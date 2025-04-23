import { DreamCLI } from '@rvoh/dream'
import { PsychicApp, PsychicDevtools } from '@rvoh/psychic'
import { PsychicAppWebsockets } from '../../../src/index.js'
import importDefault from '../app/helpers/importDefault.js'
import srcPath from '../app/helpers/srcPath.js'
import AppEnv from './AppEnv.js'
import inflections from './inflections.js'
import routesCb from './routes.js'
import websocketsConf from './websockets.js'

export default async (psy: PsychicApp) => {
  await psy.load('controllers', srcPath('app', 'controllers'), path => importDefault(path))
  await psy.load('services', srcPath('app', 'services'), path => importDefault(path))

  psy.set('appName', 'testapp')
  psy.set('packageManager', 'yarn')
  psy.set('apiOnly', false)
  psy.set('apiRoot', srcPath('..', '..'))
  psy.set('clientRoot', srcPath('..', 'client'))
  psy.set('inflections', inflections)
  psy.set('routes', routesCb)

  psy.plugin(async () => {
    await PsychicAppWebsockets.init(psy, websocketsConf)
  })

  psy.set('paths', {
    apiRoutes: 'test-app/src/conf/routes.ts',
    controllers: 'test-app/src/app/controllers',
    controllerSpecs: 'test-app/spec/unit/controllers',
  })

  // set options to pass to coors when middleware is booted
  psy.set('cors', {
    credentials: true,
    origin: [process.env.CLIENT_HOST || 'http://localhost:3000'],
  })

  // set options for cookie usage
  psy.set('cookie', {
    maxAge: {
      days: 4,
    },
  })

  psy.on('server:start', async () => {
    if (AppEnv.isDevelopment) {
      DreamCLI.logger.logStartProgress('client server starting...')
      await PsychicDevtools.launchDevServer('clientApp', { port: 3000, cmd: 'yarn client' })
      DreamCLI.logger.logEndProgress()
    }
  })

  psy.on('server:shutdown', () => {
    if (AppEnv.isDevelopment && AppEnv.boolean('CLIENT')) {
      DreamCLI.logger.logStartProgress('client server stopping...')
      PsychicDevtools.stopDevServer('clientApp')
      DreamCLI.logger.logEndProgress()
    }
  })
}

export function __forTestingOnly(message: string) {
  process.env.__PSYCHIC_HOOKS_TEST_CACHE ||= ''
  process.env.__PSYCHIC_HOOKS_TEST_CACHE += `,${message}`
}
