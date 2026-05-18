import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { format } from "date-fns"
import {
  ChevronRight,
  Clock3,
  ImagePlus,
  BellRing,
  LoaderCircle,
  Save,
  Settings2,
  Smartphone,
  Store,
  Tag,
  X,
} from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { useOpeningHours } from "@/components/hours/opening-hours-context"
import type { PayoutMethod } from "@/components/payouts/types"
import { useRestaurantStatus } from "@/components/restaurant-status-context"
import {
  type StoreSettings,
  type StoreSettingsFormErrors,
} from "@/components/store-settings/types"
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
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { getStoreCoverSrc, getStoreLogoSrc } from "@/lib/store-profile"
import { validateImageFile } from "@/lib/image-upload"
import {
  formatBangladeshPhonePlaceholder,
  isValidBangladeshPhone,
  sanitizeBangladeshPhoneInput,
} from "@/lib/phone"
import { formatTime12Hour } from "@/lib/time"
import { resolveOtpResendSeconds } from "@/lib/otp-timing"
import {
  mapOwnerPayoutMethod,
  mapOwnerStoreSettings,
  resolveRestaurantOnline,
  type OwnerStoreSettingsResponse,
  type OwnerPayoutMethodResponse,
} from "@/lib/backend-mappers"
import {
  useOwnerStoreSettingsQuery,
  useUpdateOwnerStoreSettingsMutation,
  useUpdateOwnerPayoutMethodMutation,
} from "@/hooks/use-owner-api"
import { useAppStore } from "@/store/app-store"

const PRESET_TAGS = [
  "Burger",
  "Fast Food",
  "Halal",
  "Family Meals",
  "Late Night",
  "Coffee",
  "Dessert",
  "Combo",
]

const PREPARATION_TIME_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90]

const DESCRIPTION_LIMIT = 220
type UploadTarget = "logo" | "cover"

type SectionHeaderProps = {
  icon: React.ElementType
  title: string
  description: string
}

function formatSafeDate(value: string | null | undefined, pattern: string, fallback = "--") {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return format(parsed, pattern)
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4 px-4 lg:px-6">
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-72 rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: SectionHeaderProps) {
  return (
    <CardHeader className="space-y-3 border-b border-border/70 pb-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl border bg-primary/5 text-primary shadow-sm">
          <Icon className="size-4.5" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="text-sm leading-6">
            {description}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  )
}

function validateStoreSettings(settings: StoreSettings): StoreSettingsFormErrors {
  const errors: StoreSettingsFormErrors = {}

  if (!settings.name.trim()) errors.name = "Restaurant name is required."
  if (!isValidBangladeshPhone(settings.phone)) {
    errors.phone = "Enter a valid 11-digit restaurant contact number."
  }
  if (settings.orderSettings.preparationTimeMinutes <= 0) {
    errors.preparationTimeMinutes = "Preparation time must be greater than 0."
  }

  if (settings.description.length > DESCRIPTION_LIMIT) {
    errors.description = `Keep description within ${DESCRIPTION_LIMIT} characters.`
  }

  return errors
}

function validatePayoutMethod(method: PayoutMethod) {
  const errors: Record<string, string> = {}
  const hasAnyValue = Boolean(
    method.accountName.trim() ||
      method.accountNumber.trim() ||
      method.bankName?.trim() ||
      method.branchName?.trim()
  )

  if (!hasAnyValue) return errors

  if (!method.accountName.trim()) {
    errors.accountName = "Account holder name is required."
  }

  if (!method.accountNumber.trim()) {
    errors.accountNumber = "Account number is required."
  } else if (
    method.type === "bkash" &&
    !isValidBangladeshPhone(method.accountNumber)
  ) {
    errors.accountNumber = "Enter a valid 11-digit bKash number."
  }

  if (method.type === "bank") {
    if (!method.bankName?.trim()) errors.bankName = "Bank name is required."
    if (!method.branchName?.trim()) errors.branchName = "Branch name is required."
  }

  return errors
}

export function StoreSettingsPage() {
  const queryClient = useQueryClient()
  const storeSettings = useAppStore((state) => state.storeSettings)
  const setStoreSettings = useAppStore((state) => state.setStoreSettings)
  const payoutMethod = useAppStore((state) => state.payoutMethod)
  const setPayoutMethod = useAppStore((state) => state.setPayoutMethod)
  const setVerificationModalOpen = useAppStore(
    (state) => state.setVerificationModalOpen
  )
  const setRestaurantOnline = useAppStore((state) => state.setRestaurantOnline)
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const { isOnline, isUpdating } = useRestaurantStatus()
  const { openingHours } = useOpeningHours()

  const [draft, setDraft] = React.useState(storeSettings)
  const [saved, setSaved] = React.useState(storeSettings)
  const [draftPayoutMethod, setDraftPayoutMethod] = React.useState(payoutMethod)
  const [savedPayoutMethod, setSavedPayoutMethod] = React.useState(payoutMethod)
  const [tagInput, setTagInput] = React.useState("")
  const [uploadingTarget, setUploadingTarget] = React.useState<UploadTarget | null>(null)
  const setVerificationRequest = useAppStore(
    (state) => state.setVerificationRequest
  )

  const storeSettingsQuery = useOwnerStoreSettingsQuery(ownerAccount.isAuthenticated)
  const updateStoreSettingsMutation = useUpdateOwnerStoreSettingsMutation()
  const updatePayoutMethodMutation = useUpdateOwnerPayoutMethodMutation()
  const isSaving =
    updateStoreSettingsMutation.isPending || updatePayoutMethodMutation.isPending
  const isBusy = isSaving || uploadingTarget !== null

  const isLoading = storeSettingsQuery.isPending

  const isSameStoreSettings = React.useCallback(
    (left: StoreSettings, right: StoreSettings) =>
      JSON.stringify(left) === JSON.stringify(right),
    []
  )

  React.useEffect(() => {
    if (!storeSettingsQuery.data) return

    const mapped = mapOwnerStoreSettings(
      storeSettingsQuery.data as OwnerStoreSettingsResponse,
      storeSettings
    )
    if (!isUpdating) {
      const resolvedOnline = resolveRestaurantOnline(
        storeSettingsQuery.data as OwnerStoreSettingsResponse,
        isOnline
      )

      if (resolvedOnline !== isOnline) {
        setRestaurantOnline(resolvedOnline)
      }
    }

    if (isSameStoreSettings(mapped, storeSettings)) return

    setStoreSettings(mapped)
    setDraft(mapped)
    setSaved(mapped)
  }, [
    isSameStoreSettings,
    storeSettingsQuery.data,
    setDraft,
    setSaved,
    setStoreSettings,
    storeSettings,
    setRestaurantOnline,
    isOnline,
    isUpdating,
  ])

  React.useEffect(() => {
    setDraft(storeSettings)
    setSaved(storeSettings)
  }, [storeSettings])

  React.useEffect(() => {
    setDraftPayoutMethod(payoutMethod)
    setSavedPayoutMethod(payoutMethod)
  }, [payoutMethod])

  const errors = React.useMemo(() => validateStoreSettings(draft), [draft])
  const payoutErrors = React.useMemo(
    () => validatePayoutMethod(draftPayoutMethod),
    [draftPayoutMethod]
  )
  const hasErrors =
    Object.keys(errors).length > 0 || Object.keys(payoutErrors).length > 0
  const storeIsDirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const payoutIsDirty =
    JSON.stringify(draftPayoutMethod) !== JSON.stringify(savedPayoutMethod)
  const isDirty = storeIsDirty || payoutIsDirty

  const remainingCharacters = DESCRIPTION_LIMIT - draft.description.length

  const openingSummary = React.useMemo(() => {
    const activeDays = openingHours.weeklySchedule.filter((day) => day.isOpen).length
    const firstDay = openingHours.weeklySchedule.find((day) => day.isOpen)
    const firstSlot = firstDay?.timeSlots[0]
    return {
        summary:
        firstDay && firstSlot
          ? `${activeDays}/7 days open, usually ${formatTime12Hour(firstSlot.startTime)} - ${formatTime12Hour(firstSlot.endTime)}`
          : "No opening hours configured yet.",
    }
  }, [openingHours])

  const availablePresetTags = PRESET_TAGS.filter((tag) => !draft.tags.includes(tag))

  function update<K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function addTag(rawValue: string) {
    const nextTag = rawValue.trim()
    if (!nextTag) return
    if (draft.tags.includes(nextTag)) {
      setTagInput("")
      return
    }

    update("tags", [...draft.tags, nextTag])
    setTagInput("")
  }

  function removeTag(tag: string) {
    update(
      "tags",
      draft.tags.filter((currentTag) => currentTag !== tag)
    )
  }

  function applyMappedStoreSettings(mapped: StoreSettings, response?: OwnerStoreSettingsResponse) {
    setStoreSettings(mapped)
    setDraft(mapped)
    setSaved(mapped)
    if (response) {
      queryClient.setQueryData(["owner", "store-settings"], response)
    }
  }

  async function handleStoreImageUpload(target: UploadTarget, file: File | null) {
    if (!file) return

    const validation = validateImageFile(file)
    if (!validation.ok) {
      toast.error(validation.title, {
        description: validation.description,
      })
      return
    }

    setUploadingTarget(target)

    try {
      const signature = await api.post<{
        cloudName: string
        folder: string
        timestamp: number
        signature: string
        apiKey: string
        resourceType: string
      }>("/media/upload-signature", {
        folder: "foodbela/owner/store",
        resourceType: "image",
      })

      const formData = new FormData()
      formData.append("file", file)
      formData.append("api_key", signature.apiKey)
      formData.append("timestamp", String(signature.timestamp))
      formData.append("signature", signature.signature)
      formData.append("folder", signature.folder)

      const uploadResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${signature.cloudName}/${signature.resourceType}/upload`,
        {
          method: "POST",
          body: formData,
        }
      )

      if (!uploadResponse.ok) {
        const errorPayload = (await uploadResponse.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        throw new Error(errorPayload?.error?.message || "Upload failed")
      }

      const uploaded = (await uploadResponse.json()) as {
        secure_url?: string
      }

      if (!uploaded.secure_url) {
        throw new Error("Upload failed")
      }

      const field = target === "logo" ? "logoUrl" : "coverImageUrl"
      setDraft((current) => ({
        ...current,
        [field]: uploaded.secure_url,
      }))

      toast.success(target === "logo" ? "Logo uploaded" : "Cover image uploaded", {
        description: "Preview updated. Save changes to publish it to your storefront.",
      })
    } catch (error) {
      toast.error("Upload failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setUploadingTarget(null)
    }
  }

  const payoutHasAnyValue = Boolean(
    draftPayoutMethod.accountName.trim() ||
      draftPayoutMethod.accountNumber.trim() ||
      draftPayoutMethod.bankName?.trim() ||
      draftPayoutMethod.branchName?.trim()
  )

  if (isLoading) {
    return <SettingsSkeleton />
  }

  return (
    <div className="space-y-5 px-4 pb-28 lg:px-6">
      <Card className="overflow-hidden rounded-[28px] border-border/70 shadow-sm">
        <div className="relative h-44 bg-slate-100">
          <img
            src={getStoreCoverSrc(draft.coverImageUrl)}
            alt={draft.name}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
          <div className="absolute top-4 left-4">
            <Badge className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-white backdrop-blur hover:bg-white/15">
              Store Profile
            </Badge>
          </div>
          <div className="absolute right-4 bottom-4">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-background/95 px-3 py-2 text-sm font-medium shadow-sm">
                {uploadingTarget === "cover" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
              {uploadingTarget === "cover" ? "Uploading..." : "Update Cover"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    void handleStoreImageUpload("cover", file ?? null)
                    event.target.value = ""
                  }}
              />
            </label>
          </div>
        </div>

        <CardContent className="flex flex-col gap-5 p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="-mt-14 overflow-hidden rounded-2xl border-4 border-background bg-background shadow-md">
              <img
                src={getStoreLogoSrc(draft.logoUrl)}
                alt={draft.name}
                className="size-24 object-cover"
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-2xl font-semibold">{draft.name}</h2>
                <Badge
                  className={
                    isOnline
                      ? "bg-emerald-600 text-white hover:bg-emerald-600"
                      : "bg-slate-900 text-white hover:bg-slate-900"
                  }
                >
                  {isOnline ? "Open" : "Closed"}
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  {draft.location.city}
                </Badge>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {draft.description}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {draft.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="rounded-full">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium">
            {uploadingTarget === "logo" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ImagePlus className="size-4" />
            )}
            {uploadingTarget === "logo" ? "Uploading..." : "Update Logo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      void handleStoreImageUpload("logo", file ?? null)
                      event.target.value = ""
                    }}
            />
          </label>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
        <Card className="rounded-[28px] border-border/70 shadow-sm">
          <SectionHeader
            icon={Store}
            title="Basic Information"
            description="Keep your restaurant profile clean, searchable, and customer-friendly."
          />
          <CardContent className="space-y-5 p-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Restaurant Name</label>
              <Input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
              />
              {errors.name ? (
                <p className="text-sm text-destructive">{errors.name}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Restaurant Contact Number</label>
              <Input
                value={draft.phone}
                onChange={(event) =>
                  update("phone", sanitizeBangladeshPhoneInput(event.target.value))
                }
                inputMode="numeric"
                maxLength={11}
                placeholder={formatBangladeshPhonePlaceholder()}
              />
              {errors.phone ? (
                <p className="text-sm text-destructive">{errors.phone}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Riders use this number for pickup and order-related contact. Owner login phone stays separate.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cuisine Type</label>
              <Input
                value={draft.cuisineType}
                onChange={(event) => update("cuisineType", event.target.value)}
                placeholder="Fast Food, Chinese, Cafe"
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Tags</label>
              <div className="rounded-3xl border bg-muted/15 p-4">
                <div className="flex min-h-10 flex-wrap gap-2">
                  {draft.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition hover:bg-primary/15"
                    >
                      <Tag className="size-3.5" />
                      {tag}
                      <X className="size-3.5" />
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault()
                        addTag(tagInput)
                      }
                    }}
                    placeholder="Type a tag and press Enter"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addTag(tagInput)}
                  >
                    Add Tag
                  </Button>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Suggested Tags
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availablePresetTags.map((tag) => (
                      <Button
                        key={tag}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addTag(tag)}
                      >
                        {tag}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium">Description <span className="text-xs text-muted-foreground">(Optional)</span></label>
                <span
                  className={`text-xs font-medium ${
                    remainingCharacters < 25 || !draft.description.trim()
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {remainingCharacters} characters left
                </span>
              </div>
              <div className="rounded-3xl border bg-muted/15 p-4">
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    update(
                      "description",
                      event.target.value.slice(0, DESCRIPTION_LIMIT)
                    )
                  }
                  placeholder="Optional short overview for your storefront"
                  className="min-h-32 border-0 bg-transparent p-0 text-sm leading-6 shadow-none focus-visible:ring-0"
                />
                <div className="mt-4 space-y-2">
                  <Progress
                    value={(draft.description.length / DESCRIPTION_LIMIT) * 100}
                    className="h-2"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Add it only if you want more storefront context.</span>
                    <span>{draft.description.length}/{DESCRIPTION_LIMIT}</span>
                  </div>
                </div>
              </div>
              {errors.description ? (
                <p className="text-sm text-destructive">{errors.description}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70 shadow-sm">
          <SectionHeader
            icon={Clock3}
            title="Opening Hours"
            description="Review your weekly schedule and jump into full schedule management when needed."
          />
          <CardContent className="space-y-4 p-6">
            <div className="rounded-3xl border bg-muted/15 p-4">
              <div className="font-medium">Weekly Schedule Summary</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {openingSummary.summary}
              </div>
            </div>
            <Button variant="outline" className="gap-2" asChild>
              <Link to="/hours">
                Manage Opening Hours
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70 shadow-sm">
          <SectionHeader
            icon={Settings2}
            title="Order Settings"
            description="Set how quickly the kitchen receives and prepares incoming orders."
          />
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center justify-between rounded-3xl border bg-muted/15 px-4 py-3">
              <div>
                <div className="font-medium">Accept Orders Automatically</div>
                <div className="text-sm text-muted-foreground">
                  Turn off for manual review before accepting.
                </div>
              </div>
              <Switch
                checked={draft.orderSettings.autoAcceptOrders}
                onCheckedChange={(checked) =>
                  update("orderSettings", {
                    ...draft.orderSettings,
                    autoAcceptOrders: checked,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Default Preparation Time
                <span className="ml-1 text-muted-foreground">(minutes)</span>
              </label>
              <Select
                value={String(draft.orderSettings.preparationTimeMinutes)}
                onValueChange={(value) =>
                  update("orderSettings", {
                    ...draft.orderSettings,
                    preparationTimeMinutes: Number(value),
                  })
                }
              >
                <SelectTrigger className="w-full h-11 rounded-xl px-3" size="default">
                  <SelectValue placeholder="Select preparation time" />
                </SelectTrigger>
                <SelectContent>
                  {PREPARATION_TIME_OPTIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutes} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.preparationTimeMinutes ? (
                <p className="text-sm text-destructive">
                  {errors.preparationTimeMinutes}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70 shadow-sm">
          <SectionHeader
            icon={Smartphone}
            title="Payout Setup"
            description="Set where Foodbela should send your earnings. bKash stays first for faster setup."
          />
          <CardContent className="space-y-4 p-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Payout Method</label>
              <Select
                value={draftPayoutMethod.type}
                onValueChange={(value: "bank" | "bkash") =>
                  setDraftPayoutMethod((current) => ({
                    ...current,
                    type: value,
                    accountNumber:
                      value === "bkash"
                        ? sanitizeBangladeshPhoneInput(current.accountNumber)
                        : current.accountNumber,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose payout method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bkash">bKash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Account Holder Name</label>
                <Input
                  value={draftPayoutMethod.accountName}
                  onChange={(event) =>
                    setDraftPayoutMethod((current) => ({
                      ...current,
                      accountName: event.target.value,
                    }))
                  }
                  placeholder="Meet Point"
                />
                {payoutErrors.accountName ? (
                  <p className="text-sm text-destructive">
                    {payoutErrors.accountName}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {draftPayoutMethod.type === "bkash"
                    ? "bKash Number"
                    : "Account Number"}
                </label>
                <Input
                  value={draftPayoutMethod.accountNumber}
                  onChange={(event) =>
                    setDraftPayoutMethod((current) => ({
                      ...current,
                      accountNumber:
                        current.type === "bkash"
                          ? sanitizeBangladeshPhoneInput(event.target.value)
                          : event.target.value,
                    }))
                  }
                  inputMode={
                    draftPayoutMethod.type === "bkash" ? "numeric" : undefined
                  }
                  maxLength={draftPayoutMethod.type === "bkash" ? 11 : undefined}
                  placeholder={
                    draftPayoutMethod.type === "bkash"
                      ? formatBangladeshPhonePlaceholder()
                      : "000123456789"
                  }
                />
                {payoutErrors.accountNumber ? (
                  <p className="text-sm text-destructive">
                    {payoutErrors.accountNumber}
                  </p>
                ) : null}
              </div>
            </div>

            {draftPayoutMethod.type === "bank" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bank Name</label>
                  <Input
                    value={draftPayoutMethod.bankName ?? ""}
                    onChange={(event) =>
                      setDraftPayoutMethod((current) => ({
                        ...current,
                        bankName: event.target.value,
                      }))
                    }
                    placeholder="Eastern Bank PLC"
                  />
                  {payoutErrors.bankName ? (
                    <p className="text-sm text-destructive">
                      {payoutErrors.bankName}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Branch Name</label>
                  <Input
                    value={draftPayoutMethod.branchName ?? ""}
                    onChange={(event) =>
                      setDraftPayoutMethod((current) => ({
                        ...current,
                        branchName: event.target.value,
                      }))
                    }
                    placeholder="Netrokona Branch"
                  />
                  {payoutErrors.branchName ? (
                    <p className="text-sm text-destructive">
                      {payoutErrors.branchName}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-3xl border bg-muted/15 p-4 text-sm text-muted-foreground">
              {draftPayoutMethod.type === "bkash" &&
              sanitizeBangladeshPhoneInput(draftPayoutMethod.accountNumber) &&
              sanitizeBangladeshPhoneInput(draftPayoutMethod.accountNumber) !==
                ownerAccount.phone
                ? "If this bKash number is different from your owner account phone, an OTP verification step will appear before activation."
                : "A completed payout setup helps your store profile reach 100% and avoids settlement delays after approval."}
            </div>
          </CardContent>
        </Card>

          <Card className="rounded-[28px] border-border/70 shadow-sm">
            <SectionHeader
              icon={BellRing}
              title="Notifications"
              description="Choose which operational alerts you want to receive in the dashboard."
            />
            <CardContent className="space-y-4 p-6">
              <div className="space-y-3">
                <div className="text-sm font-medium">Notifications</div>
              {[
                ["newOrder", "New order notifications"],
                ["cancellation", "Order cancellation alerts"],
              ].map(([key, label]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-3xl border bg-muted/15 px-4 py-3"
                >
                  <span>{label}</span>
                  <Switch
                    checked={
                      draft.notifications[key as keyof typeof draft.notifications]
                    }
                    onCheckedChange={(checked) =>
                      update("notifications", {
                        ...draft.notifications,
                        [key]: checked,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        </div>

        <div className="xl:sticky xl:top-20">
          <Card className="rounded-[28px] border-border/70 shadow-sm">
            <SectionHeader
              icon={Smartphone}
              title="Mobile Preview"
              description="See how your storefront information will look on a customer's phone."
            />
            <CardContent className="p-6">
              <div className="mx-auto w-full max-w-[360px] rounded-[36px] border-[7px] border-slate-900 bg-slate-950 p-1.5 shadow-2xl">
                <div className="overflow-hidden rounded-[30px] bg-background">
                  <div className="relative h-36 bg-slate-100">
                    <img
                      src={getStoreCoverSrc(draft.coverImageUrl)}
                      alt={draft.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                    <div className="absolute top-3 left-1/2 h-1.5 w-20 -translate-x-1/2 rounded-full bg-white/85" />
                    <div className="absolute right-3 bottom-3">
                      <Badge className="rounded-full bg-white/90 text-slate-900 hover:bg-white/90">
                        {isOnline ? "Open now" : "Closed"}
                      </Badge>
                    </div>
                  </div>

                  <div className="min-h-[540px] space-y-4 p-4">
                    <div className="-mt-11 flex items-end gap-3">
                      <div className="overflow-hidden rounded-2xl border-4 border-background bg-background shadow-md">
                        <img
                          src={getStoreLogoSrc(draft.logoUrl)}
                          alt={draft.name}
                          className="size-[72px] object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1 pb-1">
                      <div className="truncate text-sm font-semibold">
                        {draft.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {draft.cuisineType || "Restaurant"}
                      </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-muted/20 p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        About
                      </div>
                      <p className="line-clamp-3 text-sm leading-5 text-foreground/90">
                        {draft.description || "Add a short description to preview your storefront."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Tags
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {draft.tags.slice(0, 5).map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="rounded-full"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed right-0 bottom-0 left-0 z-40 md:left-[var(--sidebar-width)]">
        <div className="border-t bg-background/96 px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:px-6">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 rounded-2xl border bg-background px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-muted-foreground">
            Last saved{" "}
            <span className="font-medium text-foreground">
              {formatSafeDate(saved.updatedAt, "dd MMM yyyy, hh:mm a")}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={!isDirty || isBusy}
              onClick={() => {
                setDraft(saved)
                setDraftPayoutMethod(savedPayoutMethod)
                setTagInput("")
                toast.info("Changes reverted", {
                  description: "Your unsaved edits were discarded.",
                })
              }}
            >
              Reset
            </Button>
            <Button
              disabled={!isDirty || isBusy}
              onClick={() => {
                if (hasErrors) {
                  toast.error("Please fix the highlighted fields first.", {
                    description:
                      "Store details and payout information need attention before saving.",
                  })
                  return
                }
                if (payoutIsDirty && !payoutHasAnyValue) {
                  toast.error("Payout information is incomplete.", {
                    description:
                      "Add payout details or revert changes before saving.",
                  })
                  return
                }
                const cuisineTypes = draft.cuisineType
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)

                if (storeIsDirty) {
                  updateStoreSettingsMutation.mutate(
                      {
                        name: draft.name.trim(),
                        phone: sanitizeBangladeshPhoneInput(draft.phone),
                        description: draft.description.trim(),
                        preparationTimeMinutes:
                          draft.orderSettings.preparationTimeMinutes,
                        autoAcceptOrders: draft.orderSettings.autoAcceptOrders,
                        cuisineTypes,
                        tags: draft.tags,
                        logo: { url: draft.logoUrl },
                      coverImage: { url: draft.coverImageUrl },
                      address: draft.address.trim(),
                      city: draft.location.city.trim(),
                      latitude: draft.location.latitude,
                      longitude: draft.location.longitude,
                      notifications: {
                        newOrder: draft.notifications.newOrder,
                        cancellation: draft.notifications.cancellation,
                      },
                    },
                    {
                      onSuccess: (response) => {
                        const mapped = mapOwnerStoreSettings(
                          response as OwnerStoreSettingsResponse,
                          draft
                        )
                        applyMappedStoreSettings(
                          mapped,
                          response as OwnerStoreSettingsResponse
                        )
                      },
                      onError: (error) => {
                        toast.error("Unable to update store settings.", {
                          description:
                            error instanceof Error ? error.message : "Please try again.",
                        })
                      },
                    }
                  )
                }

                if (payoutIsDirty && payoutHasAnyValue) {
                  updatePayoutMethodMutation.mutate(
                    draftPayoutMethod.type === "bkash"
                      ? {
                          type: "bkash",
                          accountName: draftPayoutMethod.accountName.trim(),
                          accountNumber: sanitizeBangladeshPhoneInput(
                            draftPayoutMethod.accountNumber
                          ),
                        }
                      : {
                          type: "bank",
                          accountName: draftPayoutMethod.accountName.trim(),
                          accountNumber: draftPayoutMethod.accountNumber.trim(),
                          bankName: draftPayoutMethod.bankName?.trim() ?? "",
                          branchName: draftPayoutMethod.branchName?.trim() ?? "",
                        },
                    {
                      onSuccess: (response) => {
                        const payload = response as OwnerPayoutMethodResponse
                        const nextMethod = mapOwnerPayoutMethod(
                          payload.payoutMethod,
                          draftPayoutMethod
                        )
                        setPayoutMethod(nextMethod)
                        setSavedPayoutMethod(nextMethod)

                        if (payload.verificationSessionId) {
                          setVerificationRequest({
                            verificationSessionId: payload.verificationSessionId,
                            purpose: "owner_payout_verify",
                            phone:
                              nextMethod.pendingAccountNumber ||
                              nextMethod.accountNumber,
                            referenceId: payload.payoutMethod._id,
                            pendingPassword: "",
                            resendAvailableInSeconds: resolveOtpResendSeconds(payload.resendAvailableInSeconds),
                          })
                          setVerificationModalOpen(true)
                          toast.info(
                            "Verify your bKash number to finish payout setup.",
                            {
                              description:
                                "We kept the new wallet number pending until OTP verification is complete.",
                            }
                          )
                          return
                        }

                        toast.success("Store settings updated", {
                          description:
                            "Your restaurant profile, payout setup, and storefront settings are now saved.",
                          action: {
                            label: "View Hours",
                            onClick: () => {
                              window.location.assign("/hours")
                            },
                          },
                        })
                      },
                      onError: (error) => {
                        toast.error("Unable to update payout method.", {
                          description:
                            error instanceof Error ? error.message : "Please try again.",
                        })
                      },
                    }
                  )
                } else if (storeIsDirty) {
                  toast.success("Store settings updated", {
                    description:
                      "Your restaurant profile and storefront settings are now saved.",
                  })
                }
              }}
            >
              {isBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {uploadingTarget ? "Uploading image..." : isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
