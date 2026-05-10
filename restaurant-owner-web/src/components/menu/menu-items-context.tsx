import * as React from "react"

import { useOwnerMenuItemsQuery } from "@/hooks/use-owner-api"
import {
  mapOwnerMenuItem,
  type OwnerListResponse,
  type OwnerMenuItemResponse,
} from "@/lib/backend-mappers"
import { useAppStore } from "@/store/app-store"

export function MenuItemsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setItems = useAppStore((state) => state.setMenuItems)
  const menuItemsQuery = useOwnerMenuItemsQuery(ownerAccount.isAuthenticated)

  React.useEffect(() => {
    if (!menuItemsQuery.data) return

    const mapped = (
      menuItemsQuery.data as OwnerListResponse<OwnerMenuItemResponse>
    ).items.map(mapOwnerMenuItem)
    setItems(mapped)
  }, [menuItemsQuery.data, setItems])

  React.useEffect(() => {
    if (!ownerAccount.isAuthenticated) return
    if (menuItemsQuery.isPending && !menuItemsQuery.data) {
      setItems([])
    }
  }, [menuItemsQuery.data, menuItemsQuery.isPending, ownerAccount.isAuthenticated, setItems])

  return <>{children}</>
}

export function useMenuItems() {
  const items = useAppStore((state) => state.menuItems)
  const setItems = useAppStore((state) => state.setMenuItems)

  return { items, setItems }
}
