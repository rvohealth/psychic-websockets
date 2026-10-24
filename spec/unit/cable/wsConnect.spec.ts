import { Socket } from 'socket.io'
import Cable from '../../../src/cable/index.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'
import isolateReferenceWebsocketHooks from './helpers/isolateReferenceWebsocketHooks.js'

function fakeSocket() {
  return { id: 'socket-abc', disconnect: vi.fn() }
}

describe('cable ws:connect hook handling', () => {
  let cable: Cable

  beforeEach(() => {
    isolateReferenceWebsocketHooks()
  })

  // start() registers a single async 'connect' listener on the socket.io server
  // that runs the ws:connect hooks; capture it so specs can drive it directly
  // with a fake socket, without a real socket.io round-trip.
  async function startAndCaptureConnectHandler(): Promise<(socket: Socket) => Promise<void>> {
    cable = new Cable()
    cable.connect()

    let connectHandler: ((socket: Socket) => Promise<void>) | undefined

    vi.spyOn(cable.io!, 'on').mockImplementation((event: string, handler: unknown) => {
      if (event === 'connect') connectHandler = handler as (socket: Socket) => Promise<void>
      return cable.io!
    })
    vi.spyOn(cable, 'listen').mockImplementation(async () => {})

    await cable.start(8888)

    return connectHandler!
  }

  it('calls each ws:connect hook with the connecting socket', async () => {
    const hookSpy = vi.fn()
    PsychicAppWebsockets.getOrFail().on('ws:connect', hookSpy)

    const connectHandler = await startAndCaptureConnectHandler()
    const socket = fakeSocket()

    await connectHandler(socket as unknown as Socket)

    expect(hookSpy).toHaveBeenCalledWith(socket)
  })

  it('continues later callbacks after a quiet disconnect and return', async () => {
    const later = vi.fn()
    const wsApp = PsychicAppWebsockets.getOrFail()
    wsApp.on('ws:connect', socket => {
      socket.disconnect(true)
    })
    wsApp.on('ws:connect', later)
    const connectHandler = await startAndCaptureConnectHandler()
    const socket = fakeSocket()
    await connectHandler(socket as unknown as Socket)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(later).toHaveBeenCalledExactlyOnceWith(socket)
  })

  context('when a ws:connect hook throws', () => {
    it('stops later callbacks after the failure', async () => {
      const wsApp = PsychicAppWebsockets.getOrFail()
      wsApp.on('ws:connect', () => {
        throw new Error('auth infrastructure failed')
      })
      const later = vi.fn()
      wsApp.on('ws:connect', later)
      vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)
      const connectHandler = await startAndCaptureConnectHandler()
      await connectHandler(fakeSocket() as unknown as Socket)
      expect(later).not.toHaveBeenCalled()
    })

    it('contains the error: logs at error level, disconnects that socket, and does not reject', async () => {
      const error = new Error('redis blipped during auth')
      PsychicAppWebsockets.getOrFail().on('ws:connect', () => {
        throw error
      })
      const logWithLevelSpy = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()

      // before containment, the async listener rejects (an unhandledRejection in
      // production, killing the ws process); it must resolve instead.
      await expect(connectHandler(socket as unknown as Socket)).resolves.not.toThrow()

      expect(logWithLevelSpy).toHaveBeenCalledWith('error', expect.any(String), error)
      expect(socket.disconnect).toHaveBeenCalledWith(true)
    })

    it('does not disconnect sockets whose hooks all succeed', async () => {
      PsychicAppWebsockets.getOrFail().on('ws:connect', vi.fn())

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()

      await connectHandler(socket as unknown as Socket)

      expect(socket.disconnect).not.toHaveBeenCalled()
    })
  })
})
