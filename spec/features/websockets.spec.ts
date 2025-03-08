import { Encrypt } from '@rvohealth/dream'
import createUser from '../../test-app/spec/factories/UserFactory'
import launchBrowser from './setup/helpers/launchBrowser'

describe('user visits a page implementing websockets', () => {
  it('executes websocket events as expected and performs a graceful shutdown', async () => {
    const browser = await launchBrowser()
    const page = await browser.newPage()

    const user = await createUser()
    const token = Encrypt.encrypt(user.id, {
      algorithm: 'aes-256-gcm',
      key: process.env.APP_ENCRYPTION_KEY!,
    })

    await page.goto(`http://localhost:3000/socket-test/${token}`)
    // TODO: add fspec helpers and uncomment this
    // await expect(page).toHaveSelector(`body:has-text("websockets connected")`, {
    //   timeout: 4000,
    // })
  })
})
