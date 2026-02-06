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
