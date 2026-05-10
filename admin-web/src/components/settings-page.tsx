import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Loader2,
  MapPin,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  Truck,
} from "lucide-react"
import { toast } from "sonner"

import {
  getAdminDispatchSettings,
  getPlatformContent,
  listAdminActivityLogs,
  listAdminRiders,
  updatePlatformContent,
  type PlatformContent,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

function cloneContent(content: PlatformContent) {
  return JSON.parse(JSON.stringify(content)) as PlatformContent
}

function numberFromInput(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never saved"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never saved"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

const recommendedOrderAutomation = {
  autoCancelUnacceptedOrdersEnabled: false,
  autoCancelAfterMinutes: 12,
  autoCancelNotifyBeforeMinutes: 3,
  prepStartGraceMinutes: 8,
  prepLateGraceMinutes: 5,
  pickupLateGraceMinutes: 10,
  deliveryLateGraceMinutes: 10,
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[1fr_280px] md:items-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const platformContentQuery = useQuery({
    queryKey: ["admin-platform-content"],
    queryFn: getPlatformContent,
  })
  const dispatchQuery = useQuery({
    queryKey: ["admin-dispatch-settings"],
    queryFn: getAdminDispatchSettings,
  })
  const ridersQuery = useQuery({
    queryKey: ["admin-riders", "settings-primary"],
    queryFn: () =>
      listAdminRiders({
        status: "active",
        sortBy: "mostActive",
        pageSize: 100,
      }),
  })
  const activityLogsQuery = useQuery({
    queryKey: ["admin-activity-logs", "settings"],
    queryFn: () => listAdminActivityLogs({ pageSize: 8 }),
  })

  const [draft, setDraft] = React.useState<PlatformContent | null>(null)
  const [savedSnapshot, setSavedSnapshot] = React.useState("")

  React.useEffect(() => {
    const content = platformContentQuery.data?.content
    if (!content) return
    const cloned = cloneContent(content)
    setDraft(cloned)
    setSavedSnapshot(JSON.stringify(cloned))
  }, [platformContentQuery.data?.content])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Settings are still loading")
      return updatePlatformContent(draft)
    },
    onSuccess: (result) => {
      toast.success("Platform settings updated")
      setDraft(cloneContent(result.content))
      setSavedSnapshot(JSON.stringify(result.content))
      void queryClient.invalidateQueries({ queryKey: ["admin-platform-content"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-dispatch-settings"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-dashboard-orders"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings")
    },
  })

  const hasChanges = draft ? JSON.stringify(draft) !== savedSnapshot : false
  const dispatchMetrics = dispatchQuery.data?.metrics

  const updateDraft = (updater: (content: PlatformContent) => void) => {
    setDraft((current) => {
      if (!current) return current
      const next = cloneContent(current)
      updater(next)
      return next
    })
  }

  const resetDraft = () => {
    const content = platformContentQuery.data?.content
    if (!content) return
    const cloned = cloneContent(content)
    setDraft(cloned)
    setSavedSnapshot(JSON.stringify(cloned))
    toast.info("Unsaved settings reset")
  }

  const applyRecommendedOrderAutomation = () => {
    updateDraft((content) => {
      content.operations.dispatch.autoCancelUnacceptedOrdersEnabled =
        recommendedOrderAutomation.autoCancelUnacceptedOrdersEnabled
      content.operations.dispatch.autoCancelAfterMinutes =
        recommendedOrderAutomation.autoCancelAfterMinutes
      content.operations.dispatch.autoCancelNotifyBeforeMinutes =
        recommendedOrderAutomation.autoCancelNotifyBeforeMinutes
      content.operations.dispatch.prepStartGraceMinutes =
        recommendedOrderAutomation.prepStartGraceMinutes
      content.operations.dispatch.prepLateGraceMinutes =
        recommendedOrderAutomation.prepLateGraceMinutes
      content.operations.dispatch.pickupLateGraceMinutes =
        recommendedOrderAutomation.pickupLateGraceMinutes
      content.operations.dispatch.deliveryLateGraceMinutes =
        recommendedOrderAutomation.deliveryLateGraceMinutes
    })
    toast.info("Recommended auto-cancel policy applied")
  }

  if (platformContentQuery.isLoading || !draft) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-dashed">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading platform settings...
        </div>
      </div>
    )
  }

  const dispatch = draft.operations.dispatch
  const serviceArea = draft.operations.serviceArea
  const deliveryPricing = draft.operations.deliveryPricing
  const support = draft.supportContact

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings className="size-5" />
            </span>
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure synced platform policies for branding, service area,
            dispatch, and support.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasChanges ? <Badge variant="secondary">Unsaved changes</Badge> : null}
          <Button type="button" variant="outline" onClick={resetDraft}>
            <RefreshCcw className="size-4" />
            Reset
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save settings
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-2">
            <p className="text-sm text-muted-foreground">Service area</p>
            <p className="mt-2 text-2xl font-semibold">{serviceArea.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {serviceArea.radiusKm} km delivery radius
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-2">
            <p className="text-sm text-muted-foreground">Dispatch mode</p>
            <p className="mt-2 text-2xl font-semibold">
              {dispatch.dispatchMode === "primary_rider" ? "Primary rider" : "Fleet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dispatch.autoAssignmentEnabled ? "Auto assignment on" : "Manual assignment"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-2">
            <p className="text-sm text-muted-foreground">Live rider capacity</p>
            <p className="mt-2 text-2xl font-semibold">
              {dispatchMetrics?.eligibleRiders ?? 0}/{dispatchMetrics?.totalRiders ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Eligible riders from dispatch engine
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-2">
            <p className="text-sm text-muted-foreground">Last saved</p>
            <p className="mt-2 text-lg font-semibold">
              {formatDateTime(platformContentQuery.data?.meta.updatedAt)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {platformContentQuery.data?.meta.updatedByAdminName || "System defaults"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="operations" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-[560px]">
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>

        <TabsContent value="operations" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="size-4" />
                    Service area
                  </CardTitle>
                  <CardDescription>
                    Customer and delivery availability should use this operating
                    zone as the platform default.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SettingRow
                    title="Area name"
                    description="Shown internally to identify the active operating zone."
                  >
                    <Input
                      value={serviceArea.name}
                      onChange={(event) =>
                        updateDraft((content) => {
                          content.operations.serviceArea.name = event.target.value
                        })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    title="Center latitude"
                    description="Map center for delivery operations."
                  >
                    <Input
                      type="number"
                      value={serviceArea.centerLatitude}
                      onChange={(event) =>
                        updateDraft((content) => {
                          content.operations.serviceArea.centerLatitude = numberFromInput(
                            event.target.value,
                            serviceArea.centerLatitude
                          )
                        })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    title="Center longitude"
                    description="Map center for delivery operations."
                  >
                    <Input
                      type="number"
                      value={serviceArea.centerLongitude}
                      onChange={(event) =>
                        updateDraft((content) => {
                          content.operations.serviceArea.centerLongitude = numberFromInput(
                            event.target.value,
                            serviceArea.centerLongitude
                          )
                        })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    title="Delivery radius"
                    description="Maximum supported radius in kilometers."
                  >
                    <Input
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={serviceArea.radiusKm}
                      onChange={(event) =>
                        updateDraft((content) => {
                          content.operations.serviceArea.radiusKm = numberFromInput(
                            event.target.value,
                            serviceArea.radiusKm
                          )
                        })
                      }
                    />
                  </SettingRow>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Truck className="size-4" />
                    Delivery pricing
                  </CardTitle>
                  <CardDescription>
                    Set the global delivery fee and optionally add distance-based
                    charges after the included range.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SettingRow
                    title="Base delivery fee"
                    description="Applied to every order before any optional distance surcharge."
                  >
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={deliveryPricing.baseFeeTaka}
                      onChange={(event) =>
                        updateDraft((content) => {
                          content.operations.deliveryPricing.baseFeeTaka = numberFromInput(
                            event.target.value,
                            deliveryPricing.baseFeeTaka
                          )
                        })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    title="Enable distance surcharge"
                    description="Add extra delivery cost only when an order goes beyond the included distance."
                  >
                    <Switch
                      checked={deliveryPricing.distanceSurchargeEnabled}
                      onCheckedChange={(checked) =>
                        updateDraft((content) => {
                          content.operations.deliveryPricing.distanceSurchargeEnabled = checked
                        })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    title="Included distance"
                    description="Orders within this distance keep only the base fee."
                  >
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={deliveryPricing.surchargeStartsAfterKm}
                      onChange={(event) =>
                        updateDraft((content) => {
                          content.operations.deliveryPricing.surchargeStartsAfterKm =
                            numberFromInput(
                              event.target.value,
                              deliveryPricing.surchargeStartsAfterKm
                            )
                        })
                      }
                    />
                  </SettingRow>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SettingRow
                      title="Step distance"
                      description="Additional charge applies once per distance step."
                    >
                      <Input
                        type="number"
                        min={100}
                        step={100}
                        value={deliveryPricing.surchargeStepMeters}
                        onChange={(event) =>
                          updateDraft((content) => {
                            content.operations.deliveryPricing.surchargeStepMeters =
                              numberFromInput(
                                event.target.value,
                                deliveryPricing.surchargeStepMeters
                              )
                          })
                        }
                      />
                    </SettingRow>
                    <SettingRow
                      title="Charge per step"
                      description="Extra taka added for each step beyond the included distance."
                    >
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={deliveryPricing.surchargeAmountTaka}
                        onChange={(event) =>
                          updateDraft((content) => {
                            content.operations.deliveryPricing.surchargeAmountTaka =
                              numberFromInput(
                                event.target.value,
                                deliveryPricing.surchargeAmountTaka
                              )
                          })
                        }
                      />
                    </SettingRow>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="size-4" />
                  Dispatch policy
                </CardTitle>
                <CardDescription>
                  These values are read by rider assignment and order monitoring.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SettingRow
                  title="Auto assignment"
                  description="Automatically assign ready orders to eligible riders."
                >
                  <Switch
                    checked={dispatch.autoAssignmentEnabled}
                    onCheckedChange={(checked) =>
                      updateDraft((content) => {
                        content.operations.dispatch.autoAssignmentEnabled = checked
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Auto reassign timed-out orders"
                  description="Retry dispatch when rider acknowledgement times out."
                >
                  <Switch
                    checked={dispatch.autoReassignTimedOutOrders}
                    onCheckedChange={(checked) =>
                      updateDraft((content) => {
                        content.operations.dispatch.autoReassignTimedOutOrders = checked
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Auto-cancel unaccepted orders"
                  description="If a restaurant does not accept a new order in time, notify admin first, then cancel automatically."
                >
                  <Switch
                    checked={Boolean(dispatch.autoCancelUnacceptedOrdersEnabled)}
                    onCheckedChange={(checked) =>
                      updateDraft((content) => {
                        content.operations.dispatch.autoCancelUnacceptedOrdersEnabled = checked
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Dispatch mode"
                  description="Use full fleet or send first to one primary rider."
                >
                  <Select
                    value={dispatch.dispatchMode}
                    onValueChange={(value) =>
                      updateDraft((content) => {
                        content.operations.dispatch.dispatchMode =
                          value as PlatformContent["operations"]["dispatch"]["dispatchMode"]
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fleet">Fleet</SelectItem>
                      <SelectItem value="primary_rider">Primary rider first</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow
                  title="Primary rider"
                  description="Used when primary rider mode is enabled."
                >
                  <Select
                    value={dispatch.primaryRiderId || "none"}
                    onValueChange={(value) =>
                      updateDraft((content) => {
                        content.operations.dispatch.primaryRiderId =
                          value === "none" ? "" : value
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose rider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No primary rider</SelectItem>
                      {(ridersQuery.data?.items ?? []).map((rider) => (
                        <SelectItem key={rider.id} value={rider.id}>
                          {rider.fullName} - {rider.activeOrders} active
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow
                  title="Fallback to fleet"
                  description="If the primary rider is unavailable or at capacity, try fleet dispatch."
                >
                  <Switch
                    checked={dispatch.primaryRiderFallbackEnabled}
                    onCheckedChange={(checked) =>
                      updateDraft((content) => {
                        content.operations.dispatch.primaryRiderFallbackEnabled = checked
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Assignment algorithm"
                  description="Nearest balanced considers distance and load; least loaded prioritizes capacity."
                >
                  <Select
                    value={dispatch.algorithm}
                    onValueChange={(value) =>
                      updateDraft((content) => {
                        content.operations.dispatch.algorithm =
                          value as PlatformContent["operations"]["dispatch"]["algorithm"]
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nearest_eligible_balanced">
                        Nearest balanced
                      </SelectItem>
                      <SelectItem value="least_loaded_first">
                        Least loaded first
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                Recent admin activity
              </CardTitle>
              <CardDescription>
                The latest platform setting and order-control actions across admin tools.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {platformContentQuery.data?.history.slice(0, 4).map((entry) => (
                <div key={`content-${entry.updatedAt}`} className="rounded-lg border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      Platform settings updated
                    </div>
                    <Badge variant="outline">Settings</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.updatedByAdminName || "Support Team"} changed {entry.changedSections.join(", ")}.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(entry.updatedAt)}
                  </p>
                </div>
              ))}
              {(activityLogsQuery.data?.items ?? []).map((entry) => (
                <div key={entry.id} className="rounded-lg border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{entry.title}</div>
                    <Badge variant="outline" className="capitalize">
                      {entry.entityType.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.adminName || "Support Team"}: {entry.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              ))}
              {!platformContentQuery.data?.history.length && !(activityLogsQuery.data?.items.length) ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Admin activity will appear here after the first order control or settings change.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Operational thresholds</CardTitle>
                  <CardDescription>
                    Keep these conservative so late alerts, rider capacity, and
                    auto-cancel rules stay accurate.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={applyRecommendedOrderAutomation}
                >
                  <RefreshCcw className="size-4" />
                  Reset automation
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[
                ["ownerAcceptanceTimeoutMinutes", "Owner acceptance timeout", "minutes", 1, 180],
                ["autoCancelAfterMinutes", "Auto-cancel unaccepted after", "minutes", 2, 240],
                ["autoCancelNotifyBeforeMinutes", "Notify admin before auto-cancel", "minutes", 1, 60],
                ["maxActiveOrdersPerRider", "Max active orders per rider", "orders", 1, 50],
                ["staleLocationCutoffMinutes", "Stale rider location cutoff", "minutes", 1, 180],
                ["assignmentTimeoutMinutes", "Rider assignment timeout", "minutes", 1, 180],
                ["prepStartGraceMinutes", "Prep start grace", "minutes after accept", 1, 180],
                ["prepLateGraceMinutes", "Prep late grace", "minutes after expected prep", 0, 180],
                ["pickupLateGraceMinutes", "Pickup late window", "minutes after ready", 1, 180],
                ["deliveryLateGraceMinutes", "Delivery ETA grace", "minutes after ETA", 1, 180],
                ["retryCooldownMinutes", "Dispatch retry cooldown", "minutes", 1, 60],
                ["surgeReadyOrderThreshold", "Surge ready-order threshold", "orders", 1, 100],
                ["surgeUnassignedOrderThreshold", "Surge unassigned threshold", "orders", 1, 100],
              ].map(([key, label, suffix, min, max]) => (
                <div key={key} className="space-y-2 rounded-lg border bg-background p-3">
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    min={min as number}
                    max={max as number}
                    value={(dispatch[key as keyof typeof dispatch] as number) ?? (min as number)}
                    onChange={(event) =>
                      updateDraft((content) => {
                        const dispatchKey = key as keyof PlatformContent["operations"]["dispatch"]
                        ;(content.operations.dispatch[dispatchKey] as number) = numberFromInput(
                          event.target.value,
                          dispatch[dispatchKey] as number
                        )
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Allowed {min}-{max} {suffix}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                Platform identity
              </CardTitle>
              <CardDescription>
                Shared naming used across public content and admin operations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SettingRow
                title="Platform name"
                description="Primary brand name."
              >
                <Input
                  value={draft.branding.platformName}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.branding.platformName = event.target.value
                    })
                  }
                />
              </SettingRow>
              <SettingRow title="Tagline" description="Short public-facing line.">
                <Input
                  value={draft.branding.tagline}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.branding.tagline = event.target.value
                    })
                  }
                />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="support" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Support contact</CardTitle>
              <CardDescription>
                Customer app support information and issue-reporting copy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SettingRow title="Support email" description="Public support inbox.">
                <Input
                  value={support.email}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.supportContact.email = event.target.value
                    })
                  }
                />
              </SettingRow>
              <SettingRow title="Support phone" description="Public hotline number.">
                <Input
                  value={support.phone}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.supportContact.phone = event.target.value
                    })
                  }
                />
              </SettingRow>
              <SettingRow title="Support hours" description="When admins or support agents are available.">
                <Input
                  value={support.supportHours}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.supportContact.supportHours = event.target.value
                    })
                  }
                />
              </SettingRow>
              <SettingRow title="Report label" description="Label for issue reporting actions.">
                <Input
                  value={support.reportLabel}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.supportContact.reportLabel = event.target.value
                    })
                  }
                />
              </SettingRow>
              <SettingRow title="Direct help note" description="Short guidance shown near support actions.">
                <Textarea
                  value={support.directHelpNote}
                  onChange={(event) =>
                    updateDraft((content) => {
                      content.supportContact.directHelpNote = event.target.value
                    })
                  }
                />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
