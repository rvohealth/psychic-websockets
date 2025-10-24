import { Encrypt } from '@rvoh/dream/utils'
import { visit } from '@rvoh/psychic-spec-helpers'
import createUser from '../../test-app/spec/factories/UserFactory.js'

describe('user visits a page implementing websockets', () => {
  it('executes websocket events as expected and performs a graceful shutdown', async () => {
    const user = await createUser()
    const token = Encrypt.encrypt(user.id, {
      algorithm: 'aes-256-gcm',
      key: process.env.APP_ENCRYPTION_KEY!,
    })

    await visit(`/socket-test/${token}`)
    await expect(page).toMatchTextContent('websockets connected')
  })
})
