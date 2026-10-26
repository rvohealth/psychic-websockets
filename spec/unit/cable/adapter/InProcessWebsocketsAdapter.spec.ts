import type { Mock } from 'vitest'
import { Server as SocketServer } from 'socket.io'
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import InProcessWebsocketsAdapter from '../../../../src/cable/adapter/InProcessWebsocketsAdapter.js'

// a stand-in for a socket.io 4.8 socket that has finished connecting: socket.io
// only holds a socket in its namespace's pre-connect map while io.use middleware runs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSocket(id: string, on: (...args: any[]) => void = vi.fn()): any {
  return { id, on, disconnected: false, conn: { readyState: 'open' }, nsp: { _preConnectSockets: new Map() } }
}

// a stand-in for a socket.io 4.8 socket still running io.use middleware: not yet
// connected, its transport open, and held in the namespace's pre-connect map
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function preConnectSocket(id: string, on: (...args: any[]) => void = vi.fn()): any {
  const socket = fakeSocket(id, on)
  socket.disconnected = true
  socket.nsp._preConnectSockets.set(id, socket)
  return socket
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

    context('when the socket is already disconnected', () => {
      let on: Mock<(...args: unknown[]) => void>
      let socket: ReturnType<typeof fakeSocket>

      beforeEach(() => {
        on = vi.fn()
        socket = fakeSocket('456', on)
        socket.disconnected = true
      })

      it('does not register it or bind a disconnect handler', async () => {
        await adapter.register('user:123', socket)

        expect(await adapter.socketIdsFor('user:123')).toEqual([])
        expect(on).not.toHaveBeenCalled()
      })
    })

    context('when the socket has not finished connecting (io.use middleware)', () => {
      let on: Mock<(...args: unknown[]) => void>
      let socket: ReturnType<typeof preConnectSocket>

      beforeEach(() => {
        on = vi.fn()
        socket = preConnectSocket('456', on)
      })

      it('registers it and binds a disconnect handler', async () => {
        await adapter.register('user:123', socket)

        expect(await adapter.socketIdsFor('user:123')).toEqual(['456'])
        expect(on).toHaveBeenCalledWith('disconnect', expect.any(Function))
      })

      context('when its transport has already closed', () => {
        beforeEach(() => {
          socket.conn.readyState = 'closed'
        })

        it('does not register it or bind a disconnect handler', async () => {
          await adapter.register('user:123', socket)

          expect(await adapter.socketIdsFor('user:123')).toEqual([])
          expect(on).not.toHaveBeenCalled()
        })
      })

      context('on a socket.io release without a pre-connect map', () => {
        beforeEach(() => {
          socket.nsp = {}
        })

        it('registers it and binds a disconnect handler', async () => {
          await adapter.register('user:123', socket)

          expect(await adapter.socketIdsFor('user:123')).toEqual(['456'])
          expect(on).toHaveBeenCalledWith('disconnect', expect.any(Function))
        })
      })
    })

    context('with a real socket.io server registering from io.use middleware', () => {
      const port = 9973
      let io: SocketServer
      let client: ClientSocket | undefined

      afterEach(async () => {
        client?.disconnect()
        client = undefined
        await io.close()
      })

      it('keeps the socket registered once connected and removes it on disconnect', async () => {
        io = new SocketServer(port)
        io.use((socket, next) => {
          adapter.register('user:123', socket).then(() => next(), next)
        })
        const serverSocketId = new Promise<string>(resolve =>
          io.on('connection', socket => resolve(socket.id)),
        )
        const serverDisconnect = new Promise<void>(resolve =>
          io.on('connection', socket => socket.on('disconnect', () => resolve())),
        )

        client = ioClient(`http://localhost:${port}`, { transports: ['websocket'] })

        const socketId = await serverSocketId
        expect(await adapter.socketIdsFor('user:123')).toEqual([socketId])

        client.disconnect()
        await serverDisconnect

        expect(await adapter.socketIdsFor('user:123')).toEqual([])
      })
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
