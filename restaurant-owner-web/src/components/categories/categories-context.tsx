import * as React from "react"

import { useOwnerCategoriesQuery } from "@/hooks/use-owner-api"
import {
  mapOwnerCategory,
  type OwnerCategoryResponse,
  type OwnerListResponse,
} from "@/lib/backend-mappers"
import { useAppStore } from "@/store/app-store"

export function CategoriesProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setCategories = useAppStore((state) => state.setCategories)
  const categoriesQuery = useOwnerCategoriesQuery(ownerAccount.isAuthenticated)

  React.useEffect(() => {
    if (!categoriesQuery.data) return

    const mapped = (
      categoriesQuery.data as OwnerListResponse<OwnerCategoryResponse>
    ).items.map(mapOwnerCategory)
    setCategories(mapped)
  }, [categoriesQuery.data, setCategories])

  React.useEffect(() => {
    if (!ownerAccount.isAuthenticated) return
    if (categoriesQuery.isPending && !categoriesQuery.data) {
      setCategories([])
    }
  }, [categoriesQuery.data, categoriesQuery.isPending, ownerAccount.isAuthenticated, setCategories])

  return <>{children}</>
}

export function useCategories() {
  const categories = useAppStore((state) => state.categories)
  const setCategories = useAppStore((state) => state.setCategories)

  return { categories, setCategories }
}
