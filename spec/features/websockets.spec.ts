import { Encrypt } from '@rvohealth/dream'
import visit from './helpers/visit'
import createUser from '../../test-app/spec/factories/UserFactory'

describe('user visits a page implementing websockets', () => {
  it('executes websocket events as expected and performs a graceful shutdown', async () => {
    const user = await createUser()
    const token = Encrypt.encrypt(user.id, {
      algorithm: 'aes-256-gcm',
      key: process.env.APP_ENCRYPTION_KEY!,
    })

    await visit(`/socket-test/${token}`)
    await expect(page).toHaveSelector(`body:has-text("websockets connected")`, {
      timeout: 4000,
    })
  })
})
