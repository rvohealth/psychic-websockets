import { PsychicApplication, PsychicServer } from '@rvoh/psychic'
import { createAdapter } from '@socket.io/redis-adapter'
import { Application } from 'express'
import * as http from 'http'
import * as socketio from 'socket.io'
import colors from 'yoctocolors'
import MissingWsRedisConnection from '../error/ws/MissingWsRedisConnection.js'
import EnvInternal from '../helpers/EnvInternal.js'
import PsychicApplicationWebsockets, {
  RedisOrRedisClusterConnection,
} from '../psychic-application-websockets/index.js'

export default class Cable {
  public app: Application
  public io: socketio.Server | undefined
  public httpServer: http.Server
  private config: PsychicApplicationWebsockets
  private redisConnections: RedisOrRedisClusterConnection[] = []

  constructor(app: Application, config: PsychicApplicationWebsockets) {
    this.app = app
    this.config = config
  }

  public connect() {
    if (this.io) return
    // for socket.io, we have to circumvent the normal process for starting a
    // psychic server so that we can bind socket.io to the http instance.
    this.httpServer = PsychicServer.createPsychicHttpInstance(this.app, this.config.psychicApp.sslCredentials)
    this.io = new socketio.Server(this.httpServer, { cors: this.config.psychicApp.corsOptions })
  }

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
          ;(this.config.psychicApp.constructor as typeof PsychicApplication).logWithLevel(
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

    const psychicAppWebsockets = PsychicApplicationWebsockets.getOrFail()
    await this.listen({
      port: parseInt((port || psychicAppWebsockets.psychicApp.port).toString()),
    })
  }

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

  public async listen({ port }: { port: number | string }) {
    return new Promise(accept => {
      this.httpServer.listen(port, () => {
        if (!EnvInternal.isTest) {
          const app = PsychicApplicationWebsockets.getOrFail().psychicApp

          app.logger.info(PsychicServer.asciiLogo())
          app.logger.info('\n')
          app.logger.info(colors.cyan('socket server started                                      '))
          app.logger.info(
            colors.cyan(
              `psychic dev server started at port ${colors.bgBlueBright(colors.green(port.toString()))}`,
            ),
          )
          app.logger.info('\n')
        }

        accept(true)
      })
    })
  }

  public bindToRedis() {
    const pubClient = this.config.websocketOptions.connection
    const subClient = this.config.websocketOptions.subConnection

    if (!pubClient || !subClient) throw new MissingWsRedisConnection()

    this.redisConnections.push(pubClient)
    this.redisConnections.push(subClient)

    pubClient.on('error', error => {
      PsychicApplicationWebsockets.log('PUB CLIENT ERROR', error)
    })
    subClient.on('error', error => {
      PsychicApplicationWebsockets.log('sub CLIENT ERROR', error)
    })

    try {
      this.io!.adapter(createAdapter(pubClient, subClient))
    } catch (error) {
      PsychicApplicationWebsockets.log('FAILED TO ADAPT', error)
    }
  }
}
