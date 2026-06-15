import { Encrypt } from '@rvoh/dream/utils'
import { Redis } from 'ioredis'
import { PsychicAppWebsockets, Ws } from '../../../src/index.js'
import User from '../app/models/User.js'
import AppEnv from './AppEnv.js'

export default (wsApp: PsychicAppWebsockets) => {
  if (AppEnv.serviceRole !== 'ws' && !AppEnv.isTest) return

  // Outside of test, the redis adapter (the default in development/production) needs
  // a connection. In test, the default in-process adapter needs no redis: unit specs
  // do zero redis I/O, and feature specs get real in-process delivery for broadcasts
  // emitted within the websocket-server process (e.g. ws:start handlers) via the
  // attached socket.io server. Cross-process fan-out still needs redis, as in prod.
  if (!AppEnv.isTest) {
    wsApp.set(
      'connection',
      new Redis({
        username: process.env.REDIS_USER,
        password: process.env.REDIS_PASSWORD,
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
        tls: process.env.REDIS_USE_SSL === '1' ? {} : undefined,
        maxRetriesPerRequest: null,
      }),
    )
  }

  wsApp.set('socketio', {
    // socketio server options here
  })

  wsApp.on('ws:start', io => {
    __forTestingOnly('ws:start')

    io.of('/').on('connection', async socket => {
      const token = socket.handshake.auth.token as string
      const userId = Encrypt.decrypt<string>(token, {
        algorithm: 'aes-256-gcm',
        key: process.env.APP_ENCRYPTION_KEY!,
      })!
      const user = await User.find(userId)

      if (user) {
        await Ws.register(socket, user.id)

        const ws = new Ws(['/ops/connection-success'] as const)
        await ws.emit(user.id, '/ops/connection-success', {
          message: 'Successfully connected to psychic websockets',
        })
      }
    })
  })

  wsApp.on('ws:connect', () => {
    __forTestingOnly('ws:connect')
  })
}

export function __forTestingOnly(message: string) {
  process.env.__PSYCHIC_HOOKS_TEST_CACHE ||= ''
  process.env.__PSYCHIC_HOOKS_TEST_CACHE += `,${message}`
}
