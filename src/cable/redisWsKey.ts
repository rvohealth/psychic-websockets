export default function redisWsKey(websocketId: string, redisKeyPrefix: string) {
  return `${redisKeyPrefix}:${websocketId}:socket_ids`
}
