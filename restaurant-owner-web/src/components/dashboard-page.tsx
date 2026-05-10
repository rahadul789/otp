import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  endOfDay,
  format,
  isWithinInterval,
  startOfDay,
  subDays,
} from "date-fns"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  CreditCard,
  ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Percent,
  ShoppingBag,
  Star,
  Store,
  Tags,
  UtensilsCrossed,
  Wallet,
} from "lucide-react"
import { Link } from "react-router-dom"

import { useOpeningHours } from "@/components/hours/opening-hours-context"
import { useMenuItems } from "@/components/menu/menu-items-context"
import {
  defaultOrderDateFilter,
  OrderDateFilter,
  type OrderDateFilterValue,
} from "@/components/orders/order-date-filter"
import { useOrders } from "@/components/orders/orders-context"
import {
  liveOrderStatuses,
  orderStatusLabels,
} from "@/components/orders/types"
import { usePayouts } from "@/components/payouts/payouts-context"
import { usePromotions } from "@/components/promotions/promotions-context"
import { useReviews } from "@/components/reviews/reviews-context"
import { useRestaurantStatus } from "@/components/restaurant-status-context"
import {
  useOwnerDashboardSummaryQuery,
  useOwnerOrderTransitionMutation,
} from "@/hooks/use-owner-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  calculateProfileCompletion,
  getStoreCoverSrc,
  getStoreLogoSrc,
} from "@/lib/store-profile"
import { formatHourLabel12 } from "@/lib/time"
import { calculateEarningsSummary } from "@/domain/financials"
import { getStoreOperationalStatus } from "@/domain/store-runtime"
import { useAppStore } from "@/store/app-store"

function formatCompactMoney(amount: number) {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k tk`
  return `${amount} tk`
}

function getDateInterval(filter: OrderDateFilterValue) {
  const now = new Date()
  switch (filter.preset) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) }
    case "yesterday": {
      const yesterday = subDays(now, 1)
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) }
    }
    case "last7Days":
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    case "last30Days":
      return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
    case "thisWeek":
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    case "thisMonth":
      return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
    case "custom":
      return {
        start: startOfDay(filter.range?.from ?? now),
        end: endOfDay(filter.range?.to ?? filter.range?.from ?? now),
      }
    default:
      return { start: startOfDay(now), end: endOfDay(now) }
  }
}

function toPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? null : 100
  return Number((((current - previous) / previous) * 100).toFixed(1))
}

function getTrendLabel(current: number, previous: number) {
  const percent = toPercent(current, previous)
  if (percent === null || percent === 0) return "No change"
  return `${percent > 0 ? "+" : ""}${percent}% vs previous`
}

type DashboardOrderMetrics = {
  totalOrders: number
  deliveredOrders: number
  deliveredRevenue: number
  pendingOrders: number
  customerPhones: Set<string>
}

function createDashboardOrderMetrics(): DashboardOrderMetrics {
  return {
    totalOrders: 0,
    deliveredOrders: 0,
    deliveredRevenue: 0,
    pendingOrders: 0,
    customerPhones: new Set<string>(),
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 px-4 lg:px-6">
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Skeleton className="h-[360px] rounded-2xl" />
        <Skeleton className="h-[360px] rounded-2xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[340px] rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

const dashboardKpiLinks: Record<string, string> = {
  orders: "/orders?tab=history",
  revenue: "/analytics",
  net: "/payouts",
  aov: "/analytics",
  pending: "/orders?tab=live",
  completed: "/orders?tab=history&status=Delivered",
}

export function DashboardPage() {
  const { orders } = useOrders()
  const { reviews } = useReviews()
  const { vouchers } = usePromotions()
  const { payoutTransactions, payouts, payoutMethod } = usePayouts()
  const { items: menuItems } = useMenuItems()
  const { openingHours } = useOpeningHours()
  const { isOnline } = useRestaurantStatus()
  const storeSettings = useAppStore((state) => state.storeSettings)
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const queryClient = useQueryClient()

  const [isLoading, setIsLoading] = React.useState(true)
  const [transitioningOrderId, setTransitioningOrderId] = React.useState<string | null>(null)
  const [dateFilter, setDateFilter] = React.useState<OrderDateFilterValue>({
    ...defaultOrderDateFilter,
    preset: "today",
  })
  const dashboardResetDisabled =
    dateFilter.preset === defaultOrderDateFilter.preset && !dateFilter.range
  const dashboardQueryParams = React.useMemo(
    () => ({
      preset: dateFilter.preset,
      from: dateFilter.preset === "custom" ? dateFilter.range?.from?.toISOString() : undefined,
      to: dateFilter.preset === "custom" ? dateFilter.range?.to?.toISOString() : undefined,
    }),
    [dateFilter]
  )

  const dashboardSummaryQuery = useOwnerDashboardSummaryQuery(
    ownerAccount.isAuthenticated,
    dashboardQueryParams
  )
  const orderTransitionMutation = useOwnerOrderTransitionMutation()

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setIsLoading(false), 300)
    return () => window.clearTimeout(timeout)
  }, [])

  const currentInterval = React.useMemo(() => getDateInterval(dateFilter), [dateFilter])
  const previousInterval = React.useMemo(
    () => ({
      start: subDays(currentInterval.start, 1),
      end: subDays(currentInterval.end, 1),
    }),
    [currentInterval]
  )

  const filteredOrders = React.useMemo(
    () =>
      orders.filter((order) =>
        isWithinInterval(new Date(order.timestamps.placedAt), currentInterval)
      ),
    [currentInterval, orders]
  )

  const previousOrders = React.useMemo(
    () =>
      orders.filter((order) =>
        isWithinInterval(new Date(order.timestamps.placedAt), previousInterval)
      ),
    [orders, previousInterval]
  )

  const orderById = React.useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders]
  )

  const deliveredOrdersInCurrentInterval = React.useMemo(
    () =>
      orders.filter(
        (order) =>
          order.currentStatus === "Delivered" &&
          order.timestamps.deliveredAt &&
          isWithinInterval(new Date(order.timestamps.deliveredAt), currentInterval)
      ),
    [currentInterval, orders]
  )

  const deliveredOrdersInPreviousInterval = React.useMemo(
    () =>
      orders.filter(
        (order) =>
          order.currentStatus === "Delivered" &&
          order.timestamps.deliveredAt &&
          isWithinInterval(new Date(order.timestamps.deliveredAt), previousInterval)
      ),
    [orders, previousInterval]
  )

  const liveOrders = React.useMemo(
    () =>
      orders
        .filter((order) => liveOrderStatuses.includes(order.currentStatus))
        .slice()
        .sort(
          (a, b) =>
            new Date(b.timestamps.placedAt).getTime() -
            new Date(a.timestamps.placedAt).getTime()
        )
        .slice(0, 6),
    [orders]
  )

  const currentOrderMetrics = React.useMemo(
    () =>
      filteredOrders.reduce<DashboardOrderMetrics>((metrics, order) => {
        metrics.totalOrders += 1
        metrics.customerPhones.add(order.customer.phone)
        if (liveOrderStatuses.includes(order.currentStatus)) {
          metrics.pendingOrders += 1
        }
        return metrics
      }, createDashboardOrderMetrics()),
    [filteredOrders]
  )

  const previousOrderMetrics = React.useMemo(
    () =>
      previousOrders.reduce<DashboardOrderMetrics>((metrics, order) => {
        metrics.totalOrders += 1
        metrics.customerPhones.add(order.customer.phone)
        if (liveOrderStatuses.includes(order.currentStatus)) {
          metrics.pendingOrders += 1
        }
        return metrics
      }, createDashboardOrderMetrics()),
    [previousOrders]
  )

  const todayAndTrendMetrics = React.useMemo(() => {
    const todayInterval = {
      start: startOfDay(new Date()),
      end: endOfDay(new Date()),
    }
    const trendSeed = Array.from({ length: 7 }, (_, index) => {
      const day = subDays(new Date(), 6 - index)
      return {
        key: format(day, "yyyy-MM-dd"),
        label: format(day, "dd MMM"),
        orders: 0,
        revenue: 0,
      }
    })
    const trendByKey = new Map(trendSeed.map((entry) => [entry.key, entry]))
    const todayHourCounts = Array.from({ length: 24 }, () => 0)

    orders.forEach((order) => {
      const placedAt = new Date(order.timestamps.placedAt)

      const trendEntry = trendByKey.get(format(placedAt, "yyyy-MM-dd"))
      if (trendEntry) {
        trendEntry.orders += 1
      }

      if (order.currentStatus === "Delivered" && order.timestamps.deliveredAt) {
        const deliveredAt = new Date(order.timestamps.deliveredAt)
        const deliveredTrendEntry = trendByKey.get(format(deliveredAt, "yyyy-MM-dd"))
        if (deliveredTrendEntry) {
          deliveredTrendEntry.revenue += order.total
        }
      }

      if (isWithinInterval(placedAt, todayInterval)) {
        todayHourCounts[placedAt.getHours()] += 1
      }
    })

    return {
      orderTrend: trendSeed.map(({ label, orders, revenue }) => ({
        label,
        orders,
        revenue,
      })),
      todayHourCounts,
    }
  }, [orders])

  const currentRevenue = deliveredOrdersInCurrentInterval.reduce(
    (sum, order) => sum + order.total,
    0
  )
  const previousRevenue = deliveredOrdersInPreviousInterval.reduce(
    (sum, order) => sum + order.total,
    0
  )
  const currentNet = payoutTransactions
    .filter(
      (transaction) => {
        if (transaction.type !== "earning") return false
        const relatedOrder = orderById.get(transaction.orderId)
        return Boolean(
          relatedOrder?.currentStatus === "Delivered" &&
            relatedOrder.timestamps.deliveredAt &&
            isWithinInterval(new Date(relatedOrder.timestamps.deliveredAt), currentInterval)
        )
      }
    )
    .reduce((sum, transaction) => sum + transaction.netAmount, 0)
  const previousNet = payoutTransactions
    .filter(
      (transaction) => {
        if (transaction.type !== "earning") return false
        const relatedOrder = orderById.get(transaction.orderId)
        return Boolean(
          relatedOrder?.currentStatus === "Delivered" &&
            relatedOrder.timestamps.deliveredAt &&
            isWithinInterval(new Date(relatedOrder.timestamps.deliveredAt), previousInterval)
        )
      }
    )
    .reduce((sum, transaction) => sum + transaction.netAmount, 0)
  const currentCustomers = currentOrderMetrics.customerPhones.size
  const currentCompleted = deliveredOrdersInCurrentInterval.length
  const previousCompleted = deliveredOrdersInPreviousInterval.length
  const currentPending = currentOrderMetrics.pendingOrders
  const previousPending = previousOrderMetrics.pendingOrders

  const kpis = [
    {
      key: "orders",
      label: "Total Orders",
      value: `${filteredOrders.length}`,
      trend: getTrendLabel(currentOrderMetrics.totalOrders, previousOrderMetrics.totalOrders),
      icon: ShoppingBag,
    },
    {
      key: "revenue",
      label: "Total Revenue",
      value: formatCompactMoney(currentRevenue),
      trend: getTrendLabel(currentRevenue, previousRevenue),
      icon: BadgeDollarSign,
    },
    {
      key: "net",
      label: "Net Earnings",
      value: formatCompactMoney(currentNet),
      trend: getTrendLabel(currentNet, previousNet),
      icon: Wallet,
    },
    {
      key: "aov",
      label: "Average Order Value",
      value: `${Math.round(currentCompleted ? currentRevenue / currentCompleted : 0)} tk`,
      trend: getTrendLabel(
        currentCompleted ? currentRevenue / currentCompleted : 0,
        previousCompleted ? previousRevenue / previousCompleted : 0
      ),
      icon: CreditCard,
    },
    {
      key: "pending",
      label: "Pending Orders",
      value: `${currentPending}`,
      trend: getTrendLabel(currentPending, previousPending),
      icon: Clock3,
    },
    {
      key: "completed",
      label: "Completed Orders",
      value: `${currentCompleted}`,
      trend: getTrendLabel(currentCompleted, previousCompleted),
      icon: LayoutGrid,
    },
  ]

  const dashboardSummary = dashboardSummaryQuery.data
  const kpisToRender = dashboardSummary
    ? [
        {
          key: "orders",
          label: "Total Orders",
          value: `${dashboardSummary.metrics.totalOrders}`,
          trend: getTrendLabel(
            dashboardSummary.metrics.totalOrders,
            dashboardSummary.metrics.previousTotalOrders
          ),
          icon: ShoppingBag,
        },
        {
          key: "revenue",
          label: "Total Revenue",
          value: formatCompactMoney(dashboardSummary.metrics.totalRevenue),
          trend: getTrendLabel(
            dashboardSummary.metrics.totalRevenue,
            dashboardSummary.metrics.previousTotalRevenue
          ),
          icon: BadgeDollarSign,
        },
        {
          key: "net",
          label: "Net Earnings",
          value: formatCompactMoney(dashboardSummary.metrics.totalNetEarnings),
          trend: getTrendLabel(
            dashboardSummary.metrics.totalNetEarnings,
            dashboardSummary.metrics.previousTotalNetEarnings
          ),
          icon: Wallet,
        },
        {
          key: "aov",
          label: "Average Order Value",
          value: `${Math.round(dashboardSummary.metrics.averageOrderValue)} tk`,
          trend: getTrendLabel(
            dashboardSummary.metrics.averageOrderValue,
            dashboardSummary.metrics.previousAverageOrderValue
          ),
          icon: CreditCard,
        },
        {
          key: "pending",
          label: "Pending Orders",
          value: `${dashboardSummary.metrics.pendingOrders}`,
          trend: getTrendLabel(
            dashboardSummary.metrics.pendingOrders,
            dashboardSummary.metrics.previousPendingOrders
          ),
          icon: Clock3,
        },
        {
          key: "completed",
          label: "Completed Orders",
          value: `${dashboardSummary.metrics.completedOrders}`,
          trend: getTrendLabel(
            dashboardSummary.metrics.completedOrders,
            dashboardSummary.metrics.previousCompletedOrders
          ),
          icon: LayoutGrid,
        },
      ]
    : kpis

  const orderTrend = React.useMemo(
    () => todayAndTrendMetrics.orderTrend,
    [todayAndTrendMetrics]
  )

  const peakHours = React.useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) => {
        const count = todayAndTrendMetrics.todayHourCounts[hour] ?? 0
        return { label: formatHourLabel12(hour), orders: count }
      }).filter((entry) => entry.orders > 0),
    [todayAndTrendMetrics]
  )

  const topItems = React.useMemo(() => {
    const byName = filteredOrders.reduce<
      Record<string, { name: string; quantity: number; revenue: number }>
    >((accumulator, order) => {
      order.items.forEach((item) => {
        if (!accumulator[item.name]) {
          accumulator[item.name] = { name: item.name, quantity: 0, revenue: 0 }
        }
        accumulator[item.name].quantity += item.quantity
        accumulator[item.name].revenue += item.quantity * item.unitPrice
      })
      return accumulator
    }, {})

    return Object.values(byName)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 6)
  }, [filteredOrders])

  const recentReviews = React.useMemo(
    () =>
      reviews
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 4),
    [reviews]
  )

  const voucherSnapshot = React.useMemo(() => {
    const active = vouchers.filter((voucher) => voucher.status === "Active").length
    const totalUsage = vouchers.reduce(
      (sum, voucher) => sum + voucher.analytics.totalUses,
      0
    )
    const revenueImpact = vouchers.reduce(
      (sum, voucher) => sum + voucher.analytics.revenueGenerated,
      0
    )
    return { active, totalUsage, revenueImpact }
  }, [vouchers])

  const earningsSummary = React.useMemo(
    () => calculateEarningsSummary(payoutTransactions, payouts),
    [payoutTransactions, payouts]
  )

  const payoutSummary = React.useMemo(() => {
    const lastPayout = payouts
      .filter((payout) => payout.status === "completed")
      .slice()
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]

    return { available: earningsSummary.available, pending: earningsSummary.pending, lastPayout }
  }, [earningsSummary.available, earningsSummary.pending, payouts])

  const statusSummary = React.useMemo(
    () => getStoreOperationalStatus(openingHours, isOnline),
    [isOnline, openingHours]
  )
  const profileCompletion = React.useMemo(
    () =>
      calculateProfileCompletion({
        storeSettings,
        openingHours,
        payoutMethod,
      }),
    [openingHours, payoutMethod, storeSettings]
  )

  function handleAcceptOrder(orderId: string) {
    setTransitioningOrderId(orderId)
    orderTransitionMutation.mutate(
      {
        orderId,
        nextStatus: "Accepted",
        actor: "owner",
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["owner", "orders"] })
          queryClient.invalidateQueries({ queryKey: ["owner", "dashboard", "summary"] })
          queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "summary"] })
          queryClient.invalidateQueries({ queryKey: ["owner", "payouts", "transactions"] })
          toast.success("Order accepted", {
            description: "The order moved to Accepted and synced with backend.",
          })
        },
        onError: (error) => {
          toast.error("Could not accept order", {
            description:
              error instanceof Error ? error.message : "Please try again.",
          })
        },
        onSettled: () => {
          setTransitioningOrderId(null)
        },
      }
    )
  }

  if (isLoading || dashboardSummaryQuery.isPending) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-4 px-4 lg:px-6">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <OrderDateFilter
            value={dateFilter}
            onChange={setDateFilter}
            onReset={() => setDateFilter(defaultOrderDateFilter)}
            resetDisabled={dashboardResetDisabled}
          />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/menu">
                <UtensilsCrossed className="size-4" />
                Add Menu Item
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/promotions">
                <Percent className="size-4" />
                Create Voucher
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/hours">
                <Clock3 className="size-4" />
                Update Opening Hours
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {kpisToRender.map((kpi) => (
          <Card key={kpi.key} className="rounded-2xl shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">
                  {kpi.label}
                </div>
                <div className="text-3xl font-semibold">{kpi.value}</div>
              </div>
              <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <kpi.icon className="size-5" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-sm text-muted-foreground">{kpi.trend}</div>
              <div className="mt-3 h-10">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={orderTrend}>
                    <Area
                      type="monotone"
                      dataKey={kpi.key === "revenue" || kpi.key === "net" || kpi.key === "aov" ? "revenue" : "orders"}
                      stroke="#0f766e"
                      fill="#ccfbf1"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Button
                asChild
                variant="ghost"
                className="-ml-3 mt-2 h-auto justify-start rounded-2xl px-3 text-sm text-muted-foreground hover:text-foreground"
              >
                <Link to={dashboardKpiLinks[kpi.key] ?? "/"}>
                  View details
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeDollarSign className="size-4 text-muted-foreground" />
              Revenue Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={orderTrend}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2563eb"
                    fill="#dbeafe"
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4 text-muted-foreground" />
              Quick Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Restaurant</div>
                  <div className="mt-1 text-xl font-semibold">{statusSummary.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {statusSummary.subtitle}
                  </div>
                </div>
                <Badge
                  className={
                    isOnline
                      ? "bg-emerald-600 text-white hover:bg-emerald-600"
                      : "bg-slate-900 text-white hover:bg-slate-900"
                  }
                >
                  {dashboardSummary?.restaurant.isOnline ?? isOnline ? "Live" : "Offline"}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Active Orders</div>
                <div className="mt-1 text-2xl font-semibold">
                  {dashboardSummary?.metrics.pendingOrders ?? liveOrders.length}
                </div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Customers</div>
                <div className="mt-1 text-2xl font-semibold">
                  {dashboardSummary?.metrics.uniqueCustomers ?? currentCustomers}
                </div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Next Payout</div>
                <div className="mt-1 text-lg font-semibold">
                  {dashboardSummary?.metrics.nextEstimatedPayoutAt
                    ? format(new Date(dashboardSummary.metrics.nextEstimatedPayoutAt), "dd MMM")
                    : payoutSummary.lastPayout
                    ? format(subDays(new Date(payoutSummary.lastPayout.createdAt), -7), "dd MMM")
                    : "--"}
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-2 text-sm font-medium">Peak Hours Today</div>
              <div className="space-y-2">
                {peakHours.slice(0, 4).map((entry) => (
                  <div key={entry.label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{entry.label}</span>
                      <span>{entry.orders} orders</span>
                    </div>
                    <Progress
                      value={
                        peakHours[0]?.orders
                          ? (entry.orders / peakHours[0].orders) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Profile Completion</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                Complete your profile gradually to improve trust and visibility.
              </div>
            </div>
            <Badge variant="outline">{profileCompletion.percentage}% complete</Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{profileCompletion.completedWeight}/100</span>
              </div>
              <Progress value={profileCompletion.percentage} className="h-2.5" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {profileCompletion.sections.map((section) => (
                <div
                  key={section.id}
                  className="rounded-xl border bg-muted/20 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{section.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {section.benefit}
                      </div>
                    </div>
                    {section.isComplete ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <Badge variant="outline">{section.weight}%</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {profileCompletion.incompleteSections.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-medium text-amber-950">
                  Recommended next improvements
                </div>
                <div className="mt-3 space-y-2">
                  {profileCompletion.incompleteSections.slice(0, 3).map((section) => (
                    <div
                      key={section.id}
                      className="flex items-start justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium text-amber-950">
                          {section.hint}
                        </div>
                        <div className="text-xs text-amber-800/80">
                          {section.benefit}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/store-settings">Update</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4 text-muted-foreground" />
              Storefront Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border bg-card">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Current storefront
                </div>
                <div className="relative h-24 bg-muted">
                  <img
                    src={getStoreCoverSrc(storeSettings.coverImageUrl)}
                    alt="Current storefront cover"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="px-3 pb-3">
                  <div className="-mt-7 flex size-14 items-center justify-center overflow-hidden rounded-2xl border-4 border-background bg-background shadow-sm">
                    <img
                      src={getStoreLogoSrc(storeSettings.logoUrl)}
                      alt="Current storefront logo"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="mt-3 font-medium">
                    {storeSettings.name || "Your store"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {storeSettings.description ||
                      "Add a short description so customers understand what you serve."}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border bg-emerald-50">
                <div className="border-b border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-900">
                  Completed look
                </div>
                <div className="relative h-24 bg-gradient-to-r from-emerald-500 to-teal-500" />
                <div className="px-3 pb-3">
                  <div className="-mt-7 flex size-14 items-center justify-center rounded-2xl border-4 border-white bg-white shadow-sm">
                    <ImageIcon className="size-6 text-emerald-600" />
                  </div>
                  <div className="mt-3 font-medium text-emerald-950">
                    Richer brand presentation
                  </div>
                  <div className="mt-1 text-xs text-emerald-900/70">
                    Custom logo and cover make the storefront feel more trusted
                    at a glance.
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              {storeSettings.logoUrl || storeSettings.coverImageUrl
                ? "You already have visuals in place. Update them any time from Store Settings."
                : "Your store still uses default placeholder visuals. Add your own logo and cover whenever you're ready."}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-2xl shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Live Orders Snapshot</CardTitle>
            <Button variant="outline" asChild>
              <Link to="/orders">
                View all orders
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {liveOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="grid gap-2 sm:grid-cols-4 sm:items-center lg:flex-1">
                  <div>
                    <div className="font-medium">{order.orderNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(order.timestamps.placedAt), "hh:mm a")}
                    </div>
                  </div>
                  <div className="font-medium">{order.customer.name}</div>
                  <div>{formatCompactMoney(order.total)}</div>
                  <Badge variant="outline">{orderStatusLabels[order.currentStatus]}</Badge>
                </div>
                <div className="flex gap-2">
                  {order.currentStatus === "New" ? (
                    <Button
                      size="sm"
                      onClick={() => handleAcceptOrder(order.id)}
                      disabled={
                        orderTransitionMutation.isPending &&
                        transitioningOrderId === order.id
                      }
                    >
                      {orderTransitionMutation.isPending &&
                      transitioningOrderId === order.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      {orderTransitionMutation.isPending &&
                      transitioningOrderId === order.id
                        ? "Accepting..."
                        : "Accept"}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/orders">View</Link>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button variant="outline" className="justify-between" asChild>
              <Link to="/menu">
                <span className="inline-flex items-center gap-2">
                  <UtensilsCrossed className="size-4" />
                  Add Menu Item
                </span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="outline" className="justify-between" asChild>
              <Link to="/promotions">
                <span className="inline-flex items-center gap-2">
                  <Percent className="size-4" />
                  Create Voucher
                </span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="outline" className="justify-between" asChild>
              <Link to="/categories">
                <span className="inline-flex items-center gap-2">
                  <Tags className="size-4" />
                  Manage Categories
                </span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="outline" className="justify-between" asChild>
              <Link to="/orders">
                <span className="inline-flex items-center gap-2">
                  <ShoppingBag className="size-4" />
                  View Orders
                </span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="outline" className="justify-between" asChild>
              <Link to="/hours">
                <span className="inline-flex items-center gap-2">
                  <Clock3 className="size-4" />
                  Update Opening Hours
                </span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Top Selling Items</CardTitle>
            <Badge variant="outline">{menuItems.length} menu items</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {topItems.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.quantity} orders
                  </div>
                </div>
                <div className="text-sm font-semibold">
                  {formatCompactMoney(item.revenue)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Reviews</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/reviews">View all reviews</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentReviews.map((review) => (
              <div key={review.id} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{review.user.name}</div>
                  <div className="inline-flex items-center gap-1 text-amber-600">
                    <Star className="size-4 fill-current" />
                    {review.rating}
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {review.comment || "Customer left a rating without comment."}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Payout & Promotion Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Available</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-700">
                  {formatCompactMoney(payoutSummary.available)}
                </div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Pending</div>
                <div className="mt-1 text-2xl font-semibold text-amber-700">
                  {formatCompactMoney(payoutSummary.pending)}
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-sm font-medium">Voucher Snapshot</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Active</div>
                  <div className="text-lg font-semibold">{voucherSnapshot.active}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total Usage</div>
                  <div className="text-lg font-semibold">
                    {voucherSnapshot.totalUsage}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Impact</div>
                  <div className="text-lg font-semibold">
                    {formatCompactMoney(voucherSnapshot.revenueImpact)}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-sm font-medium">Last Payout</div>
              <div className="mt-2 text-lg font-semibold">
                {payoutSummary.lastPayout
                  ? formatCompactMoney(payoutSummary.lastPayout.amount)
                  : "--"}
              </div>
              <div className="text-sm text-muted-foreground">
                {payoutSummary.lastPayout
                  ? format(new Date(payoutSummary.lastPayout.createdAt), "dd MMM yyyy")
                  : "No completed payout yet"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
