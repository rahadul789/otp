import * as React from "react"

import {
  mapOwnerPayout,
  mapOwnerPayoutMethod,
  mapOwnerPayoutTransaction,
  type OwnerListResponse,
  type OwnerPayoutHistoryResponse,
  type OwnerPayoutTransactionResponse,
  type OwnerPayoutSummaryResponse,
} from "@/lib/backend-mappers"
import type { PayoutMethod } from "@/components/payouts/types"
import {
  useOwnerPayoutHistoryQuery,
  useOwnerPayoutSummaryQuery,
  useOwnerPayoutTransactionsQuery,
} from "@/hooks/use-owner-api"
import { useAppStore } from "@/store/app-store"

export function PayoutsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setPayouts = useAppStore((state) => state.setPayouts)
  const setPayoutTransactions = useAppStore((state) => state.setPayoutTransactions)
  const payoutMethod = useAppStore((state) => state.payoutMethod)
  const setPayoutMethod = useAppStore((state) => state.setPayoutMethod)

  const payoutSummaryQuery = useOwnerPayoutSummaryQuery(ownerAccount.isAuthenticated)
  const payoutHistoryQuery = useOwnerPayoutHistoryQuery(ownerAccount.isAuthenticated)
  const payoutTransactionsQuery = useOwnerPayoutTransactionsQuery(ownerAccount.isAuthenticated)

  const isSamePayoutMethod = React.useCallback(
    (left: PayoutMethod, right: PayoutMethod) => {
      return (
        left.id === right.id &&
        left.type === right.type &&
        left.accountName === right.accountName &&
        left.accountNumber === right.accountNumber &&
        left.bankName === right.bankName &&
        left.branchName === right.branchName &&
        left.isVerified === right.isVerified &&
        left.verifiedAt === right.verifiedAt &&
        left.pendingAccountName === right.pendingAccountName &&
        left.pendingAccountNumber === right.pendingAccountNumber &&
        left.verificationSource === right.verificationSource
      )
    },
    []
  )

  React.useEffect(() => {
    if (!payoutSummaryQuery.data) return

    const payload = payoutSummaryQuery.data as OwnerPayoutSummaryResponse
    const payoutMethodResponse = payload.payoutMethod
    if (payoutMethodResponse) {
      setPayoutMethod((current) => {
        const next = mapOwnerPayoutMethod(payoutMethodResponse, current)
        return isSamePayoutMethod(current, next) ? current : next
      })
    }
  }, [isSamePayoutMethod, payoutSummaryQuery.data, setPayoutMethod])

  React.useEffect(() => {
    if (!payoutHistoryQuery.data) return

    const payoutHistory = (
      payoutHistoryQuery.data as OwnerListResponse<OwnerPayoutHistoryResponse>
    ).items
    const mapped = payoutHistory.map((entry) =>
      mapOwnerPayout(entry, payoutMethod.type)
    )
    setPayouts(mapped)
  }, [payoutHistoryQuery.data, payoutMethod.type, setPayouts])

  React.useEffect(() => {
    if (!payoutTransactionsQuery.data) return

    const entries = (
      payoutTransactionsQuery.data as OwnerListResponse<OwnerPayoutTransactionResponse>
    ).items
    setPayoutTransactions(entries.map(mapOwnerPayoutTransaction))
  }, [payoutTransactionsQuery.data, setPayoutTransactions])

  return <>{children}</>
}

export function usePayouts() {
  const payouts = useAppStore((state) => state.payouts)
  const setPayouts = useAppStore((state) => state.setPayouts)
  const payoutTransactions = useAppStore((state) => state.payoutTransactions)
  const setPayoutTransactions = useAppStore(
    (state) => state.setPayoutTransactions
  )
  const payoutMethod = useAppStore((state) => state.payoutMethod)
  const setPayoutMethod = useAppStore((state) => state.setPayoutMethod)

  return {
    payouts,
    setPayouts,
    payoutTransactions,
    setPayoutTransactions,
    payoutMethod,
    setPayoutMethod,
  }
}
