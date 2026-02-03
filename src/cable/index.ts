import { DreamCLI } from '@rvoh/dream/system'
import { PsychicApp } from '@rvoh/psychic'
import { PsychicLogos } from '@rvoh/psychic/system'
import { colorize } from '@rvoh/psychic/utils'
import { createAdapter } from '@socket.io/redis-adapter'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as socketio from 'socket.io'
import MissingWsRedisConnection from '../error/ws/MissingWsRedisConnection.js'
import EnvInternal from '../helpers/EnvInternal.js'
import PsychicAppWebsockets, { RedisOrRedisClusterConnection } from '../psychic-app-websockets/index.js'

export default class Cable {
  public io: socketio.Server | undefined
  public httpServer: http.Server
  private redisConnections: RedisOrRedisClusterConnection[] = []

  /**
   * @internal
   *
   * creates or uses the provided http server and binds it to a new socket.io server.
   * this is automatically called when you call `start`.
   * @param httpServer - optional http server to attach socket.io to; if omitted, a basic http server is created
   */
  public connect(httpServer?: http.Server | https.Server) {
    if (this.io) return
    this.httpServer = httpServer ?? this.buildHttpServer()

    const config = PsychicAppWebsockets.getOrFail()
    this.io = new socketio.Server(this.httpServer, {
      cors: config.psychicApp.corsOptions,
      ...config.socketioOptions,
    })
  }

  private buildHttpServer() {
    const wsApp = PsychicAppWebsockets.getOrFail()
    const sslCredentials = wsApp.psychicApp.sslCredentials

    if (sslCredentials?.key && sslCredentials?.cert) {
      return https.createServer({
        key: fs.readFileSync(sslCredentials.key),
        cert: fs.readFileSync(sslCredentials.cert),
        ca: sslCredentials.ca?.map(filePath => fs.readFileSync(filePath)),
        rejectUnauthorized: sslCredentials?.rejectUnauthorized,
        ...wsApp.psychicApp.httpServerOptions,
      })
    } else {
      return http.createServer(wsApp.psychicApp.httpServerOptions)
    }
  }

  /**
   * builds an http server and a socket.io server, binding to redis
   * to enable redis pubsub, then starts the http server.
   */
  public async start(port?: number) {
    this.connect()

    const config = PsychicAppWebsockets.getOrFail()

    for (const hook of config.hooks.wsStart) {
      await hook(this.io!)
    }

    this.io!.on('connect', async socket => {
      for (const hook of config.hooks.wsConnect) {
        await hook(socket)
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
    const config = PsychicAppWebsockets.getOrFail()
    const pubClient = config.connection
    const subClient = config.subConnection

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
    DreamCLI.logger.log(colorize('✺ ' + PsychicApp.getOrFail().appName + ' [ws]', { color: 'greenBright' }), {
      logPrefix: '',
    })
    DreamCLI.logger.log(colorize(`└─ http://localhost:${port.toString()}`, { color: 'greenBright' }), {
      logPrefix: '',
    })
    DreamCLI.logger.log('', { logPrefix: '' })
  } else {
    DreamCLI.logger.log(`psychic server started at port ${port} with websockets`)
  }
}
