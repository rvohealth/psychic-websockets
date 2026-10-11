import { DecryptionError } from '@rvoh/dream/errors'
import { Encrypt } from '@rvoh/dream/utils'
import type { Socket } from 'socket.io'
import User from '../../app/models/User.js'
import AppEnv from '../AppEnv.js'

export default async function resolveReferenceSocketUser(socket: Socket): Promise<User | null> {
  // Validate configuration outside the credential-error catch: Dream also wraps
  // an invalid AES key length in DecryptionError. That is a server failure.
  const key = AppEnv.string('APP_ENCRYPTION_KEY')
  if (!Encrypt.validateKey(key, 'aes-256-gcm')) {
    throw new Error('APP_ENCRYPTION_KEY must be a valid aes-256-gcm key')
  }

  const token: unknown = socket.handshake.auth.token
  if (typeof token !== 'string' || !token) return null

  let userId: unknown
  try {
    userId = Encrypt.decrypt<unknown>(token, { algorithm: 'aes-256-gcm', key })
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error
    return null
  }

  // This reference app uses bigint user IDs. Reject an authenticated payload of
  // the wrong shape before passing it to the database.
  if (typeof userId !== 'string' || !/^-?\d+$/.test(userId)) return null
  const numericUserId = BigInt(userId)
  if (numericUserId < -9223372036854775808n || numericUserId > 9223372036854775807n) return null

  return await User.find(userId)
}
