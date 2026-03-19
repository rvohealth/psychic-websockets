## 3.1.0

- We recommend you pass cors options yourself, since the types are no longer congruent. If cors configuration is needed, it should be set up in the websockets config, using `wsApp.set('socketioOptions', { cors: ... })`.
- update to the latest psychic. Bumping minor versions because this also changes the peer dependency for psychic to ^3.0.0, which will force users to update to the latest psychic, which does possibly introduce breaking changes, if they were leveraging middleware, or else if they were tapping into `this.req` or `this.res` from a controller. See the psychic changelog for more info:

https://github.com/rvohealth/psychic/blob/main/CHANGELOG.md

## 3.0.0

Decouple psychic web server from websocket server. This was an architectural mis-step that needed to be remedied, since the single-threaded nature of node meant that failure to catch an exception within your socket.io callbacks would could cause your express server to come down as well.

Additionally, a health check route has been added to the http server encapsulating the socket.io service. This route is configurable via options in the `conf/websockets.ts` file using `wsApp.set('healthCheck', opts)`.

Moving forward, all apps using psychic-websockets v3 will need the following in place in order to get websockets working in your existing applications again.

1. add the following to your AppEnv.ts file (you can otherwise keep it the way you had it, just need a few new booleans and a serviceRole method, as well as the new ServiceRole type):

```ts
import { Env } from '@rvoh/dream'

class AppEnvClass extends Env<{
  boolean: 'WEB_SERVICE' | 'WS_SERVICE'
}> {
  public get serviceRole(): ServiceRole {
    return AppEnv.boolean('WS_SERVICE') ? 'ws' : AppEnv.boolean('WEB_SERVICE') ? 'web' : 'unknown'
  }
}

type ServiceRole = 'ws' | 'web' | 'unknown'

const AppEnv = new AppEnvClass()
export default AppEnv
```

2. add a src/ws.ts file with the following contents:

```ts
import './src/conf/global.js'

import initializePsychicApp from './src/cli/helpers/initializePsychicApp.js'
import { Cable } from '../src/index.js'
import AppEnv from './src/conf/AppEnv.js'

let cable: Cable | null = null

async function startWs() {
  process.env.WS_SERVICE = '1'
  await initializePsychicApp()

  cable = new Cable()
  await cable.start(AppEnv.integer('WS_PORT', { optional: true }) || (AppEnv.isTest ? 8889 : 8888))
}

// begin: error handling
process.on('uncaughtException', err => {
  console.error('Uncaught websockets exception:', err)
  void shutdown('uncaughtException')
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled websockets promise rejection at', promise, 'reason:', reason)
  void shutdown('unhandledRejection')
})

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

async function shutdown(shutdownReason: ShutdownReason) {
  if (cable) {
    await cable.stop()
    cable = null
  }

  switch (shutdownReason) {
    case 'uncaughtException':
    case 'unhandledRejection':
      process.exit(1)

    // eslint-disable-next-line no-fallthrough
    default:
      process.exit(0)
  }
}

type ShutdownReason = 'uncaughtException' | 'unhandledRejection' | 'SIGINT' | 'SIGTERM'
// end: error handling

void startWs()
```

3. Update your fspec hooks to add the following, so that your websocket service will start when you run specs, and then terminate when you stop them:

```ts
beforeAll(async () => {
  ...
  await PsychicDevtools.launchDevServer('ws', {
    cmd: 'pnpm ws:fspec',
    port: AppEnv.integer('WS_PORT', { optional: true }) || 8888,
  })
})

afterAll(async () => {
  ...
  PsychicDevtools.stopDevServer('ws')
})
```

4. Update any clients connecting to websockets to use the new url. In this case, it will just be localhost:8888, but you can use whatever ports you want, as long as you also make sure to use that port for the `WS_PORT` env var.

5. Add the following to `src/conf/initializers/websockets.ts`, so that there is a guard to prevent needlessly configuring when you are not running websockets:

```ts
export default (wsApp: PsychicAppWebsockets) => {
  if (AppEnv.serviceRole !== 'ws' && !AppEnv.isTest) return
  ...
```

6. Add the following package.json scripts:

```json
  "scripts":
    ...
    "ws": "NODE_ENV=development tsx ./test-app/ws.ts",
    "ws:fspec": "NODE_ENV=test tsx ./test-app/ws.ts",
```

7. `conf/websockets.ts` has simplified the api to set the redis connection, and also now provides the ability to directly pass low-level socket.io server options, which will be fed into the socket.io server as it is provisioned:

```ts
export default (wsApp: PsychicAppWebsockets) => {
  if (AppEnv.serviceRole !== 'ws' && !AppEnv.isTest) return

  // simplified api for setting redis connection
  wsApp.set(
    'connection',
    new Redis({
      username: process.env.REDIS_USER,
      password: process.env.REDIS_PASSWORD,
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
      tls: process.env.REDIS_USE_SSL === '1' ? {} : undefined,
      maxRetriesPerRequest: null,
    }),
  )

  wsApp.set('socketio', {
    // socketio server options here
  })
```

## 2.0.1

bump glob to close dependabot issue

## 2.0.0

- namespace exports
- support Dream and Psychic 2.0

## 0.5.0

- update for Psychic 1.11.1 and modern Dream

## 0.4.0

- update for Dream 1.4.0
