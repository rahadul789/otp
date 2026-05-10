import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import {
  markAdminNotificationRead,
  type AdminNotificationCenterItem,
} from "@/lib/admin-api"
import {
  connectAdminSocket,
  disconnectAdminSocket,
  getAdminSocket,
} from "@/lib/socket-client"

function invalidateAdminRealtimeQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  payload?: Partial<AdminNotificationCenterItem>
) {
  void queryClient.invalidateQueries({ queryKey: ["admin-notifications"] })
  void queryClient.invalidateQueries({ queryKey: ["admin-dashboard-orders"] })

  if (payload?.entityType === "support_case" || payload?.path?.startsWith("/support")) {
    void queryClient.invalidateQueries({ queryKey: ["admin-support-cases"] })
  }
  if (payload?.entityType === "order" || payload?.path?.startsWith("/orders")) {
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-orders-monitor"] })
  }
}

function resolveAdminNotificationPath(payload: Partial<AdminNotificationCenterItem>) {
  if (
    payload.path?.startsWith("/orders") ||
    payload.path?.startsWith("/support") ||
    payload.path?.startsWith("/reviews") ||
    payload.path?.startsWith("/restaurants") ||
    payload.path?.startsWith("/riders") ||
    payload.path?.startsWith("/payments")
  ) {
    return payload.path
  }
  return "/notifications"
}

function canMarkNotificationRead(payload: Partial<AdminNotificationCenterItem>) {
  return payload.source === "customer" || payload.source === "owner" || payload.source === "ops"
}

export function useAdminSocketBridge(enabled: boolean) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!enabled) {
      disconnectAdminSocket()
      return
    }

    const socket = connectAdminSocket()
    const ensureJoined = () => socket.emit("admin:join", "ops")
    socket.on("connect", ensureJoined)

    const handleNotification = (payload: AdminNotificationCenterItem) => {
      invalidateAdminRealtimeQueries(queryClient, payload)
      toast(payload.title || "New admin alert", {
        description: payload.description,
        action: {
          label: "Open",
          onClick: () => {
            if (!payload.isRead && payload.id && canMarkNotificationRead(payload)) {
              void markAdminNotificationRead({
                source: payload.source as "customer" | "owner" | "ops",
                id: payload.id,
              }).finally(() => {
                void queryClient.invalidateQueries({ queryKey: ["admin-notifications"] })
              })
            }
            navigate(resolveAdminNotificationPath(payload))
          },
        },
      })
    }

    const handleOrderUpdated = (payload: { orderId?: string; path?: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-orders-monitor"] })
      if (payload.orderId) {
        void queryClient.invalidateQueries({ queryKey: ["admin-order", payload.orderId] })
      }
    }

    socket.on("admin.notification.created", handleNotification)
    socket.on("admin.order.updated", handleOrderUpdated)

    return () => {
      socket.off("admin.notification.created", handleNotification)
      socket.off("admin.order.updated", handleOrderUpdated)
      socket.off("connect", ensureJoined)
    }
  }, [enabled, navigate, queryClient])

  React.useEffect(() => {
    return () => {
      const socket = getAdminSocket()
      socket.off("admin.notification.created")
      socket.off("admin.order.updated")
    }
  }, [])
}
