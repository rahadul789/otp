import mongoose from "mongoose";

import { CustomerModel } from "../customer/customer.model";
import {
  createCustomerNotification,
  sendPushToCustomer,
} from "../customer/push.service";
import { NotificationModel, OrderModel } from "../owner/operational.model";
import { createOwnerNotification } from "../owner/operational.service";
import { getPlatformContent } from "../public/content.service";
import { sendPushToRider } from "../rider/push.service";
import { OwnerModel, RestaurantModel, RiderModel } from "../auth/auth.model";
import { recordBusinessEvent } from "./business-event.service";
import {
  classifyCustomerNotification,
  getAdminNotificationSettings,
  isAdminNotificationCategoryEnabled,
  isAdminNotificationItemEnabled,
} from "./admin-notification-settings";
import { AdminCustomerGroupModel } from "./customer-group.model";
import { AdminNotificationScheduleModel } from "./notification-schedule.model";
import {
  listAdminOperationalAlerts,
  markAdminOperationalAlertRead,
  markAllAdminOperationalAlertsRead,
} from "./admin-alert.service";

type NotificationSource = "all" | "customer" | "owner" | "rider" | "campaign" | "scheduled" | "ops";
type NotificationStatus = "all" | "read" | "unread";
type RecipientType = "customers" | "owners" | "riders";
type RecipientAudience = "all" | "selected";

type ListParams = {
  source?: NotificationSource;
  status?: NotificationStatus;
  search?: string;
  page?: number;
  pageSize?: number;
};

type RecipientReportStatus = "all" | "received" | "opened" | "not_reached";
type CampaignRecipientReport = {
  items: Array<Record<string, any>>;
  total: number;
  summary: { total: number; received: number; opened: number; notReached: number };
};

type SendParams = {
  recipientType: RecipientType;
  audience: RecipientAudience;
  recipientIds?: string[];
  title: string;
  body: string;
  path?: string;
  ctaLabel?: string;
  ctaPath?: string;
  type?: string;
  contentType?: "text" | "image" | "image_text";
  imageUrl?: string;
  imagePublicId?: string;
  customerAudienceType?: "all_users" | "new_users" | "returning_users" | "selected_users";
  customerGroupKey?: string;
  restaurantScope?: "all_restaurants" | "selected_restaurants";
  selectedRestaurantIds?: string[];
  abTest?: {
    enabled?: boolean;
    splitPercent?: number;
    variantBTitle?: string;
    variantBBody?: string;
    variantBPath?: string;
  };
  conversionWindowDays?: number;
  campaignId?: string;
  testMode?: boolean;
  pushEnabled?: boolean;
  scheduledAt?: string;
  adminId?: string;
};

const MAX_PAGE_SIZE = 100;
const MAX_NOTIFICATION_SOURCE_FETCH = 1000;
const EMBEDDED_NOTIFICATION_SCAN_WINDOW = 100;
const CUSTOMER_PROMO_TYPES = new Set(["promotion", "voucher", "campaign"]);

type NotificationListItem = Record<string, any>;
type NotificationQueryResult = {
  items: NotificationListItem[];
  total: number;
  unread: number;
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function objectIdString(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && "toString" in value) return String(value);
  return "";
}

function serializeDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePage(params: ListParams) {
  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.pageSize ?? 20)));
  return { page, pageSize };
}

function normalizeOwnerNotificationType(type: string) {
  if (type === "order_status") return "order";
  if (["order", "payout", "system", "promotion", "support", "review"].includes(type)) {
    return type as "order" | "payout" | "system" | "promotion" | "support" | "review";
  }
  return "system";
}

function matchesSearch(item: Record<string, any>, search?: string) {
  if (!search?.trim()) return true;
  const needle = search.trim().toLowerCase();
  return [
    item.title,
    item.description,
    item.recipientName,
    item.recipientPhone,
    item.source,
    item.type,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function filterStatus(item: Record<string, any>, status?: NotificationStatus) {
  if (!status || status === "all") return true;
  if (status === "read") return item.isRead === true;
  return item.isRead === false;
}

function emptyNotificationResult(): NotificationQueryResult {
  return { items: [], total: 0, unread: 0 };
}

function escapeRegexValue(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchRegex(search?: string) {
  const value = search?.trim();
  return value ? new RegExp(escapeRegexValue(value), "i") : null;
}

function isCustomerPromoNotification(recipientType: RecipientType, type: string) {
  return recipientType === "customers" && CUSTOMER_PROMO_TYPES.has(type);
}

function buildPromoDetailsPath(campaignId: string) {
  return `/promo-details?campaignId=${encodeURIComponent(campaignId)}`;
}

function resolveNotificationOpenPath(params: {
  recipientType: RecipientType;
  type: string;
  path: string;
  campaignId: string;
}) {
  if (isCustomerPromoNotification(params.recipientType, params.type)) {
    if (/^\/restaurants\/[A-Za-z0-9_-]+(?:[?#].*)?$/.test(params.path)) {
      return params.path;
    }

    return buildPromoDetailsPath(params.campaignId);
  }

  return params.path;
}

function shouldLoadSource(params: ListParams, source: NotificationSource) {
  return !params.source || params.source === "all" || params.source === source;
}

function shouldLoadScheduleHistory(params: ListParams) {
  return !params.source || params.source === "all" || params.source === "campaign" || params.source === "scheduled";
}

function embeddedNotificationMatch(
  params: ListParams,
  settings?: Awaited<ReturnType<typeof getAdminNotificationSettings>>,
) {
  const match: Record<string, any> = {
    $or: [
      { "notifications.campaignId": { $exists: false } },
      { "notifications.campaignId": "" },
      { "notifications.campaignId": null },
    ],
  };
  const hiddenTypes = settings
    ? ["order_status", "rider_assigned", "rider_near", "promotion", "voucher", "campaign", "support"]
        .filter((type) =>
          !isAdminNotificationCategoryEnabled(
            settings,
            classifyCustomerNotification(type),
          ),
        )
    : [];

  if (hiddenTypes.length) {
    match["notifications.type"] = { $nin: hiddenTypes };
  }

  if (params.status === "read") {
    match["notifications.isRead"] = true;
  } else if (params.status === "unread") {
    match["notifications.isRead"] = { $ne: true };
  }

  return match;
}

function embeddedNotificationSearchMatch(params: ListParams) {
  const regex = buildSearchRegex(params.search);
  if (!regex) return [];

  return [
    {
      $match: {
        $or: [
          { "notifications.title": regex },
          { "notifications.description": regex },
          { "notifications.type": regex },
          { fullName: regex },
          { phone: regex },
        ],
      },
    },
  ];
}

function activePushTokenExpression() {
  return {
    $size: {
      $filter: {
        input: { $ifNull: ["$pushTokens", []] },
        as: "token",
        cond: { $eq: [{ $ifNull: ["$$token.disabledAt", null] }, null] },
      },
    },
  };
}

async function getCustomerNotificationItems(
  params: ListParams,
  fetchLimit: number,
  settings: Awaited<ReturnType<typeof getAdminNotificationSettings>>,
): Promise<NotificationQueryResult> {
  const [result] = await CustomerModel.aggregate([
    {
      $project: {
        fullName: 1,
        phone: 1,
        pushTokens: 1,
        notifications: {
          $slice: [
            { $ifNull: ["$notifications", []] },
            -EMBEDDED_NOTIFICATION_SCAN_WINDOW,
          ],
        },
      },
    },
    { $unwind: "$notifications" },
    { $match: embeddedNotificationMatch(params, settings) },
    ...embeddedNotificationSearchMatch(params),
    { $sort: { "notifications.createdAt": -1 } },
    {
      $facet: {
        items: [
          { $limit: fetchLimit },
          { $addFields: { activePushTokenCount: activePushTokenExpression() } },
          {
            $project: {
              id: { $toString: "$notifications._id" },
              source: { $literal: "customer" },
              type: { $ifNull: ["$notifications.type", "system"] },
              title: { $ifNull: ["$notifications.title", ""] },
              description: { $ifNull: ["$notifications.description", ""] },
              recipientId: { $toString: "$_id" },
              recipientName: { $ifNull: ["$fullName", "Customer"] },
              recipientPhone: { $ifNull: ["$phone", ""] },
              path: { $ifNull: ["$notifications.path", ""] },
              campaignId: { $ifNull: ["$notifications.campaignId", ""] },
              ctaLabel: { $ifNull: ["$notifications.ctaLabel", ""] },
              ctaPath: { $ifNull: ["$notifications.ctaPath", ""] },
              contentType: { $ifNull: ["$notifications.contentType", "text"] },
              imageUrl: { $ifNull: ["$notifications.imageUrl", ""] },
              isRead: { $eq: ["$notifications.isRead", true] },
              readAt: "$notifications.readAt",
              createdAt: "$notifications.createdAt",
              deliveryStatus: {
                $cond: [
                  { $gt: ["$activePushTokenCount", 0] },
                  "push_ready",
                  "in_app_only",
                ],
              },
            },
          },
        ],
        total: [{ $count: "count" }],
        unread: [
          { $match: { "notifications.isRead": { $ne: true } } },
          { $count: "count" },
        ],
      },
    },
  ]);

  return {
    items: (result?.items ?? []).map((item: Record<string, any>) => ({
      ...item,
      readAt: serializeDate(item.readAt),
      createdAt: serializeDate(item.createdAt),
    })),
    total: Number(result?.total?.[0]?.count ?? 0),
    unread: Number(result?.unread?.[0]?.count ?? 0),
  };
}

function buildOwnerNotificationQuery(
  params: ListParams,
  settings: Awaited<ReturnType<typeof getAdminNotificationSettings>>,
) {
  const query: Record<string, any> = { entityType: { $ne: "admin_notification" } };
  const hiddenRules: Record<string, unknown>[] = [];

  if (!settings.orderPlaced) {
    hiddenRules.push({ eventType: "order.created" });
  }
  if (!settings.payoutRequests) {
    hiddenRules.push({
      $or: [{ type: "payout" }, { eventType: /^payout\./ }],
    });
  }
  if (!settings.support) {
    hiddenRules.push({
      $or: [{ type: "support" }, { eventType: /support/i }],
    });
  }
  if (!settings.campaigns) {
    hiddenRules.push({
      $or: [{ type: "promotion" }, { eventType: /campaign/i }],
    });
  }
  if (hiddenRules.length) {
    query.$nor = hiddenRules;
  }

  if (params.status === "read") {
    query.isRead = true;
  } else if (params.status === "unread") {
    query.isRead = { $ne: true };
  }

  const regex = buildSearchRegex(params.search);
  if (regex) {
    query.$or = [
      { title: regex },
      { description: regex },
      { type: regex },
      { eventType: regex },
    ];
  }

  return query;
}

async function getOwnerNotificationItems(
  params: ListParams,
  fetchLimit: number,
  settings: Awaited<ReturnType<typeof getAdminNotificationSettings>>,
): Promise<NotificationQueryResult> {
  const query = buildOwnerNotificationQuery(params, settings);
  const [rows, total, unread] = await Promise.all([
    NotificationModel.find(query)
    .sort({ createdAt: -1 })
      .limit(fetchLimit)
    .populate("ownerId", "fullName phone")
    .populate("restaurantId", "name")
      .lean(),
    NotificationModel.countDocuments(query),
    NotificationModel.countDocuments({
      entityType: { $ne: "admin_notification" },
      isRead: { $ne: true },
    }),
  ]);

  return {
    items: rows.map((notification: Record<string, any>) => ({
      id: objectIdString(notification._id),
      source: "owner" as const,
      type: stringValue(notification.type, "system"),
      eventType: stringValue(notification.eventType),
      title: stringValue(notification.title),
      description: stringValue(notification.description),
      recipientId: objectIdString(notification.ownerId?._id ?? notification.ownerId),
      recipientName:
        stringValue(notification.ownerId?.fullName) ||
        stringValue(notification.restaurantId?.name, "Restaurant owner"),
      recipientPhone: stringValue(notification.ownerId?.phone),
      restaurantName: stringValue(notification.restaurantId?.name),
      path: stringValue(notification.actionPath),
      isRead: notification.isRead === true,
      readAt: serializeDate(notification.readAt),
      createdAt: serializeDate(notification.createdAt),
      deliveryStatus: "in_app",
    })),
    total,
    unread,
  };
}

async function getRiderNotificationItems(
  params: ListParams,
  fetchLimit: number,
): Promise<NotificationQueryResult> {
  const [result] = await RiderModel.aggregate([
    {
      $project: {
        fullName: 1,
        phone: 1,
        pushTokens: 1,
        notifications: {
          $slice: [
            { $ifNull: ["$notifications", []] },
            -EMBEDDED_NOTIFICATION_SCAN_WINDOW,
          ],
        },
      },
    },
    { $unwind: "$notifications" },
    { $match: embeddedNotificationMatch(params) },
    ...embeddedNotificationSearchMatch(params),
    { $sort: { "notifications.createdAt": -1 } },
    {
      $facet: {
        items: [
          { $limit: fetchLimit },
          { $addFields: { activePushTokenCount: activePushTokenExpression() } },
          {
            $project: {
              id: { $toString: "$notifications._id" },
              source: { $literal: "rider" },
              type: { $ifNull: ["$notifications.type", "system"] },
              title: { $ifNull: ["$notifications.title", ""] },
              description: { $ifNull: ["$notifications.description", ""] },
              recipientId: { $toString: "$_id" },
              recipientName: { $ifNull: ["$fullName", "Rider"] },
              recipientPhone: { $ifNull: ["$phone", ""] },
              path: { $ifNull: ["$notifications.path", ""] },
              campaignId: { $ifNull: ["$notifications.campaignId", ""] },
              ctaLabel: { $ifNull: ["$notifications.ctaLabel", ""] },
              ctaPath: { $ifNull: ["$notifications.ctaPath", ""] },
              contentType: { $ifNull: ["$notifications.contentType", "text"] },
              imageUrl: { $ifNull: ["$notifications.imageUrl", ""] },
              isRead: { $eq: ["$notifications.isRead", true] },
              readAt: "$notifications.readAt",
              createdAt: "$notifications.createdAt",
              deliveryStatus: {
                $cond: [
                  { $gt: ["$activePushTokenCount", 0] },
                  "push_ready",
                  "in_app_only",
                ],
              },
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);

  return {
    items: (result?.items ?? []).map((item: Record<string, any>) => ({
      ...item,
      readAt: serializeDate(item.readAt),
      createdAt: serializeDate(item.createdAt),
    })),
    total: Number(result?.total?.[0]?.count ?? 0),
    unread: 0,
  };
}

async function getEmbeddedNotificationSummary(model: typeof CustomerModel | typeof RiderModel) {
  const [result] = await model.aggregate([
    {
      $facet: {
        tokenTotals: [
          { $unwind: { path: "$pushTokens", preserveNullAndEmptyArrays: false } },
          {
            $group: {
              _id: null,
              active: {
                $sum: {
                  $cond: [
                    { $eq: [{ $ifNull: ["$pushTokens.disabledAt", null] }, null] },
                    1,
                    0,
                  ],
                },
              },
              disabled: {
                $sum: {
                  $cond: [
                    { $ne: [{ $ifNull: ["$pushTokens.disabledAt", null] }, null] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        unreadNotifications: [
          { $unwind: { path: "$notifications", preserveNullAndEmptyArrays: false } },
          {
            $match: {
              "notifications.isRead": { $ne: true },
              $or: [
                { "notifications.campaignId": { $exists: false } },
                { "notifications.campaignId": "" },
                { "notifications.campaignId": null },
              ],
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  const tokenTotals = result?.tokenTotals?.[0] ?? {};
  return {
    active: Number(tokenTotals.active ?? 0),
    disabled: Number(tokenTotals.disabled ?? 0),
    unread: Number(result?.unreadNotifications?.[0]?.count ?? 0),
  };
}

async function getCampaignItems() {
  const content = await getPlatformContent();
  const campaigns = (content.customerApp.homeCms.pushCampaign.campaignHistory ?? []).slice(-200);

  return campaigns.map((campaign: Record<string, any>) => ({
    id: stringValue(campaign.campaignId),
    source: "campaign" as const,
    type: "customer_push",
    title: stringValue(campaign.title),
    description: stringValue(campaign.body),
    recipientId: "",
    recipientName: stringValue(campaign.audienceType, "Campaign audience"),
    recipientPhone: "",
    path: stringValue(campaign.path),
    recipientType: "customers",
    audience: stringValue(campaign.audienceType, "campaign"),
    sendMode: "cms",
    isRead: true,
    readAt: serializeDate(campaign.sentAt),
    createdAt: serializeDate(campaign.sentAt),
    deliveryStatus: "campaign",
    totalTargets: Number(campaign.totalTargets ?? 0),
    sentCount: Number(campaign.sentCount ?? 0),
    disabledCount: Number(campaign.disabledCount ?? 0),
    openCount: Number(campaign.openCount ?? 0),
  }));
}

async function estimateScheduledTargets(schedule: Record<string, any>) {
  const recipientIds = Array.isArray(schedule.recipientIds)
    ? schedule.recipientIds.filter(Boolean)
    : [];
  const isSelectedAudience = schedule.audience === "selected";

  if (isSelectedAudience && !recipientIds.length) return 0;

  if (schedule.recipientType === "customers") {
    const query: Record<string, unknown> = { status: "active" };
    if (isSelectedAudience) query._id = { $in: recipientIds };
    return CustomerModel.countDocuments(query);
  }

  if (schedule.recipientType === "riders") {
    const query: Record<string, unknown> = { status: "active" };
    if (isSelectedAudience) query._id = { $in: recipientIds };
    return RiderModel.countDocuments(query);
  }

  if (schedule.recipientType === "owners") {
    const query: Record<string, unknown> = {
      activeRestaurantId: { $ne: null },
    };
    if (isSelectedAudience) query.activeRestaurantId = { $in: recipientIds };
    return OwnerModel.countDocuments(query);
  }

  return 0;
}

async function getScheduledItems() {
  const rows = await AdminNotificationScheduleModel.find()
    .sort({ scheduledAt: -1 })
    .limit(200)
    .lean();

  return Promise.all(
    rows.map(async (schedule: Record<string, any>) => {
      const scheduleId = objectIdString(schedule._id);
      const sendMode = stringValue(schedule.sendMode, "scheduled");
      const storedTotalTargets = Number(schedule.result?.totalTargets ?? 0);
      const totalTargets =
        storedTotalTargets > 0 || schedule.status !== "scheduled"
          ? storedTotalTargets
          : await estimateScheduledTargets(schedule);
      let openCount = 0;

      if (schedule.recipientType === "customers") {
        openCount = await CustomerModel.countDocuments({
          notifications: {
            $elemMatch: { campaignId: scheduleId, isRead: true },
          },
        });
      } else if (schedule.recipientType === "riders") {
        openCount = await RiderModel.countDocuments({
          notifications: {
            $elemMatch: { campaignId: scheduleId, isRead: true },
          },
        });
      } else if (schedule.recipientType === "owners") {
        openCount = await NotificationModel.countDocuments({
          entityId: scheduleId,
          isRead: true,
        });
      }

      return {
        id: scheduleId,
        source: sendMode === "instant" ? "campaign" as const : "scheduled" as const,
        type: stringValue(schedule.notificationType, "system"),
        title: stringValue(schedule.title),
        description: stringValue(schedule.body),
        recipientId: "",
        recipientName:
          schedule.audience === "all"
            ? `All ${stringValue(schedule.recipientType)}`
            : `${Array.isArray(schedule.recipientIds) ? schedule.recipientIds.length : 0} selected`,
        recipientPhone: "",
        path: stringValue(schedule.path),
        ctaLabel: stringValue(schedule.ctaLabel),
        ctaPath: stringValue(schedule.ctaPath),
        campaignId: scheduleId,
        recipientType: stringValue(schedule.recipientType),
        audience: stringValue(schedule.audience),
        sendMode,
        customerAudienceType: stringValue(schedule.customerAudienceType),
        customerGroupKey: stringValue(schedule.customerGroupKey),
        restaurantScope: stringValue(schedule.restaurantScope),
        selectedRestaurantIds: Array.isArray(schedule.selectedRestaurantIds) ? schedule.selectedRestaurantIds : [],
        abTest: schedule.abTest ?? {},
        conversionWindowDays: Number(schedule.conversionWindowDays ?? schedule.result?.conversionWindowDays ?? 7),
        conversions: schedule.result?.conversions ?? null,
        contentType: stringValue(schedule.contentType, "text"),
        imageUrl: stringValue(schedule.imageUrl),
        isRead: schedule.status !== "scheduled",
        readAt: serializeDate(schedule.sentAt),
        createdAt: serializeDate(schedule.createdAt ?? schedule.scheduledAt),
        deliveryStatus: stringValue(schedule.status, "scheduled"),
        scheduledAt: serializeDate(schedule.scheduledAt),
        sentAt: serializeDate(schedule.sentAt),
        totalTargets,
        sentCount: Number(schedule.result?.sentCount ?? 0),
        disabledCount: Number(schedule.result?.disabledCount ?? 0),
        inAppCount: Number(schedule.result?.inAppCount ?? 0),
        skippedCount: Number(schedule.result?.skippedCount ?? 0),
        openCount,
        failureReason: stringValue(schedule.failureReason),
      };
    }),
  );
}

export async function listAdminNotifications(params: ListParams = {}) {
  const { page, pageSize } = normalizePage(params);
  const notificationSettings = await getAdminNotificationSettings();
  const fetchLimit = Math.min(
    MAX_NOTIFICATION_SOURCE_FETCH,
    Math.max(page * pageSize + pageSize * 2, pageSize * 4),
  );
  const [customerResult, ownerResult, riderResult, campaignItems, scheduledItems, opsItems, customerTokenSummary, riderTokenSummary] =
    await Promise.all([
      shouldLoadSource(params, "customer")
        ? getCustomerNotificationItems(params, fetchLimit, notificationSettings)
        : Promise.resolve(emptyNotificationResult()),
      shouldLoadSource(params, "owner")
        ? getOwnerNotificationItems(params, fetchLimit, notificationSettings)
        : Promise.resolve(emptyNotificationResult()),
      shouldLoadSource(params, "rider")
        ? getRiderNotificationItems(params, fetchLimit)
        : Promise.resolve(emptyNotificationResult()),
      shouldLoadSource(params, "campaign") && notificationSettings.campaigns
        ? getCampaignItems()
        : Promise.resolve([]),
      shouldLoadScheduleHistory(params) && notificationSettings.campaigns
        ? getScheduledItems()
        : Promise.resolve([]),
      shouldLoadSource(params, "ops") ? listAdminOperationalAlerts() : Promise.resolve([]),
      getEmbeddedNotificationSummary(CustomerModel),
      getEmbeddedNotificationSummary(RiderModel),
    ]);

  const allItems = [
    ...opsItems,
    ...customerResult.items,
    ...ownerResult.items,
    ...riderResult.items,
    ...campaignItems,
    ...scheduledItems,
  ]
    .filter((item) => isAdminNotificationItemEnabled(item, notificationSettings))
    .filter((item) => params.source && params.source !== "all" ? item.source === params.source : true)
    .filter((item) => filterStatus(item, params.status))
    .filter((item) => matchesSearch(item, params.search))
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt ?? 0).getTime();
      const rightTime = new Date(right.createdAt ?? 0).getTime();
      return rightTime - leftTime;
    });

  const ownerUnread = ownerResult.unread;
  const visibleOpsItems = opsItems.filter((item) =>
    isAdminNotificationItemEnabled(item, notificationSettings),
  );
  const opsUnread = visibleOpsItems.filter((item) => !item.isRead).length;
  const allCampaignItems = [
    ...campaignItems,
    ...scheduledItems.filter((item) => item.source === "campaign"),
  ];
  const scheduledOnlyItems = scheduledItems.filter((item) => item.source === "scheduled");
  const campaignDelivered = allCampaignItems.reduce((total, item) => total + Number(item.sentCount ?? 0), 0);
  const campaignOpens = allCampaignItems.reduce((total, item) => total + Number(item.openCount ?? 0), 0);
  const campaignTargets = allCampaignItems.reduce((total, item) => total + Number(item.totalTargets ?? 0), 0);
  const scheduledCount = scheduledOnlyItems.filter((item) => item.deliveryStatus === "scheduled").length;
  const start = (page - 1) * pageSize;
  const campaignScheduledOpsTotal = [
    ...visibleOpsItems,
    ...campaignItems,
    ...scheduledItems,
  ]
    .filter((item) => params.source && params.source !== "all" ? item.source === params.source : true)
    .filter((item) => filterStatus(item, params.status))
    .filter((item) => matchesSearch(item, params.search)).length;
  const total = customerResult.total + ownerResult.total + riderResult.total + campaignScheduledOpsTotal;

  return {
    items: allItems.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      totalNotifications: customerResult.total + ownerResult.total + riderResult.total,
      customerUnread: customerResult.unread,
      ownerUnread: ownerUnread + opsUnread,
      customerPushActiveTokens: customerTokenSummary.active,
      customerPushDisabledTokens: customerTokenSummary.disabled,
      riderPushActiveTokens: riderTokenSummary.active,
      riderPushDisabledTokens: riderTokenSummary.disabled,
      campaignCount: allCampaignItems.length,
      campaignTargets,
      campaignDelivered,
      campaignOpens,
      campaignOpenRate: campaignDelivered > 0 ? Math.round((campaignOpens / campaignDelivered) * 100) : 0,
      scheduledCount,
      opsUnread,
    },
  };
}

async function resolveCustomerTargets(params: SendParams) {
  const query: Record<string, unknown> = { status: "active" };
  const audienceType = params.customerAudienceType ?? (params.audience === "selected" ? "selected_users" : "all_users");
  if (params.audience === "selected" || audienceType === "selected_users") {
    query._id = { $in: (params.recipientIds ?? []).filter(Boolean) };
  } else if (audienceType === "new_users") {
    query._id = { $nin: await OrderModel.distinct("customerId", {}) };
  } else if (audienceType === "returning_users") {
    query._id = { $in: await OrderModel.distinct("customerId", {}) };
  }

  if (params.customerGroupKey?.startsWith("manual:")) {
    const groupId = params.customerGroupKey.replace("manual:", "").trim();
    const group = mongoose.Types.ObjectId.isValid(groupId)
      ? await AdminCustomerGroupModel.findOne({
          _id: groupId,
          archivedAt: null,
        }).lean()
      : null;
    query._id = {
      ...(typeof query._id === "object" && query._id ? query._id : {}),
      $in: (group?.customerIds ?? []).map(objectIdString).filter(Boolean),
    };
  } else if (params.customerGroupKey === "has_push_token") {
    query.pushTokens = {
      $elemMatch: {
        token: { $exists: true, $ne: "" },
        disabledAt: null,
      },
    };
  } else if (params.customerGroupKey === "ordered_last_30_days") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const customerIds = await OrderModel.distinct("customerId", { createdAt: { $gte: since } });
    query._id = { ...(typeof query._id === "object" && query._id ? query._id : {}), $in: customerIds };
  } else if (params.customerGroupKey === "inactive_30_days") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const customerIds = await OrderModel.distinct("customerId", { createdAt: { $gte: since } });
    query._id = { ...(typeof query._id === "object" && query._id ? query._id : {}), $nin: customerIds };
  } else if (params.customerGroupKey === "high_value_customers") {
    const rows = await OrderModel.aggregate([
      { $match: { status: "Delivered" } },
      { $group: { _id: "$customerId", totalSpend: { $sum: { $toDouble: { $ifNull: ["$pricing.total", 0] } } } } },
      { $match: { totalSpend: { $gte: 1000 } } },
      { $limit: 2000 },
    ]);
    const customerIds = rows.map((row) => String(row._id)).filter(Boolean);
    query._id = { ...(typeof query._id === "object" && query._id ? query._id : {}), $in: customerIds };
  }

  if (params.restaurantScope === "selected_restaurants" && params.selectedRestaurantIds?.length) {
    const customerIds = await OrderModel.distinct("customerId", {
      restaurantId: { $in: params.selectedRestaurantIds },
    });
    query._id = query._id
      ? { ...(query._id as Record<string, unknown>), $in: customerIds }
      : { $in: customerIds };
  }
  return CustomerModel.find(query).select("_id fullName phone").limit(5000).lean();
}

async function resolveRestaurantTargets(params: SendParams) {
  const query: Record<string, unknown> = { activeRestaurantId: { $ne: null } };
  if (params.audience === "selected") {
    query.activeRestaurantId = { $in: (params.recipientIds ?? []).filter(Boolean) };
  }
  const owners = await OwnerModel.find(query)
    .select("_id fullName phone activeRestaurantId")
    .limit(5000)
    .lean();
  const restaurantIds = owners.map((owner) => owner.activeRestaurantId).filter(Boolean);
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).select("_id name").lean()
    : [];
  const restaurantMap = new Map(restaurants.map((restaurant) => [objectIdString(restaurant._id), restaurant]));
  return owners.map((owner) => ({
    owner,
    restaurant: restaurantMap.get(objectIdString(owner.activeRestaurantId)),
  })).filter((target) => target.restaurant);
}

async function resolveRiderTargets(params: SendParams) {
  const query: Record<string, unknown> = { status: "active" };
  if (params.audience === "selected") {
    query._id = { $in: (params.recipientIds ?? []).filter(Boolean) };
  }
  return RiderModel.find(query).select("_id fullName phone pushTokens").limit(5000).lean();
}

function reportStatusLabel(status: string) {
  if (status === "opened") return "Opened";
  if (status === "received") return "Received";
  return "Not reached";
}

function recipientStatusMatch(status: RecipientReportStatus) {
  if (status === "all") return [];
  if (status === "received") return [{ $match: { status: { $in: ["received", "opened"] } } }];
  if (status === "opened") return [{ $match: { status: "opened" } }];
  return [{ $match: { status: "not_reached" } }];
}

function objectIdValues(values: unknown[]) {
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

function buildRecipientReportSummary(rows: Array<{ _id: string; count: number }>) {
  const counts = new Map(rows.map((row) => [String(row._id), Number(row.count ?? 0)]));
  const opened = counts.get("opened") ?? 0;
  const receivedOnly = counts.get("received") ?? 0;
  const notReached = counts.get("not_reached") ?? 0;
  return {
    total: opened + receivedOnly + notReached,
    received: opened + receivedOnly,
    opened,
    notReached,
  };
}

function serializeRecipientReportItems(items: Array<Record<string, any>>) {
  return items.map((item) => ({
    ...item,
    statusLabel: reportStatusLabel(stringValue(item.status)),
    notificationId: objectIdString(item.notificationId),
    receivedAt: serializeDate(item.receivedAt),
    openedAt: serializeDate(item.openedAt),
  }));
}

async function buildCustomerCampaignRecipients(
  schedule: Record<string, any>,
  campaignId: string,
  params: { status: RecipientReportStatus; page: number; pageSize: number },
): Promise<CampaignRecipientReport> {
  const recipientIds = Array.isArray(schedule.recipientIds) ? schedule.recipientIds.filter(Boolean) : [];
  const query: Record<string, unknown> = { status: "active" };
  if (schedule.audience === "selected") query._id = { $in: objectIdValues(recipientIds) };
  const statusPipeline = recipientStatusMatch(params.status);
  const [result] = await CustomerModel.aggregate([
    { $match: query },
    {
      $project: {
        fullName: 1,
        phone: 1,
        notification: {
          $first: {
            $filter: {
              input: { $ifNull: ["$notifications", []] },
              as: "notification",
              cond: { $eq: ["$$notification.campaignId", campaignId] },
            },
          },
        },
      },
    },
    {
      $addFields: {
        reportStatus: {
          $cond: [
            { $eq: ["$notification.isRead", true] },
            "opened",
            {
              $cond: [
                { $ifNull: ["$notification._id", false] },
                "received",
                "not_reached",
              ],
            },
          ],
        },
      },
    },
    { $addFields: { status: "$reportStatus" } },
    {
      $facet: {
        summary: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        total: [...statusPipeline, { $count: "count" }],
        items: [
          ...statusPipeline,
          { $sort: { fullName: 1, phone: 1 } },
          { $skip: (params.page - 1) * params.pageSize },
          { $limit: params.pageSize },
          {
            $project: {
              id: { $toString: "$_id" },
              name: { $ifNull: ["$fullName", "Customer"] },
              phone: { $ifNull: ["$phone", ""] },
              userType: { $literal: "customer" },
              status: 1,
              notificationId: "$notification._id",
              receivedAt: "$notification.createdAt",
              openedAt: "$notification.readAt",
              reason: {
                $cond: [
                  { $ifNull: ["$notification._id", false] },
                  "",
                  "No in-app notification was created for this campaign.",
                ],
              },
            },
          },
        ],
      },
    },
  ]);

  return {
    items: serializeRecipientReportItems(result?.items ?? []),
    total: Number(result?.total?.[0]?.count ?? 0),
    summary: buildRecipientReportSummary(result?.summary ?? []),
  };
}

async function buildRiderCampaignRecipients(
  schedule: Record<string, any>,
  campaignId: string,
  params: { status: RecipientReportStatus; page: number; pageSize: number },
): Promise<CampaignRecipientReport> {
  const recipientIds = Array.isArray(schedule.recipientIds) ? schedule.recipientIds.filter(Boolean) : [];
  const query: Record<string, unknown> = { status: "active" };
  if (schedule.audience === "selected") query._id = { $in: objectIdValues(recipientIds) };
  const statusPipeline = recipientStatusMatch(params.status);
  const [result] = await RiderModel.aggregate([
    { $match: query },
    {
      $project: {
        fullName: 1,
        phone: 1,
        notification: {
          $first: {
            $filter: {
              input: { $ifNull: ["$notifications", []] },
              as: "notification",
              cond: { $eq: ["$$notification.campaignId", campaignId] },
            },
          },
        },
      },
    },
    {
      $addFields: {
        reportStatus: {
          $cond: [
            { $eq: ["$notification.isRead", true] },
            "opened",
            {
              $cond: [
                { $ifNull: ["$notification._id", false] },
                "received",
                "not_reached",
              ],
            },
          ],
        },
      },
    },
    { $addFields: { status: "$reportStatus" } },
    {
      $facet: {
        summary: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        total: [...statusPipeline, { $count: "count" }],
        items: [
          ...statusPipeline,
          { $sort: { fullName: 1, phone: 1 } },
          { $skip: (params.page - 1) * params.pageSize },
          { $limit: params.pageSize },
          {
            $project: {
              id: { $toString: "$_id" },
              name: { $ifNull: ["$fullName", "Rider"] },
              phone: { $ifNull: ["$phone", ""] },
              userType: { $literal: "rider" },
              status: 1,
              notificationId: "$notification._id",
              receivedAt: "$notification.createdAt",
              openedAt: "$notification.readAt",
              reason: {
                $cond: [
                  { $ifNull: ["$notification._id", false] },
                  "",
                  "No in-app notification was created for this campaign.",
                ],
              },
            },
          },
        ],
      },
    },
  ]);

  return {
    items: serializeRecipientReportItems(result?.items ?? []),
    total: Number(result?.total?.[0]?.count ?? 0),
    summary: buildRecipientReportSummary(result?.summary ?? []),
  };
}

async function buildOwnerCampaignRecipients(
  schedule: Record<string, any>,
  campaignId: string,
  params: { status: RecipientReportStatus; page: number; pageSize: number },
): Promise<CampaignRecipientReport> {
  const recipientIds = Array.isArray(schedule.recipientIds) ? schedule.recipientIds.filter(Boolean) : [];
  const query: Record<string, unknown> = { activeRestaurantId: { $ne: null } };
  if (schedule.audience === "selected") query.activeRestaurantId = { $in: objectIdValues(recipientIds) };
  const statusPipeline = recipientStatusMatch(params.status);
  const [result] = await OwnerModel.aggregate([
    { $match: query },
    {
      $lookup: {
        from: RestaurantModel.collection.name,
        localField: "activeRestaurantId",
        foreignField: "_id",
        as: "restaurantRows",
      },
    },
    {
      $lookup: {
        from: NotificationModel.collection.name,
        let: { ownerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$ownerId", "$$ownerId"] },
                  { $eq: ["$entityType", "admin_notification"] },
                  { $eq: ["$entityId", campaignId] },
                ],
              },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
        ],
        as: "notificationRows",
      },
    },
    {
      $addFields: {
        restaurant: { $first: "$restaurantRows" },
        notification: { $first: "$notificationRows" },
      },
    },
    {
      $addFields: {
        reportStatus: {
          $cond: [
            { $eq: ["$notification.isRead", true] },
            "opened",
            {
              $cond: [
                { $ifNull: ["$notification._id", false] },
                "received",
                "not_reached",
              ],
            },
          ],
        },
      },
    },
    { $addFields: { status: "$reportStatus" } },
    {
      $facet: {
        summary: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        total: [...statusPipeline, { $count: "count" }],
        items: [
          ...statusPipeline,
          { $sort: { fullName: 1, phone: 1 } },
          { $skip: (params.page - 1) * params.pageSize },
          { $limit: params.pageSize },
          {
            $project: {
              id: { $toString: "$_id" },
              name: {
                $ifNull: [
                  "$fullName",
                  { $ifNull: ["$restaurant.name", "Restaurant owner"] },
                ],
              },
              phone: { $ifNull: ["$phone", ""] },
              userType: { $literal: "owner" },
              restaurantName: { $ifNull: ["$restaurant.name", ""] },
              status: 1,
              notificationId: "$notification._id",
              receivedAt: "$notification.createdAt",
              openedAt: "$notification.readAt",
              reason: {
                $cond: [
                  { $ifNull: ["$notification._id", false] },
                  "",
                  "No owner notification was created for this campaign.",
                ],
              },
            },
          },
        ],
      },
    },
  ]);

  return {
    items: serializeRecipientReportItems(result?.items ?? []),
    total: Number(result?.total?.[0]?.count ?? 0),
    summary: buildRecipientReportSummary(result?.summary ?? []),
  };
}

export async function getAdminNotificationCampaignRecipients(params: {
  campaignId: string;
  status?: RecipientReportStatus;
  page?: number;
  pageSize?: number;
}) {
  const campaignId = params.campaignId.trim();
  const status = params.status ?? "all";
  const { page, pageSize } = normalizePage({
    page: params.page,
    pageSize: params.pageSize,
  });
  const schedule = await AdminNotificationScheduleModel.findById(campaignId).lean();

  if (!schedule) {
    return {
      campaignId,
      items: [],
      total: 0,
      page,
      pageSize,
      pageCount: 1,
      summary: { total: 0, received: 0, opened: 0, notReached: 0 },
      unavailableReason: "Recipient report is available for admin-created instant and scheduled notifications.",
    };
  }

  const report =
    schedule.recipientType === "customers"
      ? await buildCustomerCampaignRecipients(schedule, campaignId, { status, page, pageSize })
      : schedule.recipientType === "riders"
        ? await buildRiderCampaignRecipients(schedule, campaignId, { status, page, pageSize })
        : await buildOwnerCampaignRecipients(schedule, campaignId, { status, page, pageSize });

  return {
    campaignId,
    items: report.items,
    total: report.total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(report.total / pageSize)),
    summary: report.summary,
    unavailableReason: "",
  };
}

async function calculateNotificationCampaignConversions(params: {
  sentAt: string;
  customerIds: string[];
  windowDays: number;
}) {
  const start = new Date(params.sentAt);
  const end = new Date(start.getTime() + params.windowDays * 24 * 60 * 60 * 1000);
  const orders = await OrderModel.find(
    {
      customerId: { $in: params.customerIds },
      createdAt: { $gte: start, $lte: end },
    },
    { customerId: 1, status: 1, pricing: 1, orderNumber: 1, customerSnapshot: 1, createdAt: 1 },
  ).lean();
  const deliveredOrders = orders.filter((order) => order.status === "Delivered");
  const deliveredRevenue = deliveredOrders.reduce(
    (sum, order) => sum + Number((order.pricing as { total?: number } | undefined)?.total ?? 0),
    0,
  );
  const uniqueOrderingCustomers = new Set(orders.map((order) => String(order.customerId))).size;

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
  };
}

export async function refreshAdminNotificationCampaignConversions(campaignId: string) {
  const schedule = await AdminNotificationScheduleModel.findById(campaignId);
  if (!schedule) {
    return {
      refreshed: false,
      unavailableReason: "Conversion tracking is available for admin-created customer campaigns.",
    };
  }
  if (schedule.recipientType !== "customers") {
    return {
      refreshed: false,
      unavailableReason: "Conversion tracking is only available for customer campaigns.",
    };
  }

  const recipientEvents = Array.isArray(schedule.result?.recipientEvents)
    ? schedule.result.recipientEvents
    : [];
  const customerIds = recipientEvents
    .map((event: Record<string, any>) => String(event.customerId ?? ""))
    .filter(Boolean);
  const sentAt = schedule.sentAt
    ? new Date(schedule.sentAt).toISOString()
    : String(recipientEvents[0]?.sentAt ?? schedule.createdAt ?? new Date().toISOString());
  const conversions = await calculateNotificationCampaignConversions({
    sentAt,
    customerIds,
    windowDays: Number(schedule.conversionWindowDays ?? schedule.result?.conversionWindowDays ?? 7),
  });

  schedule.result = {
    ...(schedule.result ?? {}),
    conversions,
  };
  await schedule.save();

  return {
    refreshed: true,
    ...conversions,
  };
}

export async function checkAdminNotificationCampaignReceipts(campaignId: string) {
  const schedule = await AdminNotificationScheduleModel.findById(campaignId);
  if (!schedule) {
    return {
      checked: 0,
      deliveredToProvider: 0,
      failed: 0,
      deviceNotRegistered: 0,
      unavailableReason: "Receipt checking is available for admin-created customer campaigns.",
    };
  }

  const recipientEvents = Array.isArray(schedule.result?.recipientEvents)
    ? schedule.result.recipientEvents
    : [];
  const ticketIds = recipientEvents.flatMap((event: Record<string, any>) => event.ticketIds ?? []);

  if (!ticketIds.length) {
    return {
      checked: 0,
      deliveredToProvider: 0,
      failed: 0,
      deviceNotRegistered: 0,
      unavailableReason: "",
    };
  }

  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ ids: ticketIds.slice(0, 1000) }),
  });

  if (!response.ok) {
    throw new Error("Expo receipt check failed");
  }

  const payload = (await response.json()) as {
    data?: Record<
      string,
      {
        status?: "ok" | "error";
        message?: string;
        details?: { error?: string };
      }
    >;
  };
  const receipts = payload.data ?? {};
  const checkedAt = new Date().toISOString();
  let deliveredToProvider = 0;
  let failed = 0;
  let deviceNotRegistered = 0;

  const nextRecipientEvents = recipientEvents.map((event: Record<string, any>) => {
    const eventTicketIds = event.ticketIds ?? [];
    const eventReceipts = eventTicketIds.map((ticketId: string) => receipts[ticketId]).filter(Boolean);

    if (!eventReceipts.length) return event;

    const errorReceipt = eventReceipts.find(
      (receipt: { status?: string }) => receipt.status === "error",
    );
    if (errorReceipt) {
      failed += 1;
      if (errorReceipt.details?.error === "DeviceNotRegistered") {
        deviceNotRegistered += 1;
        return {
          ...event,
          status: "failed",
          receiptStatus: "device_not_registered",
          receiptCheckedAt: checkedAt,
          receiptError: "Device not registered. The app may be uninstalled or the token expired.",
        };
      }
      return {
        ...event,
        status: "failed",
        receiptStatus: "failed",
        receiptCheckedAt: checkedAt,
        receiptError: errorReceipt.message ?? errorReceipt.details?.error ?? "Expo delivery failed",
      };
    }

    deliveredToProvider += 1;
    return {
      ...event,
      receiptStatus: "delivered_to_provider",
      receiptCheckedAt: checkedAt,
      receiptError: "",
    };
  });

  schedule.result = {
    ...(schedule.result ?? {}),
    recipientEvents: nextRecipientEvents,
    receiptCheckedAt: checkedAt,
  };
  await schedule.save();

  return {
    checked: ticketIds.length,
    deliveredToProvider,
    failed,
    deviceNotRegistered,
    unavailableReason: "",
  };
}

async function recordInstantAdminNotificationCampaign(params: SendParams, result: Record<string, unknown>, campaignId: string) {
  if (params.campaignId?.trim() || params.testMode) return;

  const now = new Date();
  await AdminNotificationScheduleModel.create({
    _id: new mongoose.Types.ObjectId(campaignId),
    recipientType: params.recipientType,
    audience: params.audience,
    recipientIds: params.recipientIds ?? [],
    title: params.title.trim(),
    body: params.body.trim(),
    path: params.path?.trim() ?? "",
    ctaLabel: params.ctaLabel?.trim() ?? "",
    ctaPath: params.ctaPath?.trim() ?? "",
    notificationType: params.type?.trim() || "system",
    contentType: params.contentType ?? "text",
    imageUrl: params.imageUrl?.trim() ?? "",
    imagePublicId: params.imagePublicId?.trim() ?? "",
    customerAudienceType: params.customerAudienceType ?? (params.audience === "selected" ? "selected_users" : "all_users"),
    customerGroupKey: params.customerGroupKey ?? "",
    restaurantScope: params.restaurantScope ?? "all_restaurants",
    selectedRestaurantIds: params.selectedRestaurantIds ?? [],
    abTest: params.abTest ?? {},
    conversionWindowDays: params.conversionWindowDays ?? 7,
    pushEnabled: params.pushEnabled !== false,
    sendMode: "instant",
    scheduledAt: now,
    sentAt: now,
    createdByAdminId: params.adminId ?? "",
    status: "sent",
    result,
  });
}

export async function sendAdminNotification(params: SendParams) {
  const title = params.title.trim();
  const body = params.body.trim();
  const path = params.path?.trim() ?? "";
  const ctaLabel = params.ctaLabel?.trim() ?? "";
  const ctaPath = params.ctaPath?.trim() ?? "";
  const type = params.type?.trim() || "system";
  const contentType = params.contentType ?? "text";
  const imageUrl = params.imageUrl?.trim() ?? "";
  const imagePublicId = params.imagePublicId?.trim() ?? "";
  const pushEnabled = params.pushEnabled !== false;
  const scheduledAt = params.scheduledAt ? new Date(params.scheduledAt) : null;
  const campaignId = params.campaignId?.trim() || new mongoose.Types.ObjectId().toString();

  if (contentType !== "text" && !imageUrl) {
    throw new Error("Image is required for image notification campaigns");
  }

  if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now() + 10_000) {
    const scheduleId = new mongoose.Types.ObjectId();
    const schedule = await AdminNotificationScheduleModel.create({
      _id: scheduleId,
      recipientType: params.recipientType,
      audience: params.audience,
      recipientIds: params.recipientIds ?? [],
      title,
      body,
      path,
      ctaLabel,
      ctaPath,
      notificationType: type,
      contentType,
      imageUrl,
      imagePublicId,
      pushEnabled,
      customerAudienceType: params.customerAudienceType ?? (params.audience === "selected" ? "selected_users" : "all_users"),
      customerGroupKey: params.customerGroupKey ?? "",
      restaurantScope: params.restaurantScope ?? "all_restaurants",
      selectedRestaurantIds: params.selectedRestaurantIds ?? [],
      abTest: params.abTest ?? {},
      conversionWindowDays: params.conversionWindowDays ?? 7,
      sendMode: "scheduled",
      scheduledAt,
      createdByAdminId: params.adminId ?? "",
      status: "scheduled",
    });

    return {
      recipientType: params.recipientType,
      totalTargets: 0,
      sentCount: 0,
      disabledCount: 0,
      inAppCount: 0,
      skippedCount: 0,
      scheduledId: objectIdString(schedule._id),
      scheduledAt: scheduledAt.toISOString(),
    };
  }

  if (params.recipientType === "customers") {
    const customers = await resolveCustomerTargets(params);
    const campaignOpenPath = resolveNotificationOpenPath({
      recipientType: params.recipientType,
      type,
      path,
      campaignId,
    });
    let sentCount = 0;
    let disabledCount = 0;
    let inAppCount = 0;
    let skippedCount = 0;
    const sentAt = new Date().toISOString();
    const sentExpoTokens = new Set<string>();
    const recipientEvents: Array<Record<string, unknown>> = [];

    for (const [index, customer] of customers.entries()) {
      const useVariantB =
        params.abTest?.enabled === true &&
        Boolean(params.abTest.variantBTitle?.trim()) &&
        Boolean(params.abTest.variantBBody?.trim()) &&
        index % 100 < Math.min(99, Math.max(1, Number(params.abTest.splitPercent ?? 50)));
      const variant = useVariantB ? "B" : "A";
      const variantTitle = useVariantB ? params.abTest?.variantBTitle?.trim() || title : title;
      const variantBody = useVariantB ? params.abTest?.variantBBody?.trim() || body : body;
      const variantPath =
        isCustomerPromoNotification(params.recipientType, type)
          ? campaignOpenPath
          : useVariantB && params.abTest?.variantBPath?.trim()
            ? params.abTest.variantBPath.trim()
            : campaignOpenPath;
      if (pushEnabled) {
        const result = await sendPushToCustomer({
          customerId: objectIdString(customer._id),
          excludeExpoTokens: sentExpoTokens,
          payload: {
            title: variantTitle,
            body: variantBody,
            contentType,
            imageUrl: contentType === "text" ? undefined : imageUrl,
            data: {
              path: variantPath,
              type,
              campaignId,
              variant,
              ctaLabel,
              ctaPath,
              contentType,
              imageUrl: contentType === "text" ? "" : imageUrl,
            },
          },
        });
        sentCount += result.sent;
        disabledCount += result.disabled;
        inAppCount += result.inAppCreated;
        if (result.skipped) skippedCount += 1;
        result.sentExpoTokens.forEach((token) => sentExpoTokens.add(token));
        recipientEvents.push({
          customerId: objectIdString(customer._id),
          customerName: stringValue(customer.fullName),
          customerPhone: stringValue(customer.phone),
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
        });
      } else {
        const created = await createCustomerNotification({
          customerId: objectIdString(customer._id),
          payload: {
            title: variantTitle,
            body: variantBody,
            contentType,
            imageUrl: contentType === "text" ? undefined : imageUrl,
            data: {
              path: variantPath,
              type,
              campaignId,
              variant,
              ctaLabel,
              ctaPath,
              contentType,
              imageUrl: contentType === "text" ? "" : imageUrl,
            },
          },
        });
        if (created) inAppCount += 1;
        recipientEvents.push({
          customerId: objectIdString(customer._id),
          customerName: stringValue(customer.fullName),
          customerPhone: stringValue(customer.phone),
          sentAt,
          status: created ? "in_app_only" : "preference_disabled",
          expoTokenCount: 0,
          ticketIds: [],
          receiptStatus: "failed",
          receiptCheckedAt: null,
          receiptError: created ? "" : "Customer notification preference disabled",
          variant,
        });
      }
    }

    const result = {
      recipientType: params.recipientType,
      totalTargets: customers.length,
      sentCount,
      disabledCount,
      inAppCount,
      skippedCount,
      recipientEvents,
      conversionWindowDays: params.conversionWindowDays ?? 7,
    };
    await recordInstantAdminNotificationCampaign(params, result, campaignId);
    return result;
  }

  if (params.recipientType === "owners") {
    const targets = await resolveRestaurantTargets(params);
    for (const target of targets) {
      await createOwnerNotification({
        ownerId: objectIdString(target.owner._id),
        restaurantId: objectIdString(target.restaurant?._id),
        type: normalizeOwnerNotificationType(type),
        eventType: "admin.notification",
        entityType: "admin_notification",
        entityId: campaignId,
        title,
        description: body,
        actionPath: path,
      });
    }
    const result = {
      recipientType: params.recipientType,
      totalTargets: targets.length,
      sentCount: 0,
      disabledCount: 0,
      inAppCount: targets.length,
      skippedCount: 0,
    };
    await recordInstantAdminNotificationCampaign(params, result, campaignId);
    return result;
  }

  const riders = await resolveRiderTargets(params);
  let sentCount = 0;
  let disabledCount = 0;
  let inAppCount = 0;
  for (const rider of riders) {
    const result = await sendPushToRider({
      riderId: objectIdString(rider._id),
      payload: {
        title,
        body,
        contentType,
        imageUrl: contentType === "text" ? undefined : imageUrl,
        data: {
          path,
          type,
          campaignId,
          contentType,
          imageUrl: contentType === "text" ? "" : imageUrl,
        },
      },
    });
    sentCount += result.sent;
    disabledCount += result.disabled;
    inAppCount += result.inAppCreated;
  }

  const result = {
    recipientType: params.recipientType,
    totalTargets: riders.length,
    sentCount,
    disabledCount,
    inAppCount,
    skippedCount: Math.max(riders.length - sentCount, 0),
  };
  await recordInstantAdminNotificationCampaign(params, result, campaignId);
  return result;
}

export async function processDueAdminNotificationSchedules() {
  for (let index = 0; index < 10; index += 1) {
    const schedule = await AdminNotificationScheduleModel.findOneAndUpdate(
      {
        status: "scheduled",
        scheduledAt: { $lte: new Date() },
      },
      {
        $set: {
          status: "sending",
          failureReason: "",
        },
      },
      {
        sort: { scheduledAt: 1 },
        new: true,
      },
    );

    if (!schedule) break;

    try {
      const result = await sendAdminNotification({
        recipientType: schedule.recipientType as RecipientType,
        audience: schedule.audience as RecipientAudience,
        recipientIds: schedule.recipientIds,
        title: schedule.title,
        body: schedule.body,
        path: schedule.path,
        ctaLabel: schedule.ctaLabel,
        ctaPath: schedule.ctaPath,
        type: schedule.notificationType,
        campaignId: String(schedule._id ?? ""),
        contentType: schedule.contentType,
        imageUrl: schedule.imageUrl,
        imagePublicId: schedule.imagePublicId,
        customerAudienceType: schedule.customerAudienceType,
        customerGroupKey: schedule.customerGroupKey,
        restaurantScope: schedule.restaurantScope,
        selectedRestaurantIds: schedule.selectedRestaurantIds,
        abTest: schedule.abTest ?? undefined,
        conversionWindowDays: schedule.conversionWindowDays,
        pushEnabled: schedule.pushEnabled,
      });
      schedule.status = "sent";
      schedule.sentAt = new Date();
      schedule.result = result;
      schedule.failureReason = "";
      await schedule.save();
      await recordBusinessEvent({
        event: "notification.schedule.sent",
        category: "notifications",
        severity: "info",
        title: "Scheduled notification sent",
        description: schedule.title,
        entityType: "notification_schedule",
        entityId: String(schedule._id ?? ""),
        metadata: {
          recipientType: schedule.recipientType,
          audience: schedule.audience,
          sentCount: result.sentCount,
          totalTargets: result.totalTargets,
        },
      });
    } catch (error) {
      schedule.status = "failed";
      schedule.failureReason = error instanceof Error ? error.message : "Scheduled notification failed";
      await schedule.save();
      await recordBusinessEvent({
        event: "notification.schedule.failed",
        category: "notifications",
        severity: "critical",
        title: "Scheduled notification failed",
        description: schedule.failureReason,
        entityType: "notification_schedule",
        entityId: String(schedule._id ?? ""),
        metadata: {
          recipientType: schedule.recipientType,
          audience: schedule.audience,
          scheduledAt: schedule.scheduledAt,
        },
      });
    }
  }
}

export async function markAdminNotificationRead(params: {
  source: "customer" | "owner" | "rider" | "ops";
  id: string;
}) {
  const readAt = new Date();

  if (params.source === "ops") {
    return markAdminOperationalAlertRead(params.id);
  }

  if (params.source === "customer") {
    const result = await CustomerModel.updateOne(
      { "notifications._id": params.id },
      {
        $set: {
          "notifications.$.isRead": true,
          "notifications.$.readAt": readAt,
        },
      },
    );
    return { updated: result.modifiedCount > 0 };
  }

  if (params.source === "rider") {
    const result = await RiderModel.updateOne(
      { "notifications._id": params.id },
      {
        $set: {
          "notifications.$.isRead": true,
          "notifications.$.readAt": readAt,
        },
      },
    );
    return { updated: result.modifiedCount > 0 };
  }

  const notification = await NotificationModel.findById(params.id);
  if (!notification) return { updated: false };
  notification.isRead = true;
  notification.readAt = readAt;
  await notification.save();
  return { updated: true };
}

export async function markAllAdminNotificationsRead() {
  const readAt = new Date();
  const [customerResult, ownerResult, riderResult, opsResult] = await Promise.all([
    CustomerModel.updateMany(
      {
        notifications: {
          $elemMatch: { isRead: { $ne: true } },
        },
      },
      {
        $set: {
          "notifications.$[notification].isRead": true,
          "notifications.$[notification].readAt": readAt,
        },
      },
      {
        arrayFilters: [{ "notification.isRead": { $ne: true } }],
      },
    ),
    NotificationModel.updateMany(
      { isRead: { $ne: true } },
      { $set: { isRead: true, readAt } },
    ),
    RiderModel.updateMany(
      {
        notifications: {
          $elemMatch: { isRead: { $ne: true } },
        },
      },
      {
        $set: {
          "notifications.$[notification].isRead": true,
          "notifications.$[notification].readAt": readAt,
        },
      },
      {
        arrayFilters: [{ "notification.isRead": { $ne: true } }],
      },
    ),
    markAllAdminOperationalAlertsRead(),
  ]);

  return {
    updated:
      customerResult.modifiedCount +
      ownerResult.modifiedCount +
      riderResult.modifiedCount +
      opsResult.updated,
    customerDocuments: customerResult.modifiedCount,
    ownerNotifications: ownerResult.modifiedCount,
    riderNotifications: riderResult.modifiedCount,
    opsAlerts: opsResult.updated,
  };
}

export async function cancelAdminNotificationSchedule(scheduleId: string) {
  const schedule = await AdminNotificationScheduleModel.findById(scheduleId);
  if (!schedule) return { updated: false, status: "not_found" };
  if (schedule.status !== "scheduled") {
    return { updated: false, status: schedule.status };
  }
  schedule.status = "cancelled";
  schedule.failureReason = "";
  await schedule.save();
  return { updated: true, status: schedule.status };
}

export async function retryAdminNotificationSchedule(scheduleId: string) {
  const schedule = await AdminNotificationScheduleModel.findOneAndUpdate(
    {
      _id: scheduleId,
      status: "failed",
    },
    {
      $set: {
        status: "sending",
        failureReason: "",
      },
    },
    {
      new: true,
    },
  );

  if (!schedule) {
    const existing = await AdminNotificationScheduleModel.findById(scheduleId)
      .select({ status: 1 })
      .lean();
    return {
      updated: false,
      status: existing?.status ? String(existing.status) : "not_found",
    };
  }

  try {
    const result = await sendAdminNotification({
      recipientType: schedule.recipientType as RecipientType,
      audience: schedule.audience as RecipientAudience,
      recipientIds: schedule.recipientIds,
      title: schedule.title,
      body: schedule.body,
      path: schedule.path,
      ctaLabel: schedule.ctaLabel,
      ctaPath: schedule.ctaPath,
      type: schedule.notificationType,
      campaignId: String(schedule._id ?? ""),
      contentType: schedule.contentType,
      imageUrl: schedule.imageUrl,
      imagePublicId: schedule.imagePublicId,
      customerAudienceType: schedule.customerAudienceType,
      customerGroupKey: schedule.customerGroupKey,
      restaurantScope: schedule.restaurantScope,
      selectedRestaurantIds: schedule.selectedRestaurantIds,
      abTest: schedule.abTest ?? undefined,
      conversionWindowDays: schedule.conversionWindowDays,
      pushEnabled: schedule.pushEnabled,
    });
    schedule.status = "sent";
    schedule.sentAt = new Date();
    schedule.result = result;
    await schedule.save();
    await recordBusinessEvent({
      event: "notification.schedule.retry_sent",
      category: "notifications",
      severity: "info",
      title: "Scheduled notification retry sent",
      description: schedule.title,
      entityType: "notification_schedule",
      entityId: String(schedule._id ?? ""),
      metadata: {
        recipientType: schedule.recipientType,
        audience: schedule.audience,
        sentCount: result.sentCount,
        totalTargets: result.totalTargets,
      },
    });
    return { updated: true, status: schedule.status, result };
  } catch (error) {
    schedule.status = "failed";
    schedule.failureReason =
      error instanceof Error ? error.message : "Scheduled notification retry failed";
    await schedule.save();
    await recordBusinessEvent({
      event: "notification.schedule.retry_failed",
      category: "notifications",
      severity: "critical",
      title: "Scheduled notification retry failed",
      description: schedule.failureReason,
      entityType: "notification_schedule",
      entityId: String(schedule._id ?? ""),
    });
    return { updated: false, status: schedule.status, failureReason: schedule.failureReason };
  }
}
