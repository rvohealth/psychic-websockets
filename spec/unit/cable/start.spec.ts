import { PsychicServer } from '@rvoh/psychic'
import * as http from 'http'
import Cable from '../../../src/cable/index.js'
import PsychicApplicationWebsockets from '../../../src/psychic-application-websockets/index.js'

describe('cable#start', () => {
  let server: PsychicServer
  let cable: Cable
  beforeEach(() => {
    server = new PsychicServer()
    cable = new Cable(server.expressApp, PsychicApplicationWebsockets.getOrFail())
    http.createServer(server.expressApp)
    cable.connect()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    vi.spyOn(cable.io!, 'on').mockReturnValue(null as any)
    vi.spyOn(cable, 'listen').mockImplementation(async () => {})
    vi.spyOn(cable, 'connect')
  })

  it('calls cable#connect to establish io and http server if they arent already established', async () => {
    await cable.start()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cable.connect).toHaveBeenCalled()
  })

  it('calls cable#listen to start http server and sidechain io server to it', async () => {
    await cable.start()
    const port = 7777
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cable.listen).toHaveBeenCalledWith({ port: port })
  })

  it('attaches a socket io instance to the cable instance', async () => {
    await cable.start()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cable.io!.on).toHaveBeenCalled()
  })

  context('psychic is configured for redis as well', () => {
    it('creates additional redis bindings', async () => {
      // TODO: add coverage here.
    })
  })
})
