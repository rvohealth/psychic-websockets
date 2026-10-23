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
    // socket.io emits 'disconnect' once and does not replay it to listeners added
    // later, so a socket that has already closed would leave its id behind until
    // the key's TTL (and, at the cap, evict a live socket's id first). A socket
    // still in io.use middleware is registered: it emits 'disconnect' once connected.
    if (this.hasClosed(socket)) return

    const connection = this.connection
    const redisKey = this.redisKey(userKey)

    const wsApp = PsychicAppWebsockets.getOrFail()
    const maxConnections = wsApp.maxConnectionsPerUser
    const ttlSeconds = wsApp.maxConnectionTtlSeconds

    // one transaction with no prior read, so concurrent registers (and disconnect
    // cleanups) for the same user apply one after another instead of overwriting
    // each other: drop any earlier copy of this id, append it, then trim to the most
    // recent maxConnections ids so the oldest connection is evicted first. A single
    // key keeps this valid on redis cluster, and the key stays a list so processes
    // running the previous release can share it during a rolling deploy.
    await connection
      .multi()
      .lrem(redisKey, 0, socket.id)
      .rpush(redisKey, socket.id)
      .ltrim(redisKey, -maxConnections, -1)
      .expire(redisKey, ttlSeconds)
      .exec()

    // check and bind in the same tick as the write resolving, so a socket that
    // closed while the write was in flight is cleaned up here and any later
    // disconnect reaches the listener.
    if (this.hasClosed(socket)) {
      this.deregister(connection, redisKey, socket.id)
      return
    }

    socket.on('disconnect', () => {
      this.deregister(connection, redisKey, socket.id)
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
      PsychicAppWebsockets.logWithLevel('error', 'websockets redis pub client error', error)
    })
    // subConnection is `Redis | Cluster`; both expose `.on('error', …)`, but the
    // union's listener overloads aren't directly callable, so narrow to Redis.
    ;(subClient as Redis).on('error', (error: unknown) => {
      PsychicAppWebsockets.logWithLevel('error', 'websockets redis sub client error', error)
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
   * removes a socket id from the user's registry. Best-effort: the registry key's
   * TTL is the backstop for entries this misses. Uncaught, this rejection floats on
   * every graceful shutdown ("Connection is closed.") and becomes an
   * unhandledRejection, so it is logged at warn instead.
   */
  private deregister(connection: RedisOrRedisClusterConnection, redisKey: string, socketId: string): void {
    connection.lrem(redisKey, 0, socketId).catch((error: unknown) => {
      PsychicAppWebsockets.logWithLevel(
        'warn',
        'failed to deregister socket id on disconnect (the registry key TTL will clean it up)',
        error,
      )
    })
  }

  /**
   * @internal
   *
   * whether socket.io is finished with this socket, so it will never emit
   * 'disconnect' to a listener bound now. `socket.disconnected` alone is not enough:
   * it is also true for a socket still running `io.use` middleware, which connects
   * afterward. A socket whose transport is no longer open will never connect. On
   * socket.io 4.8+, a socket that is neither connected nor held in its namespace's
   * pre-connect map has already disconnected. Earlier releases have no such map,
   * so there a not-yet-connected socket on an open transport counts as connecting.
   */
  private hasClosed(socket: Socket): boolean {
    if (!socket.disconnected) return false
    if (socket.conn.readyState !== 'open') return true

    // a private socket.io 4.8+ field, read defensively
    const preConnectSockets = (socket.nsp as unknown as { _preConnectSockets?: unknown })._preConnectSockets
    return preConnectSockets instanceof Map && !preConnectSockets.has(socket.id)
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
