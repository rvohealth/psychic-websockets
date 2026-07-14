export default class MissingWsRedisConnection extends Error {
  public get message() {
    return `
No websocket redis connection was found, even though
the application is configured to establish websockets.

In conf/app.ts, either:

  1.) disable websockets by omitting the call to psy.set('websockets', ...), OR
  2.) provide a redis connection for your websockets, as shown below:

export default async (psy: PsychicApp) => {
  ...

  psy.set('websockets', {
    connection: new Redis({
      host: AppEnv.string('WS_REDIS_HOST'),
      port: AppEnv.integer('WS_REDIS_PORT'),
      username: AppEnv.string('WS_REDIS_USERNAME', { optional: true }),
      password: AppEnv.string('WS_REDIS_PASSWORD', { optional: true }),
      tls: AppEnv.isProduction ? {} : undefined,
      // Bounded, not null: the socket.io redis-adapter issues no blocking
      // commands, so an unreachable Redis must fail fast rather than hang.
      maxRetriesPerRequest: 3,
      commandTimeout: 10000,
    })
  })
}

`
  }
}
