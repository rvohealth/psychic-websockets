import { PsychicApp } from '@rvoh/psychic'
import { Cluster, Redis } from 'ioredis'
import { Socket, Server as SocketServer } from 'socket.io'
import Cable from '../cable/index.js'
import { cachePsychicAppWebsockets, getCachedPsychicAppWebsocketsOrFail } from './cache.js'

export default class PsychicAppWebsockets {
  public static async init(psychicApp: PsychicApp, cb: (app: PsychicAppWebsockets) => void | Promise<void>) {
    const psychicWsApp = new PsychicAppWebsockets(psychicApp)

    await cb(psychicWsApp)

    psychicApp.on('server:shutdown', async psychicServer => {
      const cable = psychicServer.$attached.cable as Cable
      if (cable) {
        await cable.stop()
        await psychicWsApp.websocketOptions.subConnection?.quit()
        psychicServer.$attached.cable = undefined
      }
    })

    psychicApp.override('server:start', async (psychicServer, { port }) => {
      const cable = new Cable(psychicServer.expressApp, psychicWsApp)
      await cable.start(port)
      psychicServer.attach('cable', cable)

      return cable.httpServer
    })

    cachePsychicAppWebsockets(psychicWsApp)

    return psychicWsApp
  }

  /**
   * Returns the cached psychic application if it has been set.
   * If it has not been set, an exception is raised.
   *
   * The psychic application can be set by calling PsychicApp#init
   */
  public static getOrFail() {
    return getCachedPsychicAppWebsocketsOrFail()
  }

  public psychicApp: PsychicApp

  public static log(...args: Parameters<typeof PsychicApp.log>) {
    const psychicWebsocketsApp = this.getOrFail()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return (psychicWebsocketsApp.psychicApp.constructor as typeof PsychicApp).log(...args)
  }

  constructor(psychicApp: PsychicApp) {
    this.psychicApp = psychicApp
  }

  private _websocketOptions: PsychicWebsocketOptions & { subConnection?: RedisOrRedisClusterConnection }
  public get websocketOptions() {
    return this._websocketOptions
  }

  private _hooks: PsychicAppWebsocketsHooks = {
    wsStart: [],
    wsConnect: [],
  }
  public get hooks() {
    return this._hooks
  }

  public on<T extends PsychicWebsocketsHookEventType>(
    hookEventType: T,
    cb: T extends 'ws:start'
      ? (server: SocketServer) => void | Promise<void>
      : T extends 'ws:connect'
        ? (socket: Socket) => void | Promise<void>
        : never,
  ) {
    switch (hookEventType) {
      case 'ws:start':
        this._hooks.wsStart.push(cb as (server: SocketServer) => void | Promise<void>)
        break

      case 'ws:connect':
        this._hooks.wsConnect.push(cb as (socket: Socket) => void | Promise<void>)
        break

      default:
        throw new Error(`unrecognized event provided to PsychicAppWebsockets#on: ${hookEventType}`)
    }
  }

  public set<Opt extends PsychicAppWebsocketsOption>(option: Opt, value: unknown) {
    switch (option) {
      case 'websockets':
        if (this.websocketOptions?.connection) {
          this.websocketOptions.connection.disconnect()
        }

        if (this.websocketOptions?.subConnection) {
          this.websocketOptions.subConnection.disconnect()
        }

        this._websocketOptions = {
          ...(value as PsychicWebsocketOptions),
          subConnection: (value as PsychicWebsocketOptions | undefined)?.connection?.duplicate(),
        }
        break

      default:
        throw new Error(`Unhandled option type passed to PsychicAppWebsockets#set: ${option}`)
    }
  }
}

interface PsychicWebsocketOptions {
  connection: Redis
}

export type PsychicAppWebsocketsOption = 'websockets'

export type PsychicWebsocketsHookEventType = 'ws:start' | 'ws:connect'

export interface PsychicAppWebsocketsHooks {
  wsStart: ((server: SocketServer) => void | Promise<void>)[]
  wsConnect: ((socket: Socket) => void | Promise<void>)[]
}

export type RedisOrRedisClusterConnection = Redis | Cluster
