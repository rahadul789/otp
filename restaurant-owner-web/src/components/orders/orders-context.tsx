import * as React from "react"

import {
  mapOwnerOrder,
  type OwnerListResponse,
  type OwnerOrderResponse,
} from "@/lib/backend-mappers"
import { useOwnerOrdersQuery } from "@/hooks/use-owner-api"
import { useAppStore } from "@/store/app-store"

export function OrdersProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setOrders = useAppStore((state) => state.setOrders)
  const ordersQuery = useOwnerOrdersQuery(ownerAccount.isAuthenticated)

  React.useEffect(() => {
    if (!ordersQuery.data) return

    const mapped = (
      ordersQuery.data as OwnerListResponse<OwnerOrderResponse>
    ).items.map(mapOwnerOrder)
    setOrders(mapped)
  }, [ordersQuery.data, setOrders])

  return <>{children}</>
}

export function useOrders() {
  const orders = useAppStore((state) => state.orders)
  const setOrders = useAppStore((state) => state.setOrders)
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const ordersQuery = useOwnerOrdersQuery(ownerAccount.isAuthenticated)

  return {
    orders,
    setOrders,
    isLoading: ordersQuery.isPending,
  }
}
