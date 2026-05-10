import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../common/utils/app-error";
import { CustomerModel } from "../customer/customer.model";
import { sendPushToCustomer } from "../customer/push.service";
import { RestaurantModel } from "../auth/auth.model";
import { ReviewModel } from "../owner/experience.model";
import { OrderModel } from "../owner/operational.model";
import { AdminAuditLogModel, AdminModel } from "./admin.model";

const LIVE_ORDER_STATUSES = [
  "New",
  "Accepted",
  "Preparing",
  "ReadyForPickup",
  "PickedUp",
];

type CustomerListParams = {
  search?: string;
  status?: "all" | "active" | "suspended" | "locked";
  requestStatus?: "all" | "pending" | "cancelled" | "reviewed" | "completed" | "none";
  sortBy?: "newest" | "recentLogin" | "mostOrders" | "highestSpend";
  page?: number;
  pageSize?: number;
};

type CustomerOrdersParams = {
  preset?: string;
  from?: string;
  to?: string;
  restaurantId?: string;
  status?: "all" | "live" | "delivered" | "cancelled";
  search?: string;
  sortBy?: "newest" | "oldest" | "highestValue";
  page?: number;
  pageSize?: number;
};

function clampPage(value?: number) {
  if (!value || Number.isNaN(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function clampPageSize(value?: number) {
  if (!value || Number.isNaN(value)) return 20;
  return Math.min(100, Math.max(5, Math.floor(value)));
}

function serializeDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function objectIdString(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && "toString" in value) return String(value);
  return "";
}

function toObjectIdOrThrow(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "INVALID_ID", `${label} id is invalid`);
  }

  return new mongoose.Types.ObjectId(value);
}

function buildDateMatch(params?: { preset?: string; from?: string; to?: string }) {
  const now = new Date();
  let from: Date | null = null;
  let to: Date | null = null;

  if (params?.preset === "today") {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    to = new Date(now);
    to.setHours(23, 59, 59, 999);
  } else if (params?.preset === "yesterday") {
    from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setHours(23, 59, 59, 999);
  } else if (params?.preset === "last30Days") {
    from = new Date(now);
    from.setDate(from.getDate() - 30);
  } else if (params?.preset === "thisWeek") {
    from = new Date(now);
    const day = from.getDay();
    const diff = from.getDate() - day + (day === 0 ? -6 : 1);
    from.setDate(diff);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setDate(from.getDate() + 6);
    to.setHours(23, 59, 59, 999);
  } else if (params?.preset === "thisMonth") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (params?.preset === "custom") {
    from = params.from ? new Date(params.from) : null;
    to = params.to ? new Date(params.to) : null;
  } else {
    from = new Date(now);
    from.setDate(from.getDate() - 7);
  }

  const match: Record<string, Date> = {};
  if (from && !Number.isNaN(from.getTime())) match.$gte = from;
  if (to && !Number.isNaN(to.getTime())) match.$lte = to;

  return Object.keys(match).length ? match : null;
}

function buildCustomerQuery(params: CustomerListParams = {}) {
  const query: Record<string, unknown> = {};

  if (params.search?.trim()) {
    const search = params.search.trim();
    query.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  if (params.status && params.status !== "all") query.status = params.status;

  if (params.requestStatus && params.requestStatus !== "all") {
    if (params.requestStatus === "none") {
      query.$and = [
        ...(Array.isArray(query.$and) ? query.$and : []),
        {
          $or: [
            { "accountRequest.type": null },
            { "accountRequest.type": { $exists: false } },
            { "accountRequest.status": null },
            { "accountRequest.status": { $exists: false } },
          ],
        },
      ];
    } else {
      query["accountRequest.status"] = params.requestStatus;
    }
  }

  return query;
}

function asRecordArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? (value as Array<Record<string, any>>) : [];
}

function buildCustomerSort(sortBy?: CustomerListParams["sortBy"]): Record<string, 1 | -1> {
  if (sortBy === "recentLogin") return { lastLoginAt: -1, createdAt: -1 };
  if (sortBy === "mostOrders") return { totalOrders: -1, createdAt: -1 };
  if (sortBy === "highestSpend") return { deliveredSpend: -1, createdAt: -1 };
  return { createdAt: -1 };
}

function mapCustomerSummary(customer: Record<string, any>) {
  const activePushTokens = Array.isArray(customer.pushTokens)
    ? customer.pushTokens.filter((token: Record<string, unknown>) => !token.disabledAt).length
    : 0;
  const unreadNotifications = Array.isArray(customer.notifications)
    ? customer.notifications.filter((item: Record<string, unknown>) => item.isRead !== true).length
    : 0;

  return {
    id: objectIdString(customer._id),
    fullName: stringValue(customer.fullName, "Customer"),
    phone: stringValue(customer.phone),
    email: stringValue(customer.email),
    status: stringValue(customer.status, "active"),
    authProviders: Array.isArray(customer.authProviders) ? customer.authProviders : [],
    lastLoginAt: serializeDate(customer.lastLoginAt),
    createdAt: serializeDate(customer.createdAt),
    updatedAt: serializeDate(customer.updatedAt),
    savedLocationsCount: Array.isArray(customer.savedLocations)
      ? customer.savedLocations.length
      : 0,
    hasPushToken: activePushTokens > 0,
    unreadNotifications,
    requestStatus: customer.accountRequest?.status ?? null,
    requestType: customer.accountRequest?.type ?? null,
    requestRequestedAt: serializeDate(customer.accountRequest?.requestedAt),
    totalOrders: numberValue(customer.totalOrders),
    liveOrders: numberValue(customer.liveOrders),
    deliveredOrders: numberValue(customer.deliveredOrders),
    deliveredSpend: numberValue(customer.deliveredSpend),
  };
}

async function createAdminAuditLog(params: {
  adminId?: string;
  customerId: string;
  action: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = params.adminId ? await AdminModel.findById(params.adminId).lean() : null;

  await AdminAuditLogModel.create({
    actorAdminId: params.adminId ?? "",
    actorName: stringValue(admin?.fullName, "Admin"),
    actorRole: stringValue(admin?.role, "admin"),
    entityType: "customer",
    entityId: params.customerId,
    action: params.action,
    title: params.title,
    description: params.description ?? "",
    metadata: params.metadata ?? {},
  });
}

async function getCustomerOrThrow(customerId: string) {
  const safeCustomerId = toObjectIdOrThrow(customerId, "Customer");
  const customer = await CustomerModel.findById(safeCustomerId);

  if (!customer) {
    throw new AppError(StatusCodes.NOT_FOUND, "CUSTOMER_NOT_FOUND", "Customer not found");
  }

  return customer;
}

export async function listAdminCustomers(params: CustomerListParams = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const query = buildCustomerQuery(params);
  const sort = buildCustomerSort(params.sortBy);
  const [items, total, summaryRows] = await Promise.all([
    CustomerModel.aggregate<Record<string, any>>([
      { $match: query },
      { $addFields: { customerIdString: { $toString: "$_id" } } },
      {
        $lookup: {
          from: OrderModel.collection.name,
          localField: "customerIdString",
          foreignField: "customerId",
          as: "orders",
        },
      },
      {
        $addFields: {
          totalOrders: { $size: "$orders" },
          liveOrders: {
            $size: {
              $filter: {
                input: "$orders",
                as: "order",
                cond: { $in: ["$$order.status", LIVE_ORDER_STATUSES] },
              },
            },
          },
          deliveredOrders: {
            $size: {
              $filter: {
                input: "$orders",
                as: "order",
                cond: { $eq: ["$$order.status", "Delivered"] },
              },
            },
          },
          deliveredSpend: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$orders",
                    as: "order",
                    cond: { $eq: ["$$order.status", "Delivered"] },
                  },
                },
                as: "order",
                in: { $ifNull: ["$$order.pricing.total", 0] },
              },
            },
          },
        },
      },
      { $sort: sort },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $project: { orders: 0, customerIdString: 0 } },
    ]),
    CustomerModel.countDocuments(query),
    CustomerModel.aggregate<{
      _id: null;
      total: number;
      active: number;
      suspended: number;
      locked: number;
      pendingRequests: number;
    }>([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] } },
          locked: { $sum: { $cond: [{ $eq: ["$status", "locked"] }, 1, 0] } },
          pendingRequests: {
            $sum: { $cond: [{ $eq: ["$accountRequest.status", "pending"] }, 1, 0] },
          },
        },
      },
    ]),
  ]);
  const summary = summaryRows[0] ?? {
    total: 0,
    active: 0,
    suspended: 0,
    locked: 0,
    pendingRequests: 0,
  };

  return {
    items: items.map(mapCustomerSummary),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary,
  };
}

export async function getAdminCustomerDetails(
  customerId: string,
  params?: { preset?: string; from?: string; to?: string },
) {
  const safeCustomerId = toObjectIdOrThrow(customerId, "Customer");
  const customer = await CustomerModel.findById(safeCustomerId).lean();

  if (!customer) {
    throw new AppError(StatusCodes.NOT_FOUND, "CUSTOMER_NOT_FOUND", "Customer not found");
  }

  const customerIdString = safeCustomerId.toString();
  const dateMatch = buildDateMatch(params);
  const windowMatch: Record<string, unknown> = { customerId: customerIdString };
  if (dateMatch) windowMatch.createdAt = dateMatch;

  const [
    lifetimeRows,
    windowRows,
    reviewRows,
    topRestaurants,
    orderRestaurants,
    recentOrders,
    recentReviews,
    auditLogs,
  ] = await Promise.all([
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: customerIdString } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          liveOrders: {
            $sum: { $cond: [{ $in: ["$status", LIVE_ORDER_STATUSES] }, 1, 0] },
          },
          deliveredOrders: { $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] } },
          deliveredSpend: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Delivered"] },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
        },
      },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: windowMatch },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          liveOrders: {
            $sum: { $cond: [{ $in: ["$status", LIVE_ORDER_STATUSES] }, 1, 0] },
          },
          deliveredOrders: { $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] } },
          deliveredSpend: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Delivered"] },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
        },
      },
    ]),
    ReviewModel.aggregate<{ _id: null; reviewsGiven: number; averageReviewRating: number }>([
      { $match: { customerId: customerIdString } },
      {
        $group: {
          _id: null,
          reviewsGiven: { $sum: 1 },
          averageReviewRating: { $avg: "$rating" },
        },
      },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: customerIdString } },
      {
        $group: {
          _id: "$restaurantId",
          orders: { $sum: 1 },
          deliveredOrders: { $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] } },
          spend: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Delivered"] },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
          lastOrderedAt: { $max: "$createdAt" },
        },
      },
      { $sort: { spend: -1, orders: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: RestaurantModel.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "restaurantDocs",
        },
      },
      { $addFields: { restaurant: { $arrayElemAt: ["$restaurantDocs", 0] } } },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: customerIdString } },
      { $group: { _id: "$restaurantId", restaurantName: { $first: "$restaurantSnapshot.name" } } },
      {
        $lookup: {
          from: RestaurantModel.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "restaurantDocs",
        },
      },
      { $addFields: { restaurant: { $arrayElemAt: ["$restaurantDocs", 0] } } },
      { $sort: { "restaurant.name": 1 } },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: customerIdString } },
      { $sort: { createdAt: -1 } },
      { $limit: 8 },
      {
        $lookup: {
          from: RestaurantModel.collection.name,
          localField: "restaurantId",
          foreignField: "_id",
          as: "restaurantDocs",
        },
      },
      { $addFields: { restaurant: { $arrayElemAt: ["$restaurantDocs", 0] } } },
    ]),
    ReviewModel.aggregate<Record<string, any>>([
      { $match: { customerId: customerIdString } },
      { $sort: { createdAt: -1 } },
      { $limit: 8 },
      {
        $lookup: {
          from: RestaurantModel.collection.name,
          localField: "restaurantId",
          foreignField: "_id",
          as: "restaurantDocs",
        },
      },
      { $addFields: { restaurant: { $arrayElemAt: ["$restaurantDocs", 0] } } },
    ]),
    AdminAuditLogModel.find({ entityType: "customer", entityId: customerIdString })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const lifetime = lifetimeRows[0] ?? {
    totalOrders: 0,
    liveOrders: 0,
    deliveredOrders: 0,
    deliveredSpend: 0,
  };
  const overview = windowRows[0] ?? {
    totalOrders: 0,
    liveOrders: 0,
    deliveredOrders: 0,
    deliveredSpend: 0,
  };
  const reviewStats = reviewRows[0] ?? {
    reviewsGiven: 0,
    averageReviewRating: 0,
  };
  const customerSavedLocations = asRecordArray(customer.savedLocations);
  const customerNotifications = asRecordArray(customer.notifications);
  const customerPushTokens = asRecordArray(customer.pushTokens);
  const customerPreviousPhones = asRecordArray(customer.previousPhones);
  const accountRequestHistory = asRecordArray(customer.accountRequest?.history);

  return {
    ...mapCustomerSummary({
      ...customer,
      totalOrders: lifetime.totalOrders,
      liveOrders: lifetime.liveOrders,
      deliveredOrders: lifetime.deliveredOrders,
      deliveredSpend: lifetime.deliveredSpend,
    }),
    profileImageUrl: stringValue(customer.profileImage?.url),
    notificationSettings: {
      orderUpdates: customer.notificationSettings?.orderUpdates ?? true,
      restaurantStatus: customer.notificationSettings?.restaurantStatus ?? true,
      reviewReplies: customer.notificationSettings?.reviewReplies ?? true,
    },
    overview: {
      totalOrders: numberValue(overview.totalOrders),
      liveOrders: numberValue(overview.liveOrders),
      deliveredOrders: numberValue(overview.deliveredOrders),
      deliveredSpend: numberValue(overview.deliveredSpend),
      averageDeliveredValue:
        numberValue(overview.deliveredOrders) > 0
          ? Math.round(numberValue(overview.deliveredSpend) / numberValue(overview.deliveredOrders))
          : 0,
      reviewsGiven: numberValue(reviewStats.reviewsGiven),
      averageReviewRating: Number(numberValue(reviewStats.averageReviewRating).toFixed(1)),
    },
    lifetime: {
      totalOrders: numberValue(lifetime.totalOrders),
      liveOrders: numberValue(lifetime.liveOrders),
      deliveredOrders: numberValue(lifetime.deliveredOrders),
      deliveredSpend: numberValue(lifetime.deliveredSpend),
      averageDeliveredValue:
        numberValue(lifetime.deliveredOrders) > 0
          ? Math.round(numberValue(lifetime.deliveredSpend) / numberValue(lifetime.deliveredOrders))
          : 0,
    },
    account: {
      savedLocationsCount: customerSavedLocations.length,
      unreadNotifications: customerNotifications.filter((item) => item.isRead !== true).length,
      pushTokensCount: customerPushTokens.length,
      activePushTokensCount: customerPushTokens.filter((token) => !token.disabledAt).length,
      previousPhones: customerPreviousPhones.map((entry) => ({
        phone: stringValue(entry.phone),
        changedAt: serializeDate(entry.changedAt),
      })),
    },
    accountRequest: customer.accountRequest?.type
      ? {
          type: customer.accountRequest.type ?? null,
          status: customer.accountRequest.status ?? null,
          requestedAt: serializeDate(customer.accountRequest.requestedAt),
          reason: stringValue(customer.accountRequest.reason),
          reviewNote: stringValue(customer.accountRequest.reviewNote),
          reviewedByAdminName: stringValue(customer.accountRequest.reviewedByAdminName),
          reviewedAt: serializeDate(customer.accountRequest.reviewedAt),
          history: accountRequestHistory.map((entry) => ({
            action: stringValue(entry.action),
            note: stringValue(entry.note),
            actorName: stringValue(entry.actorName),
            createdAt: serializeDate(entry.createdAt),
          })),
        }
      : null,
    topRestaurants: topRestaurants.map((row) => ({
      restaurantId: objectIdString(row._id),
      restaurantName: stringValue(row.restaurant?.name, "Restaurant"),
      orders: numberValue(row.orders),
      deliveredOrders: numberValue(row.deliveredOrders),
      spend: numberValue(row.spend),
      lastOrderedAt: serializeDate(row.lastOrderedAt),
    })),
    orderRestaurants: orderRestaurants.map((row) => ({
      restaurantId: objectIdString(row._id),
      restaurantName: stringValue(row.restaurant?.name, stringValue(row.restaurantName, "Restaurant")),
    })),
    savedLocations: customerSavedLocations.map((location) => ({
      id: objectIdString(location._id),
      label: stringValue(location.label),
      address: stringValue(location.address),
      isDefault: location.isDefault === true,
      lastUsedAt: serializeDate(location.lastUsedAt),
    })),
    devices: customerPushTokens.map((token) => ({
      expoPushToken: stringValue(token.expoPushToken),
      platform: stringValue(token.platform),
      appVersion: stringValue(token.appVersion),
      deviceId: stringValue(token.deviceId),
      lastSeenAt: serializeDate(token.lastSeenAt),
      disabledAt: serializeDate(token.disabledAt),
    })),
    recentNotifications: customerNotifications
      .slice(-8)
      .reverse()
      .map((notification) => ({
        type: stringValue(notification.type),
        title: stringValue(notification.title),
        description: stringValue(notification.description),
        path: stringValue(notification.path),
        isRead: notification.isRead === true,
        createdAt: serializeDate(notification.createdAt),
      })),
    recentOrders: recentOrders.map((order) => ({
      id: objectIdString(order._id),
      orderNumber: stringValue(order.orderNumber),
      restaurantId: objectIdString(order.restaurantId),
      restaurantName: stringValue(order.restaurant?.name, "Restaurant"),
      status: stringValue(order.status),
      paymentMethod: stringValue(order.paymentMethod),
      paymentStatus: stringValue(order.paymentStatus),
      total: numberValue(order.pricing?.total),
      createdAt: serializeDate(order.createdAt),
      deliveredAt: serializeDate(order.timestamps?.Delivered ?? order.timestamps?.deliveredAt),
    })),
    recentReviews: recentReviews.map((review) => ({
      id: objectIdString(review._id),
      restaurantId: objectIdString(review.restaurantId),
      restaurantName: stringValue(review.restaurant?.name, "Restaurant"),
      rating: numberValue(review.rating),
      comment: stringValue(review.comment),
      ownerReplyMessage: stringValue(review.ownerReply?.message),
      moderationStatus: stringValue(review.moderationStatus, "visible"),
      isHidden: review.isHidden === true,
      hiddenAt: serializeDate(review.hiddenAt),
      hiddenReason: stringValue(review.hiddenReason),
      createdAt: serializeDate(review.createdAt),
    })),
    auditLogs: auditLogs.map((log) => ({
      id: objectIdString(log._id),
      action: stringValue(log.action),
      title: stringValue(log.title),
      description: stringValue(log.description),
      actorName: stringValue(log.actorName, "Admin"),
      actorRole: stringValue(log.actorRole, "admin"),
      createdAt: serializeDate(log.createdAt),
      metadata: log.metadata && typeof log.metadata === "object" ? log.metadata : {},
    })),
  };
}

export async function listAdminCustomerOrders(
  customerId: string,
  params: CustomerOrdersParams = {},
) {
  const safeCustomerId = toObjectIdOrThrow(customerId, "Customer");
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const query: Record<string, unknown> = { customerId: safeCustomerId.toString() };
  const dateMatch = buildDateMatch(params);

  if (dateMatch) query.createdAt = dateMatch;
  if (params.restaurantId) {
    query.restaurantId = toObjectIdOrThrow(params.restaurantId, "Restaurant");
  }
  if (params.status === "live") query.status = { $in: LIVE_ORDER_STATUSES };
  if (params.status === "delivered") query.status = "Delivered";
  if (params.status === "cancelled") query.status = { $in: ["Cancelled", "Rejected"] };
  if (params.search?.trim()) {
    const search = params.search.trim();
    query.$or = [
      { orderNumber: { $regex: search, $options: "i" } },
      { "customerSnapshot.fullName": { $regex: search, $options: "i" } },
      { "customerSnapshot.phone": { $regex: search, $options: "i" } },
    ];
  }

  const sort: Record<string, 1 | -1> =
    params.sortBy === "oldest"
      ? { createdAt: 1 }
      : params.sortBy === "highestValue"
        ? { "pricing.total": -1, createdAt: -1 }
        : { createdAt: -1 };
  const [orders, total] = await Promise.all([
    OrderModel.aggregate<Record<string, any>>([
      { $match: query },
      { $sort: sort },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      {
        $lookup: {
          from: RestaurantModel.collection.name,
          localField: "restaurantId",
          foreignField: "_id",
          as: "restaurantDocs",
        },
      },
      { $addFields: { restaurant: { $arrayElemAt: ["$restaurantDocs", 0] } } },
    ]),
    OrderModel.countDocuments(query),
  ]);

  return {
    items: orders.map((order) => ({
      id: objectIdString(order._id),
      orderNumber: stringValue(order.orderNumber),
      restaurantId: objectIdString(order.restaurantId),
      restaurantName: stringValue(order.restaurant?.name, "Restaurant"),
      status: stringValue(order.status),
      paymentMethod: stringValue(order.paymentMethod),
      paymentStatus: stringValue(order.paymentStatus),
      total: numberValue(order.pricing?.total),
      subtotal: numberValue(order.pricing?.subtotal),
      deliveryFee: numberValue(order.pricing?.deliveryFee),
      createdAt: serializeDate(order.createdAt),
      acceptedAt: serializeDate(order.timestamps?.Accepted ?? order.timestamps?.acceptedAt),
      readyAt: serializeDate(order.timestamps?.ReadyForPickup ?? order.timestamps?.readyForPickupAt),
      deliveredAt: serializeDate(order.timestamps?.Delivered ?? order.timestamps?.deliveredAt),
      cancelledAt: serializeDate(order.timestamps?.Cancelled ?? order.timestamps?.cancelledAt),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateAdminCustomerStatus(params: {
  customerId: string;
  status: "active" | "suspended" | "locked";
  note?: string;
  adminId?: string;
}) {
  const customer = await getCustomerOrThrow(params.customerId);
  const previousStatus = customer.status;
  customer.status = params.status;
  await customer.save();

  await createAdminAuditLog({
    adminId: params.adminId,
    customerId: customer.id,
    action: "status.updated",
    title: "Customer status updated",
    description: `${customer.fullName || customer.phone || "Customer"} changed from ${previousStatus} to ${params.status}.`,
    metadata: {
      previousStatus,
      status: params.status,
      note: params.note?.trim() ?? "",
    },
  });

  if (params.status !== previousStatus) {
    try {
      await sendPushToCustomer({
        customerId: customer.id,
        payload: {
          title: "Account status updated",
          body:
            params.status === "active"
              ? "Your account is active again."
              : params.status === "locked"
                ? "Your account has been locked. Contact support for help."
                : "Your account has been suspended. Contact support for help.",
          data: {
            type: "account_status",
            path: "/account",
          },
        },
      });
    } catch {
      // Admin moderation should not roll back because external push delivery is down.
    }
  }

  return {
    id: customer.id,
    fullName: customer.fullName || "Customer",
    status: customer.status,
    updatedAt: serializeDate(customer.updatedAt),
  };
}
