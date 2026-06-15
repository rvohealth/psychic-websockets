import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import InProcessWebsocketsAdapter from '../../../src/cable/adapter/InProcessWebsocketsAdapter.js'
import Cable from '../../../src/cable/index.js'
import Ws from '../../../src/cable/ws.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'

// End-to-end proof that the in-process adapter (the default in test) delivers real
// websocket broadcasts over a real socket.io connection with NO redis involved —
// the same guarantee the puppeteer feature spec covers, but without a browser.
describe('in-process websocket delivery (end-to-end, no redis)', () => {
  const port = 9971
  let cable: Cable
  let client: ClientSocket | undefined

  beforeEach(() => {
    const wsApp = PsychicAppWebsockets.getOrFail()
    wsApp.on('ws:start', server => {
      server.of('/').on('connection', async socket => {
        const userId = socket.handshake.auth.userId as string
        await Ws.register(socket, userId)
        const ws = new Ws(['/ops/connection-success'] as const)
        await ws.emit(userId, '/ops/connection-success', { message: 'connected' })
      })
    })

    cable = new Cable()
  })

  afterEach(async () => {
    client?.disconnect()
    client = undefined
    await cable.stop()
  })

  it('delivers an emit to the connected socket and records it, without any redis', async () => {
    await cable.start(port)

    const received = await new Promise<{ message: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for broadcast')), 8000)
      client = ioClient(`http://localhost:${port}`, { auth: { userId: '123' }, transports: ['websocket'] })
      client.on('/ops/connection-success', (data: { message: string }) => {
        clearTimeout(timeout)
        resolve(data)
      })
      client.on('connect_error', error => {
        clearTimeout(timeout)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })

    expect(received).toEqual({ message: 'connected' })

    const adapter = PsychicAppWebsockets.getOrFail().adapter()
    expect(adapter).toBeInstanceOf(InProcessWebsocketsAdapter)
    expect((adapter as InProcessWebsocketsAdapter).broadcasts).toContainEqual({
      namespace: '/',
      userKey: 'user:123',
      path: '/ops/connection-success',
      data: { message: 'connected' },
    })
  }, 15000)
})
