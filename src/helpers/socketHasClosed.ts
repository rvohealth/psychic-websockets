import { Socket } from 'socket.io'

/**
 * @internal
 *
 * whether socket.io is finished with this socket, so it will never emit
 * 'disconnect' to a listener bound now. `socket.disconnected` alone is not enough:
 * it is also true for a socket still running `io.use` middleware, which connects
 * afterward. A socket whose transport is no longer open will never connect. On
 * socket.io 4.8+, a socket that is neither connected nor held in its namespace's
 * pre-connect map has already disconnected. Earlier releases have no such map,
 * so there a not-yet-connected socket on an open transport counts as connecting.
 */
export default function socketHasClosed(socket: Socket): boolean {
  if (!socket.disconnected) return false
  if (socket.conn.readyState !== 'open') return true

  // a private socket.io 4.8+ field, read defensively
  const preConnectSockets = (socket.nsp as unknown as { _preConnectSockets?: unknown })._preConnectSockets
  return preConnectSockets instanceof Map && !preConnectSockets.has(socket.id)
}
