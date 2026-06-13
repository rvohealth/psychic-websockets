import { PsychicApp } from '@rvoh/psychic'
import { Cluster, Redis } from 'ioredis'
import { Socket, Server as SocketServer, ServerOptions as SocketioServerOptions } from 'socket.io'
import { PsychicWebsocketsAdapter } from '../cable/adapter/PsychicWebsocketsAdapter.js'
import resolveWebsocketsAdapter, {
  WebsocketsAdapterSelector,
} from '../cable/adapter/resolveWebsocketsAdapter.js'
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

  private _adapterSelector: WebsocketsAdapterSelector | undefined
  private _resolvedAdapter: PsychicWebsocketsAdapter | undefined

  /**
   * Returns the websockets adapter for this environment, resolving (and memoizing)
   * the configured selector on first use. Defaults cable.yml-style: `test` →
   * in-process, `development`/`production` → redis. Override with
   * `wsApp.set('adapter', 'redis' | 'in_process' | <instance>)`.
   */
  public adapter(): PsychicWebsocketsAdapter {
    return (this._resolvedAdapter ??= resolveWebsocketsAdapter(this._adapterSelector))
  }

  private _hooks: PsychicAppWebsocketsHooks = {
    wsStart: [],
    wsConnect: [],
  }
  public get hooks() {
    return this._hooks
  }

  private defaultHealthCheckOptions: HealthCheckOptions = {
    path: '/healthcheck',
    method: 'GET',
    body: null,
  }
  private _healthCheckOptions: HealthCheckOptions | null = {
    ...this.defaultHealthCheckOptions,
  }
  public get healthCheckOptions() {
    return this._healthCheckOptions
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
    value: Opt extends 'connection'
      ? Redis
      : Opt extends 'socketio'
        ? Partial<SocketioServerOptions>
        : Opt extends 'healthCheck'
          ? Partial<HealthCheckOptions> | null
          : Opt extends 'adapter'
            ? WebsocketsAdapterSelector
            : never,
  ) {
    switch (option) {
      case 'connection':
        this.connection?.disconnect()
        this.subConnection?.disconnect()

        this._connection = value as Redis
        this._subConnection = (value as Redis)?.duplicate()
        break

      case 'adapter':
        this._adapterSelector = value as WebsocketsAdapterSelector
        this._resolvedAdapter = undefined
        break

      case 'healthCheck':
        if (value === null) {
          this._healthCheckOptions = null
        } else {
          this._healthCheckOptions = {
            ...this.defaultHealthCheckOptions,
            ...(value as HealthCheckOptions),
          }
        }
        break

      case 'socketio':
        this._socketioOptions = value as Partial<SocketioServerOptions>
        break

      default:
        throw new Error(`Unhandled option type passed to PsychicAppWebsockets#set: ${option}`)
    }
  }
}

export type PsychicAppWebsocketsOption = 'connection' | 'socketio' | 'healthCheck' | 'adapter'

interface HealthCheckOptions {
  path: string
  method: 'GET' | 'HEAD'
  body: string | null
}

export type PsychicWebsocketsHookEventType = 'ws:start' | 'ws:connect'

export interface PsychicAppWebsocketsHooks {
  wsStart: ((server: SocketServer) => void | Promise<void>)[]
  wsConnect: ((socket: Socket) => void | Promise<void>)[]
}

export type RedisOrRedisClusterConnection = Redis | Cluster
