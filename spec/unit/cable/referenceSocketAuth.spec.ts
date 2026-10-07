import { Encrypt } from '@rvoh/dream/utils'
import { DecryptionParseError } from '@rvoh/dream/errors'
import { createCipheriv, randomBytes } from 'node:crypto'
import { Socket } from 'socket.io'
import Cable from '../../../src/cable/index.js'
import Ws from '../../../src/cable/ws.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'
import createUser from '../../../test-app/spec/factories/UserFactory.js'
import AppEnv from '../../../test-app/src/conf/AppEnv.js'
import * as socketAuth from '../../../test-app/src/conf/websocketAuth/resolveReferenceSocketUser.js'
import User from '../../../test-app/src/app/models/User.js'
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'

function socketFor(auth: Record<string, unknown>) {
  const socket = {
    id: 'reference-socket',
    connected: true,
    handshake: { auth },
    on: vi.fn(),
    disconnect: vi.fn<(close?: boolean) => void>(() => {
      socket.connected = false
    }),
  }
  return socket
}

describe('reference websocket authentication through ws:connect', () => {
  let cable: Cable
  let connect: (socket: Socket) => Promise<void>
  let originalKey: string | undefined
  const observer = vi.fn()

  beforeEach(async () => {
    originalKey = AppEnv.string('APP_ENCRYPTION_KEY', { optional: true })
    const wsApp = PsychicAppWebsockets.getOrFail()
    wsApp.on('ws:error', observer)
    cable = new Cable()
    cable.connect()
    vi.spyOn(cable.io!, 'on').mockImplementation((event: string, handler: unknown) => {
      if (event === 'connect') connect = handler as typeof connect
      return cable.io!
    })
    vi.spyOn(cable, 'listen').mockImplementation(async () => {})
    await cable.start(8888)
  })

  afterEach(async () => {
    AppEnv.setString('APP_ENCRYPTION_KEY', originalKey)
    await cable.stop()
    vi.restoreAllMocks()
  })

  function encrypt(data: unknown) {
    return Encrypt.encrypt(data, {
      algorithm: 'aes-256-gcm',
      key: AppEnv.string('APP_ENCRYPTION_KEY'),
    })
  }

  it.each([{}, { token: '' }, { token: 'malformed' }, { token: 42 }])(
    'quietly rejects invalid credentials %j without registration or success',
    async auth => {
      const register = vi.spyOn(Ws, 'register')
      const logger = vi.spyOn(PsychicAppWebsockets, 'logWithLevel')
      const socket = socketFor(auth)
      await connect(socket as unknown as Socket)
      expect(socket.disconnect).toHaveBeenCalledWith(true)
      expect(register).not.toHaveBeenCalled()
      expect(PsychicAppWebsockets.getOrFail().adapter()).toHaveProperty('broadcasts', [])
      expect(observer).not.toHaveBeenCalled()
      expect(logger).not.toHaveBeenCalled()
    },
  )

  it('quietly rejects credentials for a deleted user', async () => {
    const user = await createUser()
    const token = encrypt(user.id)
    await user.destroy()
    const register = vi.spyOn(Ws, 'register')
    const socket = socketFor({ token })
    await connect(socket as unknown as Socket)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(register).not.toHaveBeenCalled()
    expect(observer).not.toHaveBeenCalled()
    expect(PsychicAppWebsockets.getOrFail().adapter()).toHaveProperty('broadcasts', [])
  })

  it('registers a real current user and emits authenticated success', async () => {
    const user = await createUser()
    const socket = socketFor({ token: encrypt(user.id) })
    await connect(socket as unknown as Socket)
    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    expect(await adapter.socketIdsFor(`user:${user.id}`)).toEqual([socket.id])
    expect(adapter).toHaveProperty('broadcasts', [
      {
        namespace: '/',
        userKey: `user:${user.id}`,
        path: '/ops/connection-success',
        data: { message: 'Successfully connected to psychic websockets' },
      },
    ])
    expect(socket.disconnect).not.toHaveBeenCalled()
    expect(observer).not.toHaveBeenCalled()
  })

  it.each([null, {}, 'not-a-bigint', '9223372036854775808', '-9223372036854775809'])(
    'quietly rejects invalid decrypted identity %j',
    async identity => {
      const socket = socketFor({ token: encrypt(identity) })
      const register = vi.spyOn(Ws, 'register')
      await connect(socket as unknown as Socket)
      expect(socket.disconnect).toHaveBeenCalledWith(true)
      expect(register).not.toHaveBeenCalled()
      expect(observer).not.toHaveBeenCalled()
    },
  )

  it('ignores a socket already disconnected before authentication', async () => {
    const lookup = vi.spyOn(socketAuth, 'default')
    const register = vi.spyOn(Ws, 'register')
    const socket = socketFor({})
    socket.connected = false
    await connect(socket as unknown as Socket)
    expect(lookup).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(observer).not.toHaveBeenCalled()
  })

  it('contains an authenticated plaintext format error rather than rejecting it quietly', async () => {
    const iv = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(AppEnv.string('APP_ENCRYPTION_KEY'), 'base64'),
      iv,
    )
    const ciphertext = Buffer.concat([cipher.update('not JSON', 'utf8'), cipher.final()])
    const token = Buffer.from(
      JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      }),
    ).toString('base64')
    const socket = socketFor({ token })
    const register = vi.spyOn(Ws, 'register')
    const logger = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)
    await connect(socket as unknown as Socket)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(register).not.toHaveBeenCalled()
    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.any(DecryptionParseError), {
      phase: 'ws:connect',
      socketId: socket.id,
    })
    expect(logger).toHaveBeenCalledWith('error', expect.any(String), expect.any(DecryptionParseError))
  })

  it('does not register a socket disconnected while user resolution is pending', async () => {
    const user = await createUser()
    let finishLookup!: (user: User) => void
    const pending = new Promise<User>(resolve => {
      finishLookup = resolve
    })
    const lookup = vi.spyOn(socketAuth, 'default').mockReturnValue(pending)
    const register = vi.spyOn(Ws, 'register')
    const socket = socketFor({ token: encrypt(user.id) })
    const connection = connect(socket as unknown as Socket)
    expect(lookup).toHaveBeenCalledWith(socket)
    socket.disconnect(true)
    finishLookup(user)
    await connection
    expect(register).not.toHaveBeenCalled()
    expect(PsychicAppWebsockets.getOrFail().adapter()).toHaveProperty('broadcasts', [])
  })

  it('does not emit success when the socket disconnects during registration', async () => {
    const user = await createUser()
    const socket = socketFor({ token: encrypt(user.id) })
    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    const originalRegister = adapter.register.bind(adapter)
    vi.spyOn(adapter, 'register').mockImplementation(async (userKey, registeringSocket) => {
      await originalRegister(userKey, registeringSocket)
      socket.disconnect(true)
    })
    await connect(socket as unknown as Socket)
    expect(adapter).toHaveProperty('broadcasts', [])
    expect(observer).not.toHaveBeenCalled()
  })

  it.each(['lookup', 'registration', 'emit'] as const)('contains unexpected %s failures', async boundary => {
    const user = await createUser()
    const error = new Error('infrastructure unavailable')
    const socket = socketFor({ token: encrypt(user.id) })
    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    switch (boundary) {
      case 'lookup':
        vi.spyOn(socketAuth, 'default').mockRejectedValue(error)
        break
      case 'registration':
        vi.spyOn(adapter, 'register').mockRejectedValue(error)
        break
      case 'emit':
        vi.spyOn(adapter, 'emit').mockRejectedValue(error)
        break
      default: {
        const _never: never = boundary
        throw new Error(`Unhandled failure boundary: ${String(_never)}`)
      }
    }
    const logger = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)
    await expect(connect(socket as unknown as Socket)).resolves.toBeUndefined()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(observer).toHaveBeenCalledExactlyOnceWith(error, { phase: 'ws:connect', socketId: socket.id })
    expect(logger).toHaveBeenCalledWith('error', expect.any(String), error)
    expect(adapter).toHaveProperty('broadcasts', [])
  })

  it.each([undefined, 'short-key'])('contains configuration failure for key %j', async key => {
    const user = await createUser()
    const token = encrypt(user.id)
    AppEnv.setString('APP_ENCRYPTION_KEY', key)
    const logger = vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)
    const register = vi.spyOn(Ws, 'register')
    const socket = socketFor({ token })
    await expect(connect(socket as unknown as Socket)).resolves.toBeUndefined()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(register).not.toHaveBeenCalled()
    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      phase: 'ws:connect',
      socketId: socket.id,
    })
    expect(logger).toHaveBeenCalledWith('error', expect.any(String), expect.any(Error))
  })
})

// This suite uses actual transports and the reference initializer, without any
// authentication/query/delivery replacement. It awaits server rejection before
// opening the subsequent valid client against the same running Cable.
describe('reference authentication over real sockets', () => {
  const port = 9972
  let cable: Cable
  let clients: ClientSocket[]
  const observer = vi.fn()

  beforeEach(async () => {
    clients = []
    PsychicAppWebsockets.getOrFail().on('ws:error', observer)
    cable = new Cable()
    await cable.start(port)
  })

  afterEach(async () => {
    clients.forEach(client => client.disconnect())
    await cable.stop()
    vi.restoreAllMocks()
  })

  function newClient(auth: Record<string, unknown>) {
    const client = ioClient(`http://localhost:${port}`, {
      auth,
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    })
    clients.push(client)
    return client
  }

  function awaitRejection(client: ClientSocket) {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server never rejected invalid credentials')), 4000)
      client.once('disconnect', reason => {
        clearTimeout(timeout)
        resolve(reason)
      })
      client.once('connect_error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      client.connect()
    })
  }

  function awaitSuccess(client: ClientSocket) {
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('valid user did not receive app delivery')), 4000)
      client.once('/ops/connection-success', data => {
        clearTimeout(timeout)
        resolve(data)
      })
      client.once('connect_error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      client.connect()
    })
  }

  it.each(['missing token', 'malformed token', 'deleted user'] as const)(
    'rejects %s before delivering to a subsequent valid client',
    async scenario => {
      const user = await createUser()
      const key = AppEnv.string('APP_ENCRYPTION_KEY')
      const token = Encrypt.encrypt(user.id, { algorithm: 'aes-256-gcm', key })
      let invalidAuth: Record<string, unknown> = {}
      if (scenario === 'malformed token') invalidAuth = { token: 'malformed' }
      if (scenario === 'deleted user') {
        const deletedUser = await createUser()
        invalidAuth = { token: Encrypt.encrypt(deletedUser.id, { algorithm: 'aes-256-gcm', key }) }
        await deletedUser.destroy()
      }
      const adapter = PsychicAppWebsockets.getOrFail().adapter()
      const register = vi.spyOn(adapter, 'register')
      const logger = vi.spyOn(PsychicAppWebsockets, 'logWithLevel')
      const invalidClient = newClient(invalidAuth)
      const unexpectedSuccess = vi.fn()
      invalidClient.on('/ops/connection-success', unexpectedSuccess)
      expect(await awaitRejection(invalidClient)).toBe('io server disconnect')
      expect(invalidClient.connected).toBe(false)
      expect(unexpectedSuccess).not.toHaveBeenCalled()
      expect(register).not.toHaveBeenCalled()
      expect(adapter).toHaveProperty('broadcasts', [])
      expect(observer).not.toHaveBeenCalled()
      expect(logger).not.toHaveBeenCalled()

      const validClient = newClient({ token })
      expect(await awaitSuccess(validClient)).toEqual({
        message: 'Successfully connected to psychic websockets',
      })
      expect(register).toHaveBeenCalledTimes(1)
      expect(await adapter.socketIdsFor(`user:${user.id}`)).toHaveLength(1)
      expect(observer).not.toHaveBeenCalled()
    },
  )
})
