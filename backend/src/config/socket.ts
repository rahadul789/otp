import type { Server as HttpServer } from "node:http"
import { Server } from "socket.io"

import { env } from "./env"
import { logger } from "./logger"

let ioInstance: Server | null = null

export function createSocketServer(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      origin: [env.CLIENT_ORIGIN, env.ADMIN_PANEL_ORIGIN, env.CUSTOMER_APP],
      credentials: true
    }
  })

  io.on("connection", (socket) => {
    socket.on("admin:join", (scope: string) => {
      if (scope) socket.join(`admin:${scope}`)
    })

    socket.on("admin:leave", (scope: string) => {
      if (scope) socket.leave(`admin:${scope}`)
    })

    socket.on("owner:join", (ownerId: string) => {
      if (ownerId) socket.join(`owner:${ownerId}`)
    })

    socket.on("restaurant:join", (restaurantId: string) => {
      if (restaurantId) socket.join(`restaurant:${restaurantId}`)
    })

    socket.on("customer:join", (customerId: string) => {
      if (customerId) socket.join(`customer:${customerId}`)
    })

    socket.on("rider:join", (riderId: string) => {
      if (riderId) socket.join(`rider:${riderId}`)
    })

    socket.on(
      "admin:support-typing",
      (payload: { customerId?: string; caseId?: string; isTyping?: boolean; adminName?: string }) => {
        if (!payload?.customerId || !payload?.caseId) {
          return
        }

        io.to(`customer:${payload.customerId}`).emit("customer.support.typing", {
          caseId: payload.caseId,
          isTyping: Boolean(payload.isTyping),
          adminName: payload.adminName ?? "Support team"
        })
      }
    )
  })

  ioInstance = io

  return io
}

export function emitSocketEvent(channel: string, eventName: string, payload: unknown) {
  if (!ioInstance) {
    logger.warn(
      {
        channel,
        eventName
      },
      "Socket server not initialized. Event emission skipped."
    )
    return
  }

  ioInstance.to(channel).emit(eventName, payload)
}

export function hasActiveSocketChannel(channel: string) {
  if (!ioInstance) {
    return false
  }

  const room = ioInstance.sockets.adapter.rooms.get(channel)
  return Boolean(room && room.size > 0)
}
