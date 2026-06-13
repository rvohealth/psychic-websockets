import InProcessWebsocketsAdapter from '../../../../src/cable/adapter/InProcessWebsocketsAdapter.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSocket(id: string, on: (...args: any[]) => void = vi.fn()): any {
  return { id, on }
}

// a minimal stand-in for the socket.io server: io.of(namespace).to(socketId).emit(path, data)
function fakeSocketServer() {
  const emit = vi.fn()
  const to = vi.fn().mockReturnValue({ emit })
  const of = vi.fn().mockReturnValue({ to })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { server: { of } as any, of, to, emit }
}

describe('InProcessWebsocketsAdapter', () => {
  let adapter: InProcessWebsocketsAdapter

  beforeEach(() => {
    adapter = new InProcessWebsocketsAdapter()
  })

  describe('#register / #socketIdsFor', () => {
    it('tracks registered socket ids in memory per user key', async () => {
      await adapter.register('user:123', fakeSocket('456'))
      await adapter.register('user:123', fakeSocket('789'))
      await adapter.register('user:other', fakeSocket('101'))

      expect(await adapter.socketIdsFor('user:123')).toEqual(['456', '789'])
      expect(await adapter.socketIdsFor('user:other')).toEqual(['101'])
    })

    it('dedupes repeated socket ids', async () => {
      await adapter.register('user:123', fakeSocket('456'))
      await adapter.register('user:123', fakeSocket('456'))

      expect(await adapter.socketIdsFor('user:123')).toEqual(['456'])
    })

    it('removes the socket id on disconnect', async () => {
      let disconnect: () => void = () => {}
      const on = vi.fn((event: string, cb: () => void) => {
        if (event === 'disconnect') disconnect = cb
      })
      await adapter.register('user:123', fakeSocket('456', on))
      expect(await adapter.socketIdsFor('user:123')).toEqual(['456'])

      disconnect()

      expect(await adapter.socketIdsFor('user:123')).toEqual([])
    })

    context('for an unknown user key', () => {
      it('returns an empty array', async () => {
        expect(await adapter.socketIdsFor('user:nope')).toEqual([])
      })
    })
  })

  describe('#emit', () => {
    it('records every broadcast', async () => {
      await adapter.emit('/', 'user:123', '/ops/howyadoin', { hello: 'world' })

      expect(adapter.broadcasts).toEqual([
        { namespace: '/', userKey: 'user:123', path: '/ops/howyadoin', data: { hello: 'world' } },
      ])
    })

    context('without an attached server', () => {
      it('records but performs no delivery', async () => {
        await adapter.register('user:123', fakeSocket('456'))

        await adapter.emit('/', 'user:123', '/ops/howyadoin', { hello: 'world' })

        expect(adapter.broadcasts).toHaveLength(1)
      })
    })

    context('with an attached server', () => {
      it('delivers in-process to each registered socket within the namespace', async () => {
        const io = fakeSocketServer()
        adapter.attachServer(io.server)
        await adapter.register('user:123', fakeSocket('456'))

        await adapter.emit('/', 'user:123', '/ops/howyadoin', { hello: 'world' })

        expect(io.of).toHaveBeenCalledWith('/')
        expect(io.to).toHaveBeenCalledWith('456')
        expect(io.emit).toHaveBeenCalledWith('/ops/howyadoin', { hello: 'world' })
        expect(adapter.broadcasts).toHaveLength(1)
      })
    })
  })

  describe('#clearBroadcasts', () => {
    it('empties the recorded broadcasts without detaching the server', async () => {
      const io = fakeSocketServer()
      adapter.attachServer(io.server)
      await adapter.emit('/', 'user:123', '/x', {})

      adapter.clearBroadcasts()

      expect(adapter.broadcasts).toEqual([])
      // server still attached: a subsequent emit still records
      await adapter.emit('/', 'user:123', '/y', {})
      expect(adapter.broadcasts).toHaveLength(1)
    })
  })

  describe('#shutdown', () => {
    it('clears the registry, broadcasts, and detaches the server', async () => {
      const io = fakeSocketServer()
      adapter.attachServer(io.server)
      await adapter.register('user:123', fakeSocket('456'))
      await adapter.emit('/', 'user:123', '/x', {})

      await adapter.shutdown()

      expect(adapter.broadcasts).toEqual([])
      expect(await adapter.socketIdsFor('user:123')).toEqual([])

      io.of.mockClear()
      await adapter.emit('/', 'user:123', '/x', {})
      expect(io.of).not.toHaveBeenCalled()
    })
  })
})
