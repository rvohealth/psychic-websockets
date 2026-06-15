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

    context('with more than 3 register calls for the same user', () => {
      it('restricts to 3 socket ids per user key', async () => {
        await adapter.register('user:123', fakeSocket('456'))
        await adapter.register('user:123', fakeSocket('789'))
        await adapter.register('user:123', fakeSocket('345'))
        await adapter.register('user:123', fakeSocket('234'))

        expect(sort(await adapter.socketIdsFor('user:123'))).toEqual(['234', '345', '789'])
      })
    })

    it('binds disconnect cleanup to the socket', async () => {
      const onSpy = vi.fn()
      await adapter.register('user:123', fakeSocket('456', onSpy))

      // NOTE: a real disconnect round-trip would need an end-to-end test; here we
      // only assert the cleanup handler was bound.
      expect(onSpy).toHaveBeenCalledWith('disconnect', expect.any(Function))
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
  })
})
