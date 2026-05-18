import * as React from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowRight,
  Bell,
  BarChart3,
  Clock,
  Download,
  Gift,
  Loader2,
  MousePointerClick,
  RefreshCcw,
  Send,
  ShoppingCart,
  Target,
  TrendingDown,
  UserPlus,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  getAdminCustomerAnalytics,
  getAdminCustomerAnalyticsActorDetail,
  sendAdminNotification,
  type AdminCustomerAnalyticsPreset,
  type AdminCustomerAnalyticsResponse,
  type AdminCustomerAnalyticsSection,
} from "@/lib/admin-api"
import { AdminDateRangeFilter } from "@/components/admin-date-range-filter"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function formatNumber(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString()
}

function formatCurrency(value: number) {
  return `Tk ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString()}`
}

function compactId(value: string) {
  if (!value) return "N/A"
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function formatDate(value?: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function formatShortDate(value?: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date)
}

function formatUpdatedAt(value?: number) {
  if (!value) return "Not loaded yet"
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function labelize(value: string) {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function formatPercent(numerator: number, denominator: number) {
  if (!denominator) return "0%"
  return `${Math.round((numerator / denominator) * 100)}%`
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function downloadCustomerAnalyticsCsv(
  data: AdminCustomerAnalyticsResponse,
  section: AdminCustomerAnalyticsSection = "all"
) {
  const rows: unknown[][] = [
    ["section", "metric", "value"],
    ["overview", "totalEvents", data.overview.totalEvents],
    ["overview", "pageViews", data.overview.pageViews],
    ["overview", "checkoutStarts", data.overview.checkoutStarts],
    ["overview", "ordersCreated", data.overview.ordersCreated],
    [
      "overview",
      "browseOnlyAnonymousVisitors",
      data.overview.browseOnlyAnonymousVisitors,
    ],
    [
      "overview",
      "registeredBrowseNoOrderCustomers",
      data.overview.registeredBrowseNoOrderCustomers,
    ],
    [
      "overview",
      "checkoutAbandonedSessions",
      data.overview.checkoutAbandonedSessions,
    ],
    [
      "overview",
      "signupAbandonedVisitors",
      data.overview.signupAbandonedVisitors,
    ],
    [
      "insights",
      "checkoutConversionRate",
      data.insights.checkoutConversionRate,
    ],
    ["insights", "paymentCompletionRate", data.insights.paymentCompletionRate],
    ...data.alerts.map((alert) => [
      "alert",
      alert.key,
      `${alert.severity}; ${alert.title}; ${alert.description}`,
    ]),
    ...data.recommendedActions.map((action) => [
      "recommendedAction",
      action.key,
      `${action.severity}; targets=${action.targetCount}; ${action.title}; ${action.description}`,
    ]),
    ...data.trend.map((point) => [
      "trend",
      point.date,
      `pageViews=${point.pageViews}; checkoutStarts=${point.checkoutStarts}; ordersCreated=${point.ordersCreated}`,
    ]),
    ...data.topPaths.map((path) => [
      "topPath",
      path.path,
      `total=${path.count}; guests=${path.guestCount}; customers=${path.customerCount}`,
    ]),
    ...data.checkoutDropOffPaths.map((path) => [
      "checkoutDropOffPath",
      path.path,
      `sessions=${path.sessions}; guests=${path.guestSessions}; customers=${path.customerSessions}`,
    ]),
    ...data.restaurantConversions.map((row) => [
      "restaurantConversion",
      row.restaurantName,
      `views=${row.views}; orders=${row.orders}; rate=${row.viewToOrderRate}; revenue=${row.revenue}`,
    ]),
    ...data.restaurantFunnels.map((row) => [
      "restaurantFunnel",
      row.restaurantName,
      `views=${row.restaurantViews}; menu=${row.menuItemViews}; cart=${row.cartAdds}; checkout=${row.checkoutStarts}; orders=${row.orders}; weakest=${row.weakestStage}`,
    ]),
    ...data.abandonedCheckouts.map((row) => [
      "abandonedCheckout",
      row.sessionId,
      `actor=${row.actorType}; customer=${row.customerId}; restaurant=${row.restaurantName}; cart=${row.estimatedCartValue}; items=${row.itemCount}`,
    ]),
    ...data.menuItemConversions.map((row) => [
      "menuItemConversion",
      row.itemName,
      `views=${row.views}; cartAdds=${row.cartAdds}; orders=${row.orders}; revenue=${row.revenue}`,
    ]),
    ...data.searchAnalytics.map((row) => [
      "search",
      row.query,
      `scope=${row.scope}; count=${row.count}; zero=${row.zeroResultCount}; avg=${row.averageResults}`,
    ]),
    ...data.attribution.map((row) => [
      "attribution",
      row.source,
      `campaign=${row.campaignId}; events=${row.events}; orders=${row.orders}; orderRate=${row.orderRate}`,
    ]),
    ...data.recentEvents.map((event) => [
      "recentEvent",
      event.eventType,
      `${event.actorType}; ${event.path}; ${event.occurredAt ?? ""}`,
    ]),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `customer-analytics-${section}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function MetricCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string
  value: React.ReactNode
  helper: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="pt-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
          </div>
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AnalyticsInsightChip({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  tone?: "default" | "good" | "warn" | "danger" | "info"
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : tone === "info"
            ? "border-sky-200 bg-sky-50 text-sky-800"
            : "border-border bg-background text-foreground"

  return (
    <div
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm shadow-sm ${toneClass}`}
    >
      <span className="text-xs font-medium opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function EmptyGuidance({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function FunnelStep({
  label,
  value,
  total,
  tone,
}: {
  label: string
  value: number
  total: number
  tone: string
}) {
  const width = total > 0 ? Math.max(6, Math.round((value / total) * 100)) : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">
          {formatNumber(value)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className={`h-2 rounded-full ${tone}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function DistributionList({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: Array<{ label: string; count: number }>
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.label} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-sm text-muted-foreground">
                  {formatNumber(row.count)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-sky-500"
                  style={{
                    width: total
                      ? `${Math.max(6, Math.round((row.count / total) * 100))}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <EmptyGuidance
            title="No distribution yet"
            description="This section fills up after customer app events are tracked in the selected timeframe."
          />
        )}
      </CardContent>
    </Card>
  )
}

function TrendChart({
  data,
}: {
  data: AdminCustomerAnalyticsResponse["trend"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily conversion trend</CardTitle>
        <CardDescription>
          Page views, checkout starts, and final orders by day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length ? (
          <ChartContainer
            className="h-[280px] w-full"
            config={{
              pageViews: {
                label: "Page views",
                color: "#0284c7",
              },
              checkoutStarts: {
                label: "Checkout starts",
                color: "#d97706",
              },
              ordersCreated: {
                label: "Orders created",
                color: "#16a34a",
              },
            }}
          >
            <AreaChart data={data} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatShortDate(String(value))}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="pageViews"
                stroke="var(--color-pageViews)"
                fill="var(--color-pageViews)"
                fillOpacity={0.12}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="checkoutStarts"
                stroke="var(--color-checkoutStarts)"
                fill="var(--color-checkoutStarts)"
                fillOpacity={0.1}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="ordersCreated"
                stroke="var(--color-ordersCreated)"
                fill="var(--color-ordersCreated)"
                fillOpacity={0.1}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <EmptyGuidance
            title="No graph data yet"
            description="Try a wider date range, or wait for customer app activity to create daily trend points."
          />
        )}
      </CardContent>
    </Card>
  )
}

function AlertPanel({ data }: { data: AdminCustomerAnalyticsResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action signals</CardTitle>
        <CardDescription>
          Automatically highlighted conversion, payment, and search risks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.alerts.length ? (
          data.alerts.map((alert) => (
            <div
              key={alert.key}
              className="flex items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      alert.severity === "critical"
                        ? "destructive"
                        : alert.severity === "warning"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {alert.severity}
                  </Badge>
                  <p className="text-sm font-medium">{alert.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {alert.description}
                </p>
              </div>
              <div className="shrink-0 text-right text-sm font-semibold">
                {formatNumber(alert.metric)}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            No critical analytics signal in this timeframe.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SessionJourneyTable({
  sessions,
}: {
  sessions: AdminCustomerAnalyticsResponse["sessionJourneys"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session journeys</CardTitle>
        <CardDescription>
          Recent guest/customer paths compressed into operational timelines.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Journey</TableHead>
              <TableHead>Signals</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length ? (
              sessions.map((session) => (
                <TableRow key={session.sessionId}>
                  <TableCell className="font-medium">
                    {compactId(session.sessionId)}
                  </TableCell>
                  <TableCell>{labelize(session.actorType)}</TableCell>
                  <TableCell className="max-w-[520px]">
                    <div className="flex flex-wrap gap-1">
                      {session.events.slice(-8).map((event, index) => (
                        <Badge
                          key={`${session.sessionId}-${index}`}
                          variant="outline"
                          className="max-w-[160px] truncate"
                        >
                          {labelize(event.eventType)}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {session.startPath}
                      {" -> "}
                      {session.lastPath}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {session.checkoutStarted ? (
                        <Badge variant="secondary">Checkout</Badge>
                      ) : null}
                      {session.converted ? (
                        <Badge>Ordered</Badge>
                      ) : (
                        <Badge variant="outline">No order</Badge>
                      )}
                      {session.paymentHadIssue ? (
                        <Badge variant="destructive">Payment issue</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(session.lastSeenAt)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  Open this tab after users browse the app to see session paths.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AdvancedTables({ data }: { data: AdminCustomerAnalyticsResponse }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Restaurant conversion</CardTitle>
          <CardDescription>
            Restaurant views compared with orders and revenue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Restaurant</TableHead>
                <TableHead>Views</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.restaurantConversions.length ? (
                data.restaurantConversions.map((row) => (
                  <TableRow key={row.restaurantId}>
                    <TableCell className="font-medium">
                      {row.restaurantName}
                    </TableCell>
                    <TableCell>{formatNumber(row.views)}</TableCell>
                    <TableCell>{formatNumber(row.orders)}</TableCell>
                    <TableCell>{row.viewToOrderRate}%</TableCell>
                    <TableCell>{formatCurrency(row.revenue)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Restaurant conversion appears after restaurant views and orders are tracked.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Menu item conversion</CardTitle>
          <CardDescription>
            Item views, cart adds, ordered quantity, and revenue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Restaurant</TableHead>
                <TableHead>Views</TableHead>
                <TableHead>Cart adds</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.menuItemConversions.length ? (
                data.menuItemConversions.map((row) => (
                  <TableRow key={row.itemId}>
                    <TableCell className="font-medium">
                      {row.itemName}
                    </TableCell>
                    <TableCell>{row.restaurantName}</TableCell>
                    <TableCell>{formatNumber(row.views)}</TableCell>
                    <TableCell>
                      {formatNumber(row.cartAdds)} ({row.viewToCartRate}%)
                    </TableCell>
                    <TableCell>
                      {formatNumber(row.orders)} ({row.cartToOrderRate}%)
                    </TableCell>
                    <TableCell>{formatCurrency(row.revenue)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Menu conversion appears after item views, cart adds, and orders are tracked.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function SearchAttributionPayment({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Search analytics</CardTitle>
          <CardDescription>
            Query demand, average result count, and zero-result gaps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Results</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.searchAnalytics.length ? (
                data.searchAnalytics.map((row) => (
                  <TableRow
                    key={`${row.scope}-${row.query}-${row.restaurantId}`}
                  >
                    <TableCell className="font-medium">{row.query}</TableCell>
                    <TableCell>{labelize(row.scope)}</TableCell>
                    <TableCell>
                      {row.averageResults} avg,{" "}
                      {formatNumber(row.zeroResultCount)} zero
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Search analytics appears after users search inside customer app.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attribution</CardTitle>
          <CardDescription>
            Campaign/source traffic connected to checkout and orders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.attribution.length ? (
                data.attribution.map((row) => (
                  <TableRow key={`${row.source}-${row.campaignId}`}>
                    <TableCell>
                      <div className="font-medium">{row.source}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.campaignId || "No campaign"}
                      </div>
                    </TableCell>
                    <TableCell>{formatNumber(row.events)}</TableCell>
                    <TableCell>
                      {formatNumber(row.orders)} ({row.orderRate}%)
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Attribution appears when campaign/source metadata is attached to events.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment health</CardTitle>
          <CardDescription>
            Payment event completion plus order payment methods.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Completion</p>
              <p className="mt-1 text-xl font-semibold">
                {data.paymentHealth.completionRate}%
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Failed/cancelled</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNumber(
                  data.paymentHealth.failed + data.paymentHealth.cancelled
                )}
              </p>
            </div>
          </div>
          {data.paymentHealth.orderMethods.map((row) => (
            <div
              key={`${row.paymentMethod}-${row.paymentStatus}`}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{row.paymentMethod}</p>
                <p className="text-xs text-muted-foreground">
                  {row.paymentStatus}
                </p>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium">{formatNumber(row.orders)}</div>
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(row.revenue)}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function RetentionPanel({
  data,
  onViewRepeatCustomers,
}: {
  data: AdminCustomerAnalyticsResponse
  onViewRepeatCustomers: () => void
}) {
  const retentionCards = [
    {
      label: "New customers",
      value: formatNumber(data.retention.newCustomers),
      helper: "Registered in timeframe",
    },
    {
      label: "Day 1 order",
      value: `${data.retention.day1OrderRate}%`,
      helper: `${formatNumber(data.retention.orderedWithin1Day)} customers`,
    },
    {
      label: "Day 7 order",
      value: `${data.retention.day7OrderRate}%`,
      helper: `${formatNumber(data.retention.orderedWithin7Days)} customers`,
    },
    {
      label: "Day 30 order",
      value: `${data.retention.day30OrderRate}%`,
      helper: `${formatNumber(data.retention.orderedWithin30Days)} customers`,
    },
    {
      label: "Repeat customers",
      value: formatNumber(data.retention.repeatCustomers),
      helper: `${formatNumber(data.repeatCustomers.length)} loaded in drawer`,
      action: onViewRepeatCustomers,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention cohort</CardTitle>
        <CardDescription>
          New customers in the selected timeframe and their first-order
          behavior.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {retentionCards.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="rounded-lg border p-3 text-left transition hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
            disabled={!item.action}
          >
            <p className="text-sm text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold">{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.helper}</p>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

type RepeatCustomer = AdminCustomerAnalyticsResponse["repeatCustomers"][number]
type CustomerSegment = AdminCustomerAnalyticsResponse["customerSegments"][number]
type SegmentMember = CustomerSegment["members"][number]
type AbandonedCheckout =
  AdminCustomerAnalyticsResponse["abandonedCheckouts"][number]
type RecommendedAction =
  AdminCustomerAnalyticsResponse["recommendedActions"][number]
type RestaurantFunnel =
  AdminCustomerAnalyticsResponse["restaurantFunnels"][number]
type CustomerAnalyticsQueryParams = {
  preset: AdminCustomerAnalyticsPreset
  from?: string
  to?: string
  limit: number
}

function stageLabel(value: string) {
  if (value === "view_to_menu") return "View to menu"
  if (value === "menu_to_cart") return "Menu to cart"
  if (value === "cart_to_checkout") return "Cart to checkout"
  if (value === "checkout_to_order") return "Checkout to order"
  return labelize(value || "unknown")
}

function RepeatCustomerDrawer({
  open,
  onOpenChange,
  customers,
  queryParams,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: RepeatCustomer[]
  queryParams: CustomerAnalyticsQueryParams
}) {
  const [selectedCustomerId, setSelectedCustomerId] = React.useState("")
  const selectedCustomer = React.useMemo(
    () =>
      customers.find(
        (customer) => customer.customerId === selectedCustomerId
      ) ??
      customers[0] ??
      null,
    [customers, selectedCustomerId]
  )
  const customerDetailQuery = useQuery({
    queryKey: [
      "admin-customer-analytics",
      "actor-detail",
      selectedCustomer?.customerId,
      queryParams,
    ],
    enabled: open && Boolean(selectedCustomer?.customerId),
    queryFn: () =>
      getAdminCustomerAnalyticsActorDetail({
        ...queryParams,
        customerId: selectedCustomer?.customerId,
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const customerDetail =
    customerDetailQuery.data?.customerId === selectedCustomer?.customerId
      ? customerDetailQuery.data
      : null
  const activeCustomer = customerDetail ?? selectedCustomer

  React.useEffect(() => {
    if (!open) return
    if (!selectedCustomerId && customers[0]) {
      setSelectedCustomerId(customers[0].customerId)
    }
  }, [customers, open, selectedCustomerId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full max-w-none! flex-col overflow-hidden p-0 sm:max-w-3xl! md:max-w-6xl!">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Repeat customers</SheetTitle>
          <SheetDescription>
            Customers with more than one lifetime order and at least one order
            in this timeframe.
          </SheetDescription>
        </SheetHeader>

        {customers.length && selectedCustomer ? (
          <div className="grid flex-1 gap-4 overflow-y-auto p-6 xl:grid-cols-[320px_1fr]">
            <div className="space-y-2">
              {customers.map((customer) => (
                <button
                  key={customer.customerId}
                  type="button"
                  onClick={() => setSelectedCustomerId(customer.customerId)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/40 ${
                    selectedCustomer.customerId === customer.customerId
                      ? "border-primary bg-muted/50"
                      : "bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {customer.fullName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {customer.phone || compactId(customer.customerId)}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {formatNumber(customer.lifetimeOrders)}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>
                      {formatNumber(customer.timeframeOrders)} in range
                    </span>
                    <span className="text-right">
                      {formatCurrency(customer.timeframeSpend)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {customerDetailQuery.isFetching ? (
                <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
                  <Loader2 className="size-3 animate-spin" />
                  Loading full customer details
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    Lifetime orders
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatNumber(activeCustomer?.lifetimeOrders ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    Lifetime spend
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatCurrency(activeCustomer?.lifetimeSpend ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Average order</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatCurrency(activeCustomer?.averageOrderValue ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Last order</p>
                  <p className="mt-1 text-sm font-semibold">
                    {formatDate(activeCustomer?.lastOrderAt ?? null)}
                  </p>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Order trend</CardTitle>
                  <CardDescription>
                    Orders and spend from this customer in selected timeframe.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(activeCustomer?.orderTrend ?? []).length ? (
                    <ChartContainer
                      className="h-[240px] w-full"
                      config={{
                        orders: { label: "Orders", color: "#0284c7" },
                        revenue: { label: "Revenue", color: "#16a34a" },
                      }}
                    >
                      <AreaChart
                        data={activeCustomer?.orderTrend ?? []}
                        margin={{ left: 8, right: 8 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatShortDate}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={18}
                        />
                        <YAxis tickLine={false} axisLine={false} width={36} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) =>
                                formatShortDate(String(value))
                              }
                            />
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="orders"
                          stroke="var(--color-orders)"
                          fill="var(--color-orders)"
                          fillOpacity={0.12}
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="revenue"
                          stroke="var(--color-revenue)"
                          fill="var(--color-revenue)"
                          fillOpacity={0.1}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ChartContainer>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No order trend in this timeframe.
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Top restaurants</CardTitle>
                    <CardDescription>
                      Where this customer keeps coming back.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(activeCustomer?.topRestaurants ?? []).length ? (
                      (activeCustomer?.topRestaurants ?? []).map((restaurant) => (
                        <div
                          key={restaurant.restaurantId}
                          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {restaurant.restaurantName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatNumber(restaurant.orders)} order(s)
                            </p>
                          </div>
                          <span className="text-sm font-semibold">
                            {formatCurrency(restaurant.revenue)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        No restaurant breakdown yet.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Recent activity</CardTitle>
                    <CardDescription>
                      Latest analytics events for this customer.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(activeCustomer?.recentActivities ?? []).length ? (
                      (activeCustomer?.recentActivities ?? []).map(
                        (activity, index) => (
                          <div
                            key={`${activity.eventType}-${activity.occurredAt}-${index}`}
                            className="rounded-lg border px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <Badge variant="outline">
                                {labelize(activity.eventType)}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(activity.occurredAt)}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {activity.path ||
                                activity.screenName ||
                                "Unknown path"}
                            </p>
                          </div>
                        )
                      )
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        No recent tracked activity for this timeframe.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Recent orders</CardTitle>
                  <CardDescription>
                    Latest orders, payment state, and order value.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Restaurant</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(activeCustomer?.recentOrders ?? []).map((order) => (
                        <TableRow key={order.orderId}>
                          <TableCell className="font-medium">
                            {order.orderNumber}
                          </TableCell>
                          <TableCell>{order.restaurantName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{order.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {order.paymentMethod} / {order.paymentStatus}
                          </TableCell>
                          <TableCell>{formatCurrency(order.total)}</TableCell>
                          <TableCell>{formatDate(order.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                      {!(activeCustomer?.recentOrders ?? []).length ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="h-20 text-center text-sm text-muted-foreground"
                          >
                            No recent orders found for this customer.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No repeat customer details found for this timeframe.
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ActionCenter({
  actions,
  onOpenAbandoned,
}: {
  actions: RecommendedAction[]
  onOpenAbandoned: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin action center</CardTitle>
        <CardDescription>
          Prioritized follow-up actions generated from customer behavior.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {actions.length ? (
          actions.map((action) => (
            <div key={action.key} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <Badge
                  variant={
                    action.severity === "critical"
                      ? "destructive"
                      : action.severity === "warning"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {action.severity}
                </Badge>
                <span className="text-sm font-semibold">
                  {formatNumber(action.targetCount)}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium">{action.title}</p>
              <p className="mt-1 min-h-10 text-xs text-muted-foreground">
                {action.description}
              </p>
              {action.actionType === "open_abandoned_checkout" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={onOpenAbandoned}
                >
                  <Target className="size-4" />
                  {action.actionLabel}
                </Button>
              ) : action.href ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  asChild
                >
                  <a href={action.href}>
                    <ArrowRight className="size-4" />
                    {action.actionLabel}
                  </a>
                </Button>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground lg:col-span-2 xl:col-span-4">
            No urgent admin action generated for this timeframe.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityTimeline({
  activities,
}: {
  activities: SegmentMember["activities"]
}) {
  return (
    <div className="space-y-2">
      {activities.length ? (
        activities.slice(0, 10).map((activity, index) => (
          <div
            key={`${activity.eventType}-${activity.occurredAt}-${index}`}
            className="rounded-lg border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline">{labelize(activity.eventType)}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(activity.occurredAt)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {activity.path || activity.screenName || "Unknown path"}
            </p>
          </div>
        ))
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No activity timeline captured for this member yet.
        </div>
      )}
    </div>
  )
}

function CustomerSegmentsPanel({
  segments,
  onSendReminder,
  isSendingReminder,
  queryParams,
}: {
  segments: CustomerSegment[]
  onSendReminder: (params: {
    customerId: string
    title: string
    body: string
    path: string
  }) => void
  isSendingReminder: boolean
  queryParams: CustomerAnalyticsQueryParams
}) {
  const [selectedSegmentKey, setSelectedSegmentKey] = React.useState("")
  const [selectedMemberId, setSelectedMemberId] = React.useState("")
  const selectedSegment =
    segments.find((segment) => segment.key === selectedSegmentKey) ??
    segments[0] ??
    null
  const selectedMember =
    selectedSegment?.members.find((member) => member.id === selectedMemberId) ??
    selectedSegment?.members[0] ??
    null
  const selectedActorId =
    selectedMember?.customerId || selectedMember?.anonymousId || ""
  const memberDetailQuery = useQuery({
    queryKey: [
      "admin-customer-analytics",
      "actor-detail",
      "segment-member",
      selectedActorId,
      queryParams,
    ],
    enabled: Boolean(selectedActorId),
    queryFn: () =>
      getAdminCustomerAnalyticsActorDetail({
        ...queryParams,
        customerId: selectedMember?.customerId || undefined,
        anonymousId: selectedMember?.customerId
          ? undefined
          : selectedMember?.anonymousId || undefined,
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const memberDetail =
    memberDetailQuery.data &&
    (memberDetailQuery.data.customerId === selectedMember?.customerId ||
      memberDetailQuery.data.anonymousId === selectedMember?.anonymousId)
      ? memberDetailQuery.data
      : null

  React.useEffect(() => {
    if (!selectedSegmentKey && segments[0]) {
      setSelectedSegmentKey(segments[0].key)
    }
  }, [segments, selectedSegmentKey])

  React.useEffect(() => {
    if (selectedSegment?.members[0]) {
      setSelectedMemberId((current) =>
        selectedSegment.members.some((member) => member.id === current)
          ? current
          : selectedSegment.members[0].id
      )
    }
  }, [selectedSegment])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer segments</CardTitle>
        <CardDescription>
          New, repeat, high-value, at-risk, abandoned, and guest audiences.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-2">
          {segments.map((segment) => (
            <button
              key={segment.key}
              type="button"
              onClick={() => setSelectedSegmentKey(segment.key)}
              className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/40 ${
                selectedSegment?.key === segment.key
                  ? "border-primary bg-muted/50"
                  : "bg-background"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{segment.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {segment.description}
                  </p>
                </div>
                <Badge variant="outline">{formatNumber(segment.count)}</Badge>
              </div>
              <p className="mt-2 text-xs font-medium text-primary">
                {segment.actionLabel}
              </p>
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-2">
            {selectedSegment?.members.length ? (
              selectedSegment.members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedMemberId(member.id)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/40 ${
                    selectedMember?.id === member.id
                      ? "border-primary bg-muted/50"
                      : "bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {member.fullName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.phone ||
                          compactId(member.customerId || member.anonymousId)}
                      </p>
                    </div>
                    <Badge variant={member.actorType === "guest" ? "secondary" : "outline"}>
                      {labelize(member.actorType)}
                    </Badge>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {member.segmentReason}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No members loaded for this segment.
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3">
            {selectedMember ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {selectedMember.fullName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedMember.segmentReason}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedMember.customerId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onSendReminder({
                            customerId: selectedMember.customerId,
                            title: "A special Foodbela offer for you",
                            body:
                              selectedMember.lifetimeOrders > 0
                                ? "Your favorite restaurants are waiting. Open Foodbela and order again today."
                                : "Welcome to Foodbela. Open the app and place your first order with fresh offers.",
                            path: selectedMember.lastPath || "/(tabs)/browse",
                          })
                        }
                        disabled={isSendingReminder}
                      >
                        <Send className="size-4" />
                        Reminder
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a href="/coupons">
                        <Gift className="size-4" />
                        Coupon
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Orders</p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatNumber(
                        memberDetail?.lifetimeOrders ??
                          selectedMember.lifetimeOrders
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Spend</p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrency(
                        memberDetail?.lifetimeSpend ??
                          selectedMember.lifetimeSpend
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Cart</p>
                    <p className="mt-1 text-lg font-semibold">
                      {selectedMember.cartValue
                        ? formatCurrency(selectedMember.cartValue)
                        : "N/A"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      Last order/seen
                    </p>
                    <p className="mt-1 text-xs font-semibold">
                      {formatDate(
                        memberDetail?.lastOrderAt ??
                          selectedMember.lastSeenAt
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <p className="text-sm font-medium">Activity timeline</p>
                    </div>
                    {memberDetailQuery.isFetching ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Loading details
                      </span>
                    ) : null}
                  </div>
                  <ActivityTimeline
                    activities={
                      memberDetail?.recentActivities ??
                      selectedMember.activities
                    }
                  />
                </div>

                {memberDetail?.recentOrders.length ? (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <ShoppingCart className="size-4 text-muted-foreground" />
                      <p className="text-sm font-medium">Latest orders</p>
                    </div>
                    <div className="space-y-2">
                      {memberDetail.recentOrders.slice(0, 5).map((order) => (
                        <div
                          key={order.orderId}
                          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {order.orderNumber || compactId(order.orderId)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {order.restaurantName}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline">{order.status}</Badge>
                            <p className="mt-1 text-xs font-semibold">
                              {formatCurrency(order.total)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Select a segment member to inspect activity.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AbandonedCheckoutDrawer({
  open,
  onOpenChange,
  checkouts,
  onSendReminder,
  isSendingReminder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  checkouts: AbandonedCheckout[]
  onSendReminder: (params: {
    customerId: string
    title: string
    body: string
    path: string
  }) => void
  isSendingReminder: boolean
}) {
  const [selectedSessionId, setSelectedSessionId] = React.useState("")
  const selectedCheckout =
    checkouts.find((checkout) => checkout.sessionId === selectedSessionId) ??
    checkouts[0] ??
    null

  React.useEffect(() => {
    if (open && !selectedSessionId && checkouts[0]) {
      setSelectedSessionId(checkouts[0].sessionId)
    }
  }, [checkouts, open, selectedSessionId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full max-w-none! flex-col overflow-hidden p-0 sm:max-w-3xl! md:max-w-6xl!">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Abandoned checkouts</SheetTitle>
          <SheetDescription>
            Sessions that reached checkout but did not create an order.
          </SheetDescription>
        </SheetHeader>

        {checkouts.length && selectedCheckout ? (
          <div className="grid flex-1 gap-4 overflow-y-auto p-6 xl:grid-cols-[340px_1fr]">
            <div className="space-y-2">
              {checkouts.map((checkout) => (
                <button
                  key={checkout.sessionId}
                  type="button"
                  onClick={() => setSelectedSessionId(checkout.sessionId)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/40 ${
                    selectedCheckout.sessionId === checkout.sessionId
                      ? "border-primary bg-muted/50"
                      : "bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {checkout.fullName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {checkout.restaurantName}
                      </p>
                    </div>
                    <Badge variant={checkout.repeatVisitor ? "default" : "outline"}>
                      {checkout.repeatVisitor ? "Repeat" : labelize(checkout.actorType)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{formatNumber(checkout.itemCount)} item(s)</span>
                    <span>{formatCurrency(checkout.estimatedCartValue)}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cart value</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatCurrency(selectedCheckout.estimatedCartValue)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Items</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatNumber(selectedCheckout.itemCount)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Payment</p>
                  <p className="mt-1 text-sm font-semibold">
                    {labelize(selectedCheckout.paymentMethod)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Last seen</p>
                  <p className="mt-1 text-sm font-semibold">
                    {formatDate(selectedCheckout.lastSeenAt)}
                  </p>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{selectedCheckout.fullName}</CardTitle>
                      <CardDescription>
                        {selectedCheckout.recommendedAction}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedCheckout.customerId ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            onSendReminder({
                              customerId: selectedCheckout.customerId,
                              title: "Your Foodbela cart is waiting",
                              body: `You left items from ${selectedCheckout.restaurantName}. Open Foodbela and complete your order.`,
                              path: "/checkout",
                            })
                          }
                          disabled={isSendingReminder}
                        >
                          <Bell className="size-4" />
                          Send reminder
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" asChild>
                        <a href="/coupons">
                          <Gift className="size-4" />
                          Coupon
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 xl:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-medium">Cart items</p>
                    {selectedCheckout.cartItems.length ? (
                      <div className="space-y-2">
                        {selectedCheckout.cartItems.map((item, index) => (
                          <div
                            key={`${item.itemId}-${index}`}
                            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {item.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Qty {formatNumber(item.quantity)}
                              </p>
                            </div>
                            <span className="text-sm font-semibold">
                              {formatCurrency(item.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        Cart item snapshot will appear for new checkout events.
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-medium">Activity timeline</p>
                    <ActivityTimeline activities={selectedCheckout.events} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No abandoned checkout details found for this timeframe.
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function RestaurantFunnelPanel({
  rows,
}: {
  rows: RestaurantFunnel[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Restaurant funnels</CardTitle>
        <CardDescription>
          Per-restaurant path from view to menu, cart, checkout, and order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Restaurant</TableHead>
              <TableHead>Flow</TableHead>
              <TableHead>Rates</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Weakest stage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.restaurantId}>
                  <TableCell className="font-medium">
                    <div>{row.restaurantName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatNumber(row.uniqueGuests)} guests,{" "}
                      {formatNumber(row.uniqueCustomers)} customers
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">
                        {formatNumber(row.restaurantViews)} views
                      </Badge>
                      <Badge variant="outline">
                        {formatNumber(row.menuItemViews)} menu
                      </Badge>
                      <Badge variant="outline">
                        {formatNumber(row.cartAdds)} cart
                      </Badge>
                      <Badge variant="outline">
                        {formatNumber(row.checkoutStarts)} checkout
                      </Badge>
                      <Badge>{formatNumber(row.orders)} orders</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="grid min-w-[220px] gap-1 text-xs">
                      <span>Menu {row.viewToMenuRate}%</span>
                      <span>Cart {row.menuToCartRate}%</span>
                      <span>Checkout {row.cartToCheckoutRate}%</span>
                      <span>Order {row.checkoutToOrderRate}%</span>
                    </div>
                  </TableCell>
                  <TableCell>{formatCurrency(row.revenue)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.weakestStage === "checkout_to_order"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {stageLabel(row.weakestStage)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  No restaurant funnel data captured yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// Legacy full-page renderer kept as a rollback fallback while analytics tabs are being split.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AnalyticsContent({ data }: { data: AdminCustomerAnalyticsResponse }) {
  const overview = data.overview
  const [repeatDrawerOpen, setRepeatDrawerOpen] = React.useState(false)
  const [abandonedDrawerOpen, setAbandonedDrawerOpen] = React.useState(false)
  const reminderMutation = useMutation({
    mutationFn: (params: {
      customerId: string
      title: string
      body: string
      path: string
    }) =>
      sendAdminNotification({
        recipientType: "customers",
        audience: "selected",
        recipientIds: [params.customerId],
        customerAudienceType: "selected_users",
        title: params.title,
        body: params.body,
        path: params.path,
        type: "customer_analytics",
        contentType: "text",
        pushEnabled: true,
        conversionWindowDays: 7,
      }),
    onSuccess: (result) => {
      toast.success(
        `Reminder processed for ${formatNumber(result.totalTargets)} customer(s)`
      )
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to send reminder"
      )
    },
  })
  const funnelTotal = Math.max(
    overview.pageViews,
    overview.checkoutStarts,
    overview.ordersCreated,
    overview.signupStarted
  )
  const legacyQueryParams: CustomerAnalyticsQueryParams = {
    preset: data.timeframe.preset,
    from: data.timeframe.preset === "custom" ? data.timeframe.start : undefined,
    to: data.timeframe.preset === "custom" ? data.timeframe.end : undefined,
    limit: 20,
  }

  function handleSendReminder(params: {
    customerId: string
    title: string
    body: string
    path: string
  }) {
    if (!params.customerId) {
      toast.info("Guest visitors need campaign retargeting instead of direct reminder.")
      return
    }
    reminderMutation.mutate(params)
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Total events"
          value={formatNumber(overview.totalEvents)}
          helper={`${formatNumber(overview.uniqueSessions)} tracked sessions`}
          icon={<Activity className="size-4" />}
        />
        <MetricCard
          label="Page views"
          value={formatNumber(overview.pageViews)}
          helper={`${formatNumber(overview.restaurantViews)} restaurant views`}
          icon={<MousePointerClick className="size-4" />}
        />
        <MetricCard
          label="Anonymous visitors"
          value={formatNumber(overview.uniqueAnonymousVisitors)}
          helper={`${formatNumber(overview.browseOnlyAnonymousVisitors)} browsed without signup/order`}
          icon={<Users className="size-4" />}
        />
        <MetricCard
          label="Registered customers"
          value={formatNumber(overview.uniqueRegisteredCustomers)}
          helper={`${formatNumber(overview.registeredBrowseNoOrderCustomers)} browsed but did not order`}
          icon={<UserPlus className="size-4" />}
        />
        <MetricCard
          label="Checkout abandoned"
          value={formatNumber(overview.checkoutAbandonedSessions)}
          helper="Checkout started, no order in same session"
          icon={<TrendingDown className="size-4" />}
        />
        <MetricCard
          label="Signup abandoned"
          value={formatNumber(overview.signupAbandonedVisitors)}
          helper="Signup started but not completed"
          icon={<UserPlus className="size-4" />}
        />
      </div>

      <ActionCenter
        actions={data.recommendedActions}
        onOpenAbandoned={() => setAbandonedDrawerOpen(true)}
      />

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <AlertPanel data={data} />
        <RetentionPanel
          data={data}
          onViewRepeatCustomers={() => setRepeatDrawerOpen(true)}
        />
      </div>

      <RepeatCustomerDrawer
        open={repeatDrawerOpen}
        onOpenChange={setRepeatDrawerOpen}
        customers={data.repeatCustomers}
        queryParams={legacyQueryParams}
      />
      <AbandonedCheckoutDrawer
        open={abandonedDrawerOpen}
        onOpenChange={setAbandonedDrawerOpen}
        checkouts={data.abandonedCheckouts}
        onSendReminder={handleSendReminder}
        isSendingReminder={reminderMutation.isPending}
      />

      <CustomerSegmentsPanel
        segments={data.customerSegments}
        onSendReminder={handleSendReminder}
        isSendingReminder={reminderMutation.isPending}
        queryParams={legacyQueryParams}
      />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <TrendChart data={data.trend} />
        <Card>
          <CardHeader>
            <CardTitle>Drop-off signals</CardTitle>
            <CardDescription>
              Fast answers for users who browse but do not convert.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Signup completion
                </span>
                <Badge variant="outline">
                  {formatPercent(
                    overview.signupCompleted,
                    overview.signupStarted
                  )}
                </Badge>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {formatNumber(overview.signupCompleted)}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  of {formatNumber(overview.signupStarted)}
                </span>
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Checkout to order
                </span>
                <Badge variant="outline">
                  {formatPercent(
                    overview.ordersCreated,
                    overview.checkoutStarts
                  )}
                </Badge>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {formatNumber(overview.ordersCreated)}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  of {formatNumber(overview.checkoutStarts)}
                </span>
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Cart/checkout interest
                </span>
                <ShoppingCart className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatNumber(overview.cartViews)} cart views and{" "}
                {formatNumber(overview.checkoutStarts)} checkout starts.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <SessionJourneyTable sessions={data.sessionJourneys} />

      <RestaurantFunnelPanel rows={data.restaurantFunnels} />

      <AdvancedTables data={data} />

      <SearchAttributionPayment data={data} />

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Conversion funnel</CardTitle>
            <CardDescription>
              Browse, signup, checkout, and order activity from customer app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FunnelStep
              label="Page views"
              value={overview.pageViews}
              total={funnelTotal}
              tone="bg-sky-500"
            />
            <FunnelStep
              label="Signup started"
              value={overview.signupStarted}
              total={funnelTotal}
              tone="bg-violet-500"
            />
            <FunnelStep
              label="Signup completed"
              value={overview.signupCompleted}
              total={funnelTotal}
              tone="bg-emerald-500"
            />
            <FunnelStep
              label="Checkout started"
              value={overview.checkoutStarts}
              total={funnelTotal}
              tone="bg-amber-500"
            />
            <FunnelStep
              label="Orders created"
              value={overview.ordersCreated}
              total={funnelTotal}
              tone="bg-rose-500"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Checkout drop-off paths</CardTitle>
            <CardDescription>
              Sessions that reached checkout but did not create an order.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Last path</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Guests</TableHead>
                  <TableHead>Customers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.checkoutDropOffPaths.length ? (
                  data.checkoutDropOffPaths.map((row) => (
                    <TableRow key={`${row.path}-${row.lastSeenAt ?? ""}`}>
                      <TableCell className="max-w-[260px] truncate font-medium">
                        {row.path}
                      </TableCell>
                      <TableCell>{formatNumber(row.sessions)}</TableCell>
                      <TableCell>{formatNumber(row.guestSessions)}</TableCell>
                      <TableCell>
                        {formatNumber(row.customerSessions)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No checkout drop-off sessions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DistributionList
          title="Event types"
          description="Which actions customers and guests are taking."
          rows={data.eventTypes.map((row) => ({
            label: labelize(row.eventType),
            count: row.count,
          }))}
        />
        <DistributionList
          title="Actor types"
          description="Guest vs registered customer split."
          rows={data.actorTypes.map((row) => ({
            label: labelize(row.actorType),
            count: row.count,
          }))}
        />
        <DistributionList
          title="Source apps"
          description="Which app surfaces are sending analytics events."
          rows={data.sourceApps.map((row) => ({
            label: labelize(row.sourceApp),
            count: row.count,
          }))}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top paths</CardTitle>
          <CardDescription>
            Most visited app paths, split by guest and registered users.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Guests</TableHead>
                <TableHead>Customers</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topPaths.length ? (
                data.topPaths.map((row) => (
                  <TableRow key={`${row.path}-${row.lastSeenAt ?? ""}`}>
                    <TableCell className="max-w-[360px] truncate font-medium">
                      {row.path}
                    </TableCell>
                    <TableCell>{formatNumber(row.count)}</TableCell>
                    <TableCell>{formatNumber(row.guestCount)}</TableCell>
                    <TableCell>{formatNumber(row.customerCount)}</TableCell>
                    <TableCell>{formatDate(row.lastSeenAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No path activity captured in this timeframe.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
          <CardDescription>
            Latest tracked customer app activity, with personal data excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Occurred</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentEvents.length ? (
                data.recentEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {labelize(event.eventType)}
                      </Badge>
                    </TableCell>
                    <TableCell>{labelize(event.actorType)}</TableCell>
                    <TableCell className="max-w-[320px] truncate">
                      {event.path}
                    </TableCell>
                    <TableCell>
                      {event.entityType ? (
                        <span className="text-sm">
                          {event.entityType}
                          {event.entityId ? ` / ${event.entityId}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(event.occurredAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No recent events found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}

const customerAnalyticsTabs: Array<{
  value: AdminCustomerAnalyticsSection
  label: string
  helper: string
}> = [
  {
    value: "overview",
    label: "Overview",
    helper: "Fast summary and action signals",
  },
  {
    value: "graphs",
    label: "Graphs",
    helper: "Conversion and activity charts",
  },
  {
    value: "funnels",
    label: "Funnels",
    helper: "Restaurant and menu conversion",
  },
  {
    value: "customers",
    label: "Customers",
    helper: "Retention and segments",
  },
  {
    value: "abandoned",
    label: "Abandoned",
    helper: "Checkout recovery details",
  },
  {
    value: "payments",
    label: "Payments",
    helper: "Payment event health",
  },
  {
    value: "events",
    label: "Events",
    helper: "Raw paths and sessions",
  },
  {
    value: "all",
    label: "Advanced",
    helper: "Full audit view",
  },
]

const lightweightCustomerAnalyticsSections = new Set<AdminCustomerAnalyticsSection>([
  "overview",
  "graphs",
  "events",
  "payments",
  "all",
  "customers",
])

function buildAnalyticsChips(
  section: AdminCustomerAnalyticsSection,
  data: AdminCustomerAnalyticsResponse
) {
  const overview = data.overview
  const paymentIssues =
    data.paymentHealth.failed + data.paymentHealth.cancelled
  const abandonedValue = data.abandonedCheckouts.reduce(
    (sum, checkout) => sum + checkout.estimatedCartValue,
    0
  )

  if (section === "overview") {
    return [
      {
        label: "Checkout rate",
        value: `${data.insights.checkoutConversionRate}%`,
        tone: data.insights.checkoutConversionRate >= 35 ? "good" : "warn",
      },
      {
        label: "Payment rate",
        value: `${data.insights.paymentCompletionRate}%`,
        tone: data.insights.paymentCompletionRate >= 80 ? "good" : "danger",
      },
      {
        label: "Orders",
        value: formatNumber(overview.ordersCreated),
        tone: "info",
      },
      {
        label: "Sessions",
        value: formatNumber(overview.uniqueSessions),
        tone: "default",
      },
    ]
  }

  if (section === "graphs") {
    return [
      {
        label: "Trend days",
        value: formatNumber(data.trend.length),
        tone: "info",
      },
      {
        label: "Signup rate",
        value: `${data.insights.signupCompletionRate}%`,
        tone: data.insights.signupCompletionRate >= 55 ? "good" : "warn",
      },
      {
        label: "Cart views",
        value: formatNumber(overview.cartViews),
        tone: "default",
      },
      {
        label: "Checkout starts",
        value: formatNumber(overview.checkoutStarts),
        tone: "default",
      },
    ]
  }

  if (section === "funnels") {
    return [
      {
        label: "Restaurants",
        value: formatNumber(data.restaurantFunnels.length),
        tone: "info",
      },
      {
        label: "Menu items",
        value: formatNumber(data.menuItemConversions.length),
        tone: "default",
      },
      {
        label: "Drop-off paths",
        value: formatNumber(data.checkoutDropOffPaths.length),
        tone: data.checkoutDropOffPaths.length ? "warn" : "good",
      },
      {
        label: "Restaurant views",
        value: formatNumber(overview.restaurantViews),
        tone: "default",
      },
    ]
  }

  if (section === "customers") {
    return [
      {
        label: "New customers",
        value: formatNumber(data.retention.newCustomers),
        tone: "info",
      },
      {
        label: "Repeat customers",
        value: formatNumber(data.retention.repeatCustomers),
        tone: "good",
      },
      {
        label: "Segments",
        value: formatNumber(data.customerSegments.length),
        tone: "default",
      },
      {
        label: "Registered visitors",
        value: formatNumber(overview.uniqueRegisteredCustomers),
        tone: "default",
      },
    ]
  }

  if (section === "abandoned") {
    return [
      {
        label: "Sessions",
        value: formatNumber(data.abandonedCheckouts.length),
        tone: data.abandonedCheckouts.length ? "warn" : "good",
      },
      {
        label: "Cart value",
        value: formatCurrency(abandonedValue),
        tone: data.abandonedCheckouts.length ? "warn" : "default",
      },
      {
        label: "Checkout starts",
        value: formatNumber(overview.checkoutStarts),
        tone: "default",
      },
      {
        label: "Created orders",
        value: formatNumber(overview.ordersCreated),
        tone: "good",
      },
    ]
  }

  if (section === "payments") {
    return [
      {
        label: "Initiated",
        value: formatNumber(data.paymentHealth.initiated),
        tone: "info",
      },
      {
        label: "Completed",
        value: formatNumber(data.paymentHealth.completed),
        tone: "good",
      },
      {
        label: "Issues",
        value: formatNumber(paymentIssues),
        tone: paymentIssues ? "danger" : "good",
      },
      {
        label: "Completion",
        value: `${data.paymentHealth.completionRate}%`,
        tone: data.paymentHealth.completionRate >= 80 ? "good" : "warn",
      },
    ]
  }

  if (section === "events") {
    return [
      {
        label: "Recent events",
        value: formatNumber(data.recentEvents.length),
        tone: "info",
      },
      {
        label: "Event types",
        value: formatNumber(data.eventTypes.length),
        tone: "default",
      },
      {
        label: "Top paths",
        value: formatNumber(data.topPaths.length),
        tone: "default",
      },
      {
        label: "Sessions",
        value: formatNumber(data.sessionJourneys.length),
        tone: "default",
      },
    ]
  }

  return [
    {
      label: "Events",
      value: formatNumber(overview.totalEvents),
      tone: "info",
    },
    {
      label: "Actions",
      value: formatNumber(data.recommendedActions.length),
      tone: data.recommendedActions.length ? "warn" : "good",
    },
    {
      label: "Alerts",
      value: formatNumber(data.alerts.length),
      tone: data.alerts.length ? "danger" : "good",
    },
    {
      label: "Rows",
      value: formatNumber(
        data.recentEvents.length +
          data.restaurantFunnels.length +
          data.customerSegments.length
      ),
      tone: "default",
    },
  ]
}

function AnalyticsMetricGrid({ data }: { data: AdminCustomerAnalyticsResponse }) {
  const overview = data.overview

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <MetricCard
        label="Total events"
        value={formatNumber(overview.totalEvents)}
        helper={`${formatNumber(overview.uniqueSessions)} tracked sessions`}
        icon={<Activity className="size-4" />}
      />
      <MetricCard
        label="Page views"
        value={formatNumber(overview.pageViews)}
        helper={`${formatNumber(overview.restaurantViews)} restaurant views`}
        icon={<MousePointerClick className="size-4" />}
      />
      <MetricCard
        label="Anonymous visitors"
        value={formatNumber(overview.uniqueAnonymousVisitors)}
        helper={`${formatNumber(overview.browseOnlyAnonymousVisitors)} browsed without signup/order`}
        icon={<Users className="size-4" />}
      />
      <MetricCard
        label="Registered customers"
        value={formatNumber(overview.uniqueRegisteredCustomers)}
        helper={`${formatNumber(overview.registeredBrowseNoOrderCustomers)} browsed but did not order`}
        icon={<UserPlus className="size-4" />}
      />
      <MetricCard
        label="Checkout abandoned"
        value={formatNumber(overview.checkoutAbandonedSessions)}
        helper="Checkout started, no order in same session"
        icon={<TrendingDown className="size-4" />}
      />
      <MetricCard
        label="Signup abandoned"
        value={formatNumber(overview.signupAbandonedVisitors)}
        helper="Signup started but not completed"
        icon={<UserPlus className="size-4" />}
      />
    </div>
  )
}

function ConversionFunnelCard({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  const overview = data.overview
  const funnelTotal = Math.max(
    overview.pageViews,
    overview.checkoutStarts,
    overview.ordersCreated,
    overview.signupStarted
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion funnel</CardTitle>
        <CardDescription>
          Browse, signup, checkout, and order activity from customer app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FunnelStep
          label="Page views"
          value={overview.pageViews}
          total={funnelTotal}
          tone="bg-sky-500"
        />
        <FunnelStep
          label="Signup started"
          value={overview.signupStarted}
          total={funnelTotal}
          tone="bg-violet-500"
        />
        <FunnelStep
          label="Signup completed"
          value={overview.signupCompleted}
          total={funnelTotal}
          tone="bg-emerald-500"
        />
        <FunnelStep
          label="Checkout started"
          value={overview.checkoutStarts}
          total={funnelTotal}
          tone="bg-amber-500"
        />
        <FunnelStep
          label="Orders created"
          value={overview.ordersCreated}
          total={funnelTotal}
          tone="bg-rose-500"
        />
      </CardContent>
    </Card>
  )
}

function DropOffSignalsCard({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  const overview = data.overview

  return (
    <Card>
      <CardHeader>
        <CardTitle>Drop-off signals</CardTitle>
        <CardDescription>
          Fast answers for users who browse but do not convert.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Signup completion
            </span>
            <Badge variant="outline">
              {formatPercent(overview.signupCompleted, overview.signupStarted)}
            </Badge>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(overview.signupCompleted)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              of {formatNumber(overview.signupStarted)}
            </span>
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Checkout to order
            </span>
            <Badge variant="outline">
              {formatPercent(overview.ordersCreated, overview.checkoutStarts)}
            </Badge>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(overview.ordersCreated)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              of {formatNumber(overview.checkoutStarts)}
            </span>
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Cart/checkout interest
            </span>
            <ShoppingCart className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatNumber(overview.cartViews)} cart views and{" "}
            {formatNumber(overview.checkoutStarts)} checkout starts.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function AnalyticsDistributionCards({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <DistributionList
        title="Event types"
        description="Which actions customers and guests are taking."
        rows={data.eventTypes.map((row) => ({
          label: labelize(row.eventType),
          count: row.count,
        }))}
      />
      <DistributionList
        title="Actor types"
        description="Guest vs registered customer split."
        rows={data.actorTypes.map((row) => ({
          label: labelize(row.actorType),
          count: row.count,
        }))}
      />
      <DistributionList
        title="Source apps"
        description="Which app surfaces are sending analytics events."
        rows={data.sourceApps.map((row) => ({
          label: labelize(row.sourceApp),
          count: row.count,
        }))}
      />
    </div>
  )
}

function PaymentAnalyticsPanel({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  const health = data.paymentHealth
  const paymentCards = [
    { label: "Initiated", value: health.initiated },
    { label: "Completed", value: health.completed },
    { label: "Failed", value: health.failed },
    { label: "Cancelled", value: health.cancelled },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Payment health</CardTitle>
          <CardDescription>
            Payment completion and issue signals from customer app events.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Completion</p>
              <p className="mt-1 text-2xl font-semibold">
                {health.completionRate}%
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Issues</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatNumber(health.failed + health.cancelled)}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {paymentCards.map((card) => (
              <div key={card.label} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{card.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(card.value)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-rose-500"
                    style={{
                      width: health.initiated
                        ? `${Math.max(
                            6,
                            Math.round((card.value / health.initiated) * 100)
                          )}%`
                        : "0%",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment breakdown</CardTitle>
          <CardDescription>
            Provider events and order payment methods when detailed data is
            available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Provider/status</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.events.length ? (
                health.events.map((row) => (
                  <TableRow key={`${row.eventType}-${row.provider}`}>
                    <TableCell>{labelize(row.eventType)}</TableCell>
                    <TableCell>{labelize(row.provider)}</TableCell>
                    <TableCell className="text-right">
                      {formatNumber(row.count)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="h-24 text-center text-muted-foreground"
                >
                    Payment events appear after users start or complete checkout.
                </TableCell>
              </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function CheckoutDropOffTable({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout drop-off paths</CardTitle>
        <CardDescription>
          Sessions that reached checkout but did not create an order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Last path</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Guests</TableHead>
              <TableHead>Customers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.checkoutDropOffPaths.length ? (
              data.checkoutDropOffPaths.map((row) => (
                <TableRow key={`${row.path}-${row.lastSeenAt ?? ""}`}>
                  <TableCell className="max-w-[260px] truncate font-medium">
                    {row.path}
                  </TableCell>
                  <TableCell>{formatNumber(row.sessions)}</TableCell>
                  <TableCell>{formatNumber(row.guestSessions)}</TableCell>
                  <TableCell>{formatNumber(row.customerSessions)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-24 text-center text-muted-foreground"
                >
                  Drop-off paths appear after checkout starts without a matching order.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function TopPathsTable({ data }: { data: AdminCustomerAnalyticsResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top paths</CardTitle>
        <CardDescription>
          Most visited app paths, split by guest and registered users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Path</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Guests</TableHead>
              <TableHead>Customers</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.topPaths.length ? (
              data.topPaths.map((row) => (
                <TableRow key={`${row.path}-${row.lastSeenAt ?? ""}`}>
                  <TableCell className="max-w-[360px] truncate font-medium">
                    {row.path}
                  </TableCell>
                  <TableCell>{formatNumber(row.count)}</TableCell>
                  <TableCell>{formatNumber(row.guestCount)}</TableCell>
                  <TableCell>{formatNumber(row.customerCount)}</TableCell>
                  <TableCell>{formatDate(row.lastSeenAt)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  Top paths appear after customer app page or screen events are tracked.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function RecentEventsTable({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent events</CardTitle>
        <CardDescription>
          Latest tracked customer app activity, with personal data excluded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Occurred</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.recentEvents.length ? (
              data.recentEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Badge variant="outline">{labelize(event.eventType)}</Badge>
                  </TableCell>
                  <TableCell>{labelize(event.actorType)}</TableCell>
                  <TableCell className="max-w-[320px] truncate">
                    {event.path}
                  </TableCell>
                  <TableCell>
                    {event.entityType ? (
                      <span className="text-sm">
                        {event.entityType}
                        {event.entityId ? ` / ${event.entityId}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(event.occurredAt)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  Recent events appear once the customer app sends analytics in this range.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AdvancedQuickAudit({
  data,
}: {
  data: AdminCustomerAnalyticsResponse
}) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <AlertPanel data={data} />
        <PaymentAnalyticsPanel data={data} />
      </div>
      <AnalyticsDistributionCards data={data} />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <TopPathsTable data={data} />
        <RecentEventsTable data={data} />
      </div>
    </>
  )
}

function SectionLoading({ label }: { label: string }) {
  return (
    <div className="grid min-h-[320px] place-items-center rounded-lg border border-dashed">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading {label}...
      </div>
    </div>
  )
}

function AnalyticsTabToolbar({
  data,
  tab,
  updatedAt,
  isFetching,
  onRefresh,
}: {
  data: AdminCustomerAnalyticsResponse
  tab: AdminCustomerAnalyticsSection
  updatedAt?: number
  isFetching: boolean
  onRefresh: () => void
}) {
  const chips = buildAnalyticsChips(tab, data)
  const tabLabel =
    customerAnalyticsTabs.find((item) => item.value === tab)?.label ??
    labelize(tab)

  return (
    <Card className="border-muted-foreground/15 bg-muted/20 shadow-none">
      <CardContent className="space-y-3 pt-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{tabLabel}</Badge>
              <span className="text-xs text-muted-foreground">
                Last updated {formatUpdatedAt(updatedAt)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing only this tab's analytics. Other heavy tables load when
              opened.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isFetching}
            >
              <RefreshCcw
                className={`size-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh tab
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadCustomerAnalyticsCsv(data, tab)}
            >
              <Download className="size-4" />
              Export tab
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <AnalyticsInsightChip
              key={`${chip.label}-${chip.value}`}
              label={chip.label}
              value={chip.value}
              tone={chip.tone}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function CustomerAnalyticsTabbedContent({
  activeTab,
  data,
  isFetching,
  updatedAt,
  onRefresh,
  queryParams,
}: {
  activeTab: AdminCustomerAnalyticsSection
  data: AdminCustomerAnalyticsResponse
  isFetching: boolean
  updatedAt?: number
  onRefresh: () => void
  queryParams: CustomerAnalyticsQueryParams
}) {
  const [repeatDrawerOpen, setRepeatDrawerOpen] = React.useState(false)
  const [abandonedDrawerOpen, setAbandonedDrawerOpen] = React.useState(false)
  const reminderMutation = useMutation({
    mutationFn: (params: {
      customerId: string
      title: string
      body: string
      path: string
    }) =>
      sendAdminNotification({
        recipientType: "customers",
        audience: "selected",
        recipientIds: [params.customerId],
        customerAudienceType: "selected_users",
        title: params.title,
        body: params.body,
        path: params.path,
        type: "customer_analytics",
        contentType: "text",
        pushEnabled: true,
        conversionWindowDays: 7,
      }),
    onSuccess: (result) => {
      toast.success(
        `Reminder processed for ${formatNumber(result.totalTargets)} customer(s)`
      )
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to send reminder"
      )
    },
  })

  function handleSendReminder(params: {
    customerId: string
    title: string
    body: string
    path: string
  }) {
    if (!params.customerId) {
      toast.info("Guest visitors need campaign retargeting instead of direct reminder.")
      return
    }
    reminderMutation.mutate(params)
  }

  return (
    <div className="space-y-4">
      <AnalyticsTabToolbar
        data={data}
        tab={activeTab}
        updatedAt={updatedAt}
        isFetching={isFetching}
        onRefresh={onRefresh}
      />

      {activeTab === "overview" ? (
        <>
          <AnalyticsMetricGrid data={data} />
          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <AlertPanel data={data} />
            <DropOffSignalsCard data={data} />
          </div>
        </>
      ) : null}

      {activeTab === "graphs" ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <TrendChart data={data.trend} />
            <ConversionFunnelCard data={data} />
          </div>
          <AnalyticsDistributionCards data={data} />
        </>
      ) : null}

      {activeTab === "funnels" ? (
        <>
          <RestaurantFunnelPanel rows={data.restaurantFunnels} />
          <AdvancedTables data={data} />
          <CheckoutDropOffTable data={data} />
        </>
      ) : null}

      {activeTab === "customers" ? (
        <>
          <RetentionPanel
            data={data}
            onViewRepeatCustomers={() => setRepeatDrawerOpen(true)}
          />
          <CustomerSegmentsPanel
            segments={data.customerSegments}
            onSendReminder={handleSendReminder}
            isSendingReminder={reminderMutation.isPending}
            queryParams={queryParams}
          />
          <RepeatCustomerDrawer
            open={repeatDrawerOpen}
            onOpenChange={setRepeatDrawerOpen}
            customers={data.repeatCustomers}
            queryParams={queryParams}
          />
        </>
      ) : null}

      {activeTab === "abandoned" ? (
        <>
          <ActionCenter
            actions={data.recommendedActions}
            onOpenAbandoned={() => setAbandonedDrawerOpen(true)}
          />
          <Card>
            <CardHeader>
              <CardTitle>Abandoned checkout recovery</CardTitle>
              <CardDescription>
                Open the drawer to inspect sessions and send reminders.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold">
                  {formatNumber(data.abandonedCheckouts.length)}
                </p>
                <p className="text-sm text-muted-foreground">
                  checkout session(s) loaded for this timeframe
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setAbandonedDrawerOpen(true)}
                disabled={!data.abandonedCheckouts.length}
              >
                <Target className="size-4" />
                Open recovery drawer
              </Button>
            </CardContent>
          </Card>
          <AbandonedCheckoutDrawer
            open={abandonedDrawerOpen}
            onOpenChange={setAbandonedDrawerOpen}
            checkouts={data.abandonedCheckouts}
            onSendReminder={handleSendReminder}
            isSendingReminder={reminderMutation.isPending}
          />
        </>
      ) : null}

      {activeTab === "payments" ? <PaymentAnalyticsPanel data={data} /> : null}

      {activeTab === "events" ? (
        <>
          <SessionJourneyTable sessions={data.sessionJourneys} />
          <AnalyticsDistributionCards data={data} />
          <TopPathsTable data={data} />
          <RecentEventsTable data={data} />
        </>
      ) : null}

      {activeTab === "all" ? <AdvancedQuickAudit data={data} /> : null}
    </div>
  )
}

export function CustomerAnalyticsPage() {
  const [preset, setPreset] =
    React.useState<AdminCustomerAnalyticsPreset>("last7Days")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [limit, setLimit] = React.useState(10)
  const [activeTab, setActiveTab] =
    React.useState<AdminCustomerAnalyticsSection>("overview")

  const analyticsEnabled = preset !== "custom" || (Boolean(from) && Boolean(to))
  const analyticsQueryParams = React.useMemo(
    () => ({
      preset,
      from: preset === "custom" ? from : undefined,
      to: preset === "custom" ? to : undefined,
      limit,
    }),
    [from, limit, preset, to]
  )

  const summaryQuery = useQuery({
    queryKey: [
      "admin-customer-analytics",
      "section",
      "overview",
      analyticsQueryParams,
    ],
    enabled: analyticsEnabled,
    queryFn: () =>
      getAdminCustomerAnalytics({
        ...analyticsQueryParams,
        detail: "summary",
        section: "overview",
    }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const activeSectionQuery = useQuery({
    queryKey: [
      "admin-customer-analytics",
      "section",
      activeTab,
      analyticsQueryParams,
    ],
    enabled: analyticsEnabled && activeTab !== "overview",
    queryFn: () =>
      getAdminCustomerAnalytics({
        ...analyticsQueryParams,
        detail: lightweightCustomerAnalyticsSections.has(activeTab)
          ? "summary"
          : "full",
        section: activeTab,
    }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const activeData =
    activeTab === "overview" ? summaryQuery.data : activeSectionQuery.data
  const data = activeData ?? summaryQuery.data
  const isInitialLoading =
    activeTab === "overview"
      ? summaryQuery.isLoading && !data
      : activeSectionQuery.isLoading && !activeData
  const isFetchingCurrent =
    activeTab === "overview"
      ? summaryQuery.isFetching && !summaryQuery.isLoading
      : activeSectionQuery.isFetching && !activeSectionQuery.isLoading
  const activeTabMeta =
    customerAnalyticsTabs.find((tab) => tab.value === activeTab) ??
    customerAnalyticsTabs[0]
  const activeUpdatedAt =
    activeTab === "overview"
      ? summaryQuery.dataUpdatedAt
      : activeSectionQuery.dataUpdatedAt || summaryQuery.dataUpdatedAt

  function refreshActiveTab() {
    if (activeTab === "overview") {
      void summaryQuery.refetch()
      return
    }
    void activeSectionQuery.refetch()
  }

  React.useEffect(() => {
    if (preset !== "custom") {
      setFrom("")
      setTo("")
    }
  }, [preset])

  function resetFilters() {
    setPreset("last7Days")
    setFrom("")
    setTo("")
    setLimit(10)
    setActiveTab("overview")
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <BarChart3 className="size-5" />
            </span>
            Customer analytics
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Track guest browsing, registered customer activity, signup flow,
            checkout starts, and order conversion.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              data && downloadCustomerAnalyticsCsv(data, activeTab)
            }
            disabled={!data}
          >
            <Download className="size-4" />
            Export current tab
          </Button>
          <Button type="button" variant="outline" onClick={resetFilters}>
            <RefreshCcw className="size-4" />
            Reset filters
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-2 md:grid-cols-2 xl:grid-cols-[minmax(280px,1fr)_0.55fr_auto]">
          <AdminDateRangeFilter<AdminCustomerAnalyticsPreset>
            value={preset}
            from={from}
            to={to}
            label="Timeframe"
            onPresetChange={setPreset}
            onRangeChange={(range) => {
              setFrom(range.from)
              setTo(range.to)
            }}
          />
          <div className="space-y-2">
            <Label>Rows</Label>
            <Select
              value={String(limit)}
              onValueChange={(value) => setLimit(Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Badge variant="outline" className="h-10 px-3">
              {data ? (
                data.timeframe.preset === "lifetime" ? (
                  <>Lifetime - {formatDate(data.timeframe.end)}</>
                ) : (
                  <>
                    {formatDate(data.timeframe.start)}
                    <ArrowRight className="mx-2 size-3" />
                    {formatDate(data.timeframe.end)}
                  </>
                )
              ) : (
                "Loading timeframe"
              )}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as AdminCustomerAnalyticsSection)
        }
        className="gap-4"
      >
        <div className="overflow-x-auto rounded-xl border bg-muted/20 p-2 shadow-sm">
          <TabsList className="h-auto min-w-max justify-start gap-2 bg-transparent p-0">
            {customerAnalyticsTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="min-w-[112px] rounded-full border bg-background px-4 py-2 data-active:border-primary data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {activeTabMeta.helper}
          </p>
        </div>

        <TabsContent value={activeTab} className="m-0">
          {isInitialLoading ? (
            <SectionLoading label={activeTabMeta.label.toLowerCase()} />
          ) : data ? (
            <CustomerAnalyticsTabbedContent
              activeTab={activeTab}
              data={data}
              isFetching={isFetchingCurrent}
              updatedAt={activeUpdatedAt}
              onRefresh={refreshActiveTab}
              queryParams={analyticsQueryParams}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Customer analytics data is unavailable.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
