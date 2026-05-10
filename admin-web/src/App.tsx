import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Headphones,
  Loader2,
  Megaphone,
  Moon,
  Plus,
  RefreshCcw,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  SunMedium,
  Tags,
  TicketPercent,
  Truck,
  Users,
  WalletCards,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useRouteError,
} from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import { useTheme } from "@/components/theme-provider"
import { useAdminSocketBridge } from "@/hooks/use-admin-socket"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import {
  bootstrapAdmin,
  getAdminReports,
  listAdminOrders,
  listAdminNotifications,
  listAdminRestaurants,
  listAdminRiders,
  logoutAdmin,
  markAllAdminNotificationsRead,
  markAdminNotificationRead,
  signinAdmin,
  type AdminNotificationCenterItem,
  type AdminReportsPreset,
} from "@/lib/admin-api"
import {
  clearAdminSession,
  getAdminProfile,
  getAdminRefreshToken,
  type AdminProfile,
} from "@/lib/admin-session"
import { adminRouteTitleByPath } from "@/lib/navigation"
import { useAdminRefreshPolicy } from "@/lib/refresh-policy"
import { cn } from "@/lib/utils"

type AdminAuthContextValue = {
  adminProfile: AdminProfile | null
  setAdminProfile: React.Dispatch<React.SetStateAction<AdminProfile | null>>
  signOut: () => Promise<void>
}

type DashboardMetric = {
  label: string
  value: string
  helper: string
  icon: LucideIcon
  tone: string
  drawer?: DashboardDrawerKey
}

type DashboardDrawerKey =
  | "restaurants"
  | "liveOrders"
  | "riders"
  | "lateOrders"
  | "finance"
  | "orderStatus"
  | "topRestaurants"
  | "restaurantActivity"
  | "topItems"
  | "attention"

type ModuleMetric = {
  label: string
  value: string
}

type ModuleConfig = {
  title: string
  description: string
  icon: LucideIcon
  primaryAction: string
  metrics: ModuleMetric[]
  capabilities: string[]
  queue: string[]
}

const AdminAuthContext = React.createContext<AdminAuthContextValue | null>(null)
const RestaurantsPage = React.lazy(() =>
  import("@/components/restaurants-page").then((module) => ({
    default: module.RestaurantsPage,
  }))
)
const UsersPage = React.lazy(() =>
  import("@/components/users-page").then((module) => ({
    default: module.UsersPage,
  }))
)
const OrdersPage = React.lazy(() =>
  import("@/components/orders-page").then((module) => ({
    default: module.OrdersPage,
  }))
)
const RidersPage = React.lazy(() =>
  import("@/components/riders-page").then((module) => ({
    default: module.RidersPage,
  }))
)
const LiveMapPage = React.lazy(() =>
  import("@/components/live-map-page").then((module) => ({
    default: module.LiveMapPage,
  }))
)
const PaymentsPage = React.lazy(() =>
  import("@/components/payments-page").then((module) => ({
    default: module.PaymentsPage,
  }))
)
const CouponsPage = React.lazy(() =>
  import("@/components/coupons-page").then((module) => ({
    default: module.CouponsPage,
  }))
)
const CmsPage = React.lazy(() =>
  import("@/components/cms-page").then((module) => ({
    default: module.CmsPage,
  }))
)
const CategoriesPage = React.lazy(() =>
  import("@/components/categories-page").then((module) => ({
    default: module.CategoriesPage,
  }))
)
const ReviewsPage = React.lazy(() =>
  import("@/components/reviews-page").then((module) => ({
    default: module.ReviewsPage,
  }))
)
const SupportPage = React.lazy(() =>
  import("@/components/support-page").then((module) => ({
    default: module.SupportPage,
  }))
)
const ReportsPage = React.lazy(() =>
  import("@/components/reports-page").then((module) => ({
    default: module.ReportsPage,
  }))
)
const SettingsPage = React.lazy(() =>
  import("@/components/settings-page").then((module) => ({
    default: module.SettingsPage,
  }))
)
const NotificationsPage = React.lazy(() =>
  import("@/components/notifications-page").then((module) => ({
    default: module.NotificationsPage,
  }))
)
const OperationsHealthPage = React.lazy(() =>
  import("@/components/operations-health-page").then((module) => ({
    default: module.OperationsHealthPage,
  }))
)

const sidebarBadges = {
  pendingOrders: 0,
  restaurantApprovals: 0,
  complaints: 0,
}

const dashboardMetrics: DashboardMetric[] = [
  {
    label: "Total orders",
    value: "0",
    helper: "All platform orders",
    icon: ShoppingBag,
    tone: "text-sky-600 bg-sky-50",
  },
  {
    label: "Today's sales",
    value: "Tk 0",
    helper: "Gross order value",
    icon: WalletCards,
    tone: "text-emerald-600 bg-emerald-50",
  },
  {
    label: "Active users",
    value: "0",
    helper: "Customers available",
    icon: Users,
    tone: "text-violet-600 bg-violet-50",
  },
  {
    label: "Active restaurants",
    value: "0",
    helper: "Open for orders",
    icon: Store,
    tone: "text-orange-600 bg-orange-50",
  },
  {
    label: "Active riders",
    value: "0",
    helper: "Online delivery team",
    icon: Truck,
    tone: "text-cyan-600 bg-cyan-50",
  },
  {
    label: "Pending orders",
    value: "0",
    helper: "Need admin attention",
    icon: ShieldCheck,
    tone: "text-amber-600 bg-amber-50",
  },
]

const moduleConfigs: Record<string, ModuleConfig> = {
  users: {
    title: "Users",
    description:
      "Manage customer accounts, profile details, lifecycle status, and block/unblock decisions.",
    icon: Users,
    primaryAction: "Add user note",
    metrics: [
      { label: "Active users", value: "0" },
      { label: "Blocked users", value: "0" },
      { label: "New signups", value: "0" },
      { label: "Account requests", value: "0" },
    ],
    capabilities: [
      "Customer list",
      "User block/unblock",
      "User details view",
      "Account request review",
    ],
    queue: [
      "Customer profile table",
      "Status filter and search",
      "Block/unblock confirmation dialog",
      "Customer activity timeline",
    ],
  },
  restaurants: {
    title: "Restaurants",
    description:
      "Approve restaurants, manage menu quality, control active status, and configure commission.",
    icon: Store,
    primaryAction: "Add Restaurant",
    metrics: [
      { label: "Active restaurants", value: "0" },
      { label: "Pending approval", value: "0" },
      { label: "Inactive stores", value: "0" },
      { label: "Avg commission", value: "0%" },
    ],
    capabilities: [
      "Restaurant add/approve",
      "Menu manage",
      "Restaurant status active/inactive",
      "Commission set",
    ],
    queue: [
      "Restaurant directory",
      "Approval review drawer",
      "Menu moderation",
      "Commission editor",
    ],
  },
  orders: {
    title: "Orders",
    description:
      "Track order flow from placement to delivery, with cancellation, refund, and dispatch visibility.",
    icon: ShoppingBag,
    primaryAction: "Review new orders",
    metrics: [
      { label: "New orders", value: "0" },
      { label: "Pending orders", value: "0" },
      { label: "Cancelled today", value: "0" },
      { label: "Refund review", value: "0" },
    ],
    capabilities: [
      "New order view",
      "Order status tracking",
      "Cancel/refund manage",
      "Delivery status check",
    ],
    queue: [
      "Live order table",
      "Order detail drawer",
      "Refund decision workflow",
      "Delivery timeline",
    ],
  },
  riders: {
    title: "Riders / Delivery",
    description:
      "Approve riders, monitor live delivery status, assign orders, and review rider earnings.",
    icon: Truck,
    primaryAction: "Approve rider",
    metrics: [
      { label: "Active riders", value: "0" },
      { label: "Pending approval", value: "0" },
      { label: "On delivery", value: "0" },
      { label: "Unassigned orders", value: "0" },
    ],
    capabilities: [
      "Rider add/approve",
      "Rider location/status",
      "Assign delivery",
      "Rider earnings",
    ],
    queue: [
      "Rider directory",
      "Live map panel",
      "Manual assignment controls",
      "Earnings ledger",
    ],
  },
  payments: {
    title: "Payments",
    description:
      "Monitor online payments, cash on delivery, refunds, and transaction history across the platform.",
    icon: CreditCard,
    primaryAction: "Review transactions",
    metrics: [
      { label: "Online payment", value: "Tk 0" },
      { label: "Cash on delivery", value: "Tk 0" },
      { label: "Refund pending", value: "0" },
      { label: "Transactions", value: "0" },
    ],
    capabilities: [
      "Online payment",
      "Cash on delivery",
      "Refund",
      "Transaction history",
    ],
    queue: [
      "Payment summary",
      "Transaction table",
      "Refund queue",
      "Settlement export",
    ],
  },
  coupons: {
    title: "Coupons & Offers",
    description:
      "Create promo codes, discount offers, and campaign rules for customers and restaurants.",
    icon: TicketPercent,
    primaryAction: "Create promo code",
    metrics: [
      { label: "Active coupons", value: "0" },
      { label: "Campaigns", value: "0" },
      { label: "Redeemed today", value: "0" },
      { label: "Discount spend", value: "Tk 0" },
    ],
    capabilities: [
      "Promo code create",
      "Discount offer",
      "Campaign manage",
      "Usage limits",
    ],
    queue: [
      "Coupon builder",
      "Campaign calendar",
      "Targeting rules",
      "Redemption analytics",
    ],
  },
  cms: {
    title: "Content / CMS",
    description:
      "Control customer home screen offer strips, carousel blocks, guide content, modal campaigns, and push campaigns.",
    icon: Bell,
    primaryAction: "Manage content",
    metrics: [
      { label: "Home blocks", value: "0" },
      { label: "Guide cards", value: "0" },
      { label: "Push campaigns", value: "0" },
      { label: "Conversions", value: "0" },
    ],
    capabilities: [
      "Home CMS visibility",
      "Offer strip and carousel",
      "How-to-order guide",
      "Push analytics",
    ],
    queue: [
      "Customer home preview",
      "Campaign history",
      "Notification analytics",
      "Content scheduling",
    ],
  },
  categories: {
    title: "Food Categories",
    description:
      "Organize food categories and cuisine types shown across customer discovery surfaces.",
    icon: Tags,
    primaryAction: "Add category",
    metrics: [
      { label: "Food categories", value: "0" },
      { label: "Cuisine types", value: "0" },
      { label: "Hidden categories", value: "0" },
      { label: "Featured groups", value: "0" },
    ],
    capabilities: [
      "Food category add/edit",
      "Cuisine type manage",
      "Visibility control",
      "Sort order",
    ],
    queue: [
      "Category table",
      "Cuisine type editor",
      "Image upload",
      "Display order controls",
    ],
  },
  reviews: {
    title: "Reviews",
    description:
      "Moderate customer reviews, restaurant ratings, and quality signals from completed orders.",
    icon: Star,
    primaryAction: "Moderate reviews",
    metrics: [
      { label: "Customer reviews", value: "0" },
      { label: "Flagged reviews", value: "0" },
      { label: "Avg restaurant rating", value: "0.0" },
      { label: "Pending moderation", value: "0" },
    ],
    capabilities: [
      "Customer review",
      "Restaurant rating",
      "Review moderation",
      "Rating quality trends",
    ],
    queue: [
      "Review inbox",
      "Restaurant rating breakdown",
      "Flag handling",
      "Moderation audit trail",
    ],
  },
  support: {
    title: "Complaints / Support",
    description:
      "Resolve complaints from customers, restaurants, and riders with priority tracking.",
    icon: Headphones,
    primaryAction: "Open support queue",
    metrics: [
      { label: "Open complaints", value: "0" },
      { label: "High priority", value: "0" },
      { label: "Resolved today", value: "0" },
      { label: "Avg response", value: "0m" },
    ],
    capabilities: [
      "Customer complaint",
      "Restaurant support",
      "Complaint solve",
      "Priority workflow",
    ],
    queue: [
      "Support inbox",
      "Conversation detail",
      "SLA indicators",
      "Resolution notes",
    ],
  },
  reports: {
    title: "Reports",
    description:
      "Analyze sales, orders, customers, and restaurant performance from one reporting center.",
    icon: Building2,
    primaryAction: "Generate report",
    metrics: [
      { label: "Sales reports", value: "0" },
      { label: "Order reports", value: "0" },
      { label: "Customer reports", value: "0" },
      { label: "Restaurant reports", value: "0" },
    ],
    capabilities: [
      "Sales report",
      "Order report",
      "Customer report",
      "Restaurant performance",
    ],
    queue: [
      "Report filters",
      "Export CSV/PDF",
      "Performance charts",
      "Scheduled reports",
    ],
  },
  notifications: {
    title: "Notifications",
    description:
      "Send and monitor admin, customer, restaurant, and rider notifications.",
    icon: Bell,
    primaryAction: "Create notification",
    metrics: [
      { label: "Unread alerts", value: "0" },
      { label: "Sent today", value: "0" },
      { label: "Templates", value: "0" },
      { label: "Failed sends", value: "0" },
    ],
    capabilities: [
      "Admin alerts",
      "Push campaign",
      "Audience targeting",
      "Notification history",
    ],
    queue: [
      "Notification inbox",
      "Template builder",
      "Segment selection",
      "Delivery log",
    ],
  },
  settings: {
    title: "Settings",
    description:
      "Configure platform policies, service rules, admin controls, and operational defaults.",
    icon: Settings,
    primaryAction: "Update settings",
    metrics: [
      { label: "Admin roles", value: "1" },
      { label: "Service zones", value: "0" },
      { label: "Commission rules", value: "0" },
      { label: "Payment methods", value: "0" },
    ],
    capabilities: [
      "Admin profile",
      "Platform configuration",
      "Commission rules",
      "Service area settings",
    ],
    queue: [
      "Role management",
      "Platform defaults",
      "Security settings",
      "Audit settings",
    ],
  },
}

void moduleConfigs

function formatDashboardCurrency(value?: number) {
  return `Tk ${Math.round(value || 0).toLocaleString()}`
}

function formatDashboardNumber(value?: number) {
  return Math.round(value || 0).toLocaleString()
}

function dashboardDateInput(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatDashboardDate(value?: string) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatDashboardDateTime(value?: number) {
  if (!value) return "Not refreshed yet"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

const dashboardPresetLabels: Record<AdminReportsPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  last90Days: "Last 90 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  lifetime: "Lifetime",
  custom: "Custom",
}

function DashboardDrawerRow({
  title,
  description,
  value,
  badge,
}: {
  title: string
  description?: string
  value?: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {value ? (
        <div className="shrink-0 text-right text-sm font-semibold">{value}</div>
      ) : null}
      {badge}
    </div>
  )
}

function useAdminAuth() {
  const context = React.useContext(AdminAuthContext)

  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider")
  }

  return context
}

function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [adminProfile, setAdminProfile] = React.useState<AdminProfile | null>(
    () => getAdminProfile()
  )

  const signOut = React.useCallback(async () => {
    const refreshToken = getAdminRefreshToken()

    try {
      if (refreshToken) {
        await logoutAdmin(refreshToken)
      }
    } catch {
      clearAdminSession()
    }

    clearAdminSession()
    setAdminProfile(null)
    queryClient.clear()
  }, [queryClient])

  const value = React.useMemo(
    () => ({
      adminProfile,
      setAdminProfile,
      signOut,
    }),
    [adminProfile, signOut]
  )

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  )
}

function formatNavNotificationTime(value?: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function navNotificationIcon(
  item: Pick<AdminNotificationCenterItem, "source" | "type" | "deliveryStatus">
) {
  if (item.deliveryStatus === "failed") return XCircle
  if (item.deliveryStatus === "critical") return XCircle
  if (item.deliveryStatus === "warning") return ShieldCheck
  if (item.deliveryStatus === "sent") return CheckCircle2
  if (item.source === "ops" && item.type.includes("support")) return Headphones
  if (item.source === "ops" && item.type.includes("rider")) return Truck
  if (
    item.source === "ops" &&
    (item.type.includes("prep") || item.type.includes("food"))
  )
    return Store
  if (item.source === "ops" && item.type.includes("order")) return ShoppingBag
  if (item.source === "scheduled") return CalendarClock
  if (item.source === "campaign" || item.type === "promotion") return Megaphone
  if (item.type === "support") return Headphones
  if (item.type === "payout") return CreditCard
  if (item.type === "order_status") return ReceiptText
  if (item.source === "owner") return Store
  if (item.source === "rider") return Truck
  return Users
}

function navNotificationSourceLabel(
  source: AdminNotificationCenterItem["source"]
) {
  if (source === "customer") return "Customer"
  if (source === "owner") return "Owner"
  if (source === "rider") return "Rider"
  if (source === "ops") return "Ops alert"
  if (source === "scheduled") return "Scheduled"
  return "Campaign"
}

function resolveAdminNotificationPath(item: AdminNotificationCenterItem) {
  if (
    item.path?.startsWith("/orders") ||
    item.path?.startsWith("/support") ||
    item.path?.startsWith("/reviews") ||
    item.path?.startsWith("/restaurants") ||
    item.path?.startsWith("/riders") ||
    item.path?.startsWith("/payments")
  ) {
    return item.path
  }
  return "/notifications"
}

function canMarkNavNotificationRead(item: AdminNotificationCenterItem) {
  return item.source === "customer" || item.source === "owner" || item.source === "ops"
}

function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { adminProfile, signOut } = useAdminAuth()
  const { theme, setTheme } = useTheme()
  const { policy: refreshPolicy } = useAdminRefreshPolicy()
  const [search, setSearch] = React.useState("")
  const navNotificationsQuery = useQuery({
    queryKey: ["admin-notifications", "top-nav"],
    queryFn: () =>
      listAdminNotifications({
        page: 1,
        pageSize: 15,
        status: "all",
    }),
    enabled: Boolean(adminProfile),
    refetchInterval: refreshPolicy.notificationsMs || false,
  })
  const markAllNotificationsReadMutation = useMutation({
    mutationFn: markAllAdminNotificationsRead,
    onSuccess: (result) => {
      toast.success(
        result.updated
          ? `Marked ${result.updated} notification group(s) as read`
          : "No unread notifications"
      )
      void queryClient.invalidateQueries({ queryKey: ["admin-notifications"] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to mark notifications as read"
      )
    },
  })
  const markNotificationReadMutation = useMutation({
    mutationFn: markAdminNotificationRead,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-notifications"] })
    },
  })
  useAdminSocketBridge(Boolean(adminProfile))

  if (!adminProfile) {
    return <Navigate to="/auth/signin" replace state={{ from: location }} />
  }

  const resolvedIsDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  const pageTitle = adminRouteTitleByPath[location.pathname] ?? "Dashboard"
  const isFullBleedRoute = location.pathname === "/live-map"
  const navNotificationItems = navNotificationsQuery.data?.items ?? []
  const navUnreadCount =
    (navNotificationsQuery.data?.summary.customerUnread ?? 0) +
    (navNotificationsQuery.data?.summary.ownerUnread ?? 0)
  const navBadgeLabel = navUnreadCount > 99 ? "99+" : `${navUnreadCount}`

  async function handleLogout() {
    await signOut()
    navigate("/auth/signin", { replace: true })
  }

  function handleNavNotificationOpen(item: AdminNotificationCenterItem) {
    const path = resolveAdminNotificationPath(item)
    if (!item.isRead && canMarkNavNotificationRead(item)) {
      markNotificationReadMutation.mutate({
        source: item.source as "customer" | "owner" | "ops",
        id: item.id,
      })
    }
    navigate(path)
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar
          adminProfile={adminProfile}
          badges={sidebarBadges}
          onLogout={handleLogout}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-50 border-b bg-background">
            <div className="flex h-16 items-center justify-between gap-3 px-4">
              <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{pageTitle}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Foodbela platform operations
                  </p>
                </div>
              </div>

              <div className="hidden min-w-0 flex-1 items-center justify-center px-4 lg:flex">
                <div className="relative w-full max-w-xl">
                  <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search users, restaurants, orders, riders..."
                    className="h-9 pl-8"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full"
                  onClick={() => setTheme(resolvedIsDark ? "light" : "dark")}
                  aria-label={
                    resolvedIsDark
                      ? "Switch to light mode"
                      : "Switch to dark mode"
                  }
                >
                  {resolvedIsDark ? (
                    <SunMedium className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="relative rounded-full"
                      aria-label="Open notifications"
                    >
                      <Bell className="size-4" />
                      {navUnreadCount > 0 ? (
                        <span className="absolute -top-2 -right-2 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                          {navBadgeLabel}
                        </span>
                      ) : null}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-96">
                    <DropdownMenuLabel className="flex items-center justify-between gap-3">
                      <span>Notifications</span>
                      <span className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={
                            navUnreadCount === 0 ||
                            markAllNotificationsReadMutation.isPending
                          }
                          onClick={() =>
                            markAllNotificationsReadMutation.mutate()
                          }
                        >
                          {markAllNotificationsReadMutation.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                          Read all
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => void navNotificationsQuery.refetch()}
                        >
                          {navNotificationsQuery.isFetching ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="size-3.5" />
                          )}
                          Refresh
                        </Button>
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <ScrollArea className="max-h-[420px]">
                      <div className="py-1">
                        {navNotificationsQuery.isLoading ? (
                          <DropdownMenuItem disabled>
                            <Loader2 className="size-4 animate-spin" />
                            Loading notifications...
                          </DropdownMenuItem>
                        ) : null}
                        {!navNotificationsQuery.isLoading &&
                        navNotificationItems.length === 0 ? (
                          <DropdownMenuItem disabled>
                            No platform notifications yet.
                          </DropdownMenuItem>
                        ) : null}
                        {navNotificationItems.map((item) => {
                          const Icon = navNotificationIcon(item)
                          return (
                            <DropdownMenuItem
                              key={`${item.source}-${item.id}`}
                              className="items-start gap-3 py-3"
                              onClick={() => handleNavNotificationOpen(item)}
                            >
                              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                <Icon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium">
                                    {item.title}
                                  </span>
                                  {!item.isRead ? (
                                    <span className="size-2 shrink-0 rounded-full bg-rose-500" />
                                  ) : null}
                                </span>
                                <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {item.description}
                                </span>
                                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                  <Badge
                                    variant="outline"
                                    className="h-5 px-1.5 text-[10px]"
                                  >
                                    {navNotificationSourceLabel(item.source)}
                                  </Badge>
                                  {formatNavNotificationTime(
                                    item.createdAt || item.scheduledAt
                                  )}
                                </span>
                              </span>
                            </DropdownMenuItem>
                          )
                        })}
                      </div>
                    </ScrollArea>
                    <DropdownMenuItem
                      onClick={() => navigate("/notifications")}
                      className="justify-center font-medium"
                    >
                      View notification center
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="border-t px-4 py-2 lg:hidden">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search platform"
                  className="h-9 pl-8"
                />
              </div>
            </div>
          </header>

          <section className="flex-1 overflow-auto">
            <div
              className={cn(
                "mx-auto flex w-full flex-col gap-6",
                isFullBleedRoute
                  ? "max-w-none gap-0 px-0 py-0"
                  : "max-w-7xl px-4 py-5 sm:px-6"
              )}
            >
              <Outlet />
            </div>
          </section>
        </main>
      </div>
      <Toaster richColors closeButton position="top-right" />
    </SidebarProvider>
  )
}

function SignInPage() {
  const navigate = useNavigate()
  const { adminProfile, setAdminProfile } = useAdminAuth()
  const [email, setEmail] = React.useState("admin@example.com")
  const [password, setPassword] = React.useState("")
  const [authError, setAuthError] = React.useState("")
  const isRateLimitError = /^too many /i.test(authError.trim())

  const signInMutation = useMutation({
    mutationFn: () => signinAdmin(email, password),
    onSuccess: (data) => {
      setAdminProfile(data.admin)
      setAuthError("")
      navigate("/", { replace: true })
    },
    onError: (error) => {
      setAuthError(error instanceof Error ? error.message : "Sign in failed")
    },
  })

  const bootstrapMutation = useMutation({
    mutationFn: bootstrapAdmin,
    onSuccess: () => {
      setAuthError("Admin bootstrap completed. You can sign in now.")
    },
    onError: (error) => {
      setAuthError(error instanceof Error ? error.message : "Bootstrap failed")
    },
  })

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    signInMutation.mutate()
  }

  if (adminProfile) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Admin Sign In</CardTitle>
          <CardDescription>
            Access the Foodbela platform management console.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {authError ? (
              <p
                className={
                  isRateLimitError
                    ? "rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                    : "text-sm text-muted-foreground"
                }
              >
                {authError}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button
                type="submit"
                className="flex-1"
                disabled={signInMutation.isPending}
              >
                {signInMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Sign in"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={bootstrapMutation.isPending}
                onClick={() => bootstrapMutation.mutate()}
              >
                {bootstrapMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Bootstrap"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function DashboardPage() {
  const navigate = useNavigate()
  const [preset, setPreset] = React.useState<AdminReportsPreset>("today")
  const [from, setFrom] = React.useState(() => dashboardDateInput(-6))
  const [to, setTo] = React.useState(() => dashboardDateInput())
  const [drawer, setDrawer] = React.useState<DashboardDrawerKey | null>(null)
  const [autoRefresh, setAutoRefresh] = React.useState(false)
  const { policy: refreshPolicy } = useAdminRefreshPolicy()
  const isCustomRange = preset === "custom"
  const timeframeLabel = dashboardPresetLabels[preset]
  const reportsParams = React.useMemo(
    () => ({
      preset,
      from: isCustomRange ? from : undefined,
      to: isCustomRange ? to : undefined,
    }),
    [from, isCustomRange, preset, to]
  )
  const dashboardQuery = useQuery({
    queryKey: ["admin-dashboard-reports", reportsParams],
    queryFn: () => getAdminReports(reportsParams),
  })
  const ordersQuery = useQuery({
    queryKey: ["admin-dashboard-orders"],
    queryFn: () =>
      listAdminOrders({
        pageSize: 100,
        sortBy: "recentlyUpdated",
      }),
  })
  const restaurantsQuery = useQuery({
    queryKey: ["admin-dashboard-restaurants"],
    queryFn: () =>
      listAdminRestaurants({
        visibility: "visible",
        sortBy: "mostOrders",
        pageSize: 100,
      }),
  })
  const ridersQuery = useQuery({
    queryKey: ["admin-dashboard-riders"],
    queryFn: () =>
      listAdminRiders({
        pageSize: 100,
        sortBy: "mostActive",
      }),
  })
  const data = dashboardQuery.data
  const orders = ordersQuery.data?.items ?? []
  const restaurants = restaurantsQuery.data?.items ?? []
  const ridersSummary = ridersQuery.data?.summary ?? {}
  const liveOrders =
    (ordersQuery.data?.summary?.liveOrders ?? 0) +
    (ordersQuery.data?.summary?.readyForPickup ?? 0) +
    (ordersQuery.data?.summary?.pickedUp ?? 0)
  const lateOrders = orders
    .filter((order) => order.isLate)
    .sort((left, right) => right.lateMinutes - left.lateMinutes)
    .slice(0, 5)
  const onlineRestaurants = restaurants.filter(
    (restaurant) => restaurant.isOnline
  )
  const offlineRestaurantsWithLiveOrders = restaurants.filter(
    (restaurant) => !restaurant.isOnline && restaurant.liveOrders > 0
  )
  const restaurantsMissingMedia = restaurants.filter(
    (restaurant) => !restaurant.hasLogo || !restaurant.hasCoverImage
  )
  const staleTrackingOrders = orders.filter(
    (order) => order.riderTracking?.freshness?.state === "stale"
  )
  const topRestaurants = data?.restaurants.slice(0, 5) ?? []
  const topItems = data?.topItems.slice(0, 5) ?? []
  const marginIsNegative = (data?.overview.estimatedPlatformMargin ?? 0) < 0
  const riderCapacityRisk =
    liveOrders > 0 &&
    (ridersSummary.availableRiders ?? 0) > 0 &&
    liveOrders >= (ridersSummary.availableRiders ?? 0) * 3
  const dateRangeText = data
    ? preset === "lifetime"
      ? `Lifetime - ${formatDashboardDate(data.timeframe.end)}`
      : `${formatDashboardDate(data.timeframe.start)} - ${formatDashboardDate(data.timeframe.end)}`
    : "Loading timeframe"
  const resetFilters = () => {
    setPreset("today")
    setFrom(dashboardDateInput(-6))
    setTo(dashboardDateInput())
  }
  const liveMetrics: DashboardMetric[] = data
    ? [
        {
          label: "Active restaurants",
          value: formatDashboardNumber(data.overview.activeRestaurants),
          helper: `${formatDashboardNumber(onlineRestaurants.length)} online now`,
          icon: Store,
          tone: "text-orange-600 bg-orange-50",
          drawer: "restaurants",
        },
        {
          label: "Live orders",
          value: formatDashboardNumber(liveOrders),
          helper: `${formatDashboardNumber(ordersQuery.data?.summary?.newOrders)} new, ${formatDashboardNumber(ordersQuery.data?.summary?.readyForPickup)} ready`,
          icon: ShoppingBag,
          tone: "text-sky-600 bg-sky-50",
          drawer: "liveOrders",
        },
        {
          label: "Active riders",
          value: formatDashboardNumber(ridersSummary.activeRiders),
          helper: `${formatDashboardNumber(ridersSummary.availableRiders)} available, ${formatDashboardNumber(ridersSummary.liveTrips)} live trips`,
          icon: Truck,
          tone: "text-cyan-600 bg-cyan-50",
          drawer: "riders",
        },
        {
          label: "Late alerts",
          value: formatDashboardNumber(lateOrders.length),
          helper: lateOrders.length
            ? "Needs operations review"
            : "No late order in loaded queue",
          icon: ShieldCheck,
          tone: lateOrders.length
            ? "text-rose-600 bg-rose-50"
            : "text-emerald-600 bg-emerald-50",
          drawer: "lateOrders",
        },
        {
          label: "Delivered revenue",
          value: formatDashboardCurrency(data.overview.deliveredRevenue),
          helper: `${timeframeLabel} delivered customer-paid volume`,
          icon: WalletCards,
          tone: "text-emerald-600 bg-emerald-50",
          drawer: "finance",
        },
        {
          label: "Estimated margin",
          value: formatDashboardCurrency(data.overview.estimatedPlatformMargin),
          helper: "Platform gross income - operating expense",
          icon: CreditCard,
          tone: marginIsNegative
            ? "text-rose-600 bg-rose-50"
            : "text-violet-600 bg-violet-50",
          drawer: "finance",
        },
      ]
    : dashboardMetrics
  const rawHealthAlerts = [
    {
      title: "Late orders",
      description: "Orders beyond expected operational timing",
      count: lateOrders.length,
      drawer: "lateOrders" as DashboardDrawerKey,
      path: "/orders",
      tone: lateOrders.length > 0 ? "destructive" : "outline",
      priority: 100,
    },
    {
      title: "Refund requests",
      description: "Payment disputes and refunds",
      count: data?.orders.refunds.pendingCount ?? 0,
      drawer: "finance" as DashboardDrawerKey,
      path: "/payments",
      tone:
        (data?.orders.refunds.pendingCount ?? 0) > 0
          ? "destructive"
          : "outline",
      priority: 80,
    },
    {
      title: "Unassigned ready orders",
      description: "Ready orders waiting for rider assignment",
      count: ordersQuery.data?.summary?.unassignedReadyOrders ?? 0,
      drawer: "liveOrders" as DashboardDrawerKey,
      path: "/riders",
      tone:
        (ordersQuery.data?.summary?.unassignedReadyOrders ?? 0) > 0
          ? "destructive"
          : "outline",
      priority: 90,
    },
    {
      title: "Stale rider tracking",
      description: "Assigned orders with old rider location updates",
      count: staleTrackingOrders.length,
      drawer: "liveOrders" as DashboardDrawerKey,
      path: "/orders",
      tone: staleTrackingOrders.length > 0 ? "destructive" : "outline",
      priority: 70,
    },
    {
      title: "Offline restaurants with live orders",
      description: "Stores are offline while orders are still active",
      count: offlineRestaurantsWithLiveOrders.length,
      drawer: "restaurantActivity" as DashboardDrawerKey,
      path: "/restaurants",
      tone:
        offlineRestaurantsWithLiveOrders.length > 0 ? "destructive" : "outline",
      priority: 95,
    },
    {
      title: "Restaurant media gaps",
      description: "Visible restaurants missing logo or cover image",
      count: restaurantsMissingMedia.length,
      drawer: "restaurantActivity" as DashboardDrawerKey,
      path: "/restaurants",
      tone: restaurantsMissingMedia.length > 0 ? "destructive" : "outline",
      priority: 35,
    },
    {
      title: "Rider capacity pressure",
      description: "Live order load is high compared with available riders",
      count: riderCapacityRisk ? 1 : 0,
      drawer: "riders" as DashboardDrawerKey,
      path: "/riders",
      tone: riderCapacityRisk ? "destructive" : "outline",
      priority: 85,
    },
    {
      title: "Reconciliation status",
      description: data?.reconciliation.message ?? "Finance data is loading",
      count: data?.reconciliation.status === "warning" ? 1 : 0,
      drawer: "finance" as DashboardDrawerKey,
      path: "/reports",
      tone:
        data?.reconciliation.status === "warning" ? "destructive" : "outline",
      priority: 75,
    },
    {
      title: "Negative margin",
      description: "Platform expense is higher than platform gross income",
      count: marginIsNegative ? 1 : 0,
      drawer: "finance" as DashboardDrawerKey,
      path: "/reports",
      tone: marginIsNegative ? "destructive" : "outline",
      priority: 65,
    },
  ]
  const healthAlerts = [...rawHealthAlerts].sort((left, right) => {
    if (left.count > 0 && right.count === 0) return -1
    if (left.count === 0 && right.count > 0) return 1
    return right.priority - left.priority
  })
  const criticalHealthAlertCount = healthAlerts.filter(
    (alert) => alert.count > 0
  ).length
  const isLoading =
    dashboardQuery.isLoading ||
    ordersQuery.isLoading ||
    restaurantsQuery.isLoading ||
    ridersQuery.isLoading
  const isRefreshing =
    dashboardQuery.isFetching ||
    ordersQuery.isFetching ||
    restaurantsQuery.isFetching ||
    ridersQuery.isFetching
  const lastUpdatedAt = Math.max(
    dashboardQuery.dataUpdatedAt,
    ordersQuery.dataUpdatedAt,
    restaurantsQuery.dataUpdatedAt,
    ridersQuery.dataUpdatedAt
  )
  const refreshDashboard = React.useCallback(() => {
    void dashboardQuery.refetch()
    void ordersQuery.refetch()
    void restaurantsQuery.refetch()
    void ridersQuery.refetch()
  }, [dashboardQuery, ordersQuery, restaurantsQuery, ridersQuery])

  React.useEffect(() => {
    if (!autoRefresh) return
    if (!refreshPolicy.dashboardMs) return
    const intervalId = window.setInterval(() => {
      refreshDashboard()
    }, refreshPolicy.dashboardMs)
    return () => window.clearInterval(intervalId)
  }, [autoRefresh, refreshDashboard, refreshPolicy.dashboardMs])
  const drawerMeta: Record<
    DashboardDrawerKey,
    { title: string; description: string; route: string; routeLabel: string }
  > = {
    restaurants: {
      title: "Restaurant health",
      description:
        "Active, online, missing media, and live-order restaurant signals.",
      route: "/restaurants",
      routeLabel: "Open restaurants",
    },
    liveOrders: {
      title: "Live order operations",
      description: "Current active order queue from the latest loaded orders.",
      route: "/orders",
      routeLabel: "Open orders",
    },
    riders: {
      title: "Rider capacity",
      description:
        "Current delivery capacity, live trips, and pressure checks.",
      route: "/riders",
      routeLabel: "Open riders",
    },
    lateOrders: {
      title: "Late order alerts",
      description: "Orders that need manual operations review right now.",
      route: "/orders",
      routeLabel: "Review orders",
    },
    finance: {
      title: "Finance pulse",
      description:
        "Selected timeframe finance, refunds, payroll, and reconciliation.",
      route: "/reports",
      routeLabel: "Open reports",
    },
    orderStatus: {
      title: "Order status breakdown",
      description: "Status mix for the selected dashboard timeframe.",
      route: "/orders",
      routeLabel: "Open orders",
    },
    topRestaurants: {
      title: "Top restaurants",
      description:
        "Best performing restaurants by delivered revenue in this timeframe.",
      route: "/restaurants",
      routeLabel: "Open restaurants",
    },
    restaurantActivity: {
      title: "Restaurant activity",
      description: "Live restaurant operating state and quality gaps.",
      route: "/restaurants",
      routeLabel: "Open restaurants",
    },
    topItems: {
      title: "Top items",
      description: "Best selling delivered items in this timeframe.",
      route: "/reports",
      routeLabel: "Open reports",
    },
    attention: {
      title: "Health alerts",
      description: "All active and inactive dashboard health checks.",
      route: "/reports",
      routeLabel: "Open reports",
    },
  }
  const renderDrawerContent = () => {
    if (!drawer) return null
    if (drawer === "restaurants") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DashboardDrawerRow
              title="Visible"
              value={formatDashboardNumber(restaurants.length)}
            />
            <DashboardDrawerRow
              title="Online"
              value={formatDashboardNumber(onlineRestaurants.length)}
            />
            <DashboardDrawerRow
              title="Media gaps"
              value={formatDashboardNumber(restaurantsMissingMedia.length)}
            />
          </div>
          <div className="space-y-2">
            {restaurants.slice(0, 12).map((restaurant) => (
              <DashboardDrawerRow
                key={restaurant.id}
                title={restaurant.name}
                description={`${restaurant.liveOrders} live orders - ${restaurant.lateOrders} late - ${restaurant.averageRating.toFixed(1)} rating`}
                badge={
                  <Badge variant={restaurant.isOnline ? "default" : "outline"}>
                    {restaurant.isOnline ? "Online" : "Offline"}
                  </Badge>
                }
              />
            ))}
          </div>
        </div>
      )
    }
    if (drawer === "liveOrders") {
      const liveOrderRows = orders.filter((order) =>
        [
          "Placed",
          "Accepted",
          "Preparing",
          "ReadyForPickup",
          "PickedUp",
        ].includes(order.status)
      )
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DashboardDrawerRow
              title="Live"
              value={formatDashboardNumber(liveOrders)}
            />
            <DashboardDrawerRow
              title="Ready"
              value={formatDashboardNumber(
                ordersQuery.data?.summary?.readyForPickup
              )}
            />
            <DashboardDrawerRow
              title="Unassigned"
              value={formatDashboardNumber(
                ordersQuery.data?.summary?.unassignedReadyOrders
              )}
            />
          </div>
          <div className="space-y-2">
            {liveOrderRows.slice(0, 15).map((order) => (
              <DashboardDrawerRow
                key={order.id}
                title={`${order.orderNumber} - ${order.restaurantName}`}
                description={`${order.customerName} - ${order.status} - rider: ${order.riderName || "Unassigned"}`}
                value={formatDashboardCurrency(order.total)}
                badge={
                  order.isLate ? (
                    <Badge variant="destructive">Late</Badge>
                  ) : undefined
                }
              />
            ))}
            {liveOrderRows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No live orders in the loaded queue.
              </div>
            ) : null}
          </div>
        </div>
      )
    }
    if (drawer === "riders") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DashboardDrawerRow
              title="Active riders"
              value={formatDashboardNumber(ridersSummary.activeRiders)}
            />
            <DashboardDrawerRow
              title="Available riders"
              value={formatDashboardNumber(ridersSummary.availableRiders)}
            />
            <DashboardDrawerRow
              title="Live trips"
              value={formatDashboardNumber(ridersSummary.liveTrips)}
            />
            <DashboardDrawerRow
              title="Avg delivery"
              value={`${Math.round(ridersSummary.averageDeliveryMinutes ?? 0)} min`}
            />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-medium">
              {riderCapacityRisk
                ? "Capacity pressure detected"
                : "Capacity looks stable"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current rule: capacity pressure appears when live orders are
              roughly three times available riders.
            </p>
          </div>
        </div>
      )
    }
    if (drawer === "lateOrders") {
      return (
        <div className="space-y-2">
          {lateOrders.map((order) => (
            <DashboardDrawerRow
              key={order.id}
              title={`${order.orderNumber} - ${order.restaurantName}`}
              description={`${order.lateReason || "Late order"} - ${formatDashboardNumber(order.lateMinutes)} min - ${order.status}`}
              value={order.riderName || "No rider"}
              badge={
                <Badge
                  variant={
                    order.lateTone === "critical" ? "destructive" : "outline"
                  }
                >
                  {order.lateTone}
                </Badge>
              }
            />
          ))}
          {lateOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No late orders in the loaded queue.
            </div>
          ) : null}
        </div>
      )
    }
    if (drawer === "finance") {
      return (
        <div className="space-y-4">
          {[
            ["Delivered revenue", data?.overview.deliveredRevenue],
            ["Platform commission", data?.overview.platformCommission],
            ["Delivery fees", data?.overview.deliveryFees],
            ["Platform gross income", data?.overview.platformGrossIncome],
            [
              "Platform promo expense",
              data?.sales.platformMargin.platformDiscountCost,
            ],
            ["Rider payroll expense", data?.overview.riderPayrollExpense],
            ["Estimated margin", data?.overview.estimatedPlatformMargin],
            ["Restaurant payable", data?.overview.restaurantPayable],
          ].map(([label, value]) => (
            <DashboardDrawerRow
              key={label as string}
              title={label as string}
              value={formatDashboardCurrency(value as number)}
            />
          ))}
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Reconciliation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.reconciliation.message ?? "Finance data is loading."}
            </p>
          </div>
        </div>
      )
    }
    if (drawer === "orderStatus") {
      return (
        <div className="space-y-2">
          {(data?.orders.statusDistribution ?? []).map((row) => (
            <DashboardDrawerRow
              key={row.status}
              title={row.status}
              description={`${formatDashboardCurrency(row.revenue)} delivered revenue`}
              value={formatDashboardNumber(row.count)}
            />
          ))}
        </div>
      )
    }
    if (drawer === "topRestaurants") {
      return (
        <div className="space-y-2">
          {topRestaurants.map((restaurant, index) => (
            <DashboardDrawerRow
              key={restaurant.restaurantId || restaurant.name}
              title={`${index + 1}. ${restaurant.name}`}
              description={`${formatDashboardNumber(restaurant.deliveredOrders)} delivered orders - AOV ${formatDashboardCurrency(restaurant.averageOrderValue)}`}
              value={formatDashboardCurrency(restaurant.deliveredRevenue)}
            />
          ))}
        </div>
      )
    }
    if (drawer === "restaurantActivity") {
      return (
        <div className="space-y-4">
          {offlineRestaurantsWithLiveOrders.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Offline with live orders</p>
              {offlineRestaurantsWithLiveOrders.map((restaurant) => (
                <DashboardDrawerRow
                  key={restaurant.id}
                  title={restaurant.name}
                  description={`${restaurant.liveOrders} live orders while offline`}
                  badge={<Badge variant="destructive">Needs review</Badge>}
                />
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium">Media quality</p>
            {restaurantsMissingMedia.slice(0, 12).map((restaurant) => (
              <DashboardDrawerRow
                key={restaurant.id}
                title={restaurant.name}
                description={`${restaurant.hasLogo ? "Logo ok" : "Missing logo"} - ${restaurant.hasCoverImage ? "Cover ok" : "Missing cover"}`}
                badge={<Badge variant="outline">Media gap</Badge>}
              />
            ))}
            {restaurantsMissingMedia.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No restaurant media gaps found in loaded restaurants.
              </div>
            ) : null}
          </div>
        </div>
      )
    }
    if (drawer === "topItems") {
      return (
        <div className="space-y-2">
          {topItems.map((item, index) => (
            <DashboardDrawerRow
              key={item.itemId || item.name}
              title={`${index + 1}. ${item.name}`}
              description={`${item.categoryName || "Uncategorized"} - ${formatDashboardNumber(item.orders)} orders`}
              value={`${formatDashboardNumber(item.quantity)} sold`}
            />
          ))}
        </div>
      )
    }
    return (
      <div className="space-y-2">
        {healthAlerts.map((alert) => (
          <DashboardDrawerRow
            key={alert.title}
            title={alert.title}
            description={alert.description}
            value={formatDashboardNumber(alert.count)}
            badge={
              <Badge variant={alert.count > 0 ? "destructive" : "outline"}>
                {alert.count > 0 ? "Active" : "Clear"}
              </Badge>
            }
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Dashboard overview
            </h1>
            <Badge variant="outline">Timeframe: {timeframeLabel}</Badge>
            <Badge variant="secondary">Live ops now</Badge>
            <Badge variant="outline">
              Updated: {formatDashboardDateTime(lastUpdatedAt)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live operating picture for restaurants, orders, riders, alerts, best
            sellers, and platform health.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-md border px-3">
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              aria-label="Toggle dashboard auto refresh"
            />
            <span className="text-sm">Auto refresh</span>
          </div>
          <Button
            variant="outline"
            onClick={refreshDashboard}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            Refresh
          </Button>
          <Button variant="outline" onClick={() => navigate("/reports")}>
            View reports
          </Button>
          <Button onClick={() => navigate("/orders")}>Review orders</Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-2 md:grid-cols-2 xl:grid-cols-[0.85fr_0.7fr_0.7fr_auto_auto]">
          <div className="space-y-2">
            <Label>Dashboard timeframe</Label>
            <Select
              value={preset}
              onValueChange={(value) => setPreset(value as AdminReportsPreset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7Days">Last 7 days</SelectItem>
                <SelectItem value="last30Days">Last 30 days</SelectItem>
                <SelectItem value="last90Days">Last 90 days</SelectItem>
                <SelectItem value="thisMonth">This month</SelectItem>
                <SelectItem value="lastMonth">Last month</SelectItem>
                <SelectItem value="lifetime">Lifetime</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From</Label>
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              disabled={!isCustomRange}
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              disabled={!isCustomRange}
              className="h-10"
            />
          </div>
          <div className="flex items-end">
            <Badge
              variant="outline"
              className="flex h-10 max-w-full items-center px-3 text-sm"
            >
              {dateRangeText}
            </Badge>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={resetFilters}
            >
              <RefreshCcw className="size-4" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Review live orders", "/orders"],
          ["Assign riders", "/riders"],
          ["Open payments", "/payments"],
          ["Full reports", "/reports"],
        ].map(([label, path]) => (
          <Button
            key={path}
            type="button"
            variant="outline"
            className="justify-start"
            onClick={() => navigate(path)}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading live dashboard...
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {liveMetrics.map((metric) => (
          <Card
            key={metric.label}
            role={metric.drawer ? "button" : undefined}
            tabIndex={metric.drawer ? 0 : undefined}
            onClick={() => {
              if (metric.drawer) setDrawer(metric.drawer)
            }}
            onKeyDown={(event) => {
              if (!metric.drawer) return
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                setDrawer(metric.drawer)
              }
            }}
            className={
              metric.drawer
                ? "cursor-pointer transition hover:bg-muted/30"
                : undefined
            }
          >
            <CardContent className="flex items-start justify-between gap-4 pt-2">
              <div>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {metric.helper}
                </p>
              </div>
              <div className={`rounded-lg p-2 ${metric.tone}`}>
                <metric.icon className="size-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Order status</CardTitle>
            <CardDescription>
              Order mix for the selected dashboard timeframe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.orders.statusDistribution ?? []).map((row) => (
              <button
                key={row.status}
                type="button"
                onClick={() => setDrawer("orderStatus")}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition hover:bg-muted/40"
              >
                <div>
                  <p className="text-sm font-medium">{row.status}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDashboardCurrency(row.revenue)} delivered revenue
                  </p>
                </div>
                <Badge variant="outline">
                  {formatDashboardNumber(row.count)}
                </Badge>
              </button>
            ))}
            {data?.orders.statusDistribution.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No order status data for this timeframe.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Best selling restaurants</CardTitle>
            <CardDescription>
              Top restaurants by delivered revenue in this timeframe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topRestaurants.map((restaurant, index) => (
              <button
                key={restaurant.restaurantId || restaurant.name}
                type="button"
                onClick={() => setDrawer("topRestaurants")}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {index + 1}. {restaurant.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDashboardNumber(restaurant.deliveredOrders)} orders,
                    AOV {formatDashboardCurrency(restaurant.averageOrderValue)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold">
                  {formatDashboardCurrency(restaurant.deliveredRevenue)}
                </span>
              </button>
            ))}
            {topRestaurants.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No delivered restaurant sales yet.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Restaurant activity</CardTitle>
            <CardDescription>
              Live now: visible restaurants and current operating state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {restaurants.slice(0, 6).map((restaurant) => (
              <button
                key={restaurant.id}
                type="button"
                onClick={() => setDrawer("restaurantActivity")}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {restaurant.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {restaurant.liveOrders} live, {restaurant.lateOrders} late
                  </p>
                </div>
                <Badge
                  variant={restaurant.isOnline ? "default" : "outline"}
                  className="shrink-0"
                >
                  {restaurant.isOnline ? "Online" : "Offline"}
                </Badge>
              </button>
            ))}
            {restaurants.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No visible restaurants found.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Top 5 items</CardTitle>
            <CardDescription>
              Best selling delivered items in this timeframe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topItems.map((item, index) => (
              <button
                key={item.itemId || item.name}
                type="button"
                onClick={() => setDrawer("topItems")}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {index + 1}. {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.categoryName || "Uncategorized"} -{" "}
                    {formatDashboardNumber(item.orders)} orders
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold">
                    {formatDashboardNumber(item.quantity)} sold
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDashboardCurrency(item.revenue)}
                  </p>
                </div>
              </button>
            ))}
            {topItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No delivered item sales yet.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rider health</CardTitle>
            <CardDescription>
              Live now: availability, live trips, and delivery performance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ["Active riders", ridersSummary.activeRiders],
              ["Available riders", ridersSummary.availableRiders],
              ["Live trips", ridersSummary.liveTrips],
              ["Delivered trips", ridersSummary.deliveredTrips],
              [
                "Avg delivery time",
                `${Math.round(ridersSummary.averageDeliveryMinutes ?? 0)} min`,
              ],
            ].map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => setDrawer("riders")}
                className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left transition hover:bg-muted/40"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-semibold">
                  {typeof value === "number"
                    ? formatDashboardNumber(value)
                    : value}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Late alerts</CardTitle>
            <CardDescription>
              Live now: orders that need operational attention.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {lateOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => setDrawer("lateOrders")}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {order.orderNumber} - {order.restaurantName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order.lateReason || "Late order"} -{" "}
                    {formatDashboardNumber(order.lateMinutes)} min
                  </p>
                </div>
                <Badge
                  variant={
                    order.lateTone === "critical" ? "destructive" : "outline"
                  }
                >
                  {order.status}
                </Badge>
              </button>
            ))}
            {lateOrders.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No late order in the loaded queue.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Platform finance pulse</CardTitle>
            <CardDescription>
              Finance snapshot for the selected dashboard timeframe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Delivered revenue</span>
              <span className="font-medium">
                {formatDashboardCurrency(data?.overview.deliveredRevenue)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Estimated margin</span>
              <span
                className={
                  marginIsNegative
                    ? "font-semibold text-rose-700"
                    : "font-semibold text-emerald-700"
                }
              >
                {formatDashboardCurrency(
                  data?.overview.estimatedPlatformMargin
                )}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Restaurant payable</span>
              <span className="font-medium">
                {formatDashboardCurrency(data?.overview.restaurantPayable)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Rider payroll</span>
              <span className="font-medium">
                {formatDashboardCurrency(data?.overview.riderPayrollExpense)}
              </span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/reports")}
            >
              View full finance report
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Attention queue</span>
              <Badge
                variant={
                  criticalHealthAlertCount > 0 ? "destructive" : "outline"
                }
              >
                {criticalHealthAlertCount} active
              </Badge>
            </CardTitle>
            <CardDescription>
              Smart health alerts from live operations and selected timeframe
              finance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {criticalHealthAlertCount === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                All dashboard health checks are clear.
              </div>
            ) : null}
            {healthAlerts.map((item) => (
              <div
                key={item.title}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={item.tone as "outline" | "destructive"}>
                    {item.count}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawer(item.drawer)}
                  >
                    Details
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(item.path)}
                  >
                    Route
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Sheet
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null)
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {drawer ? drawerMeta[drawer].title : "Dashboard details"}
            </SheetTitle>
            <SheetDescription>
              {drawer
                ? drawerMeta[drawer].description
                : "Detailed dashboard context."}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Timeframe: {timeframeLabel}</Badge>
              <Badge variant="secondary">{dateRangeText}</Badge>
            </div>
            {renderDrawerContent()}
            {drawer ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => navigate(drawerMeta[drawer].route)}
              >
                {drawerMeta[drawer].routeLabel}
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function ModulePage({ config }: { config: ModuleConfig }) {
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <config.icon className="size-4" />
            </div>
            <Badge variant="outline">Admin module</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {config.title}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {config.description}
          </p>
        </div>
        <Button>
          <Plus className="size-4" />
          {config.primaryAction}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {config.metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="pt-2">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Admin responsibilities</CardTitle>
            <CardDescription>
              Main work this module will handle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {config.capabilities.map((capability) => (
              <div
                key={capability}
                className="flex items-center gap-3 rounded-lg border bg-background p-3"
              >
                <ShieldCheck className="size-4 text-emerald-600" />
                <span className="text-sm font-medium">{capability}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Implementation queue</CardTitle>
            <CardDescription>
              Screens and controls planned for this route.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {config.queue.map((item, index) => (
              <div key={item}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                      {index + 1}
                    </div>
                    <span className="text-sm font-medium">{item}</span>
                  </div>
                  <Badge variant="outline">Queued</Badge>
                </div>
                {index < config.queue.length - 1 ? (
                  <Separator className="mt-3" />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

void ModulePage

function RouteLoading() {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading module...
      </div>
    </div>
  )
}

function RouteErrorBoundary() {
  const error = useRouteError()
  const message =
    error instanceof Error
      ? error.message
      : "Something went wrong while rendering this route."

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Route crashed</CardTitle>
          <CardDescription>
            Reload the admin panel or return to the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            {message}
          </div>
          <Button onClick={() => window.location.assign("/")}>
            Back to Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

const router = createBrowserRouter([
  {
    path: "/auth/signin",
    element: <SignInPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/",
    element: <AdminLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: "users",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <UsersPage />
          </React.Suspense>
        ),
      },
      {
        path: "restaurants",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <RestaurantsPage />
          </React.Suspense>
        ),
      },
      {
        path: "orders",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <OrdersPage />
          </React.Suspense>
        ),
      },
      {
        path: "riders",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <RidersPage />
          </React.Suspense>
        ),
      },
      {
        path: "live-map",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <LiveMapPage />
          </React.Suspense>
        ),
      },
      {
        path: "payments",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <PaymentsPage />
          </React.Suspense>
        ),
      },
      {
        path: "coupons",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <CouponsPage />
          </React.Suspense>
        ),
      },
      {
        path: "cms",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <CmsPage />
          </React.Suspense>
        ),
      },
      {
        path: "categories",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <CategoriesPage />
          </React.Suspense>
        ),
      },
      {
        path: "reviews",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <ReviewsPage />
          </React.Suspense>
        ),
      },
      {
        path: "support",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <SupportPage />
          </React.Suspense>
        ),
      },
      {
        path: "reports",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <ReportsPage />
          </React.Suspense>
        ),
      },
      {
        path: "notifications",
        element: <NotificationsPage />,
      },
      {
        path: "operations",
        element: (
          <React.Suspense fallback={<RouteLoading />}>
            <OperationsHealthPage />
          </React.Suspense>
        ),
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
])

export default function App() {
  return (
    <AdminAuthProvider>
      <RouterProvider router={router} />
    </AdminAuthProvider>
  )
}
