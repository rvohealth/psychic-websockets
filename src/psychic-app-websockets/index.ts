import { PsychicApp } from '@rvoh/psychic'
import { Cluster, Redis } from 'ioredis'
import { Socket, Server as SocketServer, ServerOptions as SocketioServerOptions } from 'socket.io'
import { cachePsychicAppWebsockets, getCachedPsychicAppWebsocketsOrFail } from './cache.js'

export default class PsychicAppWebsockets {
  public static async init(psychicApp: PsychicApp, cb: (app: PsychicAppWebsockets) => void | Promise<void>) {
    const psychicWsApp = new PsychicAppWebsockets(psychicApp)

    await cb(psychicWsApp)

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

  private _socketioOptions: Partial<SocketioServerOptions>
  public get socketioOptions() {
    return this._socketioOptions
  }

  private _connection: Redis
  public get connection() {
    return this._connection
  }

  private _subConnection: RedisOrRedisClusterConnection
  public get subConnection() {
    return this._subConnection
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

  public set<Opt extends PsychicAppWebsocketsOption>(
    option: Opt,
    value: Opt extends 'connection' ? Redis : Opt extends 'socketio' ? Partial<SocketioServerOptions> : never,
  ) {
    switch (option) {
      case 'connection':
        this.connection?.disconnect()
        this.subConnection?.disconnect()

        this._connection = value as Redis
        this._subConnection = (value as Redis)?.duplicate()
        break

      case 'socketio':
        this._socketioOptions = value as Partial<SocketioServerOptions>
        break

      default:
        throw new Error(`Unhandled option type passed to PsychicAppWebsockets#set: ${option}`)
    }
  }
}

export type PsychicAppWebsocketsOption = 'connection' | 'socketio'

export type PsychicWebsocketsHookEventType = 'ws:start' | 'ws:connect'

export interface PsychicAppWebsocketsHooks {
  wsStart: ((server: SocketServer) => void | Promise<void>)[]
  wsConnect: ((socket: Socket) => void | Promise<void>)[]
}

export type RedisOrRedisClusterConnection = Redis | Cluster
