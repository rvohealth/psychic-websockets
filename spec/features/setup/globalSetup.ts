import '../../../test-app/src/conf/loadEnv.js'

import { PsychicDevtools } from '@rvoh/psychic/internal'

export async function setup() {
  await PsychicDevtools.launchDevServer('client', { port: 3000, cmd: 'yarn client:fspec' })
}

export function teardown() {
  PsychicDevtools.stopDevServers()
}
