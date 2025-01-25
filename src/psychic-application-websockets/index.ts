import { PsychicApplication } from '@rvohealth/psychic'
import { Cluster, Redis } from 'ioredis'
import { Socket, Server as SocketServer } from 'socket.io'
import Cable from '../cable'
import { cachePsychicApplicationWebsockets, getCachedPsychicApplicationWebsocketsOrFail } from './cache'

export default class PsychicApplicationWebsockets {
  public static async init(
    psychicApp: PsychicApplication,
    cb: (app: PsychicApplicationWebsockets) => void | Promise<void>,
  ) {
    const psychicWsApp = new PsychicApplicationWebsockets(psychicApp)

    await cb(psychicWsApp)

    psychicApp.on('server:shutdown', async psychicServer => {
      const cable = psychicServer.$attached.cable as Cable
      await cable?.stop()
    })

    psychicApp.override('server:start', async (psychicServer, { port, withFrontEndClient, frontEndPort }) => {
      const cable = new Cable(psychicServer.expressApp, psychicWsApp)
      await cable.start(port, {
        withFrontEndClient,
        frontEndPort,
      })
      psychicServer.attach('cable', cable)

      return cable.httpServer
    })

    cachePsychicApplicationWebsockets(psychicWsApp)

    return psychicWsApp
  }

  /**
   * Returns the cached psychic application if it has been set.
   * If it has not been set, an exception is raised.
   *
   * The psychic application can be set by calling PsychicApplication#init
   */
  public static getOrFail() {
    return getCachedPsychicApplicationWebsocketsOrFail()
  }

  public psychicApp: PsychicApplication

  public static log(...args: Parameters<typeof PsychicApplication.log>) {
    const psychicWebsocketsApp = this.getOrFail()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return (psychicWebsocketsApp.psychicApp.constructor as typeof PsychicApplication).log(...args)
  }

  constructor(psychicApp: PsychicApplication) {
    this.psychicApp = psychicApp
  }

  private _websocketOptions: PsychicWebsocketOptions & { subConnection?: RedisOrRedisClusterConnection }
  public get websocketOptions() {
    return this._websocketOptions
  }

  private _hooks: PsychicApplicationWebsocketsHooks = {
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
        throw new Error(`unrecognized event provided to PsychicApplicationWebsockets#on: ${hookEventType}`)
    }
  }

  public set<Opt extends PsychicApplicationWebsocketsOption>(option: Opt, value: unknown) {
    switch (option) {
      case 'websockets':
        this._websocketOptions = {
          ...(value as PsychicWebsocketOptions),
          subConnection: (value as PsychicWebsocketOptions | undefined)?.connection?.duplicate(),
        }
        break

      default:
        throw new Error(`Unhandled option type passed to PsychicApplicationWebsockets#set: ${option}`)
    }
  }
}

interface PsychicWebsocketOptions {
  connection: Redis
}

export type PsychicApplicationWebsocketsOption = 'websockets'

export type PsychicWebsocketsHookEventType = 'ws:start' | 'ws:connect'

export interface PsychicApplicationWebsocketsHooks {
  wsStart: ((server: SocketServer) => void | Promise<void>)[]
  wsConnect: ((socket: Socket) => void | Promise<void>)[]
}

export type RedisOrRedisClusterConnection = Redis | Cluster
