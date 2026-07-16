import { Socket } from 'socket.io'
import Cable from '../../../src/cable/index.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSocket(): any {
  return { id: 'socket-abc', disconnect: vi.fn() }
}

describe('cable ws:error hook — ws:connect phase', () => {
  let cable: Cable

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

  context('when a ws:connect hook throws', () => {
    it('fires ws:error exactly once with { phase: ws:connect, socketId } and disconnects the socket', async () => {
      const error = new Error('redis blipped during auth')
      PsychicAppWebsockets.getOrFail().on('ws:connect', () => {
        throw error
      })
      vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      const observer = vi.fn()
      PsychicAppWebsockets.getOrFail().on('ws:error', observer)

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()

      await connectHandler(socket as Socket)

      expect(observer).toHaveBeenCalledTimes(1)
      expect(observer).toHaveBeenCalledWith(error, { phase: 'ws:connect', socketId: 'socket-abc' })
      expect(socket.disconnect).toHaveBeenCalledWith(true)
    })

    it('does not fire ws:error when every ws:connect hook succeeds', async () => {
      PsychicAppWebsockets.getOrFail().on('ws:connect', vi.fn())

      const observer = vi.fn()
      PsychicAppWebsockets.getOrFail().on('ws:error', observer)

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()

      await connectHandler(socket as Socket)

      expect(observer).not.toHaveBeenCalled()
      expect(socket.disconnect).not.toHaveBeenCalled()
    })
  })

  context('when socket.disconnect(true) itself throws', () => {
    it('the connect callback still resolves (no unhandled rejection) and ws:error still fires', async () => {
      const error = new Error('hook failed')
      PsychicAppWebsockets.getOrFail().on('ws:connect', () => {
        throw error
      })
      vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      const observer = vi.fn()
      PsychicAppWebsockets.getOrFail().on('ws:error', observer)

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()
      socket.disconnect = vi.fn(() => {
        throw new Error('disconnect blew up')
      })

      await expect(connectHandler(socket as Socket)).resolves.not.toThrow()

      expect(observer).toHaveBeenCalledTimes(1)
      expect(observer).toHaveBeenCalledWith(error, { phase: 'ws:connect', socketId: 'socket-abc' })
    })
  })

  context('when a ws:error observer throws', () => {
    it('still logs the original error, still runs a later observer, and does not recurse', async () => {
      const originalError = new Error('redis blipped during auth')
      PsychicAppWebsockets.getOrFail().on('ws:connect', () => {
        throw originalError
      })
      const logWithLevelSpy = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      const observerError = new Error('observer exploded')
      const firstObserver = vi.fn(() => {
        throw observerError
      })
      const secondObserver = vi.fn()
      PsychicAppWebsockets.getOrFail().on('ws:error', firstObserver)
      PsychicAppWebsockets.getOrFail().on('ws:error', secondObserver)

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()

      await expect(connectHandler(socket as Socket)).resolves.not.toThrow()

      // the original connect-hook error was logged
      expect(logWithLevelSpy).toHaveBeenCalledWith('error', expect.any(String), originalError)
      // both observers ran exactly once — a failing observer neither blocks the
      // next observer nor re-enters ws:error
      expect(firstObserver).toHaveBeenCalledTimes(1)
      expect(secondObserver).toHaveBeenCalledTimes(1)
      // no observer was ever invoked with the OTHER observer's error (no recursion)
      expect(firstObserver).not.toHaveBeenCalledWith(observerError, expect.anything())
      expect(secondObserver).not.toHaveBeenCalledWith(observerError, expect.anything())
    })

    it('contains a rejecting (async) observer the same way', async () => {
      const originalError = new Error('redis blipped during auth')
      PsychicAppWebsockets.getOrFail().on('ws:connect', () => {
        throw originalError
      })
      vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      const firstObserver = vi.fn(async () => {
        await Promise.reject(new Error('async observer rejected'))
      })
      const secondObserver = vi.fn()
      PsychicAppWebsockets.getOrFail().on('ws:error', firstObserver)
      PsychicAppWebsockets.getOrFail().on('ws:error', secondObserver)

      const connectHandler = await startAndCaptureConnectHandler()
      const socket = fakeSocket()

      await expect(connectHandler(socket as Socket)).resolves.not.toThrow()

      expect(firstObserver).toHaveBeenCalledTimes(1)
      expect(secondObserver).toHaveBeenCalledTimes(1)
    })
  })
})
