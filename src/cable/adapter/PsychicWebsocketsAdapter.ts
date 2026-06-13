import { Server as SocketServer, Socket } from 'socket.io'

/**
 * A websockets transport adapter, selected per environment (modeled on Rails'
 * ActionCable `cable.yml`). Psychic ships two implementations:
 *
 *   - {@link RedisWebsocketsAdapter} — distributes registry + broadcasts through
 *     redis (production default).
 *   - {@link InProcessWebsocketsAdapter} — keeps the registry in memory, records
 *     every broadcast for assertions, and delivers in-process through the attached
 *     socket.io server when one exists (test default).
 *
 * A `userKey` is the namespaced identity a socket is registered against, e.g.
 * `user:123` (built from the id and the `redisKeyPrefix` by {@link Ws}). Adapters
 * treat it as an opaque key.
 */
export interface PsychicWebsocketsAdapter {
  /**
   * binds a socket to the given namespaced user key, so subsequent emits to that
   * user reach this socket. Should also clean up the binding on `disconnect`.
   */
  register(userKey: string, socket: Socket): Promise<void>

  /**
   * returns the socket ids currently registered for the given namespaced user key.
   */
  socketIdsFor(userKey: string): Promise<string[]>

  /**
   * delivers `data` on `path` to every socket registered for `userKey` within the
   * given socket.io `namespace`.
   */
  emit(namespace: string, userKey: string, path: string, data: unknown): Promise<void>

  /**
   * hands the in-process socket.io server to the adapter when {@link Cable} starts.
   * The redis adapter uses it to install the redis socket.io adapter; the in-process
   * adapter stores it to deliver broadcasts directly.
   */
  attachServer(io: SocketServer): void

  /**
   * tears down any resources held by the adapter (redis connections, in-memory
   * state) when {@link Cable} stops.
   */
  shutdown(): Promise<void>
}
