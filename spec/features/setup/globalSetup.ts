import '../../../test-app/src/conf/loadEnv.js'

import { PsychicDevtools } from '@rvoh/psychic/system'

export async function setup() {
  await PsychicDevtools.launchDevServer('client', { port: 3000, cmd: 'pnpm client:fspec' })
  await PsychicDevtools.launchDevServer('ws', {
    cmd: 'pnpm ws:fspec',
    port: 8889,
  })
}

export function teardown() {
  PsychicDevtools.stopDevServers()
}
