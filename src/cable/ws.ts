import { DateTime, Dream, IdType, uniq } from '@rvoh/dream'
import { Emitter } from '@socket.io/redis-emitter'
import { Redis } from 'ioredis'
import { Socket } from 'socket.io'
import EnvInternal from '../helpers/EnvInternal.js'
import PsychicAppWebsockets from '../psychic-app-websockets/index.js'
import redisWsKey from './redisWsKey.js'
import InvalidWsPathError from '../error/ws/InvalidWsPathError.js'

export default class Ws<AllowedPaths extends readonly string[]> {
  /**
   * @internal
   *
   * the socket.io redis emitter instance, used to emit
   * messages through redis to distributed websocket clusters
   */
  public io: Emitter

  /**
   * @internal
   *
   * the redis client used to bind socket.io to the redis emitter
   */
  private redisClient: Redis

  /**
   * @internal
   *
   * the redis client used to bind socket.io to the redis emitter
   */
  private booted = false

  /**
   * @internal
   *
   * the namespace used when connecting socket.io
   * this will default to '/' if it is not provided
   */
  private namespace: string

  /**
   * @internal
   *
   * when registering your application's users with psychic-websockets,
   * you need to provide the following:
   *   1. an identifier for your user (i.e. user.id)
   *   2. a redisKeyPrefix, which is used to prefix your id before storing it in redis
   *
   * this enables you to have multiple namespaces in redis to safely store ids,
   * i.e.
   *
   *  `user:1`
   *  `admin-user:1`
   */
  private redisKeyPrefix: string

  /**
   * call this method to bind a socket to a particular identifier
   *
   * @param socket - the socket.io socket instance
   * @param id - the identifier you wish to bind to this socket instance
   * @param redisKeyPrefix - (optional) the prefix you wish to use to couple to this id (defaults to 'user')
   */
  public static async register(socket: Socket, id: IdType | Dream, redisKeyPrefix: string = 'user') {
    const psychicWebsocketsApp = PsychicAppWebsockets.getOrFail()
    const redisClient = psychicWebsocketsApp.websocketOptions.connection
    const interpretedId = (id as Dream)?.isDreamInstance ? (id as Dream).primaryKeyValue : (id as IdType)
    const key = redisWsKey(interpretedId, redisKeyPrefix)

    const socketIdsToKeep = await redisClient.lrange(redisWsKey(interpretedId, redisKeyPrefix), -2, -1)

    await redisClient
      .multi()
      .del(key)
      .rpush(key, ...socketIdsToKeep, socket.id)
      .expireat(
        key,
        // TODO: make this configurable in non-test environments
        DateTime.now()
          .plus(EnvInternal.isTest ? { seconds: 15 } : { day: 1 })
          .toSeconds(),
      )
      .exec()

    socket.on('disconnect', async () => {
      await redisClient.lrem(key, 1, socket.id)
    })

    const ws = new Ws(['/ops/connection-success'] as const)
    await ws.emit(interpretedId, '/ops/connection-success', {
      message: 'Successfully connected to psychic websockets',
    })
  }

  constructor(
    public allowedPaths: AllowedPaths & readonly string[],
    {
      /**
       * the namespace used when connecting socket.io
       * this will default to '/' if it is not provided
       */
      namespace = '/',

      /**
       * when registering your application's users with psychic-websockets,
       * you need to provide the following:
       *   1. an identifier for your user (i.e. user.id)
       *   2. a redisKeyPrefix, which is used to prefix your id before storing it in redis
       *
       * this enables you to have multiple namespaces in redis to safely store ids,
       * i.e.
       *
       *  `user:1`
       *  `admin-user:1`
       */
      redisKeyPrefix = 'user',
    }: {
      namespace?: string
      redisKeyPrefix?: string
    } = {},
  ) {
    this.namespace = namespace
    this.redisKeyPrefix = redisKeyPrefix
  }

  /**
   * @internal
   *
   * establishes a new socket.io-redis emitter
   */
  public boot() {
    if (this.booted) return

    const psychicWebsocketsApp = PsychicAppWebsockets.getOrFail()
    this.redisClient = psychicWebsocketsApp.websocketOptions.connection

    this.io = new Emitter(this.redisClient).of(this.namespace)
    this.booted = true
  }

  /**
   * emits data to the requested id (or dream instance) and path
   *
   * ```ts
   * await ws.emit(123, '/ops/howyadoin', { hello: 'world' })
   * ```
   */
  public async emit<T extends Ws<AllowedPaths>, const P extends AllowedPaths[number]>(
    this: T,
    id: IdType | Dream,
    path: P,
    // eslint-disable-next-line
    data: any = {},
  ) {
    if (this.allowedPaths.length && !this.allowedPaths.includes(path)) throw new InvalidWsPathError(path)

    this.boot()
    const socketIds = await this.findSocketIds(
      (id as Dream)?.isDreamInstance ? (id as Dream).primaryKeyValue : (id as IdType),
    )

    for (const socketId of socketIds) {
      this.io.to(socketId).emit(path, data)
    }
  }

  /**
   * @internal
   *
   * used to find a redis key matching the id
   */
  public async findSocketIds(id: IdType): Promise<string[]> {
    this.boot()
    return uniq(await this.redisClient.lrange(this.redisKey(id), 0, -1))
  }

  /**
   * @internal
   *
   * builds a redis key using the provided identifier and the redisKeyPrefix provided
   * when this Ws instance was constructed.
   */
  private redisKey(userId: IdType) {
    return redisWsKey(userId, this.redisKeyPrefix)
  }
}
