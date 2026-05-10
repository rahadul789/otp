import { io, type Socket } from "socket.io-client"

import { getApiBaseUrl } from "@/lib/api"

function resolveSocketUrl() {
  const apiBaseUrl = getApiBaseUrl().replace(/\/$/, "")
  if (apiBaseUrl.includes("/api/v1")) {
    return apiBaseUrl.replace(/\/api\/v1\/?$/, "")
  }
  return apiBaseUrl
}

let adminSocket: Socket | null = null

export function getAdminSocket() {
  if (!adminSocket) {
    adminSocket = io(resolveSocketUrl(), {
      autoConnect: false,
      transports: ["websocket"],
      withCredentials: true,
    })
  }

  return adminSocket
}

export function connectAdminSocket() {
  const socket = getAdminSocket()
  if (!socket.connected) socket.connect()
  socket.emit("admin:join", "ops")
  return socket
}

export function joinAdminSocketScope(scope: string) {
  const socket = getAdminSocket()
  if (!socket.connected) socket.connect()
  if (scope) socket.emit("admin:join", scope)
  return socket
}

export function leaveAdminSocketScope(scope: string) {
  const socket = getAdminSocket()
  if (scope) socket.emit("admin:leave", scope)
}

export function disconnectAdminSocket() {
  if (adminSocket?.connected) adminSocket.disconnect()
}
