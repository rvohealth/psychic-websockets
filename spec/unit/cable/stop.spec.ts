import Cable from '../../../src/cable/index.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'

describe('cable#stop', () => {
  let cable: Cable

  beforeEach(() => {
    cable = new Cable()
    cable.connect()
  })

  it('closes the socket.io server and shuts down the adapter', async () => {
    const closeSpy = vi.spyOn(cable.io!, 'close').mockResolvedValue()
    const shutdownSpy = vi.spyOn(PsychicAppWebsockets.getOrFail().adapter(), 'shutdown').mockResolvedValue()

    await cable.stop()

    expect(closeSpy).toHaveBeenCalled()
    expect(shutdownSpy).toHaveBeenCalled()
  })

  context('when closing the socket.io server fails', () => {
    it('logs at warn and still shuts down the adapter', async () => {
      const error = new Error('io close failed')
      vi.spyOn(cable.io!, 'close').mockRejectedValue(error)
      const shutdownSpy = vi.spyOn(PsychicAppWebsockets.getOrFail().adapter(), 'shutdown').mockResolvedValue()
      const logWithLevelSpy = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      await cable.stop()

      expect(logWithLevelSpy).toHaveBeenCalledWith('warn', expect.any(String), error)
      expect(shutdownSpy).toHaveBeenCalled()
    })
  })

  context('when shutting down the websockets adapter fails', () => {
    it('logs at warn and still resolves', async () => {
      const error = new Error('adapter shutdown failed')
      vi.spyOn(cable.io!, 'close').mockResolvedValue()
      vi.spyOn(PsychicAppWebsockets.getOrFail().adapter(), 'shutdown').mockRejectedValue(error)
      const logWithLevelSpy = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

      await cable.stop()

      expect(logWithLevelSpy).toHaveBeenCalledWith('warn', expect.any(String), error)
    })
  })
})
