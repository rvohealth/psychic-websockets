import { PsychicApp } from '@rvoh/psychic'
import { Cluster, Redis } from 'ioredis'
import { Socket, Server as SocketServer, ServerOptions as SocketioServerOptions } from 'socket.io'
import { PsychicWebsocketsAdapter } from '../cable/adapter/PsychicWebsocketsAdapter.js'
import resolveWebsocketsAdapter, {
  WebsocketsAdapterSelector,
} from '../cable/adapter/resolveWebsocketsAdapter.js'
import durationToSeconds from '../helpers/durationToSeconds.js'
import { WebsocketConnectionDuration } from '../types/duration.js'
import { cachePsychicAppWebsockets, getCachedPsychicAppWebsocketsOrFail } from './cache.js'

/**
 * Default cap on simultaneously-registered sockets per user key, applied by the
 * redis adapter. Override with `wsApp.set('maxConnectionsPerUser', n)`.
 */
export const DEFAULT_MAX_CONNECTIONS_PER_USER = 3

/**
 * Default time-to-live for a user's socket-id registry key. This is a
 * garbage-collection backstop for entries left behind by ungraceful disconnects,
 * not the live socket's lifetime (socket.io owns that via ping settings). Override
 * with `wsApp.set('maxConnectionTtl', { days: 1 })`.
 */
export const DEFAULT_MAX_CONNECTION_TTL: WebsocketConnectionDuration = { days: 1 }

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

  private _maxConnectionsPerUser: number | undefined
  /**
   * The maximum number of sockets registered simultaneously per user key. When a
   * user registers beyond this cap, the redis adapter evicts the oldest socket id.
   * Defaults to {@link DEFAULT_MAX_CONNECTIONS_PER_USER}.
   */
  public get maxConnectionsPerUser(): number {
    return this._maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS_PER_USER
  }

  private _maxConnectionTtl: WebsocketConnectionDuration | undefined
  /**
   * The configured registry-key TTL as a whole-unit duration. Defaults to
   * {@link DEFAULT_MAX_CONNECTION_TTL}.
   */
  public get maxConnectionTtl(): WebsocketConnectionDuration {
    return this._maxConnectionTtl ?? DEFAULT_MAX_CONNECTION_TTL
  }

  /**
   * The registry-key TTL in seconds, used by the redis adapter when setting the
   * key's expiry.
   */
  public get maxConnectionTtlSeconds(): number {
    return durationToSeconds(this.maxConnectionTtl)
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
            : Opt extends 'maxConnectionsPerUser'
              ? number
              : Opt extends 'maxConnectionTtl'
                ? WebsocketConnectionDuration
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

      case 'maxConnectionsPerUser': {
        const max = value as number
        if (!Number.isInteger(max) || max < 1)
          throw new Error(`maxConnectionsPerUser must be an integer >= 1, received: ${JSON.stringify(value)}`)
        this._maxConnectionsPerUser = max
        break
      }

      case 'maxConnectionTtl': {
        const ttl = value as WebsocketConnectionDuration
        if (durationToSeconds(ttl) <= 0)
          throw new Error(
            `maxConnectionTtl must resolve to a positive number of seconds, received: ${JSON.stringify(value)}`,
          )
        this._maxConnectionTtl = ttl
        break
      }

      default:
        throw new Error(`Unhandled option type passed to PsychicAppWebsockets#set: ${option}`)
    }
  }
}

export type PsychicAppWebsocketsOption =
  | 'connection'
  | 'socketio'
  | 'healthCheck'
  | 'adapter'
  | 'maxConnectionsPerUser'
  | 'maxConnectionTtl'

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
