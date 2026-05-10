import * as React from "react"

import {
  mapOwnerVoucher,
  type OwnerListResponse,
  type OwnerVoucherResponse,
} from "@/lib/backend-mappers"
import { useOwnerVouchersQuery } from "@/hooks/use-owner-api"
import { useAppStore } from "@/store/app-store"

export function PromotionsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setVouchers = useAppStore((state) => state.setVouchers)
  const vouchersQuery = useOwnerVouchersQuery(ownerAccount.isAuthenticated)

  React.useEffect(() => {
    if (!vouchersQuery.data) return

    const mapped = (
      vouchersQuery.data as OwnerListResponse<OwnerVoucherResponse>
    ).items.map(mapOwnerVoucher)
    setVouchers(mapped)
  }, [setVouchers, vouchersQuery.data])

  return <>{children}</>
}

export function usePromotions() {
  const vouchers = useAppStore((state) => state.vouchers)
  const setVouchers = useAppStore((state) => state.setVouchers)
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const vouchersQuery = useOwnerVouchersQuery(ownerAccount.isAuthenticated)

  return {
    vouchers,
    setVouchers,
    isLoading: vouchersQuery.isPending,
  }
}
