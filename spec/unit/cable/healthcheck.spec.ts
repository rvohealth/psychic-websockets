import { Cable, PsychicAppWebsockets } from '../../../src/index.js'

describe('http healthcheck', () => {
  let cable: Cable

  beforeEach(async () => {
    cable = new Cable()
    await cable.start(8889)
  })

  afterEach(async () => {
    await cable.stop()
  })

  it('opens an http health check endpoint', async () => {
    const status = (await fetch('http://localhost:8889/healthcheck')).status
    expect(status).toEqual(200)
  })

  context('when the body is configured', () => {
    beforeEach(() => {
      const wsApp = PsychicAppWebsockets.getOrFail()
      wsApp.set('healthCheck', {
        body: 'howyadoin',
      })
    })

    it('delivers the specified body', async () => {
      const body = await (await fetch('http://localhost:8889/healthcheck')).text()
      expect(body).toEqual('howyadoin')
    })
  })

  context('when the path is configured', () => {
    beforeEach(() => {
      const wsApp = PsychicAppWebsockets.getOrFail()
      wsApp.set('healthCheck', {
        path: '/howyadoin',
      })
    })

    it('delivers 200', async () => {
      const status = (await fetch('http://localhost:8889/howyadoin')).status
      expect(status).toEqual(200)
    })

    context('without a prefixing slash', () => {
      beforeEach(() => {
        const wsApp = PsychicAppWebsockets.getOrFail()
        wsApp.set('healthCheck', {
          path: 'howyadoin',
        })
      })

      it('delivers 200', async () => {
        const status = (await fetch('http://localhost:8889/howyadoin')).status
        expect(status).toEqual(200)
      })
    })
  })

  context('when the method is configured', () => {
    context('HEAD', () => {
      beforeEach(() => {
        const wsApp = PsychicAppWebsockets.getOrFail()
        wsApp.set('healthCheck', {
          method: 'HEAD',
        })
      })

      it('delivers 200', async () => {
        const status = (await fetch('http://localhost:8889/healthcheck', { method: 'HEAD' })).status
        expect(status).toEqual(200)
      })
    })

    context('GET', () => {
      beforeEach(() => {
        const wsApp = PsychicAppWebsockets.getOrFail()
        wsApp.set('healthCheck', {
          method: 'GET',
        })
      })

      it('delivers 200', async () => {
        const status = (await fetch('http://localhost:8889/healthcheck')).status
        expect(status).toEqual(200)
      })
    })
  })

  context('when set to null', () => {
    beforeEach(() => {
      const wsApp = PsychicAppWebsockets.getOrFail()
      wsApp.set('healthCheck', null)
    })

    it('delivers 404', async () => {
      const status = (await fetch('http://localhost:8889/healthcheck')).status
      expect(status).toEqual(404)
    })
  })

  context('when hitting an http url outside of the health check', () => {
    it('delivers 404', async () => {
      const status = (await fetch('http://localhost:8889/non-existent-route')).status
      expect(status).toEqual(404)
    })
  })
})
