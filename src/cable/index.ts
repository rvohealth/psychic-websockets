import { DreamCLI } from '@rvoh/dream'
import { colorize, PsychicApp, PsychicLogos, PsychicServer } from '@rvoh/psychic'
import { createAdapter } from '@socket.io/redis-adapter'
import { Express } from 'express'
import * as http from 'http'
import * as socketio from 'socket.io'
import MissingWsRedisConnection from '../error/ws/MissingWsRedisConnection.js'
import EnvInternal from '../helpers/EnvInternal.js'
import PsychicAppWebsockets, { RedisOrRedisClusterConnection } from '../psychic-app-websockets/index.js'

export default class Cable {
  public app: Express
  public io: socketio.Server | undefined
  public httpServer: http.Server
  private config: PsychicAppWebsockets
  private redisConnections: RedisOrRedisClusterConnection[] = []

  constructor(app: Express, config: PsychicAppWebsockets) {
    this.app = app
    this.config = config
  }

  /**
   * @internal
   *
   * creates a new http server and binds it to a new socket.io server.
   * this is automatically called when you call `start`.
   */
  public connect() {
    if (this.io) return
    // for socket.io, we have to circumvent the normal process for starting a
    // psychic server so that we can bind socket.io to the http instance.
    this.httpServer = PsychicServer.createPsychicHttpInstance(this.app, this.config.psychicApp.sslCredentials)
    this.io = new socketio.Server(this.httpServer, { cors: this.config.psychicApp.corsOptions })
  }

  /**
   * builds an http server and a socket.io server, binding to redis
   * to enable redis pubsub, then starts the http server.
   */
  public async start(port?: number) {
    this.connect()

    for (const hook of this.config.hooks.wsStart) {
      await hook(this.io!)
    }

    this.io!.on('connect', async socket => {
      try {
        for (const hook of this.config.hooks.wsConnect) {
          await hook(socket)
        }
      } catch (error) {
        if (EnvInternal.boolean('PSYCHIC_DANGEROUSLY_PERMIT_WS_EXCEPTIONS')) throw error
        else {
          ;(this.config.psychicApp.constructor as typeof PsychicApp).logWithLevel(
            'error',
            `
            An exception was caught in your websocket thread.
            To prevent your server from crashing, we are rescuing this error here for you.
            If you would like us to raise this exception, make sure to set

            PSYCHIC_DANGEROUSLY_PERMIT_WS_EXCEPTIONS=1

            the error received is:

            ${(error as Error).message}
          `,
          )
          console.trace()
        }
      }
    })

    this.bindToRedis()

    const psychicAppWebsockets = PsychicAppWebsockets.getOrFail()
    await this.listen({
      port: parseInt((port || psychicAppWebsockets.psychicApp.port).toString()),
    })
  }

  /**
   * stops the socket.io server, closing out of all redis connections
   */
  public async stop() {
    try {
      await this.io?.close()
    } catch {
      // noop
    }

    for (const connection of this.redisConnections) {
      try {
        connection.disconnect()
      } catch {
        // noop
      }
    }
  }

  /**
   * @internal
   *
   * stops the socket.io server, closing out of all redis connections
   */
  public async listen({ port }: { port: number | string }) {
    return new Promise(accept => {
      this.httpServer.listen(port, () => {
        if (!EnvInternal.isTest) {
          welcomeMessage({ port })
        }

        accept(true)
      })
    })
  }

  /**
   * @internal
   *
   * establishes redis pubsub mechanisms
   */
  public bindToRedis() {
    const pubClient = this.config.websocketOptions.connection
    const subClient = this.config.websocketOptions.subConnection

    if (!pubClient || !subClient) throw new MissingWsRedisConnection()

    this.redisConnections.push(pubClient)
    this.redisConnections.push(subClient)

    pubClient.on('error', error => {
      PsychicAppWebsockets.log('PUB CLIENT ERROR', error)
    })
    subClient.on('error', error => {
      PsychicAppWebsockets.log('sub CLIENT ERROR', error)
    })

    try {
      this.io!.adapter(createAdapter(pubClient, subClient))
    } catch (error) {
      PsychicAppWebsockets.log('FAILED TO ADAPT', error)
    }
  }
}

function welcomeMessage({ port }: { port: number | string }) {
  if (EnvInternal.isDevelopment) {
    DreamCLI.logger.log(colorize(PsychicLogos.asciiLogo(), { color: 'greenBright' }), {
      logPrefix: '',
    })
    DreamCLI.logger.log('', { logPrefix: '' })
    DreamCLI.logger.log(colorize('✺ ' + PsychicApp.getOrFail().appName, { color: 'greenBright' }), {
      logPrefix: '',
    })
    DreamCLI.logger.log(colorize(`└─ http://localhost:${port.toString()}`, { color: 'greenBright' }), {
      logPrefix: '',
    })
    DreamCLI.logger.log('', { logPrefix: '' })
  } else {
    DreamCLI.logger.log(`psychic dev server started at port ${port} with websockets`)
  }
}
