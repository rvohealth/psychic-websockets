import { Server as SocketServer, Socket } from 'socket.io'
import { PsychicWebsocketsAdapter } from './PsychicWebsocketsAdapter.js'

/**
 * A single recorded broadcast, captured by {@link InProcessWebsocketsAdapter} every
 * time something emits. Assertable in specs via the `./testing` helpers.
 */
export interface RecordedBroadcast {
  namespace: string
  userKey: string
  path: string
  data: unknown
}

/**
 * In-process websockets adapter (test default; also selectable for development).
 * This is Rails' "the test adapter extends the async adapter" idea in one class:
 *
 *   - it keeps the user-key → socket-id registry in memory (no redis I/O), so unit
 *     specs that emit through backgrounded app flows do zero external work;
 *   - it records every broadcast into {@link broadcasts} so specs can assert on what
 *     would have been delivered; and
 *   - when a socket.io server has been attached (i.e. {@link Cable} actually started,
 *     as in feature specs), it ALSO delivers each broadcast in-process to the live
 *     sockets — giving real end-to-end delivery with no external redis.
 */
export default class InProcessWebsocketsAdapter implements PsychicWebsocketsAdapter {
  /**
   * every broadcast emitted while this adapter is active, in order. Read/cleared
   * through the `@rvoh/psychic-websockets/testing` helpers.
   */
  public broadcasts: RecordedBroadcast[] = []

  private registry = new Map<string, Set<string>>()
  private io: SocketServer | undefined

  public register(userKey: string, socket: Socket): Promise<void> {
    let socketIds = this.registry.get(userKey)
    if (!socketIds) {
      socketIds = new Set<string>()
      this.registry.set(userKey, socketIds)
    }
    socketIds.add(socket.id)

    socket.on('disconnect', () => {
      this.registry.get(userKey)?.delete(socket.id)
    })

    return Promise.resolve()
  }

  public socketIdsFor(userKey: string): Promise<string[]> {
    return Promise.resolve([...(this.registry.get(userKey) ?? [])])
  }

  public async emit(namespace: string, userKey: string, path: string, data: unknown): Promise<void> {
    this.broadcasts.push({ namespace, userKey, path, data })

    if (!this.io) return

    const socketIds = await this.socketIdsFor(userKey)
    for (const socketId of socketIds) {
      this.io.of(namespace).to(socketId).emit(path, data)
    }
  }

  public attachServer(io: SocketServer): void {
    this.io = io
  }

  public shutdown(): Promise<void> {
    this.io = undefined
    this.registry.clear()
    this.broadcasts = []
    return Promise.resolve()
  }

  /**
   * clears recorded broadcasts without otherwise tearing down the adapter. Used by
   * the `./testing` `clearBroadcasts()` helper between assertions.
   */
  public clearBroadcasts(): void {
    this.broadcasts = []
  }
}
