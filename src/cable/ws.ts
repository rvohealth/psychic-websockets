import { Dream } from '@rvoh/dream'
import { Socket } from 'socket.io'
import InvalidWsPathError from '../error/ws/InvalidWsPathError.js'
import PsychicAppWebsockets from '../psychic-app-websockets/index.js'

/**
 * Thin facade over the configured websockets adapter. `Ws` validates paths and
 * builds the namespaced user key, then delegates registry + delivery to whichever
 * {@link PsychicWebsocketsAdapter} is active for the environment (redis in
 * production, in-process in test). The public surface — `new Ws(paths)`, `ws.emit`,
 * `Ws.register`, `ws.findSocketIds` — is unchanged.
 */
export default class Ws<AllowedPaths extends readonly string[]> {
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
   *   2. a redisKeyPrefix, which is used to prefix your id before storing it
   *
   * this enables you to have multiple namespaces of ids, i.e.
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
  public static async register(socket: Socket, id: string | number | Dream, redisKeyPrefix: string = 'user') {
    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    await adapter.register(wsUserKey(idOrDreamToId(id), redisKeyPrefix), socket)
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
       *   2. a redisKeyPrefix, which is used to prefix your id before storing it
       *
       * this enables you to have multiple namespaces of ids, i.e.
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
   * emits data to the requested id (or dream instance) and path
   *
   * ```ts
   * await ws.emit(123, '/ops/howyadoin', { hello: 'world' })
   * ```
   */
  public async emit<T extends Ws<AllowedPaths>, const P extends AllowedPaths[number]>(
    this: T,
    id: string | number | Dream,
    path: P,
    // eslint-disable-next-line
    data: any = {},
  ) {
    if (this.allowedPaths.length && !this.allowedPaths.includes(path)) throw new InvalidWsPathError(path)

    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    await adapter.emit(this.namespace, this.userKey(idOrDreamToId(id)), path, data)
  }

  /**
   * @internal
   *
   * used to find the socket ids registered for the provided id
   */
  public async findSocketIds(userId: string): Promise<string[]> {
    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    return adapter.socketIdsFor(this.userKey(userId))
  }

  /**
   * @internal
   *
   * builds the namespaced user key from the provided identifier and the
   * redisKeyPrefix provided when this Ws instance was constructed.
   */
  private userKey(userId: string) {
    return wsUserKey(userId, this.redisKeyPrefix)
  }
}

function idOrDreamToId(id: string | number | Dream) {
  return id instanceof Dream ? (id.primaryKeyValue() as string).toString() : (id as string).toString()
}

/**
 * the namespaced identity a socket is registered against, e.g. `user:123`.
 */
function wsUserKey(userId: string, redisKeyPrefix: string) {
  return `${redisKeyPrefix}:${userId}`
}
