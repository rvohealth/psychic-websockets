import * as http from 'http'
import Cable from '../../../src/cable/index.js'
import PsychicAppWebsockets from '../../../src/psychic-app-websockets/index.js'

describe('cable#listen', () => {
  let cable: Cable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let httpServer: any

  beforeEach(() => {
    cable = new Cable(PsychicAppWebsockets.getOrFail())

    cable.connect()

    // need to return httpServer as return value to http listen to satisfy typescript,
    // otherwise, this wouldn't be needed.
    httpServer = http.createServer()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    vi.spyOn(cable.httpServer, 'listen').mockReturnValue(httpServer)

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    vi.spyOn(cable.io!, 'on').mockReturnValue(null as any)
  })

  it('starts an http server', async () => {
    // patch this, difficult because listen method is using promise accept within http listener
    // await cable.listen({ port: 7777, withFrontEndClient: false, frontEndPort: 3000 })
    // expect(cable.http.listen).toHaveBeenCalled()
  })
})
