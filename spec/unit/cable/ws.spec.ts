import { DateTime } from '@rvoh/dream'
import { MockInstance } from 'vitest'
import redisWsKey, * as RedisWsKeyModule from '../../../src/cable/redisWsKey'
import Ws, { InvalidWsPathError } from '../../../src/cable/ws'
import PsychicApplicationWebsockets from '../../../src/psychic-application-websockets'
import createUser from '../../../test-app/spec/factories/UserFactory'

describe('Ws', () => {
  describe('.register', () => {
    beforeEach(async () => {
      const psychicApp = PsychicApplicationWebsockets.getOrFail()
      const redisClient = psychicApp.websocketOptions.connection
      await redisClient.del(`user:123:socket_ids`)
      await redisClient.del(`user:otheruserid:socket_ids`)
    })

    it('puts socket id in redis', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await Ws.register({ id: '456', on: vi.fn() } as any, '123')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await Ws.register({ id: '789', on: vi.fn() } as any, '123')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await Ws.register({ id: '101', on: vi.fn() } as any, 'otheruserid')

      const socketIds = await new Ws([]).findSocketIds('123')
      expect(socketIds).toEqual(['456', '789'])
    })

    context('with more than 3 register calls for the same user', () => {
      it('restricts to 3 per unique id', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        await Ws.register({ id: '456', on: vi.fn() } as any, '123')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        await Ws.register({ id: '789', on: vi.fn() } as any, '123')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        await Ws.register({ id: '345', on: vi.fn() } as any, '123')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        await Ws.register({ id: '234', on: vi.fn() } as any, '123')

        const socketIds = await new Ws([]).findSocketIds('123')
        expect(socketIds).toEqual(['789', '345', '234'])
      })
    })

    it('binds disconnect logic to socket', async () => {
      const onSpy = vi.fn()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await Ws.register({ id: '456', on: onSpy } as any, '123')

      // NOTE: would be better to get a solid test around disconnection behavior, but that would need to be
      // an end-to-end test.
      expect(onSpy).toHaveBeenCalledWith('disconnect', expect.any(Function))
    })

    it('calls emit to the passed id', async () => {
      const emitSpy = vi.spyOn(Ws.prototype, 'emit').mockImplementation(async () => {})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await Ws.register({ id: '986', on: vi.fn() } as any, '987')

      expect(emitSpy).toHaveBeenCalledWith('987', '/ops/connection-success', {
        message: 'Successfully connected to psychic websockets',
      })
    })

    context('when passed a dream', () => {
      it('calls the primaryKeyValue of that dream instance', async () => {
        const user = await createUser()
        const emitSpy = vi.spyOn(Ws.prototype, 'emit').mockImplementation(async () => {})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        await Ws.register({ id: '986', on: vi.fn() } as any, user)

        expect(emitSpy).toHaveBeenCalledWith(user.id, '/ops/connection-success', {
          message: 'Successfully connected to psychic websockets',
        })
      })
    })
  })

  describe('#emit', () => {
    let ws: Ws<readonly string[]>
    let findSocketIdsSpy: MockInstance
    let toSpy: MockInstance
    let emitSpy: MockInstance

    function buildWsInstanceForEmitTests(findSocketIdsValue: string[]) {
      ws = new Ws(['/ops/howyadoin'] as const)
      ws.boot()

      findSocketIdsSpy = vi.spyOn(ws, 'findSocketIds').mockResolvedValue(findSocketIdsValue)
      emitSpy = vi.fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      toSpy = vi.spyOn(ws.io, 'to').mockReturnValue({ emit: emitSpy } as any)
    }

    it('emits to the passed id to the default socket.io namespace, using "user" (by default) as the redis key prefix', async () => {
      buildWsInstanceForEmitTests(['456'])
      await ws.emit(123, '/ops/howyadoin', { hello: 'world' })
      expect(findSocketIdsSpy).toHaveBeenCalledWith(123)
      expect(toSpy).toHaveBeenCalledWith('456')
      expect(emitSpy).toHaveBeenCalledWith('/ops/howyadoin', { hello: 'world' })
    })

    context('findSocketIds does not find any socket ids for the user', () => {
      it('does not emit to the passed id with the "user" namespace', async () => {
        buildWsInstanceForEmitTests([])
        await ws.emit(123, '/ops/howyadoin', { hello: 'world' })
        expect(toSpy).not.toHaveBeenCalled()
        expect(emitSpy).not.toHaveBeenCalled()
      })
    })

    context('when passed a dream', () => {
      it('emits to the primaryKeyValue of that dream', async () => {
        const user = await createUser()
        buildWsInstanceForEmitTests(['456'])
        await ws.emit(user, '/ops/howyadoin', { hello: 'world' })
        expect(toSpy).toHaveBeenCalledWith('456')
        expect(findSocketIdsSpy).toHaveBeenCalledWith(user.id)
        expect(emitSpy).toHaveBeenCalledWith('/ops/howyadoin', { hello: 'world' })
      })
    })

    context('when passed an invalid path', () => {
      it('raises an exception', async () => {
        const user = await createUser()
        buildWsInstanceForEmitTests(['456'])

        await expect(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ws.emit(user, '/ops/whoopsthisiswrong' as any, { hello: 'world' }),
        ).rejects.toThrowError(InvalidWsPathError)
      })
    })
  })

  describe('#findSocketIds', () => {
    let ws: Ws<[]>
    beforeEach(async () => {
      const psychicAppWebsockets = PsychicApplicationWebsockets.getOrFail()
      const redisClient = psychicAppWebsockets.websocketOptions.connection

      const key = redisWsKey('150', 'user')
      const otherKey = redisWsKey('160', 'howyadoin')

      await redisClient
        .multi()
        .rpush(key, '151')
        .expireat(key, DateTime.now().plus({ seconds: 15 }).toSeconds())
        .exec()

      await redisClient
        .multi()
        .rpush(otherKey, '161')
        .expireat(key, DateTime.now().plus({ seconds: 15 }).toSeconds())
        .exec()

      ws = new Ws([] as const)
      ws.boot()
    })

    it('calls to redis to find socket ids', async () => {
      const redisWsKeySpy = vi.spyOn(RedisWsKeyModule, 'default')
      const socketIds = await ws.findSocketIds('150')
      expect(socketIds).toEqual(['151'])
      expect(redisWsKeySpy).toHaveBeenCalledWith('150', 'user')
    })

    context('with a custom redisKeyPrefix', () => {
      it('uses the custom prefix to generate the redis key', async () => {
        const redisWsKeySpy = vi.spyOn(RedisWsKeyModule, 'default')
        ws = new Ws([] as const, { redisKeyPrefix: 'howyadoin' })
        const socketIds = await ws.findSocketIds('160')
        expect(socketIds).toEqual(['161'])
        expect(redisWsKeySpy).toHaveBeenCalledWith('160', 'howyadoin')
      })
    })

    context('for a user with no registered socket ids', () => {
      it('returns a blank array', async () => {
        const socketIds = await ws.findSocketIds('123123123')
        expect(socketIds).toEqual([])
      })
    })
  })
})
