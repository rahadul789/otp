import * as React from "react"

import { endOfDay, format, subDays } from "date-fns"
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  CreditCard,
  Download,
  Landmark,
  LoaderCircle,
  ReceiptText,
  RotateCcw,
  Search,
  Wallet,
  WalletCards,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useIsFetching, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

import {
  defaultOrderDateFilter,
  OrderDateFilter,
  type OrderDateFilterValue,
} from "@/components/orders/order-date-filter"
import { PayoutDetailsDrawer } from "@/components/payouts/payout-details-drawer"
import { PayoutMethodDrawer } from "@/components/payouts/payout-method-drawer"
import { TransactionDetailsDrawer } from "@/components/payouts/transaction-details-drawer"
import { usePayouts } from "@/components/payouts/payouts-context"
import {
  formatPayoutMoney,
  settlementDelayDays,
  type EarningTransaction,
  type Payout,
  type PayoutStatus,
  type TransactionType,
} from "@/components/payouts/types"
import { calculateEarningsSummary } from "@/domain/financials"
import {
  mapOwnerPayout,
  mapOwnerPayoutMethod,
  mapOwnerPayoutTransaction,
  type OwnerListResponse,
  type OwnerPayoutHistoryResponse,
  type OwnerPayoutTransactionResponse,
} from "@/lib/backend-mappers"
import {
  useOwnerPayoutHistoryQuery,
  useOwnerPayoutRequestMutation,
  useOwnerPayoutSummaryQuery,
  useOwnerPayoutTransactionsQuery,
  useUpdateOwnerPayoutMethodMutation,
} from "@/hooks/use-owner-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppStore } from "@/store/app-store"

type SortKey = "latest" | "oldest" | "highestNet"
type CombinedStatusFilter = "all" | PayoutStatus
type CombinedTypeFilter = "all" | TransactionType
type PayoutTab = "history" | "transactions"

type PayoutColumnKey =
  | "amount"
  | "status"
  | "notes"
  | "transaction"
  | "method"
  | "date"

type TransactionColumnKey =
  | "type"
  | "gross"
  | "commission"
  | "discount"
  | "delivery"
  | "net"
  | "settlement"
  | "created"
  | "available"

const pageSizeOptions = [5, 10, 20]

const payoutColumnLabels: Record<PayoutColumnKey, string> = {
  amount: "Amount",
  status: "Status",
  notes: "Notes",
  transaction: "Transaction ID",
  method: "Method",
  date: "Date",
}

const transactionColumnLabels: Record<TransactionColumnKey, string> = {
  type: "Type",
  gross: "Gross",
  commission: "Commission",
  discount: "Discount Cost",
  delivery: "Delivery Cost",
  net: "Net",
  settlement: "Settlement",
  created: "Created",
  available: "Available",
}

function getPayoutBadge(status: PayoutStatus) {
  if (status === "completed") {
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Completed</Badge>
  }
  if (status === "processing") {
    return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">Processing</Badge>
  }
  if (status === "pending") {
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Pending</Badge>
  }
  return <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Failed</Badge>
}

function getTransactionBadge(type: TransactionType) {
  if (type === "earning") {
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Earning</Badge>
  }
  if (type === "payout") {
    return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">Payout</Badge>
  }
  return <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Refund</Badge>
}

function getSettlementBadge(status: EarningTransaction["status"]) {
  if (status === "available") {
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Available</Badge>
  }
  if (status === "paid_out") {
    return <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-700">Paid Out</Badge>
  }
  return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Pending</Badge>
}

function PayoutsSkeleton() {
  return (
    <div className="space-y-4 px-4 lg:px-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <Skeleton className="h-10 w-full lg:max-w-xs" />
          <Skeleton className="h-10 w-full lg:w-44" />
          <Skeleton className="h-10 w-full lg:w-44" />
          <Skeleton className="h-10 w-full lg:w-52" />
          <Skeleton className="h-10 w-full lg:w-36" />
          <Skeleton className="h-10 w-full lg:w-28" />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card p-4 shadow-sm">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className={`w-full ${index === 0 ? "mb-4 h-12" : "mb-3 h-14 last:mb-0"}`} />
        ))}
      </div>
    </div>
  )
}

export function PayoutsPage() {
  const {
    payouts,
    payoutTransactions,
    payoutMethod,
    setPayoutMethod,
  } = usePayouts()
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setVerificationModalOpen = useAppStore(
    (state) => state.setVerificationModalOpen
  )
  const setVerificationRequest = useAppStore(
    (state) => state.setVerificationRequest
  )

  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [activeTab, setActiveTab] = React.useState<PayoutTab>("history")
  const [search, setSearch] = React.useState("")
  const [dateFilter, setDateFilter] = React.useState<OrderDateFilterValue>({
    ...defaultOrderDateFilter,
    preset: "last7Days",
  })
  const [statusFilter, setStatusFilter] = React.useState<CombinedStatusFilter>("all")
  const [typeFilter, setTypeFilter] = React.useState<CombinedTypeFilter>("all")
  const [sortBy, setSortBy] = React.useState<SortKey>("latest")
  const [payoutPageSize, setPayoutPageSize] = React.useState(10)
  const [transactionPageSize, setTransactionPageSize] = React.useState(10)
  const [payoutPageIndex, setPayoutPageIndex] = React.useState(0)
  const [transactionPageIndex, setTransactionPageIndex] = React.useState(0)
  const [isRequestOpen, setIsRequestOpen] = React.useState(false)
  const [requestAmount, setRequestAmount] = React.useState("")
  const [requestError, setRequestError] = React.useState("")
  const [requestSuccess, setRequestSuccess] = React.useState("")
  const [viewingPayout, setViewingPayout] = React.useState<Payout | null>(null)
  const [viewingTransaction, setViewingTransaction] = React.useState<EarningTransaction | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const [isMethodOpen, setIsMethodOpen] = React.useState(false)
  const [payoutColumnVisibility, setPayoutColumnVisibility] = React.useState<Record<PayoutColumnKey, boolean>>({
    amount: true,
    status: true,
    notes: true,
    transaction: true,
    method: true,
    date: true,
  })
  const [transactionColumnVisibility, setTransactionColumnVisibility] = React.useState<Record<TransactionColumnKey, boolean>>({
    type: true,
    gross: true,
    commission: true,
    discount: true,
    delivery: true,
    net: true,
    settlement: true,
    created: true,
    available: true,
  })

  const payoutSummaryQuery = useOwnerPayoutSummaryQuery(ownerAccount.isAuthenticated)
  const payoutHistoryQuery = useOwnerPayoutHistoryQuery(ownerAccount.isAuthenticated, {
    search: debouncedSearch.trim() || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    sortBy,
    preset: dateFilter.preset,
    from: dateFilter.preset === "custom" ? dateFilter.range?.from?.toISOString() : undefined,
    to: dateFilter.preset === "custom" ? dateFilter.range?.to?.toISOString() : undefined,
    page: 1,
    pageSize: 500,
  })
  const payoutTransactionsQuery = useOwnerPayoutTransactionsQuery(ownerAccount.isAuthenticated, {
    search: debouncedSearch.trim() || undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    sortBy,
    preset: dateFilter.preset,
    from: dateFilter.preset === "custom" ? dateFilter.range?.from?.toISOString() : undefined,
    to: dateFilter.preset === "custom" ? dateFilter.range?.to?.toISOString() : undefined,
    page: 1,
    pageSize: 500,
  })
  const payoutRequestMutation = useOwnerPayoutRequestMutation()
  const updatePayoutMethodMutation = useUpdateOwnerPayoutMethodMutation()
  const isFetchingPayouts = useIsFetching({ queryKey: ["owner", "payouts"] })

  const isLoading = isFetchingPayouts > 0

  const earningsSummary = React.useMemo(
    () => calculateEarningsSummary(payoutTransactions, payouts),
    [payoutTransactions, payouts]
  )
  const summaryBalances = payoutSummaryQuery.data
    ? {
        available: payoutSummaryQuery.data.availableBalance,
        pending: payoutSummaryQuery.data.pendingBalance,
        paidOut: payoutSummaryQuery.data.paidOutBalance,
        gross: payoutSummaryQuery.data.lifetimeGrossAmount,
        net: payoutSummaryQuery.data.lifetimeNetEarnings,
        commission: payoutSummaryQuery.data.lifetimeCommission,
        discountCost: payoutSummaryQuery.data.lifetimeDiscountCost,
        deliveryCost: payoutSummaryQuery.data.lifetimeDeliveryCost,
      }
    : null
  const summaryLastPayout = payoutSummaryQuery.data?.lastPayout
    ? mapOwnerPayout(
        {
          ...payoutSummaryQuery.data.lastPayout,
          createdAt: payoutSummaryQuery.data.lastPayout.requestedAt,
          updatedAt:
            payoutSummaryQuery.data.lastPayout.processedAt ??
            payoutSummaryQuery.data.lastPayout.requestedAt,
        },
        payoutMethod.type
      )
    : null
  const lifetimeEarnings = summaryBalances?.net ?? earningsSummary.lifetimeEarnings
  const availableBalance = summaryBalances?.available ?? earningsSummary.available
  const pendingBalance = summaryBalances?.pending ?? earningsSummary.pending
  const availableSoonBalance = earningsSummary.availableSoon

  const lastCompletedPayout = React.useMemo(
    () =>
      summaryLastPayout && summaryLastPayout.status === "completed"
        ? summaryLastPayout
        : [...payouts]
            .filter((payout) => payout.status === "completed")
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )[0] ?? null,
    [payouts, summaryLastPayout]
  )

  const nextPayoutDate = React.useMemo(
    () =>
      payoutSummaryQuery.data?.nextSettlementAvailableAt
        ? format(new Date(payoutSummaryQuery.data.nextSettlementAvailableAt), "dd MMM yyyy")
        : lastCompletedPayout
        ? format(
            endOfDay(subDays(new Date(lastCompletedPayout.createdAt), -settlementDelayDays)),
            "dd MMM yyyy"
          )
        : "--",
    [lastCompletedPayout, payoutSummaryQuery.data?.nextSettlementAvailableAt]
  )

  const filteredPayouts = React.useMemo(() => {
    if (!payoutHistoryQuery.data) return payouts
    return (
      payoutHistoryQuery.data as OwnerListResponse<OwnerPayoutHistoryResponse>
    ).items.map((entry) => mapOwnerPayout(entry, payoutMethod.type))
  }, [payoutHistoryQuery.data, payoutMethod.type, payouts])

  const filteredTransactions = React.useMemo(() => {
    if (!payoutTransactionsQuery.data) return payoutTransactions
    return (
      payoutTransactionsQuery.data as OwnerListResponse<OwnerPayoutTransactionResponse>
    ).items.map(mapOwnerPayoutTransaction)
  }, [payoutTransactions, payoutTransactionsQuery.data])

  React.useEffect(() => {
    const queryTab = searchParams.get("tab")
    if (queryTab === "history" || queryTab === "transactions") {
      setActiveTab(queryTab)
    }
  }, [searchParams])

  React.useEffect(() => {
    const payoutId = searchParams.get("payout")
    if (!payoutId) return

    const matchedPayout = filteredPayouts.find((payout) => payout.id === payoutId)
    if (matchedPayout) {
      setActiveTab("history")
      setViewingPayout(matchedPayout)
    }
  }, [filteredPayouts, searchParams])

  React.useEffect(() => {
    const transactionId = searchParams.get("transaction")
    if (!transactionId) return

    const matchedTransaction = filteredTransactions.find(
      (transaction) => transaction.id === transactionId
    )
    if (matchedTransaction) {
      setActiveTab("transactions")
      setViewingTransaction(matchedTransaction)
    }
  }, [filteredTransactions, searchParams])

  React.useEffect(() => {
    setPayoutPageIndex(0)
    setTransactionPageIndex(0)
  }, [activeTab, debouncedSearch, dateFilter, statusFilter, typeFilter, sortBy])

  React.useEffect(() => {
    setPayoutPageIndex(0)
  }, [payoutPageSize])

  React.useEffect(() => {
    setTransactionPageIndex(0)
  }, [transactionPageSize])

  const payoutPageCount = Math.max(
    1,
    Math.ceil(filteredPayouts.length / payoutPageSize)
  )
  const safePayoutPageIndex = Math.min(payoutPageIndex, payoutPageCount - 1)
  const paginatedPayouts = React.useMemo(() => {
    const start = safePayoutPageIndex * payoutPageSize
    return filteredPayouts.slice(start, start + payoutPageSize)
  }, [filteredPayouts, payoutPageSize, safePayoutPageIndex])

  const transactionPageCount = Math.max(
    1,
    Math.ceil(filteredTransactions.length / transactionPageSize)
  )
  const safeTransactionPageIndex = Math.min(
    transactionPageIndex,
    transactionPageCount - 1
  )
  const paginatedTransactions = React.useMemo(() => {
    const start = safeTransactionPageIndex * transactionPageSize
    return filteredTransactions.slice(start, start + transactionPageSize)
  }, [filteredTransactions, transactionPageSize, safeTransactionPageIndex])

  const payoutChartData = React.useMemo(
    () =>
      filteredPayouts.slice(0, 8).reverse().map((payout) => ({
        label: format(new Date(payout.createdAt), "dd MMM"),
        primary: payout.amount,
        secondary: payout.status === "completed" ? payout.amount : 0,
      })),
    [filteredPayouts]
  )

  const transactionChartData = React.useMemo(
    () =>
      filteredTransactions
        .filter((transaction) => transaction.type !== "payout")
        .slice(0, 8)
        .reverse()
        .map((transaction) => ({
          label: format(new Date(transaction.createdAt), "dd MMM"),
          primary: transaction.grossAmount,
          secondary: transaction.netAmount,
        })),
    [filteredTransactions]
  )

  const activeChartData =
    activeTab === "history" ? payoutChartData : transactionChartData

  const activeChartMeta =
    activeTab === "history"
      ? {
          title: "Payout Trend",
          primaryStroke: "#1d4ed8",
          primaryFill: "#dbeafe",
          secondaryStroke: "#047857",
          secondaryFill: "#d1fae5",
        }
      : {
          title: "Earnings Trend",
          primaryStroke: "#1d4ed8",
          primaryFill: "#dbeafe",
          secondaryStroke: "#047857",
          secondaryFill: "#d1fae5",
        }

  const resetDisabled =
    !search &&
    dateFilter.preset === "last7Days" &&
    !dateFilter.range &&
    statusFilter === "all" &&
    typeFilter === "all" &&
    sortBy === "latest"

  function resetFilters() {
    setSearch("")
    setDateFilter({ ...defaultOrderDateFilter, preset: "last7Days" })
    setStatusFilter("all")
    setTypeFilter("all")
    setSortBy("latest")
  }

  function handleRequestPayout() {
    const amount = Number(requestAmount)
    if (!requestAmount.trim() || Number.isNaN(amount)) {
      setRequestError("Enter a valid payout amount.")
      return
    }
    if (amount < 500) {
      setRequestError("Minimum payout request is 500tk.")
      return
    }
    if (amount > availableBalance) {
      setRequestError("Requested amount exceeds available balance.")
      return
    }
    payoutRequestMutation.mutate(
      { amount },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "summary"] })
          void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "history"] })
          setRequestAmount("")
          setRequestError("")
          setRequestSuccess(
            `Payout request for ${formatPayoutMoney(amount)} submitted successfully.`
          )
          setIsRequestOpen(false)
          toast.success("Payout request submitted.")
        },
        onError: (error) => {
          setRequestError(
            error instanceof Error ? error.message : "Unable to submit payout request."
          )
        },
      }
    )
  }

  function handleDownloadReport() {
    const rows = [
      [
        "transactionId",
        "orderNumber",
        "type",
        "grossAmount",
        "commission",
        "discountCost",
        "deliveryCost",
        "netAmount",
        "status",
        "createdAt",
      ].join(","),
      ...filteredTransactions.map((transaction) =>
        [
          transaction.id,
          transaction.orderNumber,
          transaction.type,
          transaction.grossAmount,
          transaction.commission,
          transaction.discountCost,
          transaction.deliveryCost,
          transaction.netAmount,
          transaction.status,
          transaction.createdAt,
        ].join(",")
      ),
    ]

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "payout-transactions.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function handleDownloadPayoutHistory() {
    const rows = [
      [
        "payoutId",
        "amount",
        "status",
        "transactionId",
        "method",
        "createdAt",
        "processedAt",
        "failureReason",
      ].join(","),
      ...filteredPayouts.map((payout) =>
        [
          payout.id,
          payout.amount,
          payout.status,
          payout.transactionId,
          payout.method,
          payout.createdAt,
          payout.processedAt ?? "",
          `"${(payout.failureReason ?? "").replaceAll('"', '""')}"`,
        ].join(",")
      ),
    ]

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "payout-history.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return <PayoutsSkeleton />
  }

  return (
    <div className="space-y-4 px-4 lg:px-6">
      <PayoutDetailsDrawer
        payout={viewingPayout}
        open={!!viewingPayout}
        onOpenChange={(open) => {
          if (!open) {
            setViewingPayout(null)
            if (searchParams.get("payout")) {
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.delete("payout")
                return next
              })
            }
          }
        }}
      />
      <PayoutMethodDrawer
        open={isMethodOpen}
        onOpenChange={setIsMethodOpen}
        method={payoutMethod}
        showVerificationHint="If the bKash number is different from your owner account number, we will ask for OTP verification before activating it."
        onSave={(method) => {
          updatePayoutMethodMutation.mutate(
            method.type === "bkash"
              ? {
                  type: "bkash",
                  accountName: method.accountName.trim(),
                  accountNumber: method.accountNumber.trim(),
                }
              : {
                  type: "bank",
                  accountName: method.accountName.trim(),
                  accountNumber: method.accountNumber.trim(),
                  bankName: method.bankName?.trim() ?? "",
                  branchName: method.branchName?.trim() ?? "",
                },
            {
              onSuccess: (response) => {
                const nextMethod = mapOwnerPayoutMethod(response.payoutMethod, method)
                setPayoutMethod(nextMethod)
                void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "summary"] })
                void queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "history"] })

                if (response.verificationSessionId) {
                  setVerificationRequest({
                    verificationSessionId: response.verificationSessionId,
                    purpose: "owner_payout_verify",
                    phone: nextMethod.pendingAccountNumber || nextMethod.accountNumber,
                    referenceId: response.payoutMethod._id,
                    pendingPassword: "",
                  })
                  setVerificationModalOpen(true)
                  toast.info("Verify your bKash number to activate this payout method.", {
                    description:
                      "The new wallet number will stay pending until OTP verification is complete.",
                  })
                  return
                }

                toast.success("Payout method updated successfully.")
              },
              onError: (error) => {
                toast.error("Unable to update payout method.", {
                  description:
                    error instanceof Error ? error.message : "Please try again.",
                })
              },
            }
          )
        }}
        isSaving={updatePayoutMethodMutation.isPending}
      />
      <TransactionDetailsDrawer
        transaction={viewingTransaction}
        open={!!viewingTransaction}
        onOpenChange={(open) => {
          if (!open) {
            setViewingTransaction(null)
            if (searchParams.get("transaction")) {
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.delete("transaction")
                return next
              })
            }
          }
        }}
      />

      <Dialog open={isRequestOpen} onOpenChange={setIsRequestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Payout</DialogTitle>
            <DialogDescription>
              Available balance is {formatPayoutMoney(availableBalance)}. Manual
              requests are processed on approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={requestAmount}
              onChange={(event) => {
                setRequestAmount(event.target.value)
                setRequestError("")
              }}
              placeholder="Enter payout amount"
              inputMode="decimal"
            />
            {requestError ? (
              <p className="text-sm text-destructive">{requestError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRequestPayout} disabled={payoutRequestMutation.isPending}>
              {payoutRequestMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {payoutRequestMutation.isPending ? "Submitting..." : "Request Payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {requestSuccess ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <div className="font-medium text-emerald-900">
                  Payout request submitted
                </div>
                <div className="mt-1 text-sm text-emerald-800">
                  {requestSuccess}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setRequestSuccess("")}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Lifetime Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatPayoutMoney(lifetimeEarnings)}</div>
            <div className="mt-2 text-sm text-muted-foreground">Total net earnings to date</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Available Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-emerald-700">{formatPayoutMoney(availableBalance)}</div>
            <div className="mt-2 text-sm text-muted-foreground">Ready for payout now</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-amber-700">{formatPayoutMoney(pendingBalance)}</div>
            <div className="mt-2 text-sm text-muted-foreground">Settles after T+{settlementDelayDays} days</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Available Soon</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-sky-700">{formatPayoutMoney(availableSoonBalance)}</div>
            <div className="mt-2 text-sm text-muted-foreground">Recent orders settling into wallet</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Payout</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatPayoutMoney(lastCompletedPayout?.amount ?? 0)}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {lastCompletedPayout ? format(new Date(lastCompletedPayout.createdAt), "dd MMM yyyy") : "No completed payout yet"}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Next Payout Date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{nextPayoutDate}</div>
            <div className="mt-2 text-sm text-muted-foreground">Weekly auto settlement cycle</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{activeChartMeta.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeChartData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="primary"
                    stroke={activeChartMeta.primaryStroke}
                    fill={activeChartMeta.primaryFill}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="secondary"
                    stroke={activeChartMeta.secondaryStroke}
                    fill={activeChartMeta.secondaryFill}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Payout Method & Rules</CardTitle>
            </div>
            <Button variant="outline" onClick={() => setIsMethodOpen(true)}>
              {updatePayoutMethodMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : payoutMethod.type === "bank" ? (
                <Landmark className="size-4" />
              ) : (
                <WalletCards className="size-4" />
              )}
              {updatePayoutMethodMutation.isPending ? "Saving..." : "Update Method"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {payoutMethod.type === "bank" ? "Bank Account" : "bKash Wallet"}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {payoutMethod.accountName} |{" "}
                    {payoutMethod.accountNumber}
                  </div>
                  {payoutMethod.type === "bank" ? (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {payoutMethod.bankName} | {payoutMethod.branchName}
                    </div>
                  ) : null}
                  {payoutMethod.pendingAccountNumber ? (
                    <div className="mt-1 text-sm text-amber-700">
                      Pending verification for {payoutMethod.pendingAccountNumber}
                    </div>
                  ) : null}
                  <div className="mt-2">
                    {payoutMethod.pendingAccountNumber ? (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-700"
                      >
                        Verification Pending
                      </Badge>
                    ) : payoutMethod.isVerified ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        Verified
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-700"
                      >
                        Verification Pending
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {payoutMethod.type === "bank" ? <CreditCard className="size-5" /> : <Wallet className="size-5" />}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CalendarClock className="size-4 text-muted-foreground" />
                Settlement Rules
              </div>
              <p className="mt-2 text-muted-foreground">
                Available balance includes only orders settled after T+{settlementDelayDays} days.
                Pending balance contains recent orders, owner-funded discount share, and settlement holds.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setIsRequestOpen(true)} disabled={availableBalance < 500}>
                <Banknote className="size-4" />
                Request Payout
              </Button>
              <Button
                variant="outline"
                onClick={
                  activeTab === "history"
                    ? handleDownloadPayoutHistory
                    : handleDownloadReport
                }
              >
                <Download className="size-4" />
                {activeTab === "history" ? "Export History" : "Download Report"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PayoutTab)}>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <TabsList className="w-full justify-start lg:w-fit">
            <TabsTrigger value="history">
              Payout History
              <span className="ml-1 text-xs text-muted-foreground">
                {filteredPayouts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="transactions">
              Transaction Breakdown
              <span className="ml-1 text-xs text-muted-foreground">
                {filteredTransactions.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:flex-wrap">
              <div className="relative w-full lg:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={
                    activeTab === "history"
                      ? "Search payout ID, transaction, notes"
                      : "Search order or transaction"
                  }
                  className="pl-9"
                />
              </div>

              {activeTab === "history" ? (
                <Select
                  value={statusFilter}
                  onValueChange={(value) =>
                    setStatusFilter(value as CombinedStatusFilter)
                  }
                >
                  <SelectTrigger className="w-full lg:w-44">
                    <SelectValue placeholder="Payout status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Payout Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={typeFilter}
                  onValueChange={(value) =>
                    setTypeFilter(value as CombinedTypeFilter)
                  }
                >
                  <SelectTrigger className="w-full lg:w-44">
                    <SelectValue placeholder="Transaction type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Transaction Types</SelectItem>
                    <SelectItem value="earning">Earning</SelectItem>
                    <SelectItem value="payout">Payout</SelectItem>
                    <SelectItem value="refund">Refund</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <OrderDateFilter
                value={dateFilter}
                onChange={setDateFilter}
              />

              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as SortKey)}
              >
                <SelectTrigger className="w-full lg:w-44">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="highestNet">
                    {activeTab === "history" ? "Highest Amount" : "Highest Net"}
                  </SelectItem>
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between lg:w-40">
                    <span className="inline-flex items-center gap-2">
                      <Columns3 className="size-4" />
                      Columns
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {activeTab === "history"
                    ? (Object.keys(payoutColumnVisibility) as PayoutColumnKey[]).map(
                        (key) => (
                          <DropdownMenuCheckboxItem
                            key={key}
                            checked={payoutColumnVisibility[key]}
                            onCheckedChange={(checked) =>
                              setPayoutColumnVisibility((current) => ({
                                ...current,
                                [key]: !!checked,
                              }))
                            }
                          >
                            {payoutColumnLabels[key]}
                          </DropdownMenuCheckboxItem>
                        )
                      )
                    : (
                        Object.keys(
                          transactionColumnVisibility
                        ) as TransactionColumnKey[]
                      ).map((key) => (
                        <DropdownMenuCheckboxItem
                          key={key}
                          checked={transactionColumnVisibility[key]}
                          onCheckedChange={(checked) =>
                            setTransactionColumnVisibility((current) => ({
                              ...current,
                              [key]: !!checked,
                            }))
                          }
                        >
                          {transactionColumnLabels[key]}
                        </DropdownMenuCheckboxItem>
                      ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" onClick={resetFilters} disabled={resetDisabled}>
                <RotateCcw className="size-4" />
                Reset
              </Button>
            </div>
          </div>
        </div>

        <TabsContent value="history" className="space-y-4">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Payout</TableHead>
                    {payoutColumnVisibility.amount ? <TableHead>Amount</TableHead> : null}
                    {payoutColumnVisibility.status ? <TableHead>Status</TableHead> : null}
                    {payoutColumnVisibility.notes ? <TableHead>Notes</TableHead> : null}
                    {payoutColumnVisibility.transaction ? <TableHead>Transaction ID</TableHead> : null}
                    {payoutColumnVisibility.method ? <TableHead>Method</TableHead> : null}
                    {payoutColumnVisibility.date ? <TableHead>Date</TableHead> : null}
                    <TableHead className="pr-4 text-right lg:pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedPayouts.length > 0 ? (
                    paginatedPayouts.map((payout) => (
                      <TableRow key={payout.id}>
                        <TableCell className="font-medium">{payout.id}</TableCell>
                        {payoutColumnVisibility.amount ? (
                          <TableCell>{formatPayoutMoney(payout.amount)}</TableCell>
                        ) : null}
                        {payoutColumnVisibility.status ? (
                          <TableCell>{getPayoutBadge(payout.status)}</TableCell>
                        ) : null}
                        {payoutColumnVisibility.notes ? (
                          <TableCell className="max-w-56 text-sm text-muted-foreground">
                            {payout.failureReason ?? "No issues reported"}
                          </TableCell>
                        ) : null}
                        {payoutColumnVisibility.transaction ? (
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {payout.transactionId}
                          </TableCell>
                        ) : null}
                        {payoutColumnVisibility.method ? (
                          <TableCell>{payout.method === "bank" ? "Bank" : "bKash"}</TableCell>
                        ) : null}
                        {payoutColumnVisibility.date ? (
                          <TableCell>{format(new Date(payout.createdAt), "dd MMM yyyy")}</TableCell>
                        ) : null}
                        <TableCell className="pr-4 text-right lg:pr-6">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewingPayout(payout)}
                          >
                            <ReceiptText className="size-4" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="p-8">
                        <Empty>
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <ReceiptText className="size-4" />
                            </EmptyMedia>
                            <EmptyTitle>No payouts found</EmptyTitle>
                            <EmptyDescription>
                              Completed, processing, and failed payouts will appear here once settlements begin.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button variant="outline" onClick={resetFilters}>
                              <RotateCcw className="size-4" />
                              Reset Filters
                            </Button>
                          </EmptyContent>
                        </Empty>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border bg-card px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {paginatedPayouts.length} of {filteredPayouts.length} payout(s)
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={handleDownloadPayoutHistory}
              >
                <Download className="size-4" />
                Export History
              </Button>
              <Select
                value={`${payoutPageSize}`}
                onValueChange={(value) => setPayoutPageSize(Number(value))}
              >
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder="Rows" />
                </SelectTrigger>
                <SelectContent side="top">
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-sm font-medium">
                Page {safePayoutPageIndex + 1} of {payoutPageCount}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPayoutPageIndex((current) => Math.max(0, current - 1))}
                  disabled={safePayoutPageIndex === 0}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setPayoutPageIndex((current) =>
                      Math.min(payoutPageCount - 1, current + 1)
                    )
                  }
                  disabled={safePayoutPageIndex >= payoutPageCount - 1}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <Table className="min-w-[1180px]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order</TableHead>
                    {transactionColumnVisibility.type ? <TableHead>Type</TableHead> : null}
                    {transactionColumnVisibility.gross ? <TableHead>Gross</TableHead> : null}
                    {transactionColumnVisibility.commission ? <TableHead>Commission</TableHead> : null}
                    {transactionColumnVisibility.discount ? <TableHead>Discount Cost</TableHead> : null}
                    {transactionColumnVisibility.delivery ? <TableHead>Delivery Cost</TableHead> : null}
                    {transactionColumnVisibility.net ? <TableHead>Net</TableHead> : null}
                    {transactionColumnVisibility.settlement ? <TableHead>Settlement</TableHead> : null}
                    {transactionColumnVisibility.created ? <TableHead>Created</TableHead> : null}
                    {transactionColumnVisibility.available ? <TableHead>Available</TableHead> : null}
                    <TableHead className="pr-4 text-right lg:pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTransactions.length > 0 ? (
                    paginatedTransactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{transaction.orderNumber}</div>
                            <div className="text-xs text-muted-foreground">{transaction.orderId}</div>
                          </div>
                        </TableCell>
                        {transactionColumnVisibility.type ? (
                          <TableCell>{getTransactionBadge(transaction.type)}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.gross ? (
                          <TableCell>{formatPayoutMoney(transaction.grossAmount)}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.commission ? (
                          <TableCell>-{formatPayoutMoney(transaction.commission)}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.discount ? (
                          <TableCell>-{formatPayoutMoney(transaction.discountCost)}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.delivery ? (
                          <TableCell>-{formatPayoutMoney(transaction.deliveryCost)}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.net ? (
                          <TableCell
                            className={
                              transaction.netAmount >= 0
                                ? "font-medium text-emerald-700"
                                : "font-medium text-rose-700"
                            }
                          >
                            {transaction.netAmount >= 0 ? "+" : ""}
                            {formatPayoutMoney(transaction.netAmount)}
                          </TableCell>
                        ) : null}
                        {transactionColumnVisibility.settlement ? (
                          <TableCell>{getSettlementBadge(transaction.status)}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.created ? (
                          <TableCell>{format(new Date(transaction.createdAt), "dd MMM yyyy")}</TableCell>
                        ) : null}
                        {transactionColumnVisibility.available ? (
                          <TableCell>
                            {format(new Date(transaction.settlementAvailableAt), "dd MMM yyyy")}
                          </TableCell>
                        ) : null}
                        <TableCell className="pr-4 text-right lg:pr-6">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewingTransaction(transaction)}
                          >
                            <ReceiptText className="size-4" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={11} className="p-8">
                        <Empty>
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <Wallet className="size-4" />
                            </EmptyMedia>
                            <EmptyTitle>No transactions found</EmptyTitle>
                            <EmptyDescription>
                              Once orders are settled, order-level earnings and payout deductions will appear here.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button variant="outline" onClick={resetFilters}>
                              <RotateCcw className="size-4" />
                              Reset Filters
                            </Button>
                          </EmptyContent>
                        </Empty>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border bg-card px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {paginatedTransactions.length} of {filteredTransactions.length} transaction(s)
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={handleDownloadReport}
              >
                <Download className="size-4" />
                Export Transactions
              </Button>
              <Select
                value={`${transactionPageSize}`}
                onValueChange={(value) => setTransactionPageSize(Number(value))}
              >
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder="Rows" />
                </SelectTrigger>
                <SelectContent side="top">
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-sm font-medium">
                Page {safeTransactionPageIndex + 1} of {transactionPageCount}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setTransactionPageIndex((current) => Math.max(0, current - 1))
                  }
                  disabled={safeTransactionPageIndex === 0}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setTransactionPageIndex((current) =>
                      Math.min(transactionPageCount - 1, current + 1)
                    )
                  }
                  disabled={safeTransactionPageIndex >= transactionPageCount - 1}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
