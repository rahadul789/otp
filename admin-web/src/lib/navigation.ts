import type { LucideIcon } from "lucide-react"
import {
  BarChart3,
  Bell,
  CreditCard,
  HeartPulse,
  Headphones,
  Image,
  LayoutDashboard,
  Map,
  Settings,
  ShoppingBag,
  Star,
  Store,
  Tags,
  TicketPercent,
  Truck,
  Users,
} from "lucide-react"

export type AdminNavigationItem = {
  title: string
  to: string
  icon: LucideIcon
  badgeKey?: "pendingOrders" | "restaurantApprovals" | "complaints"
}

export type AdminNavigationGroup = {
  label: string
  items: AdminNavigationItem[]
}

export const adminSidebarGroups: AdminNavigationGroup[] = [
  {
    label: "Platform",
    items: [
      {
        title: "Dashboard",
        to: "/",
        icon: LayoutDashboard,
      },
      {
        title: "Users",
        to: "/users",
        icon: Users,
      },
      {
        title: "Restaurants",
        to: "/restaurants",
        icon: Store,
        badgeKey: "restaurantApprovals",
      },
      {
        title: "Orders",
        to: "/orders",
        icon: ShoppingBag,
        badgeKey: "pendingOrders",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Riders / Delivery",
        to: "/riders",
        icon: Truck,
      },
      {
        title: "Live Map",
        to: "/live-map",
        icon: Map,
      },
      {
        title: "Payments",
        to: "/payments",
        icon: CreditCard,
      },
      {
        title: "Coupons & Offers",
        to: "/coupons",
        icon: TicketPercent,
      },
      {
        title: "Content / CMS",
        to: "/cms",
        icon: Image,
      },
      {
        title: "Food Categories",
        to: "/categories",
        icon: Tags,
      },
    ],
  },
  {
    label: "Trust",
    items: [
      {
        title: "Reviews",
        to: "/reviews",
        icon: Star,
      },
      {
        title: "Complaints / Support",
        to: "/support",
        icon: Headphones,
        badgeKey: "complaints",
      },
      {
        title: "Reports",
        to: "/reports",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        title: "Operations Health",
        to: "/operations",
        icon: HeartPulse,
      },
      {
        title: "Notifications",
        to: "/notifications",
        icon: Bell,
      },
      {
        title: "Settings",
        to: "/settings",
        icon: Settings,
      },
    ],
  },
]

export const adminRouteTitleByPath = Object.fromEntries(
  adminSidebarGroups.flatMap((group) =>
    group.items.map((item) => [item.to, item.title] as const)
  )
)
