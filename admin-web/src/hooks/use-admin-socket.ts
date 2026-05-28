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
import { ADMIN_ACCESS_TOKEN_UPDATED_EVENT } from "@/lib/admin-session"

function invalidateAdminRealtimeQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  payload?: Partial<AdminNotificationCenterItem>
) {
  void queryClient.invalidateQueries({ queryKey: ["admin-notifications"] })
  void queryClient.invalidateQueries({ queryKey: ["admin-action-center"] })
  void queryClient.invalidateQueries({ queryKey: ["admin-dashboard-orders"] })

  if (payload?.entityType === "support_case" || payload?.path?.startsWith("/support")) {
    void queryClient.invalidateQueries({ queryKey: ["admin-support-cases"] })
  }
  if (payload?.entityType === "order" || payload?.path?.startsWith("/orders")) {
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-orders-monitor"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-bkash-payment-attempts"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-operational-health"] })
  }
  if (payload?.entityType === "bkash_payment_attempt" || payload?.path?.startsWith("/payments")) {
    void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-bkash-payment-attempts"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-action-center"] })
  }
  if (payload?.entityType === "payout_method" || payload?.path?.startsWith("/payouts")) {
    void queryClient.invalidateQueries({ queryKey: ["admin-payout-method-approvals"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-finance-payouts"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-action-center"] })
  }
}

function resolveAdminNotificationPath(payload: Partial<AdminNotificationCenterItem>) {
  if (
    payload.path?.startsWith("/orders") ||
    payload.path?.startsWith("/support") ||
    payload.path?.startsWith("/reviews") ||
    payload.path?.startsWith("/restaurants") ||
    payload.path?.startsWith("/riders") ||
    payload.path?.startsWith("/payments") ||
    payload.path?.startsWith("/payouts") ||
    payload.path?.startsWith("/ledger") ||
    payload.path?.startsWith("/refunds") ||
    payload.path?.startsWith("/reports")
  ) {
    return payload.path
  }
  return "/notifications"
}

function canMarkNotificationRead(payload: Partial<AdminNotificationCenterItem>) {
  return (
    payload.source === "customer" ||
    payload.source === "owner" ||
    payload.source === "rider" ||
    payload.source === "ops"
  )
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
    const reconnectWithFreshToken = () => {
      if (socket.connected) {
        socket.disconnect()
      }
      connectAdminSocket()
    }
    const handleConnectError = (error: Error) => {
      if (/token|session|unauthorized/i.test(error.message)) {
        void queryClient.invalidateQueries()
      }
    }
    socket.on("connect", ensureJoined)
    socket.on("connect_error", handleConnectError)
    window.addEventListener(ADMIN_ACCESS_TOKEN_UPDATED_EVENT, reconnectWithFreshToken)

    const handleNotification = (payload: AdminNotificationCenterItem) => {
      invalidateAdminRealtimeQueries(queryClient, payload)
      toast(payload.title || "New admin alert", {
        description: payload.description,
        action: {
          label: "Open",
          onClick: () => {
            if (!payload.isRead && payload.id && canMarkNotificationRead(payload)) {
              void markAdminNotificationRead({
                source: payload.source as "customer" | "owner" | "rider" | "ops",
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
      void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-operational-health"] })
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
      socket.off("connect_error", handleConnectError)
      window.removeEventListener(
        ADMIN_ACCESS_TOKEN_UPDATED_EVENT,
        reconnectWithFreshToken
      )
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
