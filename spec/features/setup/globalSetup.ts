import '../../../test-app/src/conf/loadEnv.js'

import { PsychicDevtools } from '@rvoh/psychic/system'

export async function setup() {
  // Only servers that never touch the database belong here. The websocket server reads the
  // rows each spec creates, so it starts inside the spec worker (see hooks.ts).
  await PsychicDevtools.launchDevServer('client', { port: 3000, cmd: 'pnpm client:fspec' })
}

export function teardown() {
  PsychicDevtools.stopDevServers()
}
