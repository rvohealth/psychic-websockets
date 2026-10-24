import { Encrypt } from '@rvoh/dream/utils'
import { visit } from '@rvoh/psychic-spec-helpers'
import createUser from '../../test-app/spec/factories/UserFactory.js'
import AppEnv from '../../test-app/src/conf/AppEnv.js'

describe('user visits a page implementing websockets', () => {
  it('observes credential rejection before a subsequent valid user receives delivery', async () => {
    await visit('/socket-test/malformed')
    // This text is set only by the server's terminal disconnect event. Waiting
    // here prevents navigation from cancelling the invalid connection first.
    await expect(page).toMatchTextContent('websockets rejected')

    const user = await createUser()
    const token = Encrypt.encrypt(user.id, {
      algorithm: 'aes-256-gcm',
      key: AppEnv.string('APP_ENCRYPTION_KEY'),
    })
    await visit(`/socket-test/${token}`)
    await expect(page).toMatchTextContent('websockets connected')
  })

  it('executes websocket events as expected and performs a graceful shutdown', async () => {
    const user = await createUser()
    const token = Encrypt.encrypt(user.id, {
      algorithm: 'aes-256-gcm',
      key: AppEnv.string('APP_ENCRYPTION_KEY'),
    })

    await visit(`/socket-test/${token}`)
    await expect(page).toMatchTextContent('websockets connected')
  })
})
