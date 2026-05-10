import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  WalletCards,
} from "lucide-react"
import { toast } from "sonner"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import {
  exportAdminPayments,
  getAdminOrder,
  listAdminPayments,
  reconcileAdminPaymentsLedger,
  updateAdminOrderCodCollection,
  updateAdminOrderRefundStatus,
  type AdminPaymentTransaction,
  type AdminRestaurantOrderDateFilterPreset,
} from "@/lib/admin-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type PaymentPreset = Extract<
  AdminRestaurantOrderDateFilterPreset,
  "today" | "last7Days" | "last30Days" | "thisMonth" | "custom"
>
type PaymentMethodFilter = "all" | "Cash" | "Bkash"
type PaymentStatusFilter =
  | "all"
  | "pending"
  | "paid"
  | "refund_pending"
  | "refunded"
  | "refund_rejected"
type SettlementFilter = "all" | "delivered" | "refund_queue" | "online" | "cod"
type PaymentSort = "newest" | "oldest" | "highestValue" | "recentlyUpdated"
type RefundStatus = "refund_pending" | "refunded" | "refund_rejected"

const pageSizeOptions = [10, 20, 50]

function formatCurrency(value: number) {
  return `Tk ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString()}`
}

function formatDate(value?: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleString()
}

function formatShortDate(value?: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleDateString()
}

function getPaymentBadgeClass(status: string) {
  if (status === "paid" || status === "refunded") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
  if (status === "refund_pending") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }
  if (status === "refund_rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700"
  }
  return ""
}

function getOrderBadgeClass(status: string) {
  if (status === "Delivered") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (["Cancelled", "Rejected"].includes(status)) {
    return "border-rose-200 bg-rose-50 text-rose-700"
  }
  return "border-sky-200 bg-sky-50 text-sky-700"
}

function getReconciliationState(transaction: AdminPaymentTransaction) {
  if (transaction.paymentMethod === "Bkash") {
    if (transaction.paymentStatus === "paid" && !transaction.transactionId) {
      return { label: "Missing trx", tone: "warning" }
    }
    if (transaction.paymentStatus === "paid") {
      return { label: "Matched", tone: "success" }
    }
    return { label: "Provider pending", tone: "muted" }
  }

  if (transaction.paymentMethod === "Cash") {
    if (transaction.status === "Delivered" && transaction.paymentStatus === "paid") {
      return { label: "Cash collected", tone: "success" }
    }
    if (transaction.status === "Delivered") {
      return { label: "Cash due", tone: "warning" }
    }
    return { label: "COD pending", tone: "muted" }
  }

  return { label: "Review", tone: "muted" }
}

function getReconciliationBadgeClass(tone: string) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-700"
  return ""
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string
  value: React.ReactNode
  helper: string
}) {
  return (
    <Card>
      <CardContent className="pt-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  )
}

function RefundDialog({
  target,
  onOpenChange,
}: {
  target: null | {
    transaction: AdminPaymentTransaction
    paymentStatus: RefundStatus
    label: string
  }
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = React.useState("")
  const mutation = useMutation({
    mutationFn: updateAdminOrderRefundStatus,
    onSuccess: () => {
      toast.success("Refund status updated.")
      void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
      void queryClient.invalidateQueries({
        queryKey: ["admin-order", target?.transaction.orderId],
      })
      setNote("")
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Refund update failed.")
      void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
    },
  })

  React.useEffect(() => {
    if (!target) setNote("")
  }, [target])

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.label ?? "Update refund"}</DialogTitle>
          <DialogDescription>
            Payment status for {target?.transaction.orderNumber} will become{" "}
            {target?.paymentStatus}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="payment-refund-note">Refund note</Label>
          <Textarea
            id="payment-refund-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Refund reference or internal note"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!target || mutation.isPending}
            onClick={() => {
              if (!target) return
              mutation.mutate({
                orderId: target.transaction.orderId,
                expectedPaymentStatus: target.transaction.paymentStatus,
                paymentStatus: target.paymentStatus,
                note,
              })
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <WalletCards className="size-4" />
            )}
            Save refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CodCollectionDialog({
  target,
  onOpenChange,
}: {
  target: AdminPaymentTransaction | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = React.useState("")
  const mutation = useMutation({
    mutationFn: updateAdminOrderCodCollection,
    onSuccess: () => {
      toast.success("COD payment marked as collected.")
      void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-order", target?.orderId] })
      setNote("")
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "COD update failed.")
      void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
    },
  })

  React.useEffect(() => {
    if (!target) setNote("")
  }, [target])

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark COD collected</DialogTitle>
          <DialogDescription>
            Confirm cash collection for {target?.orderNumber}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cod-note">Collection note</Label>
          <Textarea
            id="cod-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Cash received by rider/admin reference"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!target || mutation.isPending}
            onClick={() => {
              if (!target) return
              mutation.mutate({
                orderId: target.orderId,
                expectedPaymentStatus: target.paymentStatus,
                note,
              })
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <WalletCards className="size-4" />
            )}
            Confirm collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PaymentDetailsSheet({
  orderId,
  onRefund,
  onCollectCod,
  onOpenChange,
}: {
  orderId: string
  onRefund: (
    transaction: AdminPaymentTransaction,
    paymentStatus: RefundStatus,
    label: string
  ) => void
  onCollectCod: (transaction: AdminPaymentTransaction) => void
  onOpenChange: (open: boolean) => void
}) {
  const detailsQuery = useQuery({
    queryKey: ["admin-order", orderId],
    queryFn: () => getAdminOrder(orderId),
    enabled: Boolean(orderId),
  })
  const details = detailsQuery.data
  const transaction = details
    ? ({
        id: details.id,
        orderId: details.id,
        orderNumber: details.orderNumber,
        status: details.status,
        restaurantId: details.restaurantId,
        restaurantName: details.restaurantName,
        customerName: details.customerName,
        customerPhone: details.customerPhone,
        paymentMethod: details.paymentMethod,
        paymentStatus: details.paymentStatus,
        provider: details.paymentMethod,
        transactionId: "",
        amount: details.pricing.total,
        subtotal: details.pricing.subtotal,
        deliveryFee: details.pricing.deliveryFee,
        discount: details.pricing.discount,
        refundStatus: details.paymentStatus,
        refundNote: "",
        refundRequestedAt: null,
        refundReviewedAt: null,
        createdAt: details.timestamps.createdAt,
        updatedAt: null,
        deliveredAt: details.timestamps.deliveredAt,
        cancelledAt: details.timestamps.cancelledAt,
        isRefundCandidate:
          ["Cancelled", "Rejected"].includes(details.status) &&
          details.paymentMethod === "Bkash" &&
          ["paid", "refund_pending"].includes(details.paymentStatus),
      } satisfies AdminPaymentTransaction)
    : null
  const paymentSnapshot = (details?.paymentSnapshot ?? {}) as Record<
    string,
    unknown
  >
  const provider =
    typeof paymentSnapshot.provider === "string"
      ? paymentSnapshot.provider
      : details?.paymentMethod
  const transactionId =
    typeof paymentSnapshot.transactionId === "string"
      ? paymentSnapshot.transactionId
      : typeof paymentSnapshot.trxID === "string"
        ? paymentSnapshot.trxID
        : ""
  const refundStatus =
    typeof paymentSnapshot.refundStatus === "string"
      ? paymentSnapshot.refundStatus
      : details?.paymentStatus
  const refundNote =
    typeof paymentSnapshot.refundNote === "string" ? paymentSnapshot.refundNote : ""
  const refundRequestedAt =
    typeof paymentSnapshot.refundRequestedAt === "string"
      ? paymentSnapshot.refundRequestedAt
      : null
  const refundReviewedAt =
    typeof paymentSnapshot.refundReviewedAt === "string"
      ? paymentSnapshot.refundReviewedAt
      : null

  return (
    <Sheet open={Boolean(orderId)} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full max-w-none! flex-col overflow-hidden p-0 sm:max-w-3xl! md:max-w-6xl!">
        <div className="border-b px-6 py-5">
          <SheetHeader>
            <SheetTitle>{details?.orderNumber ?? "Payment details"}</SheetTitle>
            <SheetDescription>
              Order payment, refund, customer, and restaurant context.
            </SheetDescription>
          </SheetHeader>
          {details ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="outline" className={getOrderBadgeClass(details.status)}>
                {details.status}
              </Badge>
              <Badge
                variant="outline"
                className={getPaymentBadgeClass(details.paymentStatus)}
              >
                {details.paymentStatus}
              </Badge>
              <Badge variant="secondary">{details.paymentMethod}</Badge>
              {transactionId ? (
                <Badge variant="outline">Trx {transactionId}</Badge>
              ) : null}
              <div className="ml-auto flex flex-wrap gap-2">
                {transaction?.paymentStatus === "paid" &&
                ["Cancelled", "Rejected"].includes(transaction.status) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onRefund(
                        transaction,
                        "refund_pending",
                        "Mark refund pending"
                      )
                    }
                  >
                    Mark refund pending
                  </Button>
                ) : null}
                {transaction?.paymentStatus === "refund_pending" ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        onRefund(transaction, "refunded", "Mark refunded")
                      }
                    >
                      Mark refunded
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onRefund(transaction, "refund_rejected", "Reject refund")
                      }
                    >
                      Reject refund
                    </Button>
                  </>
                ) : null}
                {transaction?.paymentMethod === "Cash" &&
                transaction.status === "Delivered" &&
                transaction.paymentStatus !== "paid" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCollectCod(transaction)}
                  >
                    Mark COD collected
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {detailsQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : details ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Payment</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <InfoRow label="Method" value={details.paymentMethod} />
                    <InfoRow label="Status" value={details.paymentStatus} />
                    <InfoRow label="Provider" value={provider || "N/A"} />
                    <InfoRow label="Transaction ID" value={transactionId || "N/A"} />
                    <InfoRow label="Total" value={formatCurrency(details.pricing.total)} />
                    <InfoRow label="Subtotal" value={formatCurrency(details.pricing.subtotal)} />
                    <InfoRow label="Delivery fee" value={formatCurrency(details.pricing.deliveryFee)} />
                    <InfoRow label="Discount" value={formatCurrency(details.pricing.discount)} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Settlement math</CardTitle>
                    <CardDescription>
                      Customer total can differ from restaurant payable.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <InfoRow
                      label="Customer paid total"
                      value={formatCurrency(details.pricing.total)}
                    />
                    <InfoRow
                      label="Item subtotal"
                      value={formatCurrency(details.pricing.subtotal)}
                    />
                    <InfoRow
                      label="Discount"
                      value={formatCurrency(details.pricing.discount)}
                    />
                    <InfoRow
                      label="Delivery fee"
                      value={formatCurrency(details.pricing.deliveryFee)}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Order items</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {details.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Qty {item.quantity}
                          </div>
                        </div>
                        <div className="font-medium">
                          {formatCurrency(item.lineTotal)}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Order context</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <InfoRow label="Status" value={details.status} />
                    <InfoRow label="Restaurant" value={details.restaurantName} />
                    <InfoRow label="Customer" value={details.customerName} />
                    <InfoRow label="Phone" value={details.customerPhone} />
                    <InfoRow label="Rider" value={details.riderName || "N/A"} />
                    <InfoRow
                      label="Delivery address"
                      value={details.deliveryAddress || "N/A"}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Refund</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <InfoRow label="Refund status" value={refundStatus || "N/A"} />
                    <InfoRow
                      label="Requested at"
                      value={formatDate(refundRequestedAt)}
                    />
                    <InfoRow
                      label="Reviewed at"
                      value={formatDate(refundReviewedAt)}
                    />
                    <InfoRow label="Note" value={refundNote || "N/A"} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Payment audit</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {details.history
                      .filter((entry) =>
                        entry.note.toLowerCase().includes("refund") ||
                        entry.note.toLowerCase().includes("cod") ||
                        entry.note.toLowerCase().includes("payment")
                      )
                      .map((entry, index) => (
                        <div
                          key={`${entry.createdAt}-${index}`}
                          className="rounded-md border px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{entry.actor}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(entry.createdAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {entry.note || entry.status}
                          </div>
                        </div>
                      ))}
                    {details.history.filter((entry) =>
                      entry.note.toLowerCase().includes("refund") ||
                      entry.note.toLowerCase().includes("cod") ||
                      entry.note.toLowerCase().includes("payment")
                    ).length === 0 ? (
                      <div className="text-muted-foreground">
                        No payment audit entries yet.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Timeline</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <InfoRow
                      label="Created"
                      value={formatDate(details.timestamps.createdAt)}
                    />
                    <InfoRow
                      label="Accepted"
                      value={formatDate(details.timestamps.acceptedAt)}
                    />
                    <InfoRow
                      label="Ready"
                      value={formatDate(details.timestamps.readyAt)}
                    />
                    <InfoRow
                      label="Delivered"
                      value={formatDate(details.timestamps.deliveredAt)}
                    />
                    <InfoRow
                      label="Cancelled"
                      value={formatDate(details.timestamps.cancelledAt)}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Payment details not found.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function exportTransactionsCsv(
  transactions: AdminPaymentTransaction[],
  filename = `admin-payments-${new Date().toISOString().slice(0, 10)}.csv`
) {
  const rows = transactions.map((transaction) => ({
    orderNumber: transaction.orderNumber,
    restaurant: transaction.restaurantName,
    customer: transaction.customerName,
    method: transaction.paymentMethod,
    paymentStatus: transaction.paymentStatus,
    orderStatus: transaction.status,
    amount: transaction.amount,
    transactionId: transaction.transactionId,
    createdAt: transaction.createdAt ?? "",
  }))
  const headers = Object.keys(rows[0] ?? { orderNumber: "" })
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header as keyof typeof row] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function PaymentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [preset, setPreset] = React.useState<PaymentPreset>("last7Days")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethodFilter>("all")
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatusFilter>("all")
  const [settlement, setSettlement] = React.useState<SettlementFilter>("all")
  const [sortBy, setSortBy] = React.useState<PaymentSort>("newest")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [detailsOrderId, setDetailsOrderId] = React.useState("")
  const [codTarget, setCodTarget] = React.useState<AdminPaymentTransaction | null>(null)
  const [refundTarget, setRefundTarget] = React.useState<null | {
    transaction: AdminPaymentTransaction
    paymentStatus: RefundStatus
    label: string
  }>(null)
  const debouncedSearch = useDebouncedValue(search, 350)
  const paymentFilterParams = React.useMemo(
    () => ({
      search: debouncedSearch,
      preset,
      from: preset === "custom" ? from : "",
      to: preset === "custom" ? to : "",
      paymentMethod,
      paymentStatus,
      settlement,
      sortBy,
    }),
    [
      debouncedSearch,
      preset,
      from,
      to,
      paymentMethod,
      paymentStatus,
      settlement,
      sortBy,
    ]
  )

  const paymentsQuery = useQuery({
    queryKey: [
      "admin-payments",
      {
        search: debouncedSearch,
        preset,
        from,
        to,
        paymentMethod,
        paymentStatus,
        settlement,
        sortBy,
        page,
        pageSize,
      },
    ],
    queryFn: () =>
      listAdminPayments({
        ...paymentFilterParams,
        page,
        pageSize,
      }),
  })
  const exportMutation = useMutation({
    mutationFn: () => exportAdminPayments(paymentFilterParams),
    onSuccess: (data) => {
      exportTransactionsCsv(
        data.items,
        `admin-payments-filtered-${new Date().toISOString().slice(0, 10)}.csv`
      )
      if (data.truncated) {
        toast.warning("Export limited to the latest 5,000 matching transactions.")
      } else {
        toast.success(`Exported ${data.items.length} transactions.`)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Export failed.")
    },
  })
  const reconcileMutation = useMutation({
    mutationFn: reconcileAdminPaymentsLedger,
    onSuccess: (result) => {
      toast.success(
        `Ledger reconciled. ${result.created} created, ${result.updated} updated.`
      )
      void queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Ledger reconcile failed.")
    },
  })

  const transactions = paymentsQuery.data?.items ?? []
  const summary = paymentsQuery.data?.summary
  const pageCount = paymentsQuery.data?.pageCount ?? 1
  const safePage = Math.min(page, pageCount)

  React.useEffect(() => {
    setPage(1)
  }, [
    debouncedSearch,
    preset,
    from,
    to,
    paymentMethod,
    paymentStatus,
    settlement,
    sortBy,
    pageSize,
  ])

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  function resetFilters() {
    setSearch("")
    setPreset("last7Days")
    setFrom("")
    setTo("")
    setPaymentMethod("all")
    setPaymentStatus("all")
    setSettlement("all")
    setSortBy("newest")
    setPage(1)
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor online payment, cash on delivery, refunds, and transaction history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={resetFilters}>
            <RotateCcw className="size-4" />
            Reset filters
          </Button>
          <Button
            variant="outline"
            onClick={() => reconcileMutation.mutate()}
            disabled={reconcileMutation.isPending}
          >
            {reconcileMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <WalletCards className="size-4" />
            )}
            Reconcile ledger
          </Button>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export filtered
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Customer paid delivered"
          value={formatCurrency(summary?.deliveredRevenue ?? 0)}
          helper="Delivered order totals"
        />
        <StatCard
          label="Online collected"
          value={formatCurrency(summary?.onlineCollected ?? 0)}
          helper="Paid bKash orders"
        />
        <StatCard
          label="COD delivered"
          value={formatCurrency(summary?.codDelivered ?? 0)}
          helper="Delivered cash orders"
        />
        <StatCard
          label="Refund pending"
          value={formatCurrency(summary?.refundPendingAmount ?? 0)}
          helper={`${summary?.refundPendingCount ?? 0} orders need review`}
        />
        <StatCard
          label="Refunded"
          value={formatCurrency(summary?.refundedAmount ?? 0)}
          helper={`${summary?.refundedCount ?? 0} completed refunds`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Restaurant settlement breakdown</CardTitle>
            <CardDescription>
              Payout math for restaurants. This is different from customer paid total.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <InfoRow
              label="Customer paid delivered"
              value={formatCurrency(summary?.deliveredRevenue ?? 0)}
            />
            <InfoRow
              label="Item subtotal before discount"
              value={formatCurrency(summary?.settlementGrossAmount ?? 0)}
            />
            <InfoRow
              label="Commission base before restaurant discount"
              value={formatCurrency(summary?.settlementCommissionBase ?? 0)}
            />
            <InfoRow
              label="Minus platform commission"
              value={formatCurrency(summary?.platformCommission ?? 0)}
            />
            <InfoRow
              label="Minus discount funded by restaurant"
              value={formatCurrency(summary?.discountCost ?? 0)}
            />
            <InfoRow
              label="Platform promo expense"
              value={formatCurrency(summary?.platformDiscountCost ?? 0)}
            />
            <InfoRow
              label="Restaurant payable"
              value={formatCurrency(summary?.restaurantPayable ?? 0)}
            />
            <InfoRow
              label="Delivery fee shown separately"
              value={formatCurrency(summary?.deliveryCost ?? 0)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payout readiness</CardTitle>
            <CardDescription>
              Available, pending, and already paid restaurant balances.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <InfoRow
              label="Ready to payout"
              value={formatCurrency(summary?.payoutReadyAmount ?? 0)}
            />
            <InfoRow
              label="Pending settlement"
              value={formatCurrency(summary?.payoutPendingAmount ?? 0)}
            />
            <InfoRow
              label="Already paid out"
              value={formatCurrency(summary?.paidOutAmount ?? 0)}
            />
            <InfoRow
              label="Pending COD"
              value={formatCurrency(summary?.pendingCod ?? 0)}
            />
            <InfoRow
              label="Next payout date"
              value={formatShortDate(summary?.nextPayoutDate)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform margin estimate</CardTitle>
            <CardDescription>
              Commission and delivery fee minus platform promo and rider payroll.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <InfoRow
              label="Platform gross income"
              value={formatCurrency(summary?.platformGrossIncome ?? 0)}
            />
            <InfoRow
              label="Rider payroll expense"
              value={formatCurrency(summary?.riderPayrollExpense ?? 0)}
            />
            <InfoRow
              label="Payroll pending"
              value={formatCurrency(summary?.riderPayrollPending ?? 0)}
            />
            <InfoRow
              label="Payroll paid"
              value={formatCurrency(summary?.riderPayrollPaid ?? 0)}
            />
            <InfoRow
              label="Operating expense"
              value={formatCurrency(summary?.platformOperatingExpense ?? 0)}
            />
            <InfoRow
              label="Estimated margin"
              value={formatCurrency(summary?.estimatedPlatformMargin ?? 0)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction history</CardTitle>
          <CardDescription>
            Real platform orders with payment and refund status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search order, customer, restaurant, trx"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={preset} onValueChange={(value) => setPreset(value as PaymentPreset)}>
              <SelectTrigger className="h-9 w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="last7Days">Last 7 days</SelectItem>
                <SelectItem value="last30Days">Last 30 days</SelectItem>
                <SelectItem value="thisMonth">This month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={paymentMethod}
              onValueChange={(value) => setPaymentMethod(value as PaymentMethodFilter)}
            >
              <SelectTrigger className="h-9 w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bkash">bKash</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={paymentStatus}
              onValueChange={(value) => setPaymentStatus(value as PaymentStatusFilter)}
            >
              <SelectTrigger className="h-9 w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="refund_pending">Refund pending</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="refund_rejected">Refund rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={settlement}
              onValueChange={(value) => setSettlement(value as SettlementFilter)}
            >
              <SelectTrigger className="h-9 w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All settlements</SelectItem>
                <SelectItem value="delivered">Delivered revenue</SelectItem>
                <SelectItem value="online">Online payment</SelectItem>
                <SelectItem value="cod">Cash on delivery</SelectItem>
                <SelectItem value="refund_queue">Refund queue</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as PaymentSort)}
            >
              <SelectTrigger className="h-9 w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="highestValue">Highest value</SelectItem>
                <SelectItem value="recentlyUpdated">Recently updated</SelectItem>
              </SelectContent>
            </Select>
            {preset === "custom" ? (
              <>
                <Input
                  type="date"
                  className="h-9 w-full sm:w-36"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
                <Input
                  type="date"
                  className="h-9 w-full sm:w-36"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : null}
                {transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <div className="font-medium">{transaction.orderNumber}</div>
                      <Badge variant="outline" className={getOrderBadgeClass(transaction.status)}>
                        {transaction.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{transaction.restaurantName}</div>
                      <div className="text-xs text-muted-foreground">
                        {transaction.customerName} - {transaction.customerPhone || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{transaction.paymentMethod}</div>
                      <div className="text-xs text-muted-foreground">
                        {transaction.transactionId || transaction.provider || "No trx id"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getPaymentBadgeClass(transaction.paymentStatus)}>
                        {transaction.paymentStatus}
                      </Badge>
                      {(() => {
                        const state = getReconciliationState(transaction)
                        return (
                          <Badge
                            variant="outline"
                            className={getReconciliationBadgeClass(state.tone)}
                          >
                            {state.label}
                          </Badge>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(transaction.amount)}
                    </TableCell>
                    <TableCell>{formatDate(transaction.createdAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailsOrderId(transaction.orderId)}>
                            <Eye className="size-4" />
                            View details
                          </DropdownMenuItem>
                          {transaction.paymentStatus === "paid" &&
                          ["Cancelled", "Rejected"].includes(transaction.status) ? (
                            <DropdownMenuItem
                              onClick={() =>
                                setRefundTarget({
                                  transaction,
                                  paymentStatus: "refund_pending",
                                  label: "Mark refund pending",
                                })
                              }
                            >
                              <WalletCards className="size-4" />
                              Mark refund pending
                            </DropdownMenuItem>
                          ) : null}
                          {transaction.paymentStatus === "refund_pending" ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  setRefundTarget({
                                    transaction,
                                    paymentStatus: "refunded",
                                    label: "Mark refunded",
                                  })
                                }
                              >
                                <CheckCircle2 className="size-4" />
                                Mark refunded
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setRefundTarget({
                                    transaction,
                                    paymentStatus: "refund_rejected",
                                    label: "Reject refund",
                                  })
                                }
                              >
                                <WalletCards className="size-4" />
                                Reject refund
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {transaction.paymentMethod === "Cash" &&
                          transaction.status === "Delivered" &&
                          transaction.paymentStatus !== "paid" ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setCodTarget(transaction)}
                              >
                                <WalletCards className="size-4" />
                                Mark COD collected
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!paymentsQuery.isLoading && transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No payment transactions match this filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {transactions.length} of {paymentsQuery.data?.total ?? transactions.length} transactions
              {paymentsQuery.isFetching && !paymentsQuery.isLoading ? " - refreshing" : ""}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select
                value={`${pageSize}`}
                onValueChange={(value) => setPageSize(Number(value))}
              >
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue />
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
                Page {safePage} of {pageCount}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage <= 1 || paymentsQuery.isFetching}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                  disabled={safePage >= pageCount || paymentsQuery.isFetching}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <PaymentDetailsSheet
        orderId={detailsOrderId}
        onRefund={(transaction, paymentStatus, label) =>
          setRefundTarget({ transaction, paymentStatus, label })
        }
        onCollectCod={setCodTarget}
        onOpenChange={(open) => {
          if (!open) setDetailsOrderId("")
        }}
      />
      <RefundDialog
        target={refundTarget}
        onOpenChange={(open) => {
          if (!open) setRefundTarget(null)
        }}
      />
      <CodCollectionDialog
        target={codTarget}
        onOpenChange={(open) => {
          if (!open) setCodTarget(null)
        }}
      />
    </>
  )
}
