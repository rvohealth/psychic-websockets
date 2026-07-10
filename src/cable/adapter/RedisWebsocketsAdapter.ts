import { uniq } from '@rvoh/dream/utils'
import { createAdapter } from '@socket.io/redis-adapter'
import { Emitter } from '@socket.io/redis-emitter'
import { Redis } from 'ioredis'
import { Server as SocketServer, Socket } from 'socket.io'
import MissingWsRedisConnection from '../../error/ws/MissingWsRedisConnection.js'
import PsychicAppWebsockets, { RedisOrRedisClusterConnection } from '../../psychic-app-websockets/index.js'
import { PsychicWebsocketsAdapter } from './PsychicWebsocketsAdapter.js'

/**
 * Production websockets adapter. Stores the user-key → socket-id registry in redis
 * and broadcasts through `@socket.io/redis-emitter`, so a clustered fleet of
 * websocket processes can all deliver to a connected socket. This is the behavior
 * Psychic shipped before the adapter seam existed.
 */
export default class RedisWebsocketsAdapter implements PsychicWebsocketsAdapter {
  private redisConnections: RedisOrRedisClusterConnection[] = []
  private _emitter: Emitter | undefined
  private _emitterConnection: RedisOrRedisClusterConnection | undefined

  public async register(userKey: string, socket: Socket): Promise<void> {
    const connection = this.connection
    const redisKey = this.redisKey(userKey)

    const wsApp = PsychicAppWebsockets.getOrFail()
    const maxConnections = wsApp.maxConnectionsPerUser
    const ttlSeconds = wsApp.maxConnectionTtlSeconds

    // keep the most recent (maxConnections - 1) socket ids, then append the new one,
    // so the user never exceeds the cap and the oldest connection is evicted first.
    // When the cap is 1 we keep none (a negative-start lrange would otherwise return
    // every id).
    const socketIdsToKeep =
      maxConnections > 1 ? await connection.lrange(redisKey, -(maxConnections - 1), -1) : []

    await connection
      .multi()
      .del(redisKey)
      .rpush(redisKey, ...socketIdsToKeep, socket.id)
      .expire(redisKey, ttlSeconds)
      .exec()

    socket.on('disconnect', () => {
      void connection.lrem(redisKey, 1, socket.id)
    })
  }

  public async socketIdsFor(userKey: string): Promise<string[]> {
    return uniq(await this.connection.lrange(this.redisKey(userKey), 0, -1))
  }

  public async emit(namespace: string, userKey: string, path: string, data: unknown): Promise<void> {
    const socketIds = await this.socketIdsFor(userKey)
    if (!socketIds.length) return

    const emitter = this.emitter().of(namespace)
    for (const socketId of socketIds) {
      emitter.to(socketId).emit(path, data)
    }
  }

  public attachServer(io: SocketServer): void {
    const wsApp = PsychicAppWebsockets.getOrFail()
    const pubClient = wsApp.connection
    const subClient = wsApp.subConnection

    if (!pubClient || !subClient) throw new MissingWsRedisConnection()

    this.redisConnections.push(pubClient)
    this.redisConnections.push(subClient)

    pubClient.on('error', (error: unknown) => {
      PsychicAppWebsockets.log('PUB CLIENT ERROR', error)
    })
    // subConnection is `Redis | Cluster`; both expose `.on('error', …)`, but the
    // union's listener overloads aren't directly callable, so narrow to Redis.
    ;(subClient as Redis).on('error', (error: unknown) => {
      PsychicAppWebsockets.log('sub CLIENT ERROR', error)
    })

    // let a failure to attach the redis adapter propagate and abort startup: were it
    // swallowed, the server would keep serving on socket.io's default in-memory
    // adapter, silently dropping every cross-process emit.
    io.adapter(createAdapter(pubClient, subClient))
  }

  public async shutdown(): Promise<void> {
    for (const connection of this.redisConnections) {
      try {
        connection.disconnect()
      } catch {
        // noop
      }
    }

    this.redisConnections = []
    this._emitter = undefined
    this._emitterConnection = undefined

    return Promise.resolve()
  }

  /**
   * @internal
   *
   * the redis connection used for the registry + emitter, read fresh from the
   * websockets app so a replaced connection is always honored.
   */
  private get connection() {
    const connection = PsychicAppWebsockets.getOrFail().connection
    if (!connection) throw new MissingWsRedisConnection()
    return connection
  }

  /**
   * @internal
   *
   * lazily builds (and caches) the redis emitter, rebuilding if the underlying
   * connection has been swapped out.
   */
  private emitter(): Emitter {
    const connection = this.connection
    if (!this._emitter || this._emitterConnection !== connection) {
      this._emitter = new Emitter(connection)
      this._emitterConnection = connection
    }
    return this._emitter
  }

  /**
   * @internal
   *
   * the redis key under which a user's socket ids are stored.
   */
  private redisKey(userKey: string): string {
    return `${userKey}:socket_ids`
  }
}
