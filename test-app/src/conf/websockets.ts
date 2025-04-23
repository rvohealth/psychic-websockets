import { Encrypt } from '@rvoh/dream'
import { Redis } from 'ioredis'
import { PsychicAppWebsockets, Ws } from '../../../src/index.js'
import User from '../app/models/User.js'

export default (wsApp: PsychicAppWebsockets) => {
  wsApp.set('websockets', {
    connection: new Redis({
      username: process.env.REDIS_USER,
      password: process.env.REDIS_PASSWORD,
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
      tls: process.env.REDIS_USE_SSL === '1' ? {} : undefined,
      maxRetriesPerRequest: null,
    }),
  })

  // ******
  // HOOKS:
  // ******

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
        // this automatically fires the /ops/connection-success message
        await Ws.register(socket, user.id)
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
