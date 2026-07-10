import { sort } from '@rvoh/dream/utils'
import { Redis } from 'ioredis'
import RedisWebsocketsAdapter from '../../../../src/cable/adapter/RedisWebsocketsAdapter.js'
import MissingWsRedisConnection from '../../../../src/error/ws/MissingWsRedisConnection.js'
import PsychicAppWebsockets from '../../../../src/psychic-app-websockets/index.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSocket(id: string, on: (...args: any[]) => void = vi.fn()): any {
  return { id, on }
}

describe('RedisWebsocketsAdapter', () => {
  let adapter: RedisWebsocketsAdapter

  beforeEach(async () => {
    const wsApp = PsychicAppWebsockets.getOrFail()
    wsApp.set('connection', new Redis({ maxRetriesPerRequest: null }))
    wsApp.set('adapter', 'redis')
    // normalize the configurable limits to known values for each test. The short TTL
    // keeps real redis keys from lingering between runs (the library default is 1 day).
    wsApp.set('maxConnectionsPerUser', 3)
    wsApp.set('maxConnectionTtl', { seconds: 15 })
    adapter = wsApp.adapter() as RedisWebsocketsAdapter

    const connection = wsApp.connection
    await connection.del('user:123:socket_ids')
    await connection.del('user:otheruserid:socket_ids')
    await connection.del('user:150:socket_ids')
  })

  afterEach(() => {
    const wsApp = PsychicAppWebsockets.getOrFail()
    wsApp.connection?.disconnect()
    wsApp.subConnection?.disconnect()
  })

  describe('#register', () => {
    it('stores the socket id in redis under the user key', async () => {
      await adapter.register('user:123', fakeSocket('456'))
      await adapter.register('user:123', fakeSocket('789'))
      await adapter.register('user:otheruserid', fakeSocket('101'))

      expect(await adapter.socketIdsFor('user:123')).toEqual(['456', '789'])
      expect(await adapter.socketIdsFor('user:otheruserid')).toEqual(['101'])
    })

    context('with more than the default cap of register calls for the same user', () => {
      it('restricts to 3 socket ids per user key, evicting the oldest', async () => {
        await adapter.register('user:123', fakeSocket('456'))
        await adapter.register('user:123', fakeSocket('789'))
        await adapter.register('user:123', fakeSocket('345'))
        await adapter.register('user:123', fakeSocket('234'))

        expect(sort(await adapter.socketIdsFor('user:123'))).toEqual(['234', '345', '789'])
      })
    })

    context('with a custom maxConnectionsPerUser', () => {
      it('restricts to the configured cap, evicting the oldest', async () => {
        PsychicAppWebsockets.getOrFail().set('maxConnectionsPerUser', 2)

        await adapter.register('user:123', fakeSocket('456'))
        await adapter.register('user:123', fakeSocket('789'))
        await adapter.register('user:123', fakeSocket('345'))

        expect(sort(await adapter.socketIdsFor('user:123'))).toEqual(['345', '789'])
      })
    })

    context('with maxConnectionsPerUser set to 1', () => {
      it('keeps only the most recently registered socket id', async () => {
        PsychicAppWebsockets.getOrFail().set('maxConnectionsPerUser', 1)

        await adapter.register('user:123', fakeSocket('456'))
        await adapter.register('user:123', fakeSocket('789'))

        expect(await adapter.socketIdsFor('user:123')).toEqual(['789'])
      })
    })

    it('sets the registry key TTL from maxConnectionTtl', async () => {
      PsychicAppWebsockets.getOrFail().set('maxConnectionTtl', { seconds: 120 })

      await adapter.register('user:123', fakeSocket('456'))

      const ttl = await PsychicAppWebsockets.getOrFail().connection.ttl('user:123:socket_ids')
      expect(ttl).toBeGreaterThan(110)
      expect(ttl).toBeLessThanOrEqual(120)
    })

    it('binds disconnect cleanup to the socket', async () => {
      const onSpy = vi.fn()
      await adapter.register('user:123', fakeSocket('456', onSpy))

      // NOTE: a real disconnect round-trip would need an end-to-end test; here we
      // only assert the cleanup handler was bound.
      expect(onSpy).toHaveBeenCalledWith('disconnect', expect.any(Function))
    })

    context('when disconnect cleanup fails', () => {
      it('logs at warn instead of floating an unhandled rejection', async () => {
        let disconnectHandler: (() => void) | undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const socket = fakeSocket('456', (event: string, handler: () => void) => {
          if (event === 'disconnect') disconnectHandler = handler
        })
        await adapter.register('user:123', socket)

        // every graceful shutdown rejects cleanup this way ("Connection is closed.")
        const error = new Error('Connection is closed.')
        vi.spyOn(PsychicAppWebsockets.getOrFail().connection, 'lrem').mockRejectedValue(error)
        const logWithLevelSpy = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

        disconnectHandler!()
        await new Promise(resolve => setImmediate(resolve))

        expect(logWithLevelSpy).toHaveBeenCalledWith('warn', expect.any(String), error)
      })
    })
  })

  describe('#socketIdsFor', () => {
    it('reads the socket ids stored under the user key', async () => {
      const connection = PsychicAppWebsockets.getOrFail().connection
      await connection.rpush('user:150:socket_ids', '151')

      expect(await adapter.socketIdsFor('user:150')).toEqual(['151'])
    })

    context('for a user with no registered socket ids', () => {
      it('returns an empty array', async () => {
        expect(await adapter.socketIdsFor('user:123')).toEqual([])
      })
    })
  })

  describe('#emit', () => {
    it('emits to each registered socket id within the namespace', async () => {
      const emitSpy = vi.fn()
      const toSpy = vi.fn().mockReturnValue({ emit: emitSpy })
      const ofSpy = vi.fn().mockReturnValue({ to: toSpy })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      vi.spyOn(adapter as any, 'emitter').mockReturnValue({ of: ofSpy })
      vi.spyOn(adapter, 'socketIdsFor').mockResolvedValue(['456'])

      await adapter.emit('/', 'user:123', '/ops/howyadoin', { hello: 'world' })

      expect(ofSpy).toHaveBeenCalledWith('/')
      expect(toSpy).toHaveBeenCalledWith('456')
      expect(emitSpy).toHaveBeenCalledWith('/ops/howyadoin', { hello: 'world' })
    })

    context('when no socket ids are registered', () => {
      it('does not build an emitter', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emitterSpy = vi.spyOn(adapter as any, 'emitter')
        vi.spyOn(adapter, 'socketIdsFor').mockResolvedValue([])

        await adapter.emit('/', 'user:123', '/ops/howyadoin', { hello: 'world' })

        expect(emitterSpy).not.toHaveBeenCalled()
      })
    })
  })

  describe('#attachServer', () => {
    context('without a redis connection', () => {
      it('raises MissingWsRedisConnection', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        PsychicAppWebsockets.getOrFail().set('connection', undefined as any)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => adapter.attachServer({} as any)).toThrowError(MissingWsRedisConnection)
      })
    })

    context('when attaching the redis adapter to the socket.io server fails', () => {
      it('rethrows so startup aborts rather than silently serving on the in-memory adapter', () => {
        const error = new Error('failed to attach redis adapter')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const io: any = {
          adapter: () => {
            throw error
          },
        }

        expect(() => adapter.attachServer(io)).toThrowError(error)
      })
    })
  })
})
