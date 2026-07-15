import { DreamCLI } from '@rvoh/dream/system'
import { PsychicApp } from '@rvoh/psychic'
import { PsychicLogos } from '@rvoh/psychic/system'
import { colorize } from '@rvoh/psychic/utils'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as socketio from 'socket.io'
import EnvInternal from '../helpers/EnvInternal.js'
import PsychicAppWebsockets from '../psychic-app-websockets/index.js'

export default class Cable {
  public io: socketio.Server | undefined
  public httpServer: http.Server

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

    // Register the health-check 'request' listener BEFORE handing the server to
    // socket.io. socket.io/engine.io's `attach()` snapshots the http server's
    // existing 'request' listeners, removes them, and installs a single
    // delegating listener that calls that snapshot ONLY for non-socket.io
    // requests. A 'request' listener added *after* attach (as this one used to
    // be) is not part of the snapshot, so it fires independently for every
    // request — including socket.io's own long-polling requests, which
    // engine.io has already answered and ended. The late listener then falls
    // through to its 404 branch and calls res.writeHead() on the already-sent
    // response, throwing "Cannot write headers after they are sent to the
    // client". On this raw http path that throw is an uncaughtException that
    // crashes the websocket process. Registering first makes engine.io own the
    // delegation, so the health check never runs for socket.io requests.
    this.attachHealthCheckRoute()

    const config = PsychicAppWebsockets.getOrFail()
    this.io = new socketio.Server(this.httpServer, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      cors: config.psychicApp.corsOptions as any,
      ...config.socketioOptions,
    })
  }

  private buildHttpServer() {
    const wsApp = PsychicAppWebsockets.getOrFail()
    const sslCredentials = wsApp.psychicApp.sslCredentials

    return sslCredentials?.key && sslCredentials?.cert
      ? https.createServer({
          key: fs.readFileSync(sslCredentials.key),
          cert: fs.readFileSync(sslCredentials.cert),
          ca: sslCredentials.ca?.map(filePath => fs.readFileSync(filePath)),
          rejectUnauthorized: sslCredentials?.rejectUnauthorized,
          ...wsApp.psychicApp.httpServerOptions,
        })
      : http.createServer(wsApp.psychicApp.httpServerOptions)
  }

  private attachHealthCheckRoute() {
    this.httpServer.on('request', (req, res) => {
      // Defense in depth: if another 'request' listener has already answered
      // (socket.io/engine.io for its own polling requests, or a listener on an
      // app-provided http server), leave the response alone. Writing headers a
      // second time throws "Cannot write headers after they are sent to the
      // client", and on this raw http path that throw is an uncaughtException
      // that takes down the websocket process.
      if (res.headersSent || res.writableEnded) return

      const opts = PsychicAppWebsockets.getOrFail().healthCheckOptions
      if (opts === null) {
        res.writeHead(404)
        res.end()
        return
      }

      const sanitizedPath = `/${opts.path.replace(/^\//, '')}`

      if (req.url === sanitizedPath && req.method === opts.method) {
        if (opts.body === null) {
          res.writeHead(200)
          res.end()
        } else {
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain')
          res.end(opts.body)
        }
      } else {
        res.writeHead(404)
        res.end()
      }
    })
  }

  /**
   * builds an http server and a socket.io server, binding to redis
   * to enable redis pubsub, then starts the http server.
   */
  public async start(port: number, httpServer?: http.Server | https.Server) {
    this.connect(httpServer)

    const config = PsychicAppWebsockets.getOrFail()

    for (const hook of config.hooks.wsStart) {
      await hook(this.io!)
    }

    this.io!.on('connect', async socket => {
      // contain ws:connect hook failures to the connecting socket: without this,
      // one throwing hook (e.g. a db/redis blip during auth) is an unhandled
      // rejection that crashes the entire websocket process.
      try {
        for (const hook of config.hooks.wsConnect) {
          await hook(socket)
        }
      } catch (error) {
        PsychicAppWebsockets.logWithLevel(
          'error',
          'error running ws:connect hooks; disconnecting socket',
          error,
        )
        socket.disconnect(true)
      }
    })

    config.adapter().attachServer(this.io!)

    await this.listen({ port })
  }

  /**
   * stops the socket.io server and tears down the active websockets adapter
   * (closing redis connections when the redis adapter is in use)
   */
  public async stop() {
    // teardown is best-effort — a failing step must not prevent the next one —
    // but failures are logged so shutdown problems don't go dark.
    try {
      await this.io?.close()
    } catch (error) {
      PsychicAppWebsockets.logWithLevel('warn', 'error closing socket.io server during stop', error)
    }

    try {
      await PsychicAppWebsockets.getOrFail().adapter().shutdown()
    } catch (error) {
      PsychicAppWebsockets.logWithLevel('warn', 'error shutting down websockets adapter during stop', error)
    }
  }

  /**
   * @internal
   *
   * stops the socket.io server, closing out of all redis connections
   */
  public async listen({ port }: { port: number }) {
    return new Promise(accept => {
      this.httpServer.listen(port, () => {
        if (!EnvInternal.isTest) {
          welcomeMessage({ port })
        }

        accept(true)
      })
    })
  }
}

function welcomeMessage({ port }: { port: number }) {
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
