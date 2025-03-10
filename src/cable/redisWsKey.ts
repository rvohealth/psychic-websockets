import { IdType } from '@rvoh/dream'

export default function redisWsKey(userId: IdType, redisKeyPrefix: string) {
  return `${redisKeyPrefix}:${userId}:socket_ids`
}
