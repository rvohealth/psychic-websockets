import '../../../test-app/src/conf/loadEnv.js'

import { PsychicDevtools } from '@rvoh/psychic'

import initializePsychicApplication from '../../../test-app/src/cli/helpers/initializePsychicApplication.js'

export async function setup() {
  await initializePsychicApplication()
  await PsychicDevtools.launchDevServer('client', { port: 3000, cmd: 'yarn client' })
}

export function teardown() {
  PsychicDevtools.stopDevServers()
}
