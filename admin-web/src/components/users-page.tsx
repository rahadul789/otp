import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Ban,
  ChevronDown,
  CheckCircle2,
  Eye,
  Loader2,
  Lock,
  MoreHorizontal,
  RotateCcw,
  Search,
  ShieldCheck,
  Smartphone,
  TableConfig,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import {
  getAdminCustomer,
  listAdminCustomerOrders,
  listAdminCustomers,
  deleteAdminRestaurantReview,
  reviewCustomerAccountRequest,
  restoreAdminRestaurantReview,
  updateAdminCustomerStatus,
  type AdminCustomerDetails,
  type AdminCustomerOrderHistoryItem,
  type AdminCustomerSummary,
  type AdminRestaurantOrderDateFilterPreset,
} from "@/lib/admin-api"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type CustomerStatusFilter = "all" | "active" | "suspended" | "locked"
type CustomerRequestFilter =
  | "all"
  | "pending"
  | "cancelled"
  | "reviewed"
  | "completed"
  | "none"
type CustomerSort = "newest" | "recentLogin" | "mostOrders" | "highestSpend"
type CustomerStatus = AdminCustomerSummary["status"]
type CustomerStatusTargetCustomer = Pick<
  AdminCustomerSummary,
  "id" | "fullName" | "status"
>
type CustomerStatusTarget = {
  customer: CustomerStatusTargetCustomer
  status: CustomerStatus
}
type CustomerOrderStatusFilter = "all" | "live" | "delivered" | "cancelled"
type CustomerOrderSort = "newest" | "oldest" | "highestValue"
type CustomerOrderPreset = Extract<
  AdminRestaurantOrderDateFilterPreset,
  "today" | "last7Days" | "last30Days" | "thisMonth"
>
type UserColumnKey =
  | "user"
  | "status"
  | "orders"
  | "spend"
  | "account"
  | "lastLogin"

const USER_TABLE_COLUMNS: Array<{
  key: UserColumnKey
  label: string
}> = [
  { key: "user", label: "User" },
  { key: "status", label: "Status" },
  { key: "orders", label: "Orders" },
  { key: "spend", label: "Spend" },
  { key: "account", label: "Account" },
  { key: "lastLogin", label: "Last login" },
]

const defaultUserColumnVisibility: Record<UserColumnKey, boolean> = {
  user: true,
  status: true,
  orders: true,
  spend: true,
  account: true,
  lastLogin: true,
}

function formatDate(value?: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleString()
}

function formatCurrency(value: number) {
  return `Tk ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString()}`
}

function getInitials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "CU"
  )
}

function getCustomerStatusBadgeClass(status: string) {
  if (status === "active")
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "suspended")
    return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-rose-200 bg-rose-50 text-rose-700"
}

function getOrderStatusBadgeClass(status: string) {
  if (status === "Delivered")
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (["New", "Accepted", "Preparing"].includes(status)) {
    return "border-sky-200 bg-sky-50 text-sky-700"
  }
  if (["ReadyForPickup", "PickedUp"].includes(status)) {
    return "border-violet-200 bg-violet-50 text-violet-700"
  }
  return "border-rose-200 bg-rose-50 text-rose-700"
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-72 text-right font-medium">{value}</span>
    </div>
  )
}

function CustomerActionsMenu({
  customer,
  isPending,
  onView,
  onStatus,
}: {
  customer: AdminCustomerSummary
  isPending: boolean
  onView: () => void
  onStatus: (status: CustomerStatus) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="data-[state=open]:bg-muted"
          aria-label={`Open actions for ${customer.fullName}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={onView}>
          <Eye className="size-4" />
          View details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isPending || customer.status === "active"}
          onClick={() => onStatus("active")}
        >
          <UserCheck className="size-4" />
          Activate
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isPending || customer.status === "suspended"}
          onClick={() => onStatus("suspended")}
        >
          <Ban className="size-4" />
          Suspend
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isPending || customer.status === "locked"}
          onClick={() => onStatus("locked")}
        >
          <Lock className="size-4" />
          Lock
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CustomerStatusDialog({
  target,
  onOpenChange,
}: {
  target: CustomerStatusTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = React.useState("")
  const mutation = useMutation({
    mutationFn: updateAdminCustomerStatus,
    onSuccess: () => {
      toast.success("Customer status updated.")
      setNote("")
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ["admin-customers"] })
      if (target?.customer.id) {
        void queryClient.invalidateQueries({
          queryKey: ["admin-customer-details", target.customer.id],
        })
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Status update failed."
      )
    },
  })

  React.useEffect(() => {
    if (!target) setNote("")
  }, [target])

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update customer status</DialogTitle>
          <DialogDescription>
            {target?.customer.fullName} will be set to {target?.status}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="customer-status-note">Admin note</Label>
          <Textarea
            id="customer-status-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Reason or internal note"
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
                customerId: target.customer.id,
                status: target.status,
                note,
              })
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            Save status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CustomerDetailsSheet({
  customerId,
  open,
  onOpenChange,
  onStatus,
}: {
  customerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatus: (
    customer: CustomerStatusTargetCustomer,
    status: CustomerStatus
  ) => void
}) {
  const queryClient = useQueryClient()
  const [preset, setPreset] = React.useState<CustomerOrderPreset>("last7Days")
  const [requestNote, setRequestNote] = React.useState("")
  const detailsQuery = useQuery({
    queryKey: ["admin-customer-details", customerId, preset],
    queryFn: () => getAdminCustomer(customerId, { preset }),
    enabled: open && Boolean(customerId),
  })
  const details = detailsQuery.data
  const accountRequestMutation = useMutation({
    mutationFn: reviewCustomerAccountRequest,
    onSuccess: () => {
      toast.success("Account request reviewed.")
      setRequestNote("")
      void queryClient.invalidateQueries({
        queryKey: ["admin-customer-details", customerId],
      })
      void queryClient.invalidateQueries({ queryKey: ["admin-customers"] })
      void queryClient.invalidateQueries({
        queryKey: ["admin-customer-account-requests"],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Account request review failed."
      )
    },
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full max-w-none! flex-col overflow-hidden p-0 sm:max-w-3xl! md:max-w-7xl!">
        <SheetHeader className="border-b">
          <SheetTitle>{details?.fullName ?? "Customer details"}</SheetTitle>
          <SheetDescription>
            Profile, orders, devices, account request, and admin audit trail.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          {detailsQuery.isPending ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading customer details...
            </div>
          ) : details ? (
            <div className="space-y-5 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-12">
                    {details.profileImageUrl ? (
                      <img
                        src={details.profileImageUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <AvatarFallback>
                        {getInitials(details.fullName)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{details.fullName}</p>
                      <Badge
                        variant="outline"
                        className={getCustomerStatusBadgeClass(details.status)}
                      >
                        {details.status}
                      </Badge>
                      {details.accountRequest?.status === "pending" ? (
                        <Badge variant="outline">Request pending</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {details.phone || "No phone"} -{" "}
                      {details.email || "No email"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={preset}
                    onValueChange={(value) =>
                      setPreset(value as CustomerOrderPreset)
                    }
                  >
                    <SelectTrigger className="w-full sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="last7Days">Last 7 days</SelectItem>
                      <SelectItem value="last30Days">Last 30 days</SelectItem>
                      <SelectItem value="thisMonth">This month</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={preset === "last7Days"}
                    onClick={() => setPreset("last7Days")}
                  >
                    <RotateCcw className="size-4" />
                    Reset filter
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label="Lifetime spend"
                  value={formatCurrency(details.lifetime.deliveredSpend)}
                  helper="Delivered orders"
                />
                <StatCard
                  label="Window spend"
                  value={formatCurrency(details.overview.deliveredSpend)}
                  helper="Selected timeframe"
                />
                <StatCard
                  label="Total orders"
                  value={details.lifetime.totalOrders}
                  helper={`${details.lifetime.liveOrders} live`}
                />
                <StatCard
                  label="Delivered"
                  value={details.overview.deliveredOrders}
                  helper="In selected timeframe"
                />
                <StatCard
                  label="Reviews"
                  value={details.overview.reviewsGiven}
                  helper={`${details.overview.averageReviewRating.toFixed(1)} avg`}
                />
                <StatCard
                  label="Devices"
                  value={details.account.activePushTokensCount}
                  helper={`${details.account.pushTokensCount} total`}
                />
              </div>

              <Tabs defaultValue="overview" className="gap-4">
                <TabsList className="flex h-auto w-full flex-wrap justify-start">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="orders">Orders</TabsTrigger>
                  <TabsTrigger value="reviews">Reviews</TabsTrigger>
                  <TabsTrigger value="account">Account</TabsTrigger>
                  <TabsTrigger value="devices">Devices</TabsTrigger>
                  <TabsTrigger value="requests">Requests</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-3">
                    <Card>
                      <CardHeader>
                        <CardTitle>Admin controls</CardTitle>
                        <CardDescription>
                          Activate, suspend, or lock this customer.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-2 sm:grid-cols-3">
                        <Button
                          variant="outline"
                          disabled={details.status === "active"}
                          onClick={() => onStatus(details, "active")}
                        >
                          <UserCheck className="size-4" />
                          Activate
                        </Button>
                        <Button
                          variant="outline"
                          disabled={details.status === "suspended"}
                          onClick={() => onStatus(details, "suspended")}
                        >
                          <Ban className="size-4" />
                          Suspend
                        </Button>
                        <Button
                          variant="outline"
                          disabled={details.status === "locked"}
                          onClick={() => onStatus(details, "locked")}
                        >
                          <Lock className="size-4" />
                          Lock
                        </Button>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Profile</CardTitle>
                        <CardDescription>
                          Contact and login signals.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        <InfoRow label="Phone" value={details.phone || "N/A"} />
                        <InfoRow label="Email" value={details.email || "N/A"} />
                        <InfoRow
                          label="Providers"
                          value={details.authProviders.join(", ") || "Phone"}
                        />
                        <InfoRow
                          label="Last login"
                          value={formatDate(details.lastLoginAt)}
                        />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Top restaurants</CardTitle>
                        <CardDescription>
                          Delivered spend by restaurant.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {details.topRestaurants.map((restaurant) => (
                          <div
                            key={restaurant.restaurantId}
                            className="rounded-lg border p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-medium">
                                {restaurant.restaurantName}
                              </p>
                              <Badge variant="outline">
                                {formatCurrency(restaurant.spend)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {restaurant.deliveredOrders} delivered /{" "}
                              {restaurant.orders} total
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Last order {formatDate(restaurant.lastOrderedAt)}
                            </p>
                          </div>
                        ))}
                        {details.topRestaurants.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                            No restaurant spend yet.
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="orders">
                  <CustomerOrdersTab customer={details} />
                </TabsContent>

                <TabsContent value="reviews">
                  <CustomerReviewsTab details={details} />
                </TabsContent>

                <TabsContent value="account" className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Saved locations</CardTitle>
                        <CardDescription>
                          Customer delivery address book.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {details.savedLocations.map((location) => (
                          <div
                            key={location.id}
                            className="rounded-lg border p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{location.label}</p>
                              {location.isDefault ? (
                                <Badge variant="outline">Default</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {location.address}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Last used {formatDate(location.lastUsedAt)}
                            </p>
                          </div>
                        ))}
                        {details.savedLocations.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                            No saved locations.
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Notifications</CardTitle>
                        <CardDescription>
                          Preferences and recent notifications.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        <InfoRow
                          label="Order updates"
                          value={
                            details.notificationSettings.orderUpdates
                              ? "On"
                              : "Off"
                          }
                        />
                        <InfoRow
                          label="Restaurant status"
                          value={
                            details.notificationSettings.restaurantStatus
                              ? "On"
                              : "Off"
                          }
                        />
                        <InfoRow
                          label="Review replies"
                          value={
                            details.notificationSettings.reviewReplies
                              ? "On"
                              : "Off"
                          }
                        />
                        <div className="space-y-2 pt-2">
                          {details.recentNotifications.map(
                            (notification, index) => (
                              <div
                                key={`${notification.title}-${index}`}
                                className="rounded-lg border p-3"
                              >
                                <div className="font-medium">
                                  {notification.title}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {notification.description}
                                </p>
                              </div>
                            )
                          )}
                          {details.recentNotifications.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
                              No recent notifications.
                            </div>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="devices">
                  <Card>
                    <CardHeader>
                      <CardTitle>Devices</CardTitle>
                      <CardDescription>
                        Push tokens and app/device metadata.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {details.devices.map((device) => (
                        <div
                          key={device.expoPushToken}
                          className="rounded-lg border p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Smartphone className="size-4 text-muted-foreground" />
                            <p className="font-medium">
                              {device.platform || "Device"}
                            </p>
                            {device.disabledAt ? (
                              <Badge variant="outline">Disabled</Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-emerald-200 bg-emerald-50 text-emerald-700"
                              >
                                Active
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 text-xs break-all text-muted-foreground">
                            {device.expoPushToken}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            App {device.appVersion || "N/A"} - Last seen{" "}
                            {formatDate(device.lastSeenAt)}
                          </p>
                        </div>
                      ))}
                      {details.devices.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                          No active device tokens.
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="requests">
                  <Card>
                    <CardHeader>
                      <CardTitle>Account request</CardTitle>
                      <CardDescription>
                        Customer deactivate/delete request review.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {details.accountRequest ? (
                        <>
                          <div className="grid gap-3 md:grid-cols-2">
                            <InfoRow
                              label="Type"
                              value={details.accountRequest.type ?? "N/A"}
                            />
                            <InfoRow
                              label="Status"
                              value={details.accountRequest.status ?? "N/A"}
                            />
                            <InfoRow
                              label="Requested"
                              value={formatDate(
                                details.accountRequest.requestedAt
                              )}
                            />
                            <InfoRow
                              label="Reviewed"
                              value={formatDate(
                                details.accountRequest.reviewedAt
                              )}
                            />
                          </div>
                          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                            {details.accountRequest.reason ||
                              "No reason provided."}
                          </div>
                          {details.accountRequest.status === "pending" ? (
                            <div className="space-y-3">
                              <Label htmlFor="account-request-note">
                                Review note
                              </Label>
                              <Textarea
                                id="account-request-note"
                                value={requestNote}
                                onChange={(event) =>
                                  setRequestNote(event.target.value)
                                }
                                placeholder="Optional message for customer"
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  disabled={accountRequestMutation.isPending}
                                  onClick={() =>
                                    accountRequestMutation.mutate({
                                      customerId: details.id,
                                      decision: "approve",
                                      reviewNote: requestNote,
                                    })
                                  }
                                >
                                  <CheckCircle2 className="size-4" />
                                  Approve request
                                </Button>
                                <Button
                                  variant="outline"
                                  disabled={accountRequestMutation.isPending}
                                  onClick={() =>
                                    accountRequestMutation.mutate({
                                      customerId: details.id,
                                      decision: "reject",
                                      reviewNote: requestNote,
                                    })
                                  }
                                >
                                  Reject request
                                </Button>
                              </div>
                            </div>
                          ) : null}
                          <div className="space-y-2">
                            {details.accountRequest.history.map(
                              (item, index) => (
                                <div
                                  key={index}
                                  className="rounded-lg border p-3"
                                >
                                  <div className="font-medium">
                                    {item.action}
                                  </div>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {item.note || "No note"}
                                  </p>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    {item.actorName || "Customer"} -{" "}
                                    {formatDate(item.createdAt)}
                                  </p>
                                </div>
                              )
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                          No account request for this customer.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="audit">
                  <Card>
                    <CardHeader>
                      <CardTitle>Admin audit log</CardTitle>
                      <CardDescription>
                        Customer moderation and status changes.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {details.auditLogs.map((log) => (
                        <div key={log.id} className="rounded-lg border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">{log.title}</div>
                            <Badge variant="outline">{log.action}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {log.description}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {log.actorName} - {formatDate(log.createdAt)}
                          </p>
                        </div>
                      ))}
                      {details.auditLogs.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                          No admin audit logs yet.
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Customer details are not available.
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function CustomerReviewsTab({ details }: { details: AdminCustomerDetails }) {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = React.useState<
    AdminCustomerDetails["recentReviews"][number] | null
  >(null)
  const deleteReviewMutation = useMutation({
    mutationFn: deleteAdminRestaurantReview,
    onSuccess: () => {
      toast.success("Review hidden.")
      setDeleteTarget(null)
      void queryClient.invalidateQueries({
        queryKey: ["admin-customer-details", details.id],
      })
      void queryClient.invalidateQueries({ queryKey: ["admin-customers"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-restaurants"] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Review delete failed."
      )
    },
  })
  const restoreReviewMutation = useMutation({
    mutationFn: restoreAdminRestaurantReview,
    onSuccess: () => {
      toast.success("Review restored.")
      void queryClient.invalidateQueries({
        queryKey: ["admin-customer-details", details.id],
      })
      void queryClient.invalidateQueries({ queryKey: ["admin-customers"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-restaurants"] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Review restore failed."
      )
    },
  })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Recent reviews</CardTitle>
          <CardDescription>
            Ratings this customer submitted after orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {details.recentReviews.map((review) => (
            <div
              key={review.id}
              className={
                review.isHidden
                  ? "rounded-lg border border-dashed bg-muted/40 p-3"
                  : "rounded-lg border p-3"
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{review.restaurantName}</p>
                    {review.isHidden ? (
                      <Badge variant="outline">Hidden</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(review.createdAt)}
                  </p>
                  {review.hiddenAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Hidden at {formatDate(review.hiddenAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{review.rating.toFixed(1)}</Badge>
                  {review.isHidden ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoreReviewMutation.isPending}
                      onClick={() =>
                        restoreReviewMutation.mutate({
                          restaurantId: review.restaurantId,
                          reviewId: review.id,
                        })
                      }
                    >
                      Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteTarget(review)}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {review.comment || "No comment"}
              </p>
              {review.ownerReplyMessage ? (
                <p className="mt-2 text-sm">
                  Owner: {review.ownerReplyMessage}
                </p>
              ) : null}
            </div>
          ))}
          {details.recentReviews.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No reviews yet.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete review</DialogTitle>
            <DialogDescription>
              This review will be hidden from public ratings, and the action
              will stay in the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || deleteReviewMutation.isPending}
              onClick={() => {
                if (!deleteTarget) return
                deleteReviewMutation.mutate({
                  restaurantId: deleteTarget.restaurantId,
                  reviewId: deleteTarget.id,
                })
              }}
            >
              {deleteReviewMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CustomerOrdersTab({ customer }: { customer: AdminCustomerDetails }) {
  const [preset, setPreset] = React.useState<CustomerOrderPreset>("last7Days")
  const [status, setStatus] = React.useState<CustomerOrderStatusFilter>("all")
  const [restaurantId, setRestaurantId] = React.useState("all")
  const [sortBy, setSortBy] = React.useState<CustomerOrderSort>("newest")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const debouncedSearch = useDebouncedValue(search, 300)
  const ordersQuery = useQuery({
    queryKey: [
      "admin-customer-orders",
      customer.id,
      preset,
      status,
      restaurantId,
      sortBy,
      debouncedSearch,
      page,
    ],
    queryFn: () =>
      listAdminCustomerOrders(customer.id, {
        preset,
        status,
        restaurantId: restaurantId === "all" ? undefined : restaurantId,
        sortBy,
        search: debouncedSearch,
        page,
        pageSize: 8,
      }),
  })
  const orders = ordersQuery.data?.items ?? []
  const hasFilters =
    search.trim() !== "" ||
    preset !== "last7Days" ||
    status !== "all" ||
    restaurantId !== "all" ||
    sortBy !== "newest"

  React.useEffect(() => {
    setPage(1)
  }, [preset, status, restaurantId, sortBy, debouncedSearch])

  return (
    <div className="space-y-4">
      <div className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_140px_150px_170px_150px_150px]">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search orders"
            className="pl-8"
          />
        </div>
        <Select
          value={preset}
          onValueChange={(value) => setPreset(value as CustomerOrderPreset)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="last7Days">Last 7 days</SelectItem>
            <SelectItem value="last30Days">Last 30 days</SelectItem>
            <SelectItem value="thisMonth">This month</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus(value as CustomerOrderStatusFilter)
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={restaurantId} onValueChange={setRestaurantId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All restaurants</SelectItem>
            {customer.orderRestaurants.map((restaurant) => (
              <SelectItem
                key={restaurant.restaurantId}
                value={restaurant.restaurantId}
              >
                {restaurant.restaurantName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) => setSortBy(value as CustomerOrderSort)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="highestValue">Highest value</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={!hasFilters}
          onClick={() => {
            setSearch("")
            setPreset("last7Days")
            setStatus("all")
            setRestaurantId("all")
            setSortBy("newest")
            setPage(1)
          }}
        >
          <RotateCcw className="size-4" />
          Reset filter
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Restaurant</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Delivered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order: AdminCustomerOrderHistoryItem) => (
              <TableRow key={order.id}>
                <TableCell>
                  <div className="font-medium">{order.orderNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(order.createdAt)}
                  </div>
                </TableCell>
                <TableCell>{order.restaurantName}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={getOrderStatusBadgeClass(order.status)}
                  >
                    {order.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div>{order.paymentMethod}</div>
                  <div className="text-xs text-muted-foreground">
                    {order.paymentStatus}
                  </div>
                </TableCell>
                <TableCell>{formatCurrency(order.total)}</TableCell>
                <TableCell>{formatDate(order.deliveredAt)}</TableCell>
              </TableRow>
            ))}
            {ordersQuery.isPending ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  No orders match this filter.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {ordersQuery.data?.page ?? page} of{" "}
          {ordersQuery.data?.pageCount ?? 1}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={page >= (ordersQuery.data?.pageCount ?? 1)}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export function UsersPage() {
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState<CustomerStatusFilter>("all")
  const [requestStatus, setRequestStatus] =
    React.useState<CustomerRequestFilter>("all")
  const [sortBy, setSortBy] = React.useState<CustomerSort>("newest")
  const [page, setPage] = React.useState(1)
  const [selectedCustomerId, setSelectedCustomerId] = React.useState("")
  const [statusTarget, setStatusTarget] =
    React.useState<CustomerStatusTarget | null>(null)
  const [columnVisibility, setColumnVisibility] = React.useState(
    defaultUserColumnVisibility
  )
  const debouncedSearch = useDebouncedValue(search, 350)
  const customersQuery = useQuery({
    queryKey: [
      "admin-customers",
      debouncedSearch,
      status,
      requestStatus,
      sortBy,
      page,
    ],
    queryFn: () =>
      listAdminCustomers({
        search: debouncedSearch,
        status,
        requestStatus,
        sortBy,
        page,
        pageSize: 12,
      }),
  })

  const customers = customersQuery.data?.items ?? []
  const summary = customersQuery.data?.summary ?? {}
  const visibleColumnCount =
    USER_TABLE_COLUMNS.filter((column) => columnVisibility[column.key]).length +
    1
  const hasFilters =
    search.trim() !== "" ||
    status !== "all" ||
    requestStatus !== "all" ||
    sortBy !== "newest"

  React.useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status, requestStatus, sortBy])

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <Users className="size-4" />
            </div>
            <Badge variant="outline">Core platform module</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Manage customer accounts, block or unlock access, review account
            requests, and inspect order/review activity.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total users"
          value={`${summary.total ?? customersQuery.data?.total ?? 0}`}
          helper="All customer accounts"
        />
        <StatCard
          label="Active"
          value={`${summary.active ?? 0}`}
          helper="Can place orders"
        />
        <StatCard
          label="Suspended"
          value={`${summary.suspended ?? 0}`}
          helper="Blocked by admin"
        />
        <StatCard
          label="Locked"
          value={`${summary.locked ?? 0}`}
          helper="Restricted account"
        />
        <StatCard
          label="Requests"
          value={`${summary.pendingRequests ?? 0}`}
          helper="Pending review"
        />
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Customer directory</CardTitle>
              <CardDescription>
                Search customers and review account health from one place.
              </CardDescription>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_150px_170px_170px_auto_auto]">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search users"
                  className="pl-8"
                />
              </div>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as CustomerStatusFilter)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={requestStatus}
                onValueChange={(value) =>
                  setRequestStatus(value as CustomerRequestFilter)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All requests</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="none">No request</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as CustomerSort)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="recentLogin">Recent login</SelectItem>
                  <SelectItem value="mostOrders">Most orders</SelectItem>
                  <SelectItem value="highestSpend">Highest spend</SelectItem>
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <TableConfig className="size-4" />
                    Columns
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  {USER_TABLE_COLUMNS.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.key}
                      checked={columnVisibility[column.key]}
                      onCheckedChange={(checked) =>
                        setColumnVisibility((current) => ({
                          ...current,
                          [column.key]: Boolean(checked),
                        }))
                      }
                    >
                      {column.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                disabled={!hasFilters}
                onClick={() => {
                  setSearch("")
                  setStatus("all")
                  setRequestStatus("all")
                  setSortBy("newest")
                  setPage(1)
                }}
              >
                <RotateCcw className="size-4" />
                Reset filter
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columnVisibility.user ? <TableHead>User</TableHead> : null}
                  {columnVisibility.status ? (
                    <TableHead>Status</TableHead>
                  ) : null}
                  {columnVisibility.orders ? (
                    <TableHead>Orders</TableHead>
                  ) : null}
                  {columnVisibility.spend ? (
                    <TableHead>Spend</TableHead>
                  ) : null}
                  {columnVisibility.account ? (
                    <TableHead>Account</TableHead>
                  ) : null}
                  {columnVisibility.lastLogin ? (
                    <TableHead>Last login</TableHead>
                  ) : null}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    {columnVisibility.user ? (
                      <TableCell>
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-3 text-left"
                          onClick={() => setSelectedCustomerId(customer.id)}
                        >
                          <Avatar className="size-9">
                            <AvatarFallback>
                              {getInitials(customer.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {customer.fullName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {customer.phone || customer.email || "No contact"}
                            </span>
                          </span>
                        </button>
                      </TableCell>
                    ) : null}
                    {columnVisibility.status ? (
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={getCustomerStatusBadgeClass(
                            customer.status
                          )}
                        >
                          {customer.status}
                        </Badge>
                      </TableCell>
                    ) : null}
                    {columnVisibility.orders ? (
                      <TableCell>
                        <div className="font-medium">
                          {customer.totalOrders}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {customer.liveOrders} live /{" "}
                          {customer.deliveredOrders} delivered
                        </div>
                      </TableCell>
                    ) : null}
                    {columnVisibility.spend ? (
                      <TableCell>
                        {formatCurrency(customer.deliveredSpend)}
                      </TableCell>
                    ) : null}
                    {columnVisibility.account ? (
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {customer.requestStatus ? (
                            <Badge variant="outline">
                              {customer.requestType} {customer.requestStatus}
                            </Badge>
                          ) : (
                            <Badge variant="outline">No request</Badge>
                          )}
                          {customer.hasPushToken ? (
                            <Badge variant="outline">Push</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                    {columnVisibility.lastLogin ? (
                      <TableCell>{formatDate(customer.lastLoginAt)}</TableCell>
                    ) : null}
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedCustomerId(customer.id)}
                        >
                          <Eye className="size-4" />
                          View
                        </Button>
                        <CustomerActionsMenu
                          customer={customer}
                          isPending={false}
                          onView={() => setSelectedCustomerId(customer.id)}
                          onStatus={(nextStatus) =>
                            setStatusTarget({ customer, status: nextStatus })
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {customersQuery.isPending ? (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumnCount}
                      className="h-24 text-center"
                    >
                      <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : customers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumnCount}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No customers match this filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Page {customersQuery.data?.page ?? page} of{" "}
              {customersQuery.data?.pageCount ?? 1}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={page >= (customersQuery.data?.pageCount ?? 1)}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <CustomerStatusDialog
        target={statusTarget}
        onOpenChange={(open) => {
          if (!open) setStatusTarget(null)
        }}
      />
      <CustomerDetailsSheet
        customerId={selectedCustomerId}
        open={Boolean(selectedCustomerId)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedCustomerId("")
        }}
        onStatus={(customer, nextStatus) =>
          setStatusTarget({ customer, status: nextStatus })
        }
      />
    </>
  )
}
