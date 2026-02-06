import Cable from '../../../src/cable/index.js'

describe('cable#start', () => {
  let cable: Cable
  beforeEach(() => {
    cable = new Cable()
    cable.connect()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    vi.spyOn(cable.io!, 'on').mockReturnValue(null as any)
    vi.spyOn(cable, 'listen').mockImplementation(async () => {})
    vi.spyOn(cable, 'connect')
  })

  it('calls cable#connect to establish io and http server if they arent already established', async () => {
    await cable.start(8888)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cable.connect).toHaveBeenCalled()
  })

  it('calls cable#listen to start http server and sidechain io server to it', async () => {
    await cable.start(8888)
    expect(cable['listen']).toHaveBeenCalledWith({ port: 8888 })
  })

  it('attaches a socket io instance to the cable instance', async () => {
    await cable.start(8888)
    expect(cable.io!['on']).toHaveBeenCalled()
  })
})
