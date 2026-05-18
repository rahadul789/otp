import { z } from "zod"
import { StatusCodes } from "http-status-codes"

import { AdminModel } from "../admin/admin.model"
import { AppError } from "../../common/utils/app-error"
import { CustomerModel } from "../customer/customer.model"
import { sendPushToCustomer } from "../customer/push.service"
import { OrderModel } from "../owner/operational.model"
import { PublicContentModel } from "./content.model"
import { platformContent } from "./content"

const helpArticleSectionSchema = z.object({
  title: z.string().trim().min(1),
  paragraphs: z.array(z.string().trim().min(1)).optional(),
  bullets: z.array(z.string().trim().min(1)).optional(),
  steps: z.array(z.string().trim().min(1)).optional(),
})

const platformContentSchema = z.object({
  branding: z.object({
    platformName: z.string().trim().min(1),
    tagline: z.string().trim().min(1),
  }),
  customerApp: z.object({
    homeBanner: z.object({
      isActive: z.boolean(),
      title: z.string().trim().min(1),
      subtitle: z.string().trim().min(1),
      ctaLabel: z.string().trim().min(1),
      ctaPath: z.string().trim().min(1),
      tone: z.enum(["sky", "mint", "amber", "rose"]),
    }),
    homeCms: z.object({
      offerStrip: z.object({
        isActive: z.boolean(),
        showVoucherStrip: z.boolean(),
        mode: z.enum(["voucher_strip", "promo_block", "hidden"]),
        title: z.string().trim(),
        subtitle: z.string().trim(),
        variant: z.enum(["text", "image", "image_text", "carousel"]),
        buttonStyle: z.enum(["pill", "soft", "outline", "dark"]),
        imageUrl: z.string().trim(),
        imagePublicId: z.string().trim(),
        carouselImageUrls: z.array(z.string().trim()),
        carouselImages: z.array(
          z.object({
            url: z.string().trim(),
            publicId: z.string().trim(),
            ctaPath: z.string().trim().optional(),
          })
        ),
        ctaLabel: z.string().trim(),
        ctaPath: z.string().trim(),
        backgroundColor: z.string().trim(),
        textColor: z.string().trim(),
        accentColor: z.string().trim(),
      }),
      modal: z.object({
        isActive: z.boolean(),
        title: z.string().trim(),
        subtitle: z.string().trim(),
        imageUrl: z.string().trim(),
        imagePublicId: z.string().trim(),
        ctaLabel: z.string().trim(),
        ctaPath: z.string().trim(),
        delaySeconds: z.number().int().min(0).max(3600),
        frequency: z.enum(["once_per_session", "every_refresh"]),
        backgroundColor: z.string().trim(),
        textColor: z.string().trim(),
        accentColor: z.string().trim(),
      }),
      howToOrderGuide: z.object({
        isActive: z.boolean(),
        audience: z.enum(["all_users", "new_users"]),
        title: z.string().trim(),
        subtitle: z.string().trim(),
        youtubeUrl: z.string().trim(),
        ctaLabel: z.string().trim(),
        placement: z.enum(["after_search", "after_offers", "before_restaurants"]),
        backgroundColor: z.string().trim(),
        textColor: z.string().trim(),
        accentColor: z.string().trim(),
        guideImages: z.array(
          z.object({
            url: z.string().trim(),
            publicId: z.string().trim(),
            title: z.string().trim().optional(),
          })
        ),
      }),
      pushCampaign: z.object({
        contentType: z.enum(["text", "image", "image_text"]),
        title: z.string().trim(),
        body: z.string().trim(),
        imageUrl: z.string().trim(),
        imagePublicId: z.string().trim(),
        path: z.string().trim(),
        currentCampaignId: z.string().trim(),
        audienceType: z.enum(["all_users", "new_users", "returning_users", "selected_users"]),
        selectedCustomerIds: z.array(z.string().trim()),
        customerGroupKey: z.string().trim(),
        restaurantScope: z.enum(["all_restaurants", "selected_restaurants"]),
        selectedRestaurantIds: z.array(z.string().trim()),
        abTest: z.object({
          enabled: z.boolean(),
          splitPercent: z.number().int().min(1).max(99),
          variantBTitle: z.string().trim(),
          variantBBody: z.string().trim(),
          variantBPath: z.string().trim(),
        }),
        lastSentAt: z.string().nullable(),
        totalTargets: z.number().int().min(0),
        sentCount: z.number().int().min(0),
        disabledCount: z.number().int().min(0),
        openCount: z.number().int().min(0),
        recipientEvents: z.array(
          z.object({
            customerId: z.string().trim(),
            customerName: z.string().trim(),
            customerPhone: z.string().trim(),
            sentAt: z.string().trim(),
            status: z.enum(["sent", "in_app_only", "preference_disabled", "failed"]),
            expoTokenCount: z.number().int().min(0),
            ticketIds: z.array(z.string().trim()).optional(),
            receiptStatus: z
              .enum(["pending", "delivered_to_provider", "failed", "device_not_registered"])
              .optional(),
            receiptCheckedAt: z.string().trim().nullable().optional(),
            receiptError: z.string().trim().optional(),
            variant: z.enum(["A", "B"]).optional(),
          })
        ),
        openEvents: z.array(
          z.object({
            customerId: z.string().trim(),
            customerName: z.string().trim(),
            customerPhone: z.string().trim(),
            openedAt: z.string().trim(),
            path: z.string().trim(),
            campaignId: z.string().trim().optional(),
            variant: z.enum(["A", "B"]).optional(),
          })
        ),
        receiptCheckedAt: z.string().nullable(),
        conversionWindowDays: z.number().int().min(1).max(30),
        scheduledAt: z.string().nullable(),
        scheduleStatus: z.enum(["none", "scheduled", "sending", "sent", "cancelled", "failed"]),
        scheduledByAdminId: z.string().trim(),
        scheduledCreatedAt: z.string().nullable(),
        scheduleHistory: z.array(
          z.object({
            action: z.enum(["scheduled", "cancelled", "sent", "failed"]),
            scheduledAt: z.string().nullable(),
            occurredAt: z.string().trim(),
            adminId: z.string().trim(),
            note: z.string().trim(),
          })
        ),
        conversions: z.object({
          orderCount: z.number().int().min(0),
          deliveredOrderCount: z.number().int().min(0),
          deliveredRevenue: z.number().min(0),
          uniqueOrderingCustomers: z.number().int().min(0),
          conversionRate: z.number().min(0),
          refreshedAt: z.string().nullable(),
          convertedOrders: z.array(
            z.object({
              orderId: z.string().trim(),
              orderNumber: z.string().trim(),
              customerId: z.string().trim(),
              customerName: z.string().trim(),
              status: z.string().trim(),
              total: z.number().min(0),
              createdAt: z.string().trim(),
            })
          ),
        }),
        campaignHistory: z.array(z.any()),
      }),
      analytics: z.object({
        stripImpressions: z.number().int().min(0),
        stripClicks: z.number().int().min(0),
        blockImpressions: z.number().int().min(0),
        blockClicks: z.number().int().min(0),
        modalImpressions: z.number().int().min(0),
        modalClicks: z.number().int().min(0),
        guideImpressions: z.number().int().min(0),
        guideVideoClicks: z.number().int().min(0),
        guideImageClicks: z.number().int().min(0),
        pushOpens: z.number().int().min(0),
        lastEventAt: z.string().nullable(),
      }),
      analyticsEvents: z.array(
        z.object({
          eventType: z.enum([
            "strip_impression",
            "strip_click",
            "block_impression",
            "block_click",
            "modal_impression",
            "modal_click",
            "guide_impression",
            "guide_video_click",
            "guide_image_click",
          ]),
          customerId: z.string().trim(),
          customerName: z.string().trim(),
          customerPhone: z.string().trim(),
          occurredAt: z.string().trim(),
        })
      ),
    }),
  }),
  operations: z.object({
    ownerApp: z
      .object({
        webDashboardUrl: z
          .string()
          .trim()
          .url()
          .max(500)
          .optional()
          .default("http://localhost:5173"),
      })
      .optional()
      .default({
        webDashboardUrl: "http://localhost:5173",
      }),
    serviceArea: z.object({
      name: z.string().trim().min(1),
      centerLatitude: z.number().min(-90).max(90),
      centerLongitude: z.number().min(-180).max(180),
      radiusKm: z.number().positive().max(50),
    }),
    deliveryPricing: z.object({
      baseFeeTaka: z.number().int().min(0).max(5000).optional().default(20),
      distanceSurchargeEnabled: z.boolean().optional().default(false),
      surchargeStartsAfterKm: z.number().min(0).max(100).optional().default(2),
      surchargeStepMeters: z.number().int().min(100).max(10000).optional().default(500),
      surchargeAmountTaka: z.number().int().min(0).max(5000).optional().default(5),
    }),
    liveTracking: z.object({
      mode: z.enum(["balanced", "battery_saver", "high_accuracy"]).optional().default("balanced"),
      updateIntervalSeconds: z.number().int().min(10).max(60).optional().default(15),
      distanceIntervalMeters: z.number().int().min(30).max(100).optional().default(60),
      passiveHeartbeatSeconds: z.number().int().min(30).max(180).optional().default(60),
    }),
    payments: z.object({
      cashOnDeliveryEnabled: z.boolean().optional().default(true),
      bkashEnabled: z.boolean().optional().default(false),
      bkashLabel: z.string().trim().min(1).max(40).optional().default("bKash"),
      bkashSubtitle: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .default("Continue to the official hosted payment page."),
    }),
    finance: z
      .object({
        settlementDelayDays: z.number().int().min(0).max(30).optional().default(3),
        minimumPayoutAmountTaka: z.number().int().min(1).max(100000).optional().default(500),
        oneActivePayoutRequest: z.boolean().optional().default(true),
      })
      .optional()
      .default({
        settlementDelayDays: 3,
        minimumPayoutAmountTaka: 500,
        oneActivePayoutRequest: true,
      }),
    adminNotifications: z
      .object({
        orderPlaced: z.boolean().optional().default(true),
        customerOrderUpdates: z.boolean().optional().default(false),
        orderDelays: z.boolean().optional().default(true),
        preparationDelays: z.boolean().optional().default(true),
        riderDelays: z.boolean().optional().default(true),
        deliveryDelays: z.boolean().optional().default(true),
        payoutRequests: z.boolean().optional().default(true),
        support: z.boolean().optional().default(true),
        security: z.boolean().optional().default(true),
        campaigns: z.boolean().optional().default(true),
      })
      .optional()
      .default({
        orderPlaced: true,
        customerOrderUpdates: false,
        orderDelays: true,
        preparationDelays: true,
        riderDelays: true,
        deliveryDelays: true,
        payoutRequests: true,
        support: true,
        security: true,
        campaigns: true,
      }),
    referrals: z
      .object({
        enabled: z.boolean().optional().default(true),
        rewardAmountTaka: z.number().int().min(1).max(10000).optional().default(50),
        minimumOrderAmountTaka: z.number().int().min(0).max(100000).optional().default(250),
        voucherExpiryDays: z.number().int().min(1).max(365).optional().default(30),
        monthlyRewardCapPerCustomer: z.number().int().min(1).max(100).optional().default(5),
        shareLinkTemplate: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .default("foodbela://checkout?ref={{code}}"),
        shareMessageTemplate: z
          .string()
          .trim()
          .min(1)
          .max(700)
          .optional()
          .default(
            "Use my Foodbela referral code {{code}} at checkout before your first delivered order. After your first delivered order, I get a Tk {{rewardAmount}} reward voucher. {{link}}"
          ),
      })
      .optional()
      .default({
        enabled: true,
        rewardAmountTaka: 50,
        minimumOrderAmountTaka: 250,
        voucherExpiryDays: 30,
        monthlyRewardCapPerCustomer: 5,
        shareLinkTemplate: "foodbela://checkout?ref={{code}}",
        shareMessageTemplate:
          "Use my Foodbela referral code {{code}} at checkout before your first delivered order. After your first delivered order, I get a Tk {{rewardAmount}} reward voucher. {{link}}",
      }),
    dispatch: z.object({
      autoAssignmentEnabled: z.boolean(),
      autoReassignTimedOutOrders: z.boolean(),
      dispatchMode: z.enum(["fleet", "primary_rider"]),
      primaryRiderId: z.string(),
      primaryRiderFallbackEnabled: z.boolean(),
      algorithm: z.enum(["nearest_eligible_balanced", "least_loaded_first"]),
      ownerAcceptanceTimeoutMinutes: z.number().int().min(1).max(180),
      maxActiveOrdersPerRider: z.number().int().min(1).max(50),
      staleLocationCutoffMinutes: z.number().int().min(1).max(180),
      assignmentTimeoutMinutes: z.number().int().min(1).max(180),
      prepStartGraceMinutes: z.number().int().min(1).max(180).optional().default(3),
      preparationMaxExtraMinutes: z.number().int().min(0).max(180).optional().default(20),
      prepLateGraceMinutes: z.number().int().min(0).max(180).optional().default(5),
      pickupLateGraceMinutes: z.number().int().min(1).max(180).optional().default(10),
      deliveryLateGraceMinutes: z.number().int().min(1).max(180).optional().default(10),
      deliveryWatchAfterPickupMinutes: z.number().int().min(1).max(240).optional().default(20),
      deliveryLateAfterPickupMinutes: z.number().int().min(1).max(240).optional().default(25),
      deliveryCriticalAfterPickupMinutes: z.number().int().min(1).max(240).optional().default(30),
      retryCooldownMinutes: z.number().int().min(1).max(60),
      surgeReadyOrderThreshold: z.number().int().min(1).max(100),
      surgeUnassignedOrderThreshold: z.number().int().min(1).max(100),
      autoCancelUnacceptedOrdersEnabled: z.boolean().optional().default(false),
      autoCancelAfterMinutes: z.number().int().min(2).max(240).optional().default(12),
      autoCancelNotifyBeforeMinutes: z.number().int().min(1).max(60).optional().default(3),
    }),
  }),
  auth: z.object({
    otp: z.object({
      expiresInSeconds: z.number().int().min(60).max(900),
      resendCooldownSeconds: z.number().int().min(15).max(300),
      messageTemplate: z
        .string()
        .trim()
        .min(20)
        .max(320)
        .refine((value) => value.includes("{{code}}"), {
          message: "OTP message template must include {{code}}",
        }),
    }),
  }),
  supportContact: z.object({
    email: z.string().trim().email(),
    phone: z.string().trim().min(1),
    supportHours: z.string().trim().min(1),
    reportLabel: z.string().trim().min(1),
    directHelpNote: z.string().trim().min(1),
  }),
  helpCenter: z.object({
    categories: z.array(
      z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        description: z.string().trim().min(1),
        iconKey: z.string().trim().min(1),
      })
    ),
    articles: z.array(
      z.object({
        id: z.string().trim().min(1),
        categoryId: z.string().trim().min(1),
        title: z.string().trim().min(1),
        excerpt: z.string().trim().min(1),
        readTime: z.string().trim().min(1),
        sections: z.array(helpArticleSectionSchema),
      })
    ),
    faqs: z.array(
      z.object({
        id: z.string().trim().min(1),
        categoryId: z.string().trim().min(1),
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
      })
    ),
  }),
  legal: z.object({
    privacyPolicy: z.object({
      title: z.string().trim().min(1),
      label: z.string().trim().min(1),
      description: z.string().trim().min(1),
      lastUpdated: z.string().trim().min(1),
      effectiveDate: z.string().trim().min(1),
      overviewTitle: z.string().trim().min(1),
      overviewDescription: z.string().trim().min(1),
      trustTitle: z.string().trim().min(1),
      trustDescription: z.string().trim().min(1),
      sections: z.array(
        z.object({
          id: z.string().trim().min(1),
          title: z.string().trim().min(1),
          body: z.array(z.string().trim().min(1)),
        })
      ),
    }),
    termsAndConditions: z.object({
      title: z.string().trim().min(1),
      label: z.string().trim().min(1),
      description: z.string().trim().min(1),
      noticeTitle: z.string().trim().min(1),
      noticeDescription: z.string().trim().min(1),
      sections: z.array(
        z.object({
          id: z.string().trim().min(1),
          title: z.string().trim().min(1),
          body: z.array(z.string().trim().min(1)),
        })
      ),
    }),
  }),
})

type PlatformContent = z.infer<typeof platformContentSchema>
const defaultPlatformContent = platformContentSchema.parse(platformContent)
export type OperationalFinanceSettings = PlatformContent["operations"]["finance"]
type AdminEditablePlatformContent = {
  content: PlatformContent
  meta: {
    updatedAt: string | null
    updatedByAdminId: string | null
    updatedByAdminName: string
  }
  history: Array<{
    updatedAt: string
    updatedByAdminId: string | null
    updatedByAdminName: string
    changedSections: string[]
  }>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as T
  }

  if (!isObject(base) || !isObject(override)) {
    return (override ?? base) as T
  }

  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key]
    result[key] =
      isObject(baseValue) && isObject(value)
        ? deepMerge(baseValue, value)
        : Array.isArray(baseValue)
          ? (Array.isArray(value) ? value : baseValue)
          : value
  }

  return result as T
}

const CONTENT_KEY = "platform-content"
const platformContentCacheTtlMs = 30_000
const platformContentHistoryLimit = 6
let platformContentCache: { content: PlatformContent; expiresAt: number } | null = null
let adminEditablePlatformContentCache:
  | { content: AdminEditablePlatformContent; expiresAt: number }
  | null = null

const SECTION_LABELS = {
  branding: "Branding",
  customerApp: "Customer App",
  operations: "Operations",
  auth: "Authentication",
  supportContact: "Support Contact",
  helpCategories: "Help Categories",
  helpArticles: "Help Guides",
  helpFaqs: "FAQs",
  privacyPolicy: "Privacy Policy",
  termsAndConditions: "Terms & Conditions",
} as const

function isEqualSection(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getChangedSections(
  previousContent: PlatformContent | null,
  nextContent: PlatformContent
) {
  if (!previousContent) {
    return Object.values(SECTION_LABELS)
  }

  const changedSections: string[] = []

  if (!isEqualSection(previousContent.branding, nextContent.branding)) {
    changedSections.push(SECTION_LABELS.branding)
  }

  if (!isEqualSection(previousContent.customerApp, nextContent.customerApp)) {
    changedSections.push(SECTION_LABELS.customerApp)
  }

  if (!isEqualSection(previousContent.operations, nextContent.operations)) {
    changedSections.push(SECTION_LABELS.operations)
  }

  if (!isEqualSection(previousContent.auth, nextContent.auth)) {
    changedSections.push(SECTION_LABELS.auth)
  }

  if (!isEqualSection(previousContent.supportContact, nextContent.supportContact)) {
    changedSections.push(SECTION_LABELS.supportContact)
  }

  if (
    !isEqualSection(
      previousContent.helpCenter.categories,
      nextContent.helpCenter.categories
    )
  ) {
    changedSections.push(SECTION_LABELS.helpCategories)
  }

  if (
    !isEqualSection(previousContent.helpCenter.articles, nextContent.helpCenter.articles)
  ) {
    changedSections.push(SECTION_LABELS.helpArticles)
  }

  if (!isEqualSection(previousContent.helpCenter.faqs, nextContent.helpCenter.faqs)) {
    changedSections.push(SECTION_LABELS.helpFaqs)
  }

  if (
    !isEqualSection(previousContent.legal.privacyPolicy, nextContent.legal.privacyPolicy)
  ) {
    changedSections.push(SECTION_LABELS.privacyPolicy)
  }

  if (
    !isEqualSection(
      previousContent.legal.termsAndConditions,
      nextContent.legal.termsAndConditions
    )
  ) {
    changedSections.push(SECTION_LABELS.termsAndConditions)
  }

  return changedSections.length > 0 ? changedSections : ["No visible section change"]
}

function mapAdminEditablePlatformContent(
  content: PlatformContent,
  contentDoc?: {
    updatedAt?: Date | string | null
    updatedByAdminId?: string | null
    updatedByAdminName?: string | null
    history?: Array<{
      updatedAt: Date | string
      updatedByAdminId?: string | null
      updatedByAdminName?: string | null
      changedSections?: string[] | null
    }>
  } | null
) {
  const toIsoStringOrNull = (value: Date | string | null | undefined) => {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  return {
    content,
    meta: {
      updatedAt: toIsoStringOrNull(contentDoc?.updatedAt),
      updatedByAdminId: contentDoc?.updatedByAdminId ?? null,
      updatedByAdminName: contentDoc?.updatedByAdminName ?? "",
    },
    history:
      contentDoc?.history?.map((entry) => ({
        updatedAt: toIsoStringOrNull(entry.updatedAt) ?? "",
        updatedByAdminId:
          typeof entry.updatedByAdminId === "string" ? entry.updatedByAdminId : null,
        updatedByAdminName:
          typeof entry.updatedByAdminName === "string" ? entry.updatedByAdminName : "",
        changedSections:
          Array.isArray(entry.changedSections) && entry.changedSections.length > 0
            ? entry.changedSections.filter((value): value is string => typeof value === "string")
            : ["Unknown change"],
      })) ?? [],
  } satisfies AdminEditablePlatformContent
}

export async function getPlatformContent() {
  if (platformContentCache && platformContentCache.expiresAt > Date.now()) {
    return platformContentCache.content
  }

  const contentDoc = await PublicContentModel.findOne({ key: CONTENT_KEY })
    .select({ content: 1 })
    .lean()
  const content = contentDoc?.content
    ? deepMerge(defaultPlatformContent, contentDoc.content)
    : defaultPlatformContent

  platformContentCache = {
    content,
    expiresAt: Date.now() + platformContentCacheTtlMs
  }

  return content
}

export async function getOperationalFinanceSettings(): Promise<OperationalFinanceSettings> {
  const content = await getPlatformContent()
  return content.operations.finance
}

export async function getAdminEditablePlatformContent() {
  if (
    adminEditablePlatformContentCache &&
    adminEditablePlatformContentCache.expiresAt > Date.now()
  ) {
    return adminEditablePlatformContentCache.content
  }

  const contentDoc = await PublicContentModel.findOne({ key: CONTENT_KEY })
    .select({
      content: 1,
      updatedAt: 1,
      updatedByAdminId: 1,
      updatedByAdminName: 1,
      history: 1,
    })
    .slice("history", -platformContentHistoryLimit)
    .lean()
  const content = contentDoc?.content
    ? deepMerge(defaultPlatformContent, contentDoc.content)
    : defaultPlatformContent

  const mapped = mapAdminEditablePlatformContent(content, contentDoc)
  adminEditablePlatformContentCache = {
    content: mapped,
    expiresAt: Date.now() + platformContentCacheTtlMs,
  }
  return mapped
}

export async function updatePlatformContent(params: {
  content: unknown
  adminId: string
}) {
  platformContentCache = null
  adminEditablePlatformContentCache = null
  const parsed = platformContentSchema.parse(params.content)
  const [admin, currentDoc] = await Promise.all([
    AdminModel.findById(params.adminId).select({ fullName: 1 }).lean(),
    PublicContentModel.findOne({ key: CONTENT_KEY }).select({ content: 1 }).lean(),
  ])
  const adminName = admin?.fullName ?? "Support Team"
  const currentContent = currentDoc?.content
    ? deepMerge(defaultPlatformContent, currentDoc.content)
    : null
  const nextUpdatedAt = new Date()
  const changedSections = getChangedSections(currentContent, parsed)
  const nextHistoryEntry = {
    updatedByAdminId: params.adminId,
    updatedByAdminName: adminName,
    updatedAt: nextUpdatedAt,
    changedSections,
    content: parsed,
  }

  await PublicContentModel.updateOne(
    { key: CONTENT_KEY },
    {
      $set: {
        key: CONTENT_KEY,
        content: parsed,
        updatedByAdminId: params.adminId,
        updatedByAdminName: adminName,
      },
      $push: {
        history: {
          $each: [nextHistoryEntry],
          $slice: -platformContentHistoryLimit,
        },
      },
    },
    {
      upsert: true,
      setDefaultsOnInsert: true,
    }
  )

  const mapped = mapAdminEditablePlatformContent(parsed, {
    updatedAt: nextUpdatedAt,
    updatedByAdminId: params.adminId,
    updatedByAdminName: adminName,
    history: [nextHistoryEntry],
  })
  adminEditablePlatformContentCache = {
    content: mapped,
    expiresAt: Date.now() + platformContentCacheTtlMs,
  }
  platformContentCache = {
    content: parsed,
    expiresAt: Date.now() + platformContentCacheTtlMs,
  }
  return mapped
}

export async function recordCustomerHomeCmsEvent(params: {
  eventType:
    | "strip_impression"
    | "strip_click"
    | "block_impression"
    | "block_click"
    | "modal_impression"
    | "modal_click"
    | "guide_impression"
    | "guide_video_click"
    | "guide_image_click"
  customerId?: string
}) {
  const incrementKeyByEvent = {
    strip_impression: "content.customerApp.homeCms.analytics.stripImpressions",
    strip_click: "content.customerApp.homeCms.analytics.stripClicks",
    block_impression: "content.customerApp.homeCms.analytics.blockImpressions",
    block_click: "content.customerApp.homeCms.analytics.blockClicks",
    modal_impression: "content.customerApp.homeCms.analytics.modalImpressions",
    modal_click: "content.customerApp.homeCms.analytics.modalClicks",
    guide_impression: "content.customerApp.homeCms.analytics.guideImpressions",
    guide_video_click: "content.customerApp.homeCms.analytics.guideVideoClicks",
    guide_image_click: "content.customerApp.homeCms.analytics.guideImageClicks",
  } as const
  const incrementKey = incrementKeyByEvent[params.eventType]
  const occurredAt = new Date().toISOString()
  const customer = params.customerId
    ? await CustomerModel.findById(params.customerId).select("fullName phone").lean()
    : null
  const event = {
    eventType: params.eventType,
    customerId: params.customerId ?? "",
    customerName: String(customer?.fullName ?? ""),
    customerPhone: String(customer?.phone ?? ""),
    occurredAt,
  }

  await PublicContentModel.updateOne(
    { key: CONTENT_KEY },
    {
      $inc: { [incrementKey]: 1 },
      $set: { "content.customerApp.homeCms.analytics.lastEventAt": occurredAt },
      $push: {
        "content.customerApp.homeCms.analyticsEvents": {
          $each: [event],
          $position: 0,
          $slice: 300,
        },
      },
    },
    { upsert: false }
  )

  return { recorded: true }
}

async function buildHomePushCustomerQuery(pushCampaign: PlatformContent["customerApp"]["homeCms"]["pushCampaign"]) {
  const query: Record<string, unknown> = { status: "active" }

  if (pushCampaign.audienceType === "selected_users") {
    query._id = { $in: pushCampaign.selectedCustomerIds }
  } else if (pushCampaign.audienceType === "new_users") {
    query._id = { $nin: await OrderModel.distinct("customerId", {}) }
  } else if (pushCampaign.audienceType === "returning_users") {
    query._id = { $in: await OrderModel.distinct("customerId", {}) }
  }

  if (pushCampaign.customerGroupKey === "has_push_token") {
    query["pushTokens.0"] = { $exists: true }
  } else if (pushCampaign.customerGroupKey === "ordered_last_30_days") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const customerIds = await OrderModel.distinct("customerId", { createdAt: { $gte: since } })
    query._id = { ...(typeof query._id === "object" && query._id ? query._id : {}), $in: customerIds }
  } else if (pushCampaign.customerGroupKey === "inactive_30_days") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const customerIds = await OrderModel.distinct("customerId", { createdAt: { $gte: since } })
    query._id = { ...(typeof query._id === "object" && query._id ? query._id : {}), $nin: customerIds }
  } else if (pushCampaign.customerGroupKey === "high_value_customers") {
    const rows = await OrderModel.aggregate([
      { $match: { status: "Delivered" } },
      { $group: { _id: "$customerId", totalSpend: { $sum: { $toDouble: { $ifNull: ["$pricing.total", 0] } } } } },
      { $match: { totalSpend: { $gte: 1000 } } },
      { $limit: 2000 },
    ])
    const customerIds = rows.map((row) => String(row._id)).filter(Boolean)
    query._id = { ...(typeof query._id === "object" && query._id ? query._id : {}), $in: customerIds }
  }

  if (
    pushCampaign.restaurantScope === "selected_restaurants" &&
    pushCampaign.selectedRestaurantIds.length > 0
  ) {
    const customerIds = await OrderModel.distinct("customerId", {
      restaurantId: { $in: pushCampaign.selectedRestaurantIds },
    })
    query._id = query._id
      ? { ...(query._id as Record<string, unknown>), $in: customerIds }
      : { $in: customerIds }
  }

  return query
}

async function calculateCampaignConversions(params: {
  sentAt: string
  customerIds: string[]
  windowDays: number
}) {
  const start = new Date(params.sentAt)
  const end = new Date(start.getTime() + params.windowDays * 24 * 60 * 60 * 1000)
  const orders = await OrderModel.find(
    {
      customerId: { $in: params.customerIds },
      createdAt: { $gte: start, $lte: end },
    },
    { customerId: 1, status: 1, pricing: 1, orderNumber: 1, customerSnapshot: 1, createdAt: 1 }
  ).lean()
  const deliveredOrders = orders.filter((order) => order.status === "Delivered")
  const deliveredRevenue = deliveredOrders.reduce(
    (sum, order) => sum + Number((order.pricing as { total?: number } | undefined)?.total ?? 0),
    0
  )
  const uniqueOrderingCustomers = new Set(orders.map((order) => String(order.customerId))).size

  return {
    orderCount: orders.length,
    deliveredOrderCount: deliveredOrders.length,
    deliveredRevenue,
    uniqueOrderingCustomers,
    conversionRate: params.customerIds.length
      ? Math.round((uniqueOrderingCustomers / params.customerIds.length) * 10000) / 100
      : 0,
    refreshedAt: new Date().toISOString(),
    convertedOrders: orders.slice(0, 200).map((order) => ({
      orderId: String(order._id),
      orderNumber: String(order.orderNumber ?? ""),
      customerId: String(order.customerId ?? ""),
      customerName: String((order.customerSnapshot as { fullName?: string; name?: string } | undefined)?.fullName ?? (order.customerSnapshot as { name?: string } | undefined)?.name ?? ""),
      status: String(order.status ?? ""),
      total: Number((order.pricing as { total?: number } | undefined)?.total ?? 0),
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
    })),
  }
}

export async function sendCustomerHomeCmsPushCampaign(params: { adminId: string }) {
  const editor = await getAdminEditablePlatformContent()
  const content = editor.content
  const pushCampaign = content.customerApp.homeCms.pushCampaign

  if (!pushCampaign.title.trim() || !pushCampaign.body.trim()) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "HOME_PUSH_NOT_READY",
      "Push title and body are required"
    )
  }

  const customerQuery = await buildHomePushCustomerQuery(pushCampaign)
  const customers = await CustomerModel.find(customerQuery, { _id: 1, fullName: 1, phone: 1 }).limit(5000).lean()
  let sentCount = 0
  let disabledCount = 0
  const sentExpoTokens = new Set<string>()
  const sentAt = new Date().toISOString()
  const campaignId = `home-${Date.now()}`
  const recipientEvents: Array<{
    customerId: string
    customerName: string
    customerPhone: string
    sentAt: string
    status: "sent" | "in_app_only" | "preference_disabled" | "failed"
    expoTokenCount: number
    ticketIds: string[]
    receiptStatus: "pending" | "failed"
    receiptCheckedAt: null
    receiptError: string
    variant: "A" | "B"
  }> = []

  for (const [index, customer] of customers.entries()) {
    const useVariantB =
      pushCampaign.abTest.enabled &&
      Boolean(pushCampaign.abTest.variantBTitle.trim()) &&
      Boolean(pushCampaign.abTest.variantBBody.trim()) &&
      index % 100 < pushCampaign.abTest.splitPercent
    const variant = useVariantB ? "B" : "A"
    const title = useVariantB ? pushCampaign.abTest.variantBTitle : pushCampaign.title
    const body = useVariantB ? pushCampaign.abTest.variantBBody : pushCampaign.body
    const path = useVariantB && pushCampaign.abTest.variantBPath ? pushCampaign.abTest.variantBPath : pushCampaign.path
    const result = await sendPushToCustomer({
      customerId: String(customer._id),
      excludeExpoTokens: sentExpoTokens,
      payload: {
        title: pushCampaign.contentType === "image" ? title || "Foodbela" : title,
        body: pushCampaign.contentType === "image" ? body || "Open Foodbela to see this offer." : body,
        imageUrl:
          pushCampaign.contentType === "image" || pushCampaign.contentType === "image_text"
            ? pushCampaign.imageUrl
            : undefined,
        data: {
          type: "promotion",
          path: path || "/(tabs)/browse",
          source: "customer_home_cms",
          campaignId,
          variant,
          imageUrl: pushCampaign.imageUrl,
          contentType: pushCampaign.contentType,
        },
      },
    })
    sentCount += result.sent
    disabledCount += result.disabled
    result.sentExpoTokens.forEach((token) => sentExpoTokens.add(token))
    recipientEvents.push({
      customerId: String(customer._id),
      customerName: String(customer.fullName ?? ""),
      customerPhone: String(customer.phone ?? ""),
      sentAt,
      status: result.skipped
        ? "preference_disabled"
        : result.sent > 0
          ? "sent"
          : result.disabled > 0
            ? "failed"
            : "in_app_only",
      expoTokenCount: result.sent,
      ticketIds: result.ticketIds,
      receiptStatus: result.sent > 0 && result.ticketIds.length > 0 ? "pending" : "failed",
      receiptCheckedAt: null,
      receiptError:
        result.sent > 0
          ? ""
          : result.skipped
            ? "Customer notification preference disabled"
            : "No active push token or Expo rejected the push",
      variant,
    })
  }

  const nextContent: PlatformContent = {
    ...content,
    customerApp: {
      ...content.customerApp,
      homeCms: {
        ...content.customerApp.homeCms,
        pushCampaign: {
          ...pushCampaign,
          currentCampaignId: campaignId,
          lastSentAt: sentAt,
          totalTargets: customers.length,
          sentCount,
          disabledCount,
          openCount: 0,
          recipientEvents: recipientEvents.slice(0, 500),
          openEvents: [],
          receiptCheckedAt: null,
          scheduledAt: null,
          scheduleStatus: "sent",
          scheduledByAdminId: "",
          scheduledCreatedAt: null,
          scheduleHistory:
            pushCampaign.scheduleStatus === "sending" || pushCampaign.scheduleStatus === "scheduled"
              ? [
                  {
                    action: "sent" as const,
                    scheduledAt: pushCampaign.scheduledAt,
                    occurredAt: sentAt,
                    adminId: params.adminId,
                    note: pushCampaign.title,
                  },
                  ...(pushCampaign.scheduleHistory ?? []),
                ].slice(0, 20)
              : pushCampaign.scheduleHistory,
          conversions: {
            orderCount: 0,
            deliveredOrderCount: 0,
            deliveredRevenue: 0,
            uniqueOrderingCustomers: 0,
            conversionRate: 0,
            refreshedAt: null,
            convertedOrders: [],
          },
          campaignHistory: [
            {
              campaignId,
              contentType: pushCampaign.contentType,
              title: pushCampaign.title,
              body: pushCampaign.body,
              imageUrl: pushCampaign.imageUrl,
              path: pushCampaign.path,
              audienceType: pushCampaign.audienceType,
              restaurantScope: pushCampaign.restaurantScope,
              abTest: pushCampaign.abTest,
              sentAt,
              totalTargets: customers.length,
              sentCount,
              disabledCount,
              openCount: 0,
              recipientEvents: recipientEvents.slice(0, 500),
              openEvents: [],
              receiptCheckedAt: null,
              conversionWindowDays: pushCampaign.conversionWindowDays,
              conversions: {
                orderCount: 0,
                deliveredOrderCount: 0,
                deliveredRevenue: 0,
                uniqueOrderingCustomers: 0,
                conversionRate: 0,
                refreshedAt: null,
                convertedOrders: [],
              },
            },
            ...pushCampaign.campaignHistory,
          ].slice(0, 20),
        },
      },
    },
  }

  await updatePlatformContent({ content: nextContent, adminId: params.adminId })

  return {
    totalTargets: customers.length,
    sentCount,
    disabledCount,
  }
}

export async function sendCustomerHomeCmsTestPush(params: {
  adminId: string
  customerId: string
}) {
  const editor = await getAdminEditablePlatformContent()
  const pushCampaign = editor.content.customerApp.homeCms.pushCampaign

  if (!params.customerId.trim()) {
    throw new AppError(StatusCodes.BAD_REQUEST, "TEST_CUSTOMER_REQUIRED", "Test customer is required")
  }
  if (!pushCampaign.title.trim() || !pushCampaign.body.trim()) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "HOME_PUSH_NOT_READY",
      "Push title and body are required"
    )
  }
  if (pushCampaign.contentType !== "text" && !pushCampaign.imageUrl.trim()) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PUSH_IMAGE_REQUIRED",
      "Image is required for image push campaigns"
    )
  }

  const result = await sendPushToCustomer({
    customerId: params.customerId,
    payload: {
      title: `[TEST] ${pushCampaign.contentType === "image" ? pushCampaign.title || "Foodbela" : pushCampaign.title}`,
      body:
        pushCampaign.contentType === "image"
          ? pushCampaign.body || "Open Foodbela to see this offer."
          : pushCampaign.body,
      imageUrl:
        pushCampaign.contentType === "image" || pushCampaign.contentType === "image_text"
          ? pushCampaign.imageUrl
          : undefined,
      data: {
        type: "promotion",
        path: pushCampaign.path || "/(tabs)/browse",
        source: "customer_home_cms_test",
        campaignId: "customer_home_cms_test",
        imageUrl: pushCampaign.imageUrl,
        contentType: pushCampaign.contentType,
      },
    },
  })

  return {
    sentCount: result.sent,
    disabledCount: result.disabled,
    ticketIds: result.ticketIds,
  }
}

export async function recordCustomerHomePushOpen(params: {
  customerId: string
  path?: string
  campaignId?: string
  variant?: "A" | "B"
}) {
  const customer = await CustomerModel.findById(params.customerId)
    .select("fullName phone")
    .lean()
  const openedAt = new Date().toISOString()
  const event = {
    customerId: params.customerId,
    customerName: String(customer?.fullName ?? ""),
    customerPhone: String(customer?.phone ?? ""),
    openedAt,
    path: params.path ?? "",
    campaignId: params.campaignId ?? "",
    variant: params.variant,
  }
  const content = await getPlatformContent()
  const pushCampaign = content.customerApp.homeCms.pushCampaign
  const campaignId = params.campaignId || pushCampaign.currentCampaignId
  const nextHistory = pushCampaign.campaignHistory.map((campaign: any) =>
    campaign.campaignId === campaignId
      ? {
          ...campaign,
          openCount: Number(campaign.openCount ?? 0) + 1,
          openEvents: [event, ...(campaign.openEvents ?? [])].slice(0, 100),
        }
      : campaign
  )

  await PublicContentModel.updateOne(
    { key: CONTENT_KEY },
    {
      $inc: {
        "content.customerApp.homeCms.analytics.pushOpens": 1,
        "content.customerApp.homeCms.pushCampaign.openCount": 1,
      },
      $set: {
        "content.customerApp.homeCms.analytics.lastEventAt": openedAt,
        "content.customerApp.homeCms.pushCampaign.campaignHistory": nextHistory,
      },
      $push: {
        "content.customerApp.homeCms.pushCampaign.openEvents": {
          $each: [event],
          $position: 0,
          $slice: 100,
        },
      },
    }
  )

  return { recorded: true }
}

export async function checkCustomerHomeCmsPushReceipts(params: { adminId: string }) {
  const editor = await getAdminEditablePlatformContent()
  const content = editor.content
  const pushCampaign = content.customerApp.homeCms.pushCampaign
  const ticketIds = pushCampaign.recipientEvents.flatMap((event) => event.ticketIds ?? [])

  if (!ticketIds.length) {
    return {
      checked: 0,
      deliveredToProvider: 0,
      failed: 0,
      deviceNotRegistered: 0,
    }
  }

  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ ids: ticketIds.slice(0, 1000) }),
  })

  if (!response.ok) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      "PUSH_RECEIPT_CHECK_FAILED",
      "Expo receipt check failed"
    )
  }

  const payload = (await response.json()) as {
    data?: Record<
      string,
      {
        status?: "ok" | "error"
        message?: string
        details?: { error?: string }
      }
    >
  }
  const receipts = payload.data ?? {}
  const checkedAt = new Date().toISOString()
  let deliveredToProvider = 0
  let failed = 0
  let deviceNotRegistered = 0

  const nextRecipientEvents = pushCampaign.recipientEvents.map((event) => {
    const eventTicketIds = event.ticketIds ?? []
    const eventReceipts = eventTicketIds.map((ticketId) => receipts[ticketId]).filter(Boolean)

    if (!eventReceipts.length) return event

    const errorReceipt = eventReceipts.find((receipt) => receipt.status === "error")
    if (errorReceipt) {
      failed += 1
      if (errorReceipt.details?.error === "DeviceNotRegistered") {
        deviceNotRegistered += 1
        return {
          ...event,
          status: "failed" as const,
          receiptStatus: "device_not_registered" as const,
          receiptCheckedAt: checkedAt,
          receiptError: "Device not registered. The app may be uninstalled or the token expired.",
        }
      }
      return {
        ...event,
        status: "failed" as const,
        receiptStatus: "failed" as const,
        receiptCheckedAt: checkedAt,
        receiptError: errorReceipt.message ?? errorReceipt.details?.error ?? "Expo delivery failed",
      }
    }

    deliveredToProvider += 1
    return {
      ...event,
      receiptStatus: "delivered_to_provider" as const,
      receiptCheckedAt: checkedAt,
      receiptError: "",
    }
  })
  const nextHistory = pushCampaign.campaignHistory.map((campaign: any) =>
    campaign.campaignId === pushCampaign.currentCampaignId
      ? {
          ...campaign,
          recipientEvents: nextRecipientEvents,
          receiptCheckedAt: checkedAt,
        }
      : campaign
  )

  const nextContent: PlatformContent = {
    ...content,
    customerApp: {
      ...content.customerApp,
      homeCms: {
        ...content.customerApp.homeCms,
        pushCampaign: {
          ...pushCampaign,
          recipientEvents: nextRecipientEvents,
          receiptCheckedAt: checkedAt,
          campaignHistory: nextHistory,
        },
      },
    },
  }

  await updatePlatformContent({ content: nextContent, adminId: params.adminId })

  return {
    checked: ticketIds.length,
    deliveredToProvider,
    failed,
    deviceNotRegistered,
  }
}

export async function refreshCustomerHomeCmsPushConversions(params: { adminId: string }) {
  const editor = await getAdminEditablePlatformContent()
  const content = editor.content
  const pushCampaign = content.customerApp.homeCms.pushCampaign
  const currentCustomerIds = pushCampaign.recipientEvents.map((event) => event.customerId).filter(Boolean)
  const currentConversions = pushCampaign.lastSentAt
    ? await calculateCampaignConversions({
        sentAt: pushCampaign.lastSentAt,
        customerIds: currentCustomerIds,
        windowDays: pushCampaign.conversionWindowDays,
      })
    : pushCampaign.conversions

  const nextHistory = await Promise.all(
    pushCampaign.campaignHistory.map(async (campaign: any) => ({
      ...campaign,
      conversions: await calculateCampaignConversions({
        sentAt: campaign.sentAt,
        customerIds: (campaign.recipientEvents ?? []).map((event: { customerId?: string }) => event.customerId).filter(Boolean),
        windowDays: campaign.conversionWindowDays ?? pushCampaign.conversionWindowDays,
      }),
    }))
  )

  const nextContent: PlatformContent = {
    ...content,
    customerApp: {
      ...content.customerApp,
      homeCms: {
        ...content.customerApp.homeCms,
        pushCampaign: {
          ...pushCampaign,
          conversions: currentConversions,
          campaignHistory: nextHistory,
        },
      },
    },
  }

  await updatePlatformContent({ content: nextContent, adminId: params.adminId })

  return currentConversions
}

export async function scheduleCustomerHomeCmsPushCampaign(params: {
  adminId: string
  scheduledAt: string
}) {
  const scheduledDate = new Date(params.scheduledAt)
  if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_PUSH_SCHEDULE",
      "Schedule time must be in the future"
    )
  }

  const editor = await getAdminEditablePlatformContent()
  const content = editor.content
  const pushCampaign = content.customerApp.homeCms.pushCampaign
  const occurredAt = new Date().toISOString()

  if (pushCampaign.contentType !== "text" && !pushCampaign.imageUrl.trim()) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PUSH_IMAGE_REQUIRED",
      "Image is required for image push campaigns"
    )
  }

  const nextContent: PlatformContent = {
    ...content,
    customerApp: {
      ...content.customerApp,
      homeCms: {
        ...content.customerApp.homeCms,
        pushCampaign: {
          ...pushCampaign,
          scheduledAt: scheduledDate.toISOString(),
          scheduleStatus: "scheduled",
          scheduledByAdminId: params.adminId,
          scheduledCreatedAt: occurredAt,
          scheduleHistory: [
            {
              action: "scheduled" as const,
              scheduledAt: scheduledDate.toISOString(),
              occurredAt,
              adminId: params.adminId,
              note: pushCampaign.title,
            },
            ...(pushCampaign.scheduleHistory ?? []),
          ].slice(0, 20),
        },
      },
    },
  }

  await updatePlatformContent({ content: nextContent, adminId: params.adminId })

  return {
    scheduledAt: scheduledDate.toISOString(),
    scheduleStatus: "scheduled",
  }
}

export async function cancelCustomerHomeCmsPushSchedule(params: { adminId: string }) {
  const editor = await getAdminEditablePlatformContent()
  const content = editor.content
  const pushCampaign = content.customerApp.homeCms.pushCampaign
  const occurredAt = new Date().toISOString()
  const nextContent: PlatformContent = {
    ...content,
    customerApp: {
      ...content.customerApp,
      homeCms: {
        ...content.customerApp.homeCms,
        pushCampaign: {
          ...pushCampaign,
          scheduledAt: null,
          scheduleStatus: "cancelled",
          scheduledByAdminId: "",
          scheduledCreatedAt: null,
          scheduleHistory: [
            {
              action: "cancelled" as const,
              scheduledAt: pushCampaign.scheduledAt,
              occurredAt,
              adminId: params.adminId,
              note: pushCampaign.title,
            },
            ...(pushCampaign.scheduleHistory ?? []),
          ].slice(0, 20),
        },
      },
    },
  }

  await updatePlatformContent({ content: nextContent, adminId: params.adminId })
  return { scheduleStatus: "cancelled" }
}

export async function processDueCustomerHomeCmsPushCampaigns() {
  const editor = await getAdminEditablePlatformContent()
  const pushCampaign = editor.content.customerApp.homeCms.pushCampaign
  if (pushCampaign.scheduleStatus !== "scheduled" || !pushCampaign.scheduledAt) {
    return { processed: false }
  }
  if (new Date(pushCampaign.scheduledAt).getTime() > Date.now()) {
    return { processed: false }
  }

  const sendingContent: PlatformContent = {
    ...editor.content,
    customerApp: {
      ...editor.content.customerApp,
      homeCms: {
        ...editor.content.customerApp.homeCms,
        pushCampaign: {
          ...pushCampaign,
          scheduleStatus: "sending",
        },
      },
    },
  }
  await updatePlatformContent({
    content: sendingContent,
    adminId: pushCampaign.scheduledByAdminId || "system-admin",
  })

  try {
    const result = await sendCustomerHomeCmsPushCampaign({
      adminId: pushCampaign.scheduledByAdminId || "system-admin",
    })
    return { processed: true, result }
  } catch (error) {
    const failedEditor = await getAdminEditablePlatformContent()
    const failedPush = failedEditor.content.customerApp.homeCms.pushCampaign
    const occurredAt = new Date().toISOString()
    await updatePlatformContent({
      adminId: pushCampaign.scheduledByAdminId || "system-admin",
      content: {
        ...failedEditor.content,
        customerApp: {
          ...failedEditor.content.customerApp,
          homeCms: {
            ...failedEditor.content.customerApp.homeCms,
            pushCampaign: {
              ...failedPush,
              scheduleStatus: "failed",
              scheduleHistory: [
                {
                  action: "failed" as const,
                  scheduledAt: failedPush.scheduledAt,
                  occurredAt,
                  adminId: pushCampaign.scheduledByAdminId || "system-admin",
                  note: error instanceof Error ? error.message : "Scheduled push failed",
                },
                ...(failedPush.scheduleHistory ?? []),
              ].slice(0, 20),
            },
          },
        },
      },
    })
    throw error
  }
}

export async function rollbackPlatformContent(params: {
  updatedAt: string
  adminId: string
}) {
  adminEditablePlatformContentCache = null
  platformContentCache = null
  const rollbackUpdatedAt = new Date(params.updatedAt)
  if (Number.isNaN(rollbackUpdatedAt.getTime())) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_ROLLBACK_TARGET",
      "Choose a valid content history entry to restore."
    )
  }

  const admin = await AdminModel.findById(params.adminId)
    .select({ fullName: 1 })
    .lean()
  const adminName = admin?.fullName ?? "Support Team"
  const currentDoc = await PublicContentModel.findOne({
    key: CONTENT_KEY,
    "history.updatedAt": rollbackUpdatedAt,
  })
    .select({
      content: 1,
      updatedAt: 1,
      updatedByAdminId: 1,
      updatedByAdminName: 1,
      history: { $elemMatch: { updatedAt: rollbackUpdatedAt } },
    })
    .lean()

  if (!currentDoc) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "PLATFORM_CONTENT_NOT_FOUND",
      "No platform content is available to roll back."
    )
  }

  const historyEntry = currentDoc.history?.[0]

  if (!historyEntry?.content) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ROLLBACK_ENTRY_NOT_FOUND",
      "The selected history entry could not be found."
    )
  }

  const restoredContent = platformContentSchema.parse(
    deepMerge(defaultPlatformContent, historyEntry.content)
  )
  const currentContent = currentDoc.content
    ? deepMerge(defaultPlatformContent, currentDoc.content)
    : null
  const nextUpdatedAt = new Date()
  const changedSections = [
    ...getChangedSections(currentContent, restoredContent),
    "Rollback",
  ]
  const nextHistoryEntry = {
    updatedByAdminId: params.adminId,
    updatedByAdminName: adminName,
    updatedAt: nextUpdatedAt,
    changedSections,
    content: restoredContent,
  }

  await PublicContentModel.updateOne(
    { key: CONTENT_KEY },
    {
      $set: {
        key: CONTENT_KEY,
        content: restoredContent,
        updatedByAdminId: params.adminId,
        updatedByAdminName: adminName,
      },
      $push: {
        history: {
          $each: [nextHistoryEntry],
          $slice: -platformContentHistoryLimit,
        },
      },
    }
  )

  const mapped = mapAdminEditablePlatformContent(restoredContent, {
    updatedAt: nextUpdatedAt,
    updatedByAdminId: params.adminId,
    updatedByAdminName: adminName,
    history: [nextHistoryEntry],
  })
  adminEditablePlatformContentCache = {
    content: mapped,
    expiresAt: Date.now() + platformContentCacheTtlMs,
  }
  platformContentCache = {
    content: restoredContent,
    expiresAt: Date.now() + platformContentCacheTtlMs,
  }
  return mapped
}
