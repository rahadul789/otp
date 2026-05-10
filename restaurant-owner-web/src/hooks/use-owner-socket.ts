import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { getOwnerAuthSession } from "@/lib/auth-session"
import { connectOwnerSocket, disconnectOwnerSocket, getOwnerSocket } from "@/lib/socket-client"
import {
  mapOwnerNotification,
  mapOwnerOrder,
  type OwnerListResponse,
  type OwnerNotificationResponse,
  type OwnerOrderResponse,
} from "@/lib/backend-mappers"
import { patchOwnerOrderQueryCaches } from "@/lib/owner-order-cache"
import { useAppStore } from "@/store/app-store"

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1]
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
    const decoded = atob(padded)
    return JSON.parse(decoded) as { sub?: string }
  } catch {
    return null
  }
}

function resolveOwnerId() {
  const session = getOwnerAuthSession()
  if (!session?.accessToken) return null
  const payload = decodeJwtPayload(session.accessToken)
  return payload?.sub ?? null
}

export function useOwnerSocketBridge() {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setNotifications = useAppStore((state) => state.setNotifications)
  const setOrders = useAppStore((state) => state.setOrders)
  const queryClient = useQueryClient()
  const joinedRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!ownerAccount.isAuthenticated) {
      joinedRef.current = null
      disconnectOwnerSocket()
      return
    }

    const ownerId = resolveOwnerId()
    if (!ownerId) return

    if (joinedRef.current !== ownerId) {
      connectOwnerSocket(ownerId)
      joinedRef.current = ownerId
    }

    const socket = getOwnerSocket()
    const ensureJoined = () => socket.emit("owner:join", ownerId)
    socket.on("connect", ensureJoined)

    const handleNotification = (payload: OwnerNotificationResponse) => {
      const mapped = mapOwnerNotification(payload)
      setNotifications((current) => {
        if (current.some((item) => item.id === mapped.id)) return current
        return [mapped, ...current]
      })

      queryClient.setQueriesData(
        { queryKey: ["owner", "notifications"] },
        (current: unknown) => {
          if (!current || typeof current !== "object" || !("items" in (current as Record<string, unknown>))) {
            return current
          }

          const result = current as OwnerListResponse<OwnerNotificationResponse>
          if (result.items.some((item) => item._id === payload._id)) {
            return current
          }

          return {
            ...result,
            items: [payload, ...result.items],
            total: (result.total ?? result.items.length) + 1,
            unreadCount: (result.unreadCount ?? 0) + (payload.isRead ? 0 : 1),
          } satisfies OwnerListResponse<OwnerNotificationResponse>
        }
      )
      queryClient.invalidateQueries({ queryKey: ["owner", "notifications"] })

      if (mapped.type === "payout") {
        queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "summary"] })
        queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "history"] })
        queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "transactions"] })
        queryClient.invalidateQueries({ queryKey: ["owner", "dashboard", "summary"] })
      }

      if (mapped.type === "review") {
        queryClient.invalidateQueries({ queryKey: ["owner", "reviews"] })
      }

      if (mapped.type === "promotion") {
        queryClient.invalidateQueries({ queryKey: ["owner", "vouchers"] })
      }

      if (mapped.type === "support") {
        queryClient.invalidateQueries({ queryKey: ["owner", "support-cases"] })
      }
    }

    const handleOrderUpdated = (payload: OwnerOrderResponse) => {
      const mapped = mapOwnerOrder(payload)
      setOrders((current) => {
        const exists = current.some((order) => order.id === mapped.id)
        return exists
          ? current.map((order) => (order.id === mapped.id ? mapped : order))
          : [mapped, ...current]
      })

      patchOwnerOrderQueryCaches(queryClient, payload)
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard", "summary"] })
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "summary"] })
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "history"] })
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "transactions"] })
    }

    socket.on("notification.created", handleNotification)
    socket.on("order.updated", handleOrderUpdated)

    return () => {
      socket.off("notification.created", handleNotification)
      socket.off("order.updated", handleOrderUpdated)
      socket.off("connect", ensureJoined)
    }
  }, [ownerAccount.isAuthenticated, queryClient, setNotifications, setOrders])
}
