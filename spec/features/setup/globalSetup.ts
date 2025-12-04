import '../../../test-app/src/conf/loadEnv.js'

import { PsychicDevtools } from '@rvoh/psychic/system'

export async function setup() {
  await PsychicDevtools.launchDevServer('client', { port: 3000, cmd: 'pnpm client:fspec' })
}

export function teardown() {
  PsychicDevtools.stopDevServers()
}
