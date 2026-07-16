import { DreamCLI } from '@rvoh/dream/system'
import { PsychicApp } from '@rvoh/psychic'
import { PsychicLogos } from '@rvoh/psychic/system'
import { colorize } from '@rvoh/psychic/utils'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as socketio from 'socket.io'
import EnvInternal from '../helpers/EnvInternal.js'
import PsychicAppWebsockets, {
  PsychicWebsocketsErrorContext,
  PsychicWebsocketsErrorHook,
} from '../psychic-app-websockets/index.js'

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

    // Resolve the websockets app ONCE here and close over it for the health-check
    // request handler. The handler's error path must never re-enter
    // `PsychicAppWebsockets.getOrFail()` — that call is itself inside the failure
    // surface — so the observer list and config it needs on a throw are captured
    // now, from the same cached instance, not re-resolved mid-failure.
    const config = PsychicAppWebsockets.getOrFail()

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
    this.attachHealthCheckRoute(config)

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

  private attachHealthCheckRoute(config: PsychicAppWebsockets) {
    this.httpServer.on('request', (req, res) => {
      this.handleHealthCheckRequest(config, req, res)
    })
  }

  private handleHealthCheckRequest(
    config: PsychicAppWebsockets,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    // Defense in depth: if another 'request' listener has already answered
    // (socket.io/engine.io for its own polling requests, or a listener on an
    // app-provided http server), leave the response alone. Writing headers a
    // second time throws "Cannot write headers after they are sent to the
    // client", and on this raw http path that throw is an uncaughtException
    // that takes down the websocket process.
    if (res.headersSent || res.writableEnded) return

    try {
      const opts = config.healthCheckOptions
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
    } catch (error) {
      this.handleHealthCheckError(config, req, res, error)
    }
  }

  /**
   * A throw while answering the websocket server's own http request (the health
   * check + catch-all 404) must not hang the request or crash the process. Node's
   * http 'request' emitter does not await async listeners, so this is
   * fire-and-dispatch: settle the response FIRST (so an orchestrator can't see a
   * hung request and restart the task), then notify `ws:error` observers.
   */
  private handleHealthCheckError(
    config: PsychicAppWebsockets,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    error: unknown,
  ) {
    // The framework's own internal log carries the FULL url + method — it is
    // local, same trust level as every other framework log, and a developer who
    // needs the query string reads it here. Only the (external-bound) hook
    // context below is scrubbed.
    PsychicAppWebsockets.logWithLevel(
      'error',
      `error handling websocket health-check request (method=${req.method ?? ''} url=${req.url ?? ''})`,
      error,
    )

    // Settle the response exactly once so the request can neither hang nor be
    // written twice. 500 if nothing was sent yet; otherwise end/destroy safely.
    try {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(500)
        res.end()
      } else if (!res.writableEnded) {
        res.end()
      }
    } catch {
      // Last resort: tear the socket down so the request can't hang. This itself
      // must not throw past the handler.
      try {
        res.destroy()
      } catch {
        // nothing more can be done to settle this response
      }
    }

    // Query-stripped path only — never the raw url (its query string can carry
    // tokens/PII), no headers, no body.
    const context: PsychicWebsocketsErrorContext = {
      phase: 'ws:health-check',
      method: req.method,
      path: stripQueryString(req.url),
    }
    void this.dispatchWsError(config.hooks.wsError, error, context)
  }

  /**
   * Dispatch a framework-contained error to every `ws:error` observer, each
   * wrapped in its own try/catch. An observer's own failure is logged separately
   * and NEVER re-dispatched through `ws:error` — there is no recursion. The
   * observer list is passed in (closed over by the caller), never re-resolved via
   * `getOrFail()`, so dispatch stays outside the failure surface.
   */
  private async dispatchWsError(
    hooks: PsychicWebsocketsErrorHook[],
    error: unknown,
    context: PsychicWebsocketsErrorContext,
  ) {
    for (const hook of hooks) {
      try {
        await hook(error, context)
      } catch (observerError) {
        PsychicAppWebsockets.logWithLevel('error', 'error running ws:error hook', observerError)
      }
    }
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
        // Contain the failure without letting any containment step re-break the
        // process: log the original error, capture the socket id, disconnect only
        // this socket (inside its own try/catch), then notify ws:error observers.
        PsychicAppWebsockets.logWithLevel(
          'error',
          'error running ws:connect hooks; disconnecting socket',
          error,
        )

        // Capture the id BEFORE disconnect — socket.io removes the socket from
        // its map on disconnect, but the id remains readable on the object.
        const socketId = socket.id

        try {
          socket.disconnect(true)
        } catch (disconnectError) {
          PsychicAppWebsockets.logWithLevel(
            'error',
            'error disconnecting socket after ws:connect hook failure',
            disconnectError,
          )
        }

        await this.dispatchWsError(config.hooks.wsError, error, { phase: 'ws:connect', socketId })
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

/**
 * Strips the query string from a request url, returning the pathname only. The
 * query string is dropped at the framework boundary because it can carry
 * tokens/PII and the (external-bound) `ws:error` hook must never receive it.
 */
function stripQueryString(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
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
