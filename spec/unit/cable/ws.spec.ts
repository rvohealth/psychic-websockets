import Ws from '../../../src/cable/ws.js'
import InvalidWsPathError from '../../../src/error/ws/InvalidWsPathError.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'
import createUser from '../../../test-app/spec/factories/UserFactory.js'

// `Ws` is a thin facade: it validates paths, shapes the namespaced user key, and
// delegates registry + delivery to whichever adapter is active for the environment
// (in-process in test). These specs assert that delegation; the adapters' own
// behavior is covered in spec/unit/cable/adapter/*.
function activeAdapter() {
  return PsychicAppWebsockets.getOrFail().adapter()
}

describe('Ws', () => {
  describe('.register', () => {
    it('delegates to the adapter with the default-prefixed user key', async () => {
      const registerSpy = vi.spyOn(activeAdapter(), 'register').mockResolvedValue()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const socket: any = { id: '456', on: vi.fn() }

      await Ws.register(socket, '123')

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      expect(registerSpy).toHaveBeenCalledWith('user:123', socket)
    })

    context('with a custom redisKeyPrefix', () => {
      it('namespaces the user key with the custom prefix', async () => {
        const registerSpy = vi.spyOn(activeAdapter(), 'register').mockResolvedValue()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        const socket: any = { id: '456', on: vi.fn() }

        await Ws.register(socket, '123', 'admin-user')

        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        expect(registerSpy).toHaveBeenCalledWith('admin-user:123', socket)
      })
    })

    context('when passed a dream', () => {
      it('uses the primaryKeyValue of that dream', async () => {
        const user = await createUser()
        const registerSpy = vi.spyOn(activeAdapter(), 'register').mockResolvedValue()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        const socket: any = { id: '456', on: vi.fn() }

        await Ws.register(socket, user)

        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        expect(registerSpy).toHaveBeenCalledWith(`user:${user.id}`, socket)
      })
    })
  })

  describe('#emit', () => {
    it('delegates to the adapter with namespace, user key, path, and data', async () => {
      const emitSpy = vi.spyOn(activeAdapter(), 'emit').mockResolvedValue()
      const ws = new Ws(['/ops/howyadoin'] as const)

      await ws.emit(123, '/ops/howyadoin', { hello: 'world' })

      expect(emitSpy).toHaveBeenCalledWith('/', 'user:123', '/ops/howyadoin', { hello: 'world' })
    })

    context('with a custom namespace and redisKeyPrefix', () => {
      it('passes both through to the adapter', async () => {
        const emitSpy = vi.spyOn(activeAdapter(), 'emit').mockResolvedValue()
        const ws = new Ws(['/ops/howyadoin'] as const, { namespace: '/admin', redisKeyPrefix: 'admin-user' })

        await ws.emit(123, '/ops/howyadoin', { hello: 'world' })

        expect(emitSpy).toHaveBeenCalledWith('/admin', 'admin-user:123', '/ops/howyadoin', { hello: 'world' })
      })
    })

    context('when passed a dream', () => {
      it('emits to the primaryKeyValue of that dream', async () => {
        const user = await createUser()
        const emitSpy = vi.spyOn(activeAdapter(), 'emit').mockResolvedValue()
        const ws = new Ws(['/ops/howyadoin'] as const)

        await ws.emit(user, '/ops/howyadoin', { hello: 'world' })

        expect(emitSpy).toHaveBeenCalledWith('/', `user:${user.id}`, '/ops/howyadoin', { hello: 'world' })
      })
    })

    context('when passed an invalid path', () => {
      it('raises an exception and does not delegate to the adapter', async () => {
        const emitSpy = vi.spyOn(activeAdapter(), 'emit').mockResolvedValue()
        const ws = new Ws(['/ops/howyadoin'] as const)

        await expect(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ws.emit(123, '/ops/whoopsthisiswrong' as any, { hello: 'world' }),
        ).rejects.toThrowError(InvalidWsPathError)
        expect(emitSpy).not.toHaveBeenCalled()
      })
    })

    context('with no allowed paths configured', () => {
      it('permits any path', async () => {
        const emitSpy = vi.spyOn(activeAdapter(), 'emit').mockResolvedValue()
        const ws = new Ws([] as const)
        // with no allowed paths every path is permitted at runtime; call through a
        // loosened signature since the generic path constraint resolves to `never`.
        const emit = ws.emit.bind(ws) as (id: number, path: string, data: unknown) => Promise<void>

        await emit(123, '/anything/goes', { hello: 'world' })

        expect(emitSpy).toHaveBeenCalledWith('/', 'user:123', '/anything/goes', { hello: 'world' })
      })
    })
  })

  describe('#findSocketIds', () => {
    it('delegates to the adapter with the default-prefixed user key', async () => {
      const socketIdsForSpy = vi.spyOn(activeAdapter(), 'socketIdsFor').mockResolvedValue(['151'])
      const ws = new Ws([] as const)

      const socketIds = await ws.findSocketIds('150')

      expect(socketIds).toEqual(['151'])
      expect(socketIdsForSpy).toHaveBeenCalledWith('user:150')
    })

    context('with a custom redisKeyPrefix', () => {
      it('uses the custom prefix to build the user key', async () => {
        const socketIdsForSpy = vi.spyOn(activeAdapter(), 'socketIdsFor').mockResolvedValue(['161'])
        const ws = new Ws([] as const, { redisKeyPrefix: 'howyadoin' })

        await ws.findSocketIds('160')

        expect(socketIdsForSpy).toHaveBeenCalledWith('howyadoin:160')
      })
    })
  })
})
