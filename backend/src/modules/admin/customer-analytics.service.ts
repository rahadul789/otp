import mongoose from "mongoose";

import { CustomerAnalyticsEventModel } from "../customer/customer-analytics.model";
import {
  BkashSandboxPaymentSessionModel,
  CustomerModel,
} from "../customer/customer.model";
import { RestaurantModel } from "../auth/auth.model";
import { OrderModel } from "../owner/operational.model";

type AnalyticsPreset =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "last90Days"
  | "thisMonth"
  | "lastMonth"
  | "lifetime"
  | "custom";

type AnalyticsSummaryParams = {
  preset?: AnalyticsPreset;
  from?: string;
  to?: string;
  limit?: number;
  detail?: "summary" | "full";
  section?:
    | "overview"
    | "graphs"
    | "funnels"
    | "customers"
    | "abandoned"
    | "payments"
    | "events"
    | "all";
};

type AnalyticsActorDetailParams = Pick<
  AnalyticsSummaryParams,
  "preset" | "from" | "to" | "limit"
> & {
  customerId?: string;
  anonymousId?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_ANALYTICS_CACHE_TTL_MS = 60_000;
const customerAnalyticsCache = new Map<
  string,
  { expiresAt: number; value?: Awaited<ReturnType<typeof buildCustomerAnalyticsSummary>>; promise?: Promise<Awaited<ReturnType<typeof buildCustomerAnalyticsSummary>>> }
>();
const CUSTOMER_ANALYTICS_QUERY_CONCURRENCY = 4;

async function runAnalyticsTasks<T extends readonly unknown[]>(
  tasks: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex];
    }
  }

  const workerCount = Math.min(
    CUSTOMER_ANALYTICS_QUERY_CONCURRENCY,
    tasks.length,
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildRange(params: AnalyticsSummaryParams) {
  const now = new Date();
  const preset = params.preset ?? "last30Days";

  if (preset === "custom") {
    return {
      preset,
      start: startOfDay(parseDate(params.from) ?? new Date(now.getTime() - 29 * DAY_MS)),
      end: endOfDay(parseDate(params.to) ?? now),
    };
  }

  if (preset === "today") return { preset, start: startOfDay(now), end: endOfDay(now) };
  if (preset === "yesterday") {
    const yesterday = new Date(now.getTime() - DAY_MS);
    return { preset, start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }
  if (preset === "last7Days") {
    return {
      preset,
      start: startOfDay(new Date(now.getTime() - 6 * DAY_MS)),
      end: endOfDay(now),
    };
  }
  if (preset === "last90Days") {
    return {
      preset,
      start: startOfDay(new Date(now.getTime() - 89 * DAY_MS)),
      end: endOfDay(now),
    };
  }
  if (preset === "thisMonth") {
    return {
      preset,
      start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: endOfDay(now),
    };
  }
  if (preset === "lastMonth") {
    return {
      preset,
      start: startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (preset === "lifetime") {
    return {
      preset,
      start: startOfDay(new Date(0)),
      end: endOfDay(now),
    };
  }

  return {
    preset: "last30Days" as const,
    start: startOfDay(new Date(now.getTime() - 29 * DAY_MS)),
    end: endOfDay(now),
  };
}

export async function getCustomerAnalyticsSummary(params: AnalyticsSummaryParams) {
  const range = buildRange(params);
  const limit = Math.min(Math.max(params.limit ?? 20, 5), 100);
  const section = params.section ?? "all";
  const lightweightSection = ["overview", "graphs", "events", "payments"].includes(section);
  const cacheKey = JSON.stringify({
    detail: params.detail ?? (lightweightSection ? "summary" : "full"),
    section: lightweightSection || section === "funnels" || section === "customers" ? section : section === "all" ? "all" : "heavy",
    preset: range.preset,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    limit,
  });
  const cached = customerAnalyticsCache.get(cacheKey);
  const now = Date.now();

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = buildCustomerAnalyticsSummary({
    ...params,
    detail: params.detail ?? (lightweightSection ? "summary" : "full"),
    section,
    preset: range.preset,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    limit,
  });
  customerAnalyticsCache.set(cacheKey, {
    expiresAt: now + CUSTOMER_ANALYTICS_CACHE_TTL_MS,
    promise,
  });

  try {
    const value = await promise;
    customerAnalyticsCache.set(cacheKey, {
      expiresAt: Date.now() + CUSTOMER_ANALYTICS_CACHE_TTL_MS,
      value,
    });
    return value;
  } catch (error) {
    customerAnalyticsCache.delete(cacheKey);
    throw error;
  }
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function serializeDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeId(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "toString" in value) {
    return value.toString();
  }
  return String(value);
}

function calculateRate(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function formatCurrencyForText(value: number) {
  return `Tk ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString("en-US")}`;
}

function makeAlert(params: {
  key: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metric: number;
}) {
  return params;
}

function readMetadataNumber(
  metadata: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function buildActivityItems(activities: unknown[]) {
  return activities.slice(0, 16).map((activity) => {
    const item = asRecord(activity);
    return {
      eventType: stringValue(item.eventType),
      path: stringValue(item.path),
      screenName: stringValue(item.screenName),
      entityType: stringValue(item.entityType),
      entityId: stringValue(item.entityId),
      occurredAt: serializeDate(item.occurredAt),
    };
  });
}

function buildCartItemsFromMetadata(metadata: Record<string, unknown>) {
  const items = Array.isArray(metadata.items) ? metadata.items : [];

  return items.slice(0, 8).map((item) => {
    const row = asRecord(item);
    return {
      itemId: stringValue(row.itemId),
      name: stringValue(row.name) || "Cart item",
      quantity: numberValue(row.quantity),
      unitPrice: numberValue(row.unitPrice),
      total: numberValue(row.total),
    };
  });
}

type AnalyticsRange = ReturnType<typeof buildRange>;

export async function getCustomerAnalyticsActorDetail(
  params: AnalyticsActorDetailParams,
) {
  const range = buildRange(params);
  const limit = Math.min(Math.max(params.limit ?? 20, 5), 100);
  const customerId = stringValue(params.customerId).trim();
  const anonymousId = stringValue(params.anonymousId).trim();
  const activityMatch = {
    occurredAt: {
      $gte: range.start,
      $lte: range.end,
    },
    ...(customerId ? { customerId } : { anonymousId }),
  };
  const profilePromise =
    customerId && mongoose.Types.ObjectId.isValid(customerId)
      ? CustomerModel.findById(customerId)
          .select({ fullName: 1, phone: 1, status: 1, createdAt: 1, lastLoginAt: 1 })
          .lean()
      : Promise.resolve(null);
  const orderFacetPromise = customerId
    ? OrderModel.aggregate<Record<string, any>>([
        { $match: { customerId } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  lifetimeOrders: { $sum: 1 },
                  lifetimeSpend: { $sum: { $ifNull: ["$pricing.total", 0] } },
                  timeframeOrders: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$createdAt", range.start] },
                            { $lte: ["$createdAt", range.end] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  timeframeSpend: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$createdAt", range.start] },
                            { $lte: ["$createdAt", range.end] },
                          ],
                        },
                        { $ifNull: ["$pricing.total", 0] },
                        0,
                      ],
                    },
                  },
                  deliveredOrders: {
                    $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] },
                  },
                  cancelledOrders: {
                    $sum: {
                      $cond: [
                        { $in: ["$status", ["Cancelled", "Rejected"]] },
                        1,
                        0,
                      ],
                    },
                  },
                  firstOrderAt: { $min: "$createdAt" },
                  lastOrderAt: { $max: "$createdAt" },
                },
              },
            ],
            trend: [
              { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$createdAt",
                    },
                  },
                  orders: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
                },
              },
              { $sort: { _id: 1 } },
            ],
            topRestaurants: [
              {
                $group: {
                  _id: "$restaurantId",
                  orders: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
                },
              },
              { $sort: { orders: -1, revenue: -1 } },
              { $limit: 5 },
            ],
            paymentMethods: [
              {
                $group: {
                  _id: "$paymentMethod",
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
            ],
          },
        },
      ])
    : Promise.resolve([]);
  const recentOrdersPromise = customerId
    ? OrderModel.find({ customerId })
        .sort({ createdAt: -1 })
        .limit(Math.min(limit, 20))
        .select({
          orderNumber: 1,
          restaurantId: 1,
          status: 1,
          paymentMethod: 1,
          paymentStatus: 1,
          pricing: 1,
          createdAt: 1,
        })
        .lean()
    : Promise.resolve([]);
  const activityPromise =
    customerId || anonymousId
      ? CustomerAnalyticsEventModel.find(activityMatch)
          .sort({ occurredAt: -1 })
          .limit(Math.min(limit, 20))
          .select({
            eventType: 1,
            path: 1,
            screenName: 1,
            entityType: 1,
            entityId: 1,
            occurredAt: 1,
          })
          .lean()
      : Promise.resolve([]);
  const [profile, orderFacetRows, recentOrders, activities] =
    await runAnalyticsTasks([
      profilePromise,
      orderFacetPromise,
      recentOrdersPromise,
      activityPromise,
    ]);
  const orderFacet = Array.isArray(orderFacetRows) ? orderFacetRows[0] ?? {} : {};
  const totals = Array.isArray(orderFacet.totals) ? orderFacet.totals[0] ?? {} : {};
  const topRestaurantRows = Array.isArray(orderFacet.topRestaurants)
    ? orderFacet.topRestaurants
    : [];
  const recentRestaurantIds = Array.isArray(recentOrders)
    ? recentOrders.map((order) => normalizeId(asRecord(order).restaurantId))
    : [];
  const restaurantIds = Array.from(
    new Set(
      [
        ...topRestaurantRows.map((row: Record<string, unknown>) => normalizeId(row._id)),
        ...recentRestaurantIds,
      ].filter(Boolean),
    ),
  );
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } })
        .select({ name: 1 })
        .lean()
    : [];
  const restaurantNameById = new Map(
    restaurants.map((restaurant) => [
      normalizeId(restaurant._id),
      stringValue((restaurant as { name?: string }).name),
    ]),
  );
  const paymentMethods = Array.isArray(orderFacet.paymentMethods)
    ? orderFacet.paymentMethods.map((row: Record<string, unknown>) => ({
        paymentMethod: stringValue(row._id) || "unknown",
        count: numberValue(row.count),
      }))
    : [];

  return {
    timeframe: {
      preset: range.preset,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    actorType: customerId ? "customer" : "guest",
    customerId,
    anonymousId,
    fullName:
      stringValue((profile as { fullName?: string } | null)?.fullName) ||
      (customerId ? "Foodbela customer" : "Guest visitor"),
    phone: stringValue((profile as { phone?: string } | null)?.phone),
    status:
      stringValue((profile as { status?: string } | null)?.status) ||
      (customerId ? "active" : "guest"),
    createdAt: serializeDate((profile as { createdAt?: unknown } | null)?.createdAt),
    lastLoginAt: serializeDate(
      (profile as { lastLoginAt?: unknown } | null)?.lastLoginAt,
    ),
    lifetimeOrders: numberValue(totals.lifetimeOrders),
    timeframeOrders: numberValue(totals.timeframeOrders),
    deliveredOrders: numberValue(totals.deliveredOrders),
    cancelledOrders: numberValue(totals.cancelledOrders),
    lifetimeSpend: numberValue(totals.lifetimeSpend),
    timeframeSpend: numberValue(totals.timeframeSpend),
    averageOrderValue: numberValue(totals.lifetimeOrders)
      ? Math.round(numberValue(totals.lifetimeSpend) / numberValue(totals.lifetimeOrders))
      : 0,
    firstOrderAt: serializeDate(totals.firstOrderAt),
    lastOrderAt: serializeDate(totals.lastOrderAt),
    favoritePaymentMethod: paymentMethods[0]?.paymentMethod ?? "unknown",
    paymentMethods,
    topRestaurants: topRestaurantRows.map((row: Record<string, unknown>) => {
      const restaurantId = normalizeId(row._id);
      return {
        restaurantId,
        restaurantName:
          restaurantNameById.get(restaurantId) || "Unknown restaurant",
        orders: numberValue(row.orders),
        revenue: numberValue(row.revenue),
      };
    }),
    orderTrend: Array.isArray(orderFacet.trend)
      ? orderFacet.trend.map((row: Record<string, unknown>) => ({
          date: stringValue(row._id),
          orders: numberValue(row.orders),
          revenue: numberValue(row.revenue),
        }))
      : [],
    recentOrders: Array.isArray(recentOrders)
      ? recentOrders.map((order) => {
          const row = asRecord(order);
          const restaurantId = normalizeId(row.restaurantId);
          return {
            orderId: normalizeId(row._id),
            orderNumber: stringValue(row.orderNumber),
            restaurantId,
            restaurantName:
              restaurantNameById.get(restaurantId) || "Unknown restaurant",
            status: stringValue(row.status),
            paymentMethod: stringValue(row.paymentMethod),
            paymentStatus: stringValue(row.paymentStatus),
            total: numberValue(asRecord(row.pricing).total),
            createdAt: serializeDate(row.createdAt),
          };
        })
      : [],
    recentActivities: Array.isArray(activities)
      ? buildActivityItems(activities)
      : [],
  };
}

async function buildInstantCustomerAnalyticsOverview(params: {
  range: AnalyticsRange;
  match: { occurredAt: { $gte: Date; $lte: Date } };
}) {
  const { range, match } = params;
  const overviewRows = await CustomerAnalyticsEventModel.aggregate<
    Record<string, any>
  >([
    { $match: match },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        pageViews: {
          $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] },
        },
        restaurantViews: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "restaurant_view"] }, 1, 0],
          },
        },
        cartViews: {
          $sum: { $cond: [{ $eq: ["$eventType", "cart_view"] }, 1, 0] },
        },
        checkoutStarts: {
          $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] },
        },
        signupStarted: {
          $sum: { $cond: [{ $eq: ["$eventType", "signup_started"] }, 1, 0] },
        },
        signupCompleted: {
          $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] },
        },
        ordersCreated: {
          $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] },
        },
        paymentInitiated: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "payment_initiated"] }, 1, 0],
          },
        },
        paymentCompleted: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "payment_completed"] }, 1, 0],
          },
        },
        paymentFailed: {
          $sum: { $cond: [{ $eq: ["$eventType", "payment_failed"] }, 1, 0] },
        },
        paymentCancelled: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "payment_cancelled"] }, 1, 0],
          },
        },
        anonymousIds: { $addToSet: "$anonymousId" },
        customerIds: { $addToSet: "$customerId" },
        sessions: { $addToSet: "$sessionId" },
      },
    },
  ]);
  const overview = overviewRows[0] ?? {};
  const anonymousIds = Array.isArray(overview.anonymousIds)
    ? overview.anonymousIds.filter(Boolean)
    : [];
  const customerIds = Array.isArray(overview.customerIds)
    ? overview.customerIds.filter(Boolean)
    : [];
  const sessions = Array.isArray(overview.sessions)
    ? overview.sessions.filter(Boolean)
    : [];
  const paymentInitiated = numberValue(overview.paymentInitiated);
  const paymentCompleted = numberValue(overview.paymentCompleted);
  const paymentFailed = numberValue(overview.paymentFailed);
  const paymentCancelled = numberValue(overview.paymentCancelled);
  const paymentCompletionRate = calculateRate(paymentCompleted, paymentInitiated);
  const checkoutConversionRate = calculateRate(
    numberValue(overview.ordersCreated),
    numberValue(overview.checkoutStarts),
  );
  const paymentEvents = [
    {
      eventType: "payment_initiated",
      provider: "all",
      count: paymentInitiated,
    },
    {
      eventType: "payment_completed",
      provider: "all",
      count: paymentCompleted,
    },
    {
      eventType: "payment_failed",
      provider: "all",
      count: paymentFailed,
    },
    {
      eventType: "payment_cancelled",
      provider: "all",
      count: paymentCancelled,
    },
  ].filter((row) => row.count > 0);
  const alerts = [
    numberValue(overview.checkoutStarts) >= 10 && checkoutConversionRate < 30
      ? makeAlert({
          key: "checkout_conversion_low",
          severity: "warning",
          title: "Checkout conversion needs attention",
          description: `${checkoutConversionRate}% of checkout starts became orders.`,
          metric: checkoutConversionRate,
        })
      : null,
    paymentInitiated >= 10 && paymentCompletionRate < 70
      ? makeAlert({
          key: "payment_completion_low",
          severity: "critical",
          title: "Payment completion is weak",
          description: `${paymentCompletionRate}% of initiated payments completed.`,
          metric: paymentCompletionRate,
        })
      : null,
  ].filter(Boolean);

  return {
    timeframe: {
      preset: range.preset,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    overview: {
      totalEvents: numberValue(overview.totalEvents),
      pageViews: numberValue(overview.pageViews),
      restaurantViews: numberValue(overview.restaurantViews),
      cartViews: numberValue(overview.cartViews),
      checkoutStarts: numberValue(overview.checkoutStarts),
      signupStarted: numberValue(overview.signupStarted),
      signupCompleted: numberValue(overview.signupCompleted),
      ordersCreated: numberValue(overview.ordersCreated),
      uniqueAnonymousVisitors: anonymousIds.length,
      uniqueRegisteredCustomers: customerIds.length,
      uniqueSessions: sessions.length,
      browseOnlyAnonymousVisitors: 0,
      registeredBrowseNoOrderCustomers: 0,
      checkoutAbandonedSessions: 0,
      signupAbandonedVisitors: 0,
    },
    insights: {
      signupCompletionRate: calculateRate(
        numberValue(overview.signupCompleted),
        numberValue(overview.signupStarted),
      ),
      checkoutConversionRate,
      paymentCompletionRate,
      paymentFailureRate: calculateRate(
        paymentFailed + paymentCancelled,
        paymentInitiated,
      ),
    },
    alerts,
    recommendedActions: [],
    trend: [],
    sessionJourneys: [],
    restaurantConversions: [],
    restaurantFunnels: [],
    menuItemConversions: [],
    searchAnalytics: [],
    attribution: [],
    paymentHealth: {
      initiated: paymentInitiated,
      completed: paymentCompleted,
      failed: paymentFailed,
      cancelled: paymentCancelled,
      completionRate: paymentCompletionRate,
      events: paymentEvents,
      bkashSessions: [],
      orderMethods: [],
    },
    retention: {
      newCustomers: 0,
      orderedWithin1Day: 0,
      orderedWithin7Days: 0,
      orderedWithin30Days: 0,
      repeatCustomers: 0,
      day1OrderRate: 0,
      day7OrderRate: 0,
      day30OrderRate: 0,
    },
    repeatCustomers: [],
    customerSegments: [],
    abandonedCheckouts: [],
    eventTypes: [],
    actorTypes: [],
    sourceApps: [],
    topPaths: [],
    checkoutDropOffPaths: [],
    recentEvents: [],
  };
}

async function buildFastCustomerAnalyticsSummary(params: {
  range: AnalyticsRange;
  limit: number;
  match: { occurredAt: { $gte: Date; $lte: Date } };
}) {
  const { range, limit, match } = params;
  const [
    overviewRows,
    eventTypeRows,
    actorTypeRows,
    sourceAppRows,
    topPathRows,
    trendRows,
    paymentEventRows,
    recentEvents,
  ] = await runAnalyticsTasks([
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          pageViews: {
            $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] },
          },
          restaurantViews: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "restaurant_view"] }, 1, 0],
            },
          },
          cartViews: {
            $sum: { $cond: [{ $eq: ["$eventType", "cart_view"] }, 1, 0] },
          },
          checkoutStarts: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0],
            },
          },
          signupStarted: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "signup_started"] }, 1, 0],
            },
          },
          signupCompleted: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0],
            },
          },
          ordersCreated: {
            $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] },
          },
          anonymousIds: { $addToSet: "$anonymousId" },
          customerIds: { $addToSet: "$customerId" },
          sessions: { $addToSet: "$sessionId" },
        },
      },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$eventType", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$actorType", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$sourceApp", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: "$path",
          count: { $sum: 1 },
          guestCount: {
            $sum: { $cond: [{ $eq: ["$actorType", "guest"] }, 1, 0] },
          },
          customerCount: {
            $sum: { $cond: [{ $eq: ["$actorType", "customer"] }, 1, 0] },
          },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { count: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$occurredAt",
              timezone: "Asia/Dhaka",
            },
          },
          totalEvents: { $sum: 1 },
          pageViews: {
            $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] },
          },
          checkoutStarts: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0],
            },
          },
          signupStarted: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "signup_started"] }, 1, 0],
            },
          },
          signupCompleted: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0],
            },
          },
          ordersCreated: {
            $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: {
            $in: [
              "payment_initiated",
              "payment_completed",
              "payment_failed",
              "payment_cancelled",
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            eventType: "$eventType",
            provider: "$metadata.provider",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    CustomerAnalyticsEventModel.find(match)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .select({
        _id: 1,
        eventType: 1,
        actorType: 1,
        customerId: 1,
        anonymousId: 1,
        sessionId: 1,
        path: 1,
        screenName: 1,
        entityType: 1,
        entityId: 1,
        occurredAt: 1,
        createdAt: 1,
      })
      .lean(),
  ]);

  const overview = overviewRows[0] ?? {};
  const anonymousIds = Array.isArray(overview.anonymousIds)
    ? overview.anonymousIds.filter(Boolean)
    : [];
  const customerIds = Array.isArray(overview.customerIds)
    ? overview.customerIds.filter(Boolean)
    : [];
  const sessions = Array.isArray(overview.sessions)
    ? overview.sessions.filter(Boolean)
    : [];

  const paymentEvents = paymentEventRows.map((row) => ({
    eventType: stringValue(row._id?.eventType),
    provider: stringValue(row._id?.provider) || "unknown",
    count: numberValue(row.count),
  }));
  const paymentInitiated = paymentEvents
    .filter((row) => row.eventType === "payment_initiated")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentCompleted = paymentEvents
    .filter((row) => row.eventType === "payment_completed")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentFailed = paymentEvents
    .filter((row) => row.eventType === "payment_failed")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentCancelled = paymentEvents
    .filter((row) => row.eventType === "payment_cancelled")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentCompletionRate = calculateRate(paymentCompleted, paymentInitiated);
  const checkoutConversionRate = calculateRate(
    numberValue(overview.ordersCreated),
    numberValue(overview.checkoutStarts),
  );

  const alerts = [
    numberValue(overview.checkoutStarts) >= 10 && checkoutConversionRate < 30
      ? makeAlert({
          key: "checkout_conversion_low",
          severity: "warning",
          title: "Checkout conversion needs attention",
          description: `${checkoutConversionRate}% of checkout starts became orders.`,
          metric: checkoutConversionRate,
        })
      : null,
    paymentInitiated >= 10 && paymentCompletionRate < 70
      ? makeAlert({
          key: "payment_completion_low",
          severity: "critical",
          title: "Payment completion is weak",
          description: `${paymentCompletionRate}% of initiated payments completed.`,
          metric: paymentCompletionRate,
        })
      : null,
  ].filter(Boolean);

  return {
    timeframe: {
      preset: range.preset,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    overview: {
      totalEvents: numberValue(overview.totalEvents),
      pageViews: numberValue(overview.pageViews),
      restaurantViews: numberValue(overview.restaurantViews),
      cartViews: numberValue(overview.cartViews),
      checkoutStarts: numberValue(overview.checkoutStarts),
      signupStarted: numberValue(overview.signupStarted),
      signupCompleted: numberValue(overview.signupCompleted),
      ordersCreated: numberValue(overview.ordersCreated),
      uniqueAnonymousVisitors: anonymousIds.length,
      uniqueRegisteredCustomers: customerIds.length,
      uniqueSessions: sessions.length,
      browseOnlyAnonymousVisitors: 0,
      registeredBrowseNoOrderCustomers: 0,
      checkoutAbandonedSessions: 0,
      signupAbandonedVisitors: 0,
    },
    insights: {
      signupCompletionRate: calculateRate(
        numberValue(overview.signupCompleted),
        numberValue(overview.signupStarted),
      ),
      checkoutConversionRate,
      paymentCompletionRate,
      paymentFailureRate: calculateRate(
        paymentFailed + paymentCancelled,
        paymentInitiated,
      ),
    },
    alerts,
    recommendedActions: [],
    trend: trendRows.map((row) => ({
      date: stringValue(row._id),
      totalEvents: numberValue(row.totalEvents),
      pageViews: numberValue(row.pageViews),
      checkoutStarts: numberValue(row.checkoutStarts),
      signupStarted: numberValue(row.signupStarted),
      signupCompleted: numberValue(row.signupCompleted),
      ordersCreated: numberValue(row.ordersCreated),
    })),
    sessionJourneys: [],
    restaurantConversions: [],
    restaurantFunnels: [],
    menuItemConversions: [],
    searchAnalytics: [],
    attribution: [],
    paymentHealth: {
      initiated: paymentInitiated,
      completed: paymentCompleted,
      failed: paymentFailed,
      cancelled: paymentCancelled,
      completionRate: paymentCompletionRate,
      events: paymentEvents,
      bkashSessions: [],
      orderMethods: [],
    },
    retention: {
      newCustomers: 0,
      orderedWithin1Day: 0,
      orderedWithin7Days: 0,
      orderedWithin30Days: 0,
      repeatCustomers: 0,
      day1OrderRate: 0,
      day7OrderRate: 0,
      day30OrderRate: 0,
    },
    repeatCustomers: [],
    customerSegments: [],
    abandonedCheckouts: [],
    eventTypes: eventTypeRows.map((row) => ({
      eventType: stringValue(row._id),
      count: numberValue(row.count),
    })),
    actorTypes: actorTypeRows.map((row) => ({
      actorType: stringValue(row._id),
      count: numberValue(row.count),
    })),
    sourceApps: sourceAppRows.map((row) => ({
      sourceApp: stringValue(row._id) || "unknown",
      count: numberValue(row.count),
    })),
    topPaths: topPathRows.map((row) => ({
      path: stringValue(row._id),
      count: numberValue(row.count),
      guestCount: numberValue(row.guestCount),
      customerCount: numberValue(row.customerCount),
      lastSeenAt: serializeDate(row.lastSeenAt),
    })),
    checkoutDropOffPaths: [],
    recentEvents: recentEvents.map((event) => ({
      id: String(event._id),
      eventType: event.eventType,
      actorType: event.actorType,
      customerId: event.customerId,
      anonymousId: event.anonymousId,
      sessionId: event.sessionId,
      path: event.path,
      screenName: event.screenName,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: serializeDate(event.occurredAt),
      createdAt: serializeDate(event.createdAt),
    })),
  };
}

async function buildCustomerAnalyticsFunnelsSummary(params: {
  range: AnalyticsRange;
  limit: number;
  match: { occurredAt: { $gte: Date; $lte: Date } };
}) {
  const { range, limit, match } = params;
  const base = await buildInstantCustomerAnalyticsOverview({ range, match });
  const orderMatch = {
    createdAt: {
      $gte: range.start,
      $lte: range.end,
    },
  };
  const [
    restaurantViewRows,
    menuItemViewRows,
    cartAddRows,
    restaurantOrderRows,
    menuItemOrderRows,
    restaurantFunnelEventRows,
    checkoutDropOffPathRows,
  ] = await runAnalyticsTasks([
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: "restaurant_view",
          entityId: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$entityId",
          views: { $sum: 1 },
          guestViews: {
            $sum: { $cond: [{ $eq: ["$actorType", "guest"] }, 1, 0] },
          },
          customerViews: {
            $sum: { $cond: [{ $eq: ["$actorType", "customer"] }, 1, 0] },
          },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { views: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: "menu_item_view",
          entityId: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$entityId",
          views: { $sum: 1 },
          itemName: { $last: "$metadata.itemName" },
          restaurantId: { $last: "$metadata.restaurantId" },
          categoryId: { $last: "$metadata.categoryId" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { views: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: "cart_add",
          entityId: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$entityId",
          adds: { $sum: 1 },
          quantity: { $sum: { $ifNull: ["$metadata.quantity", 1] } },
          itemName: { $last: "$metadata.itemName" },
          restaurantId: { $last: "$metadata.restaurantId" },
          categoryId: { $last: "$metadata.categoryId" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { adds: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: orderMatch },
      {
        $group: {
          _id: "$restaurantId",
          orders: { $sum: 1 },
          deliveredOrders: {
            $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] },
          },
          revenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
          customers: { $addToSet: "$customerId" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
      { $sort: { orders: -1, revenue: -1 } },
      { $limit: limit },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: orderMatch },
      { $unwind: "$itemsSnapshot" },
      {
        $group: {
          _id: "$itemsSnapshot.itemId",
          itemName: { $last: "$itemsSnapshot.name" },
          restaurantId: { $last: "$restaurantId" },
          categoryId: { $last: "$itemsSnapshot.categoryId" },
          orders: { $sum: 1 },
          quantity: { $sum: "$itemsSnapshot.quantity" },
          revenue: { $sum: "$itemsSnapshot.lineTotal" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $project: {
          eventType: 1,
          actorType: 1,
          occurredAt: 1,
          customerId: 1,
          anonymousId: 1,
          restaurantId: {
            $ifNull: [
              "$metadata.restaurantId",
              {
                $cond: [
                  { $eq: ["$entityType", "restaurant"] },
                  "$entityId",
                  "",
                ],
              },
            ],
          },
        },
      },
      { $match: { restaurantId: { $ne: "" } } },
      {
        $group: {
          _id: "$restaurantId",
          restaurantViews: {
            $sum: { $cond: [{ $eq: ["$eventType", "restaurant_view"] }, 1, 0] },
          },
          menuItemViews: {
            $sum: { $cond: [{ $eq: ["$eventType", "menu_item_view"] }, 1, 0] },
          },
          cartAdds: {
            $sum: { $cond: [{ $eq: ["$eventType", "cart_add"] }, 1, 0] },
          },
          checkoutStarts: {
            $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] },
          },
          paymentInitiated: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "payment_initiated"] }, 1, 0],
            },
          },
          paymentIssues: {
            $sum: {
              $cond: [
                { $in: ["$eventType", ["payment_failed", "payment_cancelled"]] },
                1,
                0,
              ],
            },
          },
          analyticsOrders: {
            $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] },
          },
          guestVisitors: {
            $addToSet: {
              $cond: [{ $eq: ["$actorType", "guest"] }, "$anonymousId", ""],
            },
          },
          customerVisitors: { $addToSet: "$customerId" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { checkoutStarts: -1, cartAdds: -1, restaurantViews: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, sessionId: { $ne: "" } } },
      { $sort: { occurredAt: 1 } },
      {
        $group: {
          _id: "$sessionId",
          checkoutStarts: {
            $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] },
          },
          ordersCreated: {
            $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] },
          },
          lastPath: { $last: "$path" },
          lastActorType: { $last: "$actorType" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      {
        $match: {
          checkoutStarts: { $gt: 0 },
          ordersCreated: 0,
        },
      },
      {
        $group: {
          _id: "$lastPath",
          sessions: { $sum: 1 },
          guestSessions: {
            $sum: { $cond: [{ $eq: ["$lastActorType", "guest"] }, 1, 0] },
          },
          customerSessions: {
            $sum: { $cond: [{ $eq: ["$lastActorType", "customer"] }, 1, 0] },
          },
          lastSeenAt: { $max: "$lastSeenAt" },
        },
      },
      { $sort: { sessions: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
  ]);
  const restaurantIds = Array.from(
    new Set(
      [
        ...restaurantViewRows.map((row) => stringValue(row._id)),
        ...restaurantOrderRows.map((row) => normalizeId(row._id)),
        ...menuItemViewRows.map((row) => stringValue(row.restaurantId)),
        ...cartAddRows.map((row) => stringValue(row.restaurantId)),
        ...menuItemOrderRows.map((row) => normalizeId(row.restaurantId)),
        ...restaurantFunnelEventRows.map((row) => stringValue(row._id)),
      ].filter(Boolean),
    ),
  );
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } })
        .select({ name: 1 })
        .lean()
    : [];
  const restaurantNameById = new Map(
    restaurants.map((restaurant) => [
      normalizeId(restaurant._id),
      stringValue((restaurant as { name?: string }).name),
    ]),
  );
  const restaurantConversionMap = new Map<
    string,
    {
      restaurantId: string;
      restaurantName: string;
      views: number;
      guestViews: number;
      customerViews: number;
      orders: number;
      deliveredOrders: number;
      revenue: number;
      uniqueCustomers: number;
      lastSeenAt: string | null;
      lastOrderAt: string | null;
    }
  >();

  for (const row of restaurantViewRows) {
    const restaurantId = stringValue(row._id);
    restaurantConversionMap.set(restaurantId, {
      restaurantId,
      restaurantName: restaurantNameById.get(restaurantId) || "Unknown restaurant",
      views: numberValue(row.views),
      guestViews: numberValue(row.guestViews),
      customerViews: numberValue(row.customerViews),
      orders: 0,
      deliveredOrders: 0,
      revenue: 0,
      uniqueCustomers: 0,
      lastSeenAt: serializeDate(row.lastSeenAt),
      lastOrderAt: null,
    });
  }

  for (const row of restaurantOrderRows) {
    const restaurantId = normalizeId(row._id);
    const current =
      restaurantConversionMap.get(restaurantId) ??
      {
        restaurantId,
        restaurantName: restaurantNameById.get(restaurantId) || "Unknown restaurant",
        views: 0,
        guestViews: 0,
        customerViews: 0,
        orders: 0,
        deliveredOrders: 0,
        revenue: 0,
        uniqueCustomers: 0,
        lastSeenAt: null,
        lastOrderAt: null,
      };
    current.orders = numberValue(row.orders);
    current.deliveredOrders = numberValue(row.deliveredOrders);
    current.revenue = numberValue(row.revenue);
    current.uniqueCustomers = Array.isArray(row.customers)
      ? row.customers.filter(Boolean).length
      : 0;
    current.lastOrderAt = serializeDate(row.lastOrderAt);
    restaurantConversionMap.set(restaurantId, current);
  }

  const itemConversionMap = new Map<
    string,
    {
      itemId: string;
      itemName: string;
      restaurantId: string;
      restaurantName: string;
      categoryId: string;
      views: number;
      cartAdds: number;
      cartQuantity: number;
      orders: number;
      orderedQuantity: number;
      revenue: number;
      lastSeenAt: string | null;
      lastOrderAt: string | null;
    }
  >();

  function ensureItemConversion(row: Record<string, any>) {
    const itemId = stringValue(row._id);
    const restaurantId = normalizeId(row.restaurantId);
    const current =
      itemConversionMap.get(itemId) ??
      {
        itemId,
        itemName: stringValue(row.itemName) || "Unknown item",
        restaurantId,
        restaurantName: restaurantNameById.get(restaurantId) || "Unknown restaurant",
        categoryId: stringValue(row.categoryId),
        views: 0,
        cartAdds: 0,
        cartQuantity: 0,
        orders: 0,
        orderedQuantity: 0,
        revenue: 0,
        lastSeenAt: null,
        lastOrderAt: null,
      };
    current.itemName = current.itemName || stringValue(row.itemName) || "Unknown item";
    current.restaurantId = current.restaurantId || restaurantId;
    current.restaurantName =
      restaurantNameById.get(current.restaurantId) || current.restaurantName;
    current.categoryId = current.categoryId || stringValue(row.categoryId);
    return current;
  }

  for (const row of menuItemViewRows) {
    const item = ensureItemConversion(row);
    item.views = numberValue(row.views);
    item.lastSeenAt = serializeDate(row.lastSeenAt);
    itemConversionMap.set(item.itemId, item);
  }

  for (const row of cartAddRows) {
    const item = ensureItemConversion(row);
    item.cartAdds = numberValue(row.adds);
    item.cartQuantity = numberValue(row.quantity);
    item.lastSeenAt = item.lastSeenAt ?? serializeDate(row.lastSeenAt);
    itemConversionMap.set(item.itemId, item);
  }

  for (const row of menuItemOrderRows) {
    const item = ensureItemConversion(row);
    item.orders = numberValue(row.orders);
    item.orderedQuantity = numberValue(row.quantity);
    item.revenue = numberValue(row.revenue);
    item.lastOrderAt = serializeDate(row.lastOrderAt);
    itemConversionMap.set(item.itemId, item);
  }

  const restaurantFunnels = restaurantFunnelEventRows
    .map((row) => {
      const restaurantId = stringValue(row._id);
      const conversion = restaurantConversionMap.get(restaurantId);
      const views = numberValue(row.restaurantViews);
      const menuItemViews = numberValue(row.menuItemViews);
      const cartAdds = numberValue(row.cartAdds);
      const checkoutStarts = numberValue(row.checkoutStarts);
      const orders = conversion?.orders ?? numberValue(row.analyticsOrders);
      const revenue = conversion?.revenue ?? 0;
      const uniqueGuests = Array.isArray(row.guestVisitors)
        ? row.guestVisitors.filter(Boolean).length
        : 0;
      const uniqueCustomers = Array.isArray(row.customerVisitors)
        ? row.customerVisitors.filter(Boolean).length
        : 0;
      const stageRates = {
        viewToMenuRate: calculateRate(menuItemViews, views),
        menuToCartRate: calculateRate(cartAdds, menuItemViews),
        cartToCheckoutRate: calculateRate(checkoutStarts, cartAdds),
        checkoutToOrderRate: calculateRate(orders, checkoutStarts),
      };
      const weakestStage = [
        { stage: "view_to_menu", rate: stageRates.viewToMenuRate },
        { stage: "menu_to_cart", rate: stageRates.menuToCartRate },
        { stage: "cart_to_checkout", rate: stageRates.cartToCheckoutRate },
        { stage: "checkout_to_order", rate: stageRates.checkoutToOrderRate },
      ].sort((a, b) => a.rate - b.rate)[0]?.stage ?? "unknown";

      return {
        restaurantId,
        restaurantName:
          restaurantNameById.get(restaurantId) || "Unknown restaurant",
        restaurantViews: views,
        menuItemViews,
        cartAdds,
        checkoutStarts,
        paymentInitiated: numberValue(row.paymentInitiated),
        paymentIssues: numberValue(row.paymentIssues),
        orders,
        revenue,
        uniqueGuests,
        uniqueCustomers,
        lastSeenAt: serializeDate(row.lastSeenAt),
        lastOrderAt: conversion?.lastOrderAt ?? null,
        ...stageRates,
        weakestStage,
      };
    })
    .sort((a, b) => b.checkoutStarts - a.checkoutStarts || b.cartAdds - a.cartAdds)
    .slice(0, limit);

  return {
    ...base,
    restaurantConversions: Array.from(restaurantConversionMap.values())
      .map((row) => ({
        ...row,
        viewToOrderRate: calculateRate(row.orders, row.views),
      }))
      .sort((a, b) => b.orders - a.orders || b.views - a.views)
      .slice(0, limit),
    restaurantFunnels,
    menuItemConversions: Array.from(itemConversionMap.values())
      .map((row) => ({
        ...row,
        viewToCartRate: calculateRate(row.cartAdds, row.views),
        cartToOrderRate: calculateRate(row.orders, row.cartAdds),
      }))
      .sort((a, b) => b.orders - a.orders || b.cartAdds - a.cartAdds || b.views - a.views)
      .slice(0, limit),
    checkoutDropOffPaths: checkoutDropOffPathRows.map((row) => ({
      path: stringValue(row._id),
      sessions: numberValue(row.sessions),
      guestSessions: numberValue(row.guestSessions),
      customerSessions: numberValue(row.customerSessions),
      lastSeenAt: serializeDate(row.lastSeenAt),
    })),
  };
}

async function buildCustomerAnalyticsCustomersSummary(params: {
  range: AnalyticsRange;
  limit: number;
  match: { occurredAt: { $gte: Date; $lte: Date } };
}) {
  const { range, limit, match } = params;
  const base = await buildInstantCustomerAnalyticsOverview({ range, match });
  const [
    retentionRows,
    repeatCustomerRows,
    newCustomerRows,
    registeredNoOrderRows,
    guestOnlyRows,
    abandonedCheckoutRows,
  ] = await runAnalyticsTasks([
    CustomerModel.aggregate<Record<string, any>>([
      { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
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
        $group: {
          _id: null,
          newCustomers: { $sum: 1 },
          orderedWithin1Day: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: "$orders",
                          as: "order",
                          cond: {
                            $lte: ["$$order.createdAt", { $add: ["$createdAt", DAY_MS] }],
                          },
                        },
                      },
                    },
                    0,
                  ],
                },
                1,
                0,
              ],
            },
          },
          orderedWithin7Days: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: "$orders",
                          as: "order",
                          cond: {
                            $lte: [
                              "$$order.createdAt",
                              { $add: ["$createdAt", 7 * DAY_MS] },
                            ],
                          },
                        },
                      },
                    },
                    0,
                  ],
                },
                1,
                0,
              ],
            },
          },
          orderedWithin30Days: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: "$orders",
                          as: "order",
                          cond: {
                            $lte: [
                              "$$order.createdAt",
                              { $add: ["$createdAt", 30 * DAY_MS] },
                            ],
                          },
                        },
                      },
                    },
                    0,
                  ],
                },
                1,
                0,
              ],
            },
          },
          repeatCustomers: {
            $sum: { $cond: [{ $gt: [{ $size: "$orders" }, 1] }, 1, 0] },
          },
        },
      },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: { $ne: "" } } },
      {
        $group: {
          _id: "$customerId",
          lifetimeOrders: { $sum: 1 },
          lifetimeSpend: { $sum: { $ifNull: ["$pricing.total", 0] } },
          timeframeOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", range.start] },
                    { $lte: ["$createdAt", range.end] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          timeframeSpend: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", range.start] },
                    { $lte: ["$createdAt", range.end] },
                  ],
                },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
          firstOrderAt: { $min: "$createdAt" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
      {
        $match: {
          lifetimeOrders: { $gt: 1 },
          timeframeOrders: { $gt: 0 },
        },
      },
      { $sort: { timeframeOrders: -1, timeframeSpend: -1 } },
      { $limit: limit },
    ]),
    CustomerModel.find({ createdAt: { $gte: range.start, $lte: range.end } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({
        fullName: 1,
        phone: 1,
        status: 1,
        createdAt: 1,
        lastLoginAt: 1,
      })
      .lean(),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, customerId: { $ne: "" } } },
      {
        $group: {
          _id: "$customerId",
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          firstSeenAt: { $min: "$occurredAt" },
          lastSeenAt: { $max: "$occurredAt" },
          lastPath: { $last: "$path" },
        },
      },
      { $match: { pageViews: { $gt: 0 }, ordersCreated: 0 } },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, anonymousId: { $ne: "" } } },
      {
        $group: {
          _id: "$anonymousId",
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          signupCompleted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          firstSeenAt: { $min: "$occurredAt" },
          lastSeenAt: { $max: "$occurredAt" },
          lastPath: { $last: "$path" },
        },
      },
      {
        $match: {
          pageViews: { $gt: 0 },
          signupCompleted: 0,
          ordersCreated: 0,
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, sessionId: { $ne: "" } } },
      {
        $group: {
          _id: "$sessionId",
          actorType: { $last: "$actorType" },
          customerId: { $last: "$customerId" },
          anonymousId: { $first: "$anonymousId" },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $match: { checkoutStarts: { $gt: 0 }, ordersCreated: 0 } },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
  ]);
  const retention = retentionRows[0] ?? {};
  const newCustomers = numberValue(retention.newCustomers);
  const repeatCustomerIds = repeatCustomerRows
    .map((row) => stringValue(row._id))
    .filter(Boolean);
  const customerIds = Array.from(
    new Set([
      ...repeatCustomerIds,
      ...registeredNoOrderRows.map((row) => stringValue(row._id)),
    ].filter(Boolean)),
  );
  const customerProfiles = customerIds.length
    ? await CustomerModel.find({ _id: { $in: customerIds } })
        .select({ fullName: 1, phone: 1, status: 1, createdAt: 1, lastLoginAt: 1 })
        .lean()
    : [];
  const customerById = new Map(
    customerProfiles.map((customer) => [normalizeId(customer._id), customer]),
  );

  function memberFromCustomerId(
    customerId: string,
    reason: string,
    row: Record<string, any> = {},
  ) {
    const profile = customerById.get(customerId) ?? {};
    return {
      id: customerId,
      actorType: "customer",
      customerId,
      anonymousId: "",
      fullName:
        stringValue((profile as { fullName?: string }).fullName) ||
        "Foodbela customer",
      phone: stringValue((profile as { phone?: string }).phone),
      status: stringValue((profile as { status?: string }).status) || "active",
      createdAt: serializeDate((profile as { createdAt?: unknown }).createdAt),
      lastLoginAt: serializeDate((profile as { lastLoginAt?: unknown }).lastLoginAt),
      segmentReason: reason,
      lifetimeOrders: numberValue(row.lifetimeOrders),
      lifetimeSpend: numberValue(row.lifetimeSpend),
      timeframeOrders: numberValue(row.timeframeOrders),
      timeframeSpend: numberValue(row.timeframeSpend),
      firstOrderAt: serializeDate(row.firstOrderAt),
      lastOrderAt: serializeDate(row.lastOrderAt),
      checkoutStarted: numberValue(row.checkoutStarts) > 0,
      ordersCreated: numberValue(row.ordersCreated),
      lastPath: stringValue(row.lastPath),
      firstSeenAt: serializeDate(row.firstSeenAt),
      lastSeenAt: serializeDate(row.lastSeenAt),
      activities: [],
    };
  }

  const repeatCustomers = repeatCustomerRows.map((row) => {
    const customerId = stringValue(row._id);
    const profile = customerById.get(customerId) ?? {};
    return {
      customerId,
      fullName:
        stringValue((profile as { fullName?: string }).fullName) ||
        "Foodbela customer",
      phone: stringValue((profile as { phone?: string }).phone),
      lifetimeOrders: numberValue(row.lifetimeOrders),
      timeframeOrders: numberValue(row.timeframeOrders),
      deliveredOrders: 0,
      cancelledOrders: 0,
      lifetimeSpend: numberValue(row.lifetimeSpend),
      timeframeSpend: numberValue(row.timeframeSpend),
      averageOrderValue: numberValue(row.lifetimeOrders)
        ? Math.round(numberValue(row.lifetimeSpend) / numberValue(row.lifetimeOrders))
        : 0,
      firstOrderAt: serializeDate(row.firstOrderAt),
      lastOrderAt: serializeDate(row.lastOrderAt),
      favoritePaymentMethod: "unknown",
      paymentMethods: [],
      topRestaurants: [],
      orderTrend: [],
      recentOrders: [],
      recentActivities: [],
    };
  });

  return {
    ...base,
    overview: {
      ...base.overview,
      registeredBrowseNoOrderCustomers: registeredNoOrderRows.length,
      browseOnlyAnonymousVisitors: guestOnlyRows.length,
      checkoutAbandonedSessions: abandonedCheckoutRows.length,
    },
    retention: {
      newCustomers,
      orderedWithin1Day: numberValue(retention.orderedWithin1Day),
      orderedWithin7Days: numberValue(retention.orderedWithin7Days),
      orderedWithin30Days: numberValue(retention.orderedWithin30Days),
      repeatCustomers: numberValue(retention.repeatCustomers),
      day1OrderRate: calculateRate(numberValue(retention.orderedWithin1Day), newCustomers),
      day7OrderRate: calculateRate(numberValue(retention.orderedWithin7Days), newCustomers),
      day30OrderRate: calculateRate(numberValue(retention.orderedWithin30Days), newCustomers),
    },
    repeatCustomers,
    customerSegments: [
      {
        key: "new_customers",
        label: "New customers",
        description: "Registered in this timeframe.",
        count: newCustomers,
        actionLabel: "Send welcome offer",
        members: newCustomerRows.map((customer) =>
          memberFromCustomerId(
            normalizeId(customer._id),
            "Recently registered account",
            customer,
          ),
        ),
      },
      {
        key: "repeat_customers",
        label: "Repeat customers",
        description: "Customers with more than one lifetime order.",
        count: repeatCustomers.length,
        actionLabel: "Protect loyalty",
        members: repeatCustomerRows.map((row) =>
          memberFromCustomerId(
            stringValue(row._id),
            "Multiple lifetime orders",
            row,
          ),
        ),
      },
      {
        key: "registered_no_order",
        label: "Registered no order",
        description: "Registered customers browsing without an order.",
        count: registeredNoOrderRows.length,
        actionLabel: "Send first-order offer",
        members: registeredNoOrderRows.map((row) =>
          memberFromCustomerId(
            stringValue(row._id),
            "Browsed in range but did not order",
            row,
          ),
        ),
      },
      {
        key: "guest_only",
        label: "Guest only browsers",
        description: "Anonymous visitors who browsed without signup/order.",
        count: guestOnlyRows.length,
        actionLabel: "Improve signup prompt",
        members: guestOnlyRows.map((row) => ({
          id: stringValue(row._id),
          actorType: "guest",
          customerId: "",
          anonymousId: stringValue(row._id),
          fullName: "Guest visitor",
          phone: "",
          status: "guest",
          createdAt: null,
          lastLoginAt: null,
          segmentReason: "Browsed as guest only",
          lifetimeOrders: 0,
          lifetimeSpend: 0,
          timeframeOrders: 0,
          timeframeSpend: 0,
          firstOrderAt: null,
          lastOrderAt: null,
          checkoutStarted: numberValue(row.checkoutStarts) > 0,
          ordersCreated: 0,
          lastPath: stringValue(row.lastPath),
          firstSeenAt: serializeDate(row.firstSeenAt),
          lastSeenAt: serializeDate(row.lastSeenAt),
          activities: [],
        })),
      },
      {
        key: "abandoned_checkout",
        label: "Abandoned checkout",
        description: "Reached checkout but did not place an order in same session.",
        count: abandonedCheckoutRows.length,
        actionLabel: "Recover checkout",
        members: [],
      },
    ],
    abandonedCheckouts: [],
  };
}

async function buildCustomerAnalyticsSummary(params: AnalyticsSummaryParams) {
  const range = buildRange(params);
  const limit = Math.min(Math.max(params.limit ?? 20, 5), 100);
  const match = {
    occurredAt: {
      $gte: range.start,
      $lte: range.end,
    },
  };

  const section = params.section ?? "";
  if (section === "overview") {
    return buildInstantCustomerAnalyticsOverview({ range, match });
  }
  if (section === "funnels") {
    return buildCustomerAnalyticsFunnelsSummary({ range, limit, match });
  }
  if (section === "customers") {
    return buildCustomerAnalyticsCustomersSummary({ range, limit, match });
  }

  const lightweightSection = ["graphs", "events", "payments"].includes(section);
  if (params.detail === "summary" || lightweightSection) {
    return buildFastCustomerAnalyticsSummary({ range, limit, match });
  }

  const [
    overviewRows,
    eventTypeRows,
    actorTypeRows,
    topPathRows,
    browseOnlyRows,
    registeredBrowseNoOrderRows,
    checkoutAbandonedRows,
    signupAbandonedRows,
    trendRows,
    sourceAppRows,
    checkoutDropOffPathRows,
    recentEvents,
  ] = await runAnalyticsTasks([
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          restaurantViews: { $sum: { $cond: [{ $eq: ["$eventType", "restaurant_view"] }, 1, 0] } },
          cartViews: { $sum: { $cond: [{ $eq: ["$eventType", "cart_view"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          signupStarted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_started"] }, 1, 0] } },
          signupCompleted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          anonymousIds: { $addToSet: "$anonymousId" },
          customerIds: { $addToSet: "$customerId" },
          sessions: { $addToSet: "$sessionId" },
        },
      },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$eventType", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$actorType", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: "$path",
          count: { $sum: 1 },
          guestCount: { $sum: { $cond: [{ $eq: ["$actorType", "guest"] }, 1, 0] } },
          customerCount: { $sum: { $cond: [{ $eq: ["$actorType", "customer"] }, 1, 0] } },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { count: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ count: number }>([
      { $match: { ...match, anonymousId: { $ne: "" } } },
      {
        $group: {
          _id: "$anonymousId",
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          signupCompleted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
        },
      },
      {
        $match: {
          pageViews: { $gt: 0 },
          signupCompleted: 0,
          ordersCreated: 0,
        },
      },
      { $count: "count" },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ count: number }>([
      { $match: { ...match, customerId: { $ne: "" } } },
      {
        $group: {
          _id: "$customerId",
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
        },
      },
      {
        $match: {
          pageViews: { $gt: 0 },
          ordersCreated: 0,
        },
      },
      { $count: "count" },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ count: number }>([
      { $match: { ...match, sessionId: { $ne: "" } } },
      {
        $group: {
          _id: "$sessionId",
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
        },
      },
      {
        $match: {
          checkoutStarts: { $gt: 0 },
          ordersCreated: 0,
        },
      },
      { $count: "count" },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ count: number }>([
      { $match: { ...match, anonymousId: { $ne: "" } } },
      {
        $group: {
          _id: "$anonymousId",
          signupStarted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_started"] }, 1, 0] } },
          signupCompleted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] } },
        },
      },
      {
        $match: {
          signupStarted: { $gt: 0 },
          signupCompleted: 0,
        },
      },
      { $count: "count" },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$occurredAt",
              timezone: "Asia/Dhaka",
            },
          },
          totalEvents: { $sum: 1 },
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          signupStarted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_started"] }, 1, 0] } },
          signupCompleted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$sourceApp", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, sessionId: { $ne: "" } } },
      { $sort: { occurredAt: 1 } },
      {
        $group: {
          _id: "$sessionId",
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          lastPath: { $last: "$path" },
          lastActorType: { $last: "$actorType" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      {
        $match: {
          checkoutStarts: { $gt: 0 },
          ordersCreated: 0,
        },
      },
      {
        $group: {
          _id: "$lastPath",
          sessions: { $sum: 1 },
          guestSessions: { $sum: { $cond: [{ $eq: ["$lastActorType", "guest"] }, 1, 0] } },
          customerSessions: { $sum: { $cond: [{ $eq: ["$lastActorType", "customer"] }, 1, 0] } },
          lastSeenAt: { $max: "$lastSeenAt" },
        },
      },
      { $sort: { sessions: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.find(match)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .select({
        _id: 1,
        eventType: 1,
        actorType: 1,
        customerId: 1,
        anonymousId: 1,
        sessionId: 1,
        path: 1,
        screenName: 1,
        entityType: 1,
        entityId: 1,
        occurredAt: 1,
        createdAt: 1,
      })
      .lean(),
  ]);

  const overview = overviewRows[0] ?? {};
  const anonymousIds = Array.isArray(overview.anonymousIds)
    ? overview.anonymousIds.filter(Boolean)
    : [];
  const customerIds = Array.isArray(overview.customerIds)
    ? overview.customerIds.filter(Boolean)
    : [];
  const sessions = Array.isArray(overview.sessions)
    ? overview.sessions.filter(Boolean)
    : [];

  const orderMatch = {
    createdAt: {
      $gte: range.start,
      $lte: range.end,
    },
  };

  const [
    sessionJourneyRows,
    restaurantViewRows,
    menuItemViewRows,
    cartAddRows,
    restaurantOrderRows,
    menuItemOrderRows,
    searchRows,
    attributionRows,
    paymentEventRows,
    bkashPaymentRows,
    paymentMethodOrderRows,
    retentionRows,
    repeatCustomerRows,
    abandonedCheckoutRows,
    newCustomerRows,
    registeredNoOrderCustomerRows,
    guestOnlyVisitorRows,
    highValueCustomerRows,
    atRiskCustomerRows,
    restaurantFunnelEventRows,
  ] = await runAnalyticsTasks([
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, sessionId: { $ne: "" } } },
      { $sort: { sessionId: 1, occurredAt: 1 } },
      {
        $group: {
          _id: "$sessionId",
          actorType: { $last: "$actorType" },
          customerId: { $last: "$customerId" },
          anonymousId: { $first: "$anonymousId" },
          startPath: { $first: "$path" },
          lastPath: { $last: "$path" },
          firstSeenAt: { $first: "$occurredAt" },
          lastSeenAt: { $last: "$occurredAt" },
          eventCount: { $sum: 1 },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          paymentFailures: { $sum: { $cond: [{ $in: ["$eventType", ["payment_failed", "payment_cancelled"]] }, 1, 0] } },
          events: {
            $push: {
              eventType: "$eventType",
              path: "$path",
              screenName: "$screenName",
              entityType: "$entityType",
              entityId: "$entityId",
              occurredAt: "$occurredAt",
            },
          },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: "restaurant_view",
          entityId: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$entityId",
          views: { $sum: 1 },
          guestViews: { $sum: { $cond: [{ $eq: ["$actorType", "guest"] }, 1, 0] } },
          customerViews: { $sum: { $cond: [{ $eq: ["$actorType", "customer"] }, 1, 0] } },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { views: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: "menu_item_view",
          entityId: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$entityId",
          views: { $sum: 1 },
          itemName: { $last: "$metadata.itemName" },
          restaurantId: { $last: "$metadata.restaurantId" },
          categoryId: { $last: "$metadata.categoryId" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { views: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: "cart_add",
          entityId: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$entityId",
          adds: { $sum: 1 },
          quantity: { $sum: { $ifNull: ["$metadata.quantity", 1] } },
          itemName: { $last: "$metadata.itemName" },
          restaurantId: { $last: "$metadata.restaurantId" },
          categoryId: { $last: "$metadata.categoryId" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { adds: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: orderMatch },
      {
        $group: {
          _id: "$restaurantId",
          orders: { $sum: 1 },
          deliveredOrders: { $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] } },
          revenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
          customers: { $addToSet: "$customerId" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
      { $sort: { orders: -1, revenue: -1 } },
      { $limit: limit },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: orderMatch },
      { $unwind: "$itemsSnapshot" },
      {
        $group: {
          _id: "$itemsSnapshot.itemId",
          itemName: { $last: "$itemsSnapshot.name" },
          restaurantId: { $last: "$restaurantId" },
          categoryId: { $last: "$itemsSnapshot.categoryId" },
          orders: { $sum: 1 },
          quantity: { $sum: "$itemsSnapshot.quantity" },
          revenue: { $sum: "$itemsSnapshot.lineTotal" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, eventType: "search" } },
      {
        $group: {
          _id: {
            query: "$metadata.query",
            scope: "$metadata.scope",
            restaurantId: "$metadata.restaurantId",
          },
          count: { $sum: 1 },
          zeroResultCount: {
            $sum: {
              $cond: [{ $eq: [{ $ifNull: ["$metadata.resultCount", 0] }, 0] }, 1, 0],
            },
          },
          averageResults: { $avg: { $ifNull: ["$metadata.resultCount", 0] } },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { count: -1, zeroResultCount: -1, lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $group: {
          _id: {
            source: {
              $ifNull: [
                "$metadata.attribution.source",
                { $ifNull: ["$metadata.params.utm_source", "$metadata.params.source"] },
              ],
            },
            campaignId: {
              $ifNull: [
                "$metadata.attribution.campaignId",
                { $ifNull: ["$metadata.params.campaignId", "$metadata.params.utm_campaign"] },
              ],
            },
          },
          events: { $sum: 1 },
          checkouts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          orders: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      {
        $match: {
          $or: [
            { "_id.source": { $ne: null } },
            { "_id.campaignId": { $ne: null } },
          ],
        },
      },
      { $sort: { orders: -1, checkouts: -1, events: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...match,
          eventType: {
            $in: [
              "payment_initiated",
              "payment_completed",
              "payment_failed",
              "payment_cancelled",
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            eventType: "$eventType",
            provider: "$metadata.provider",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    BkashSandboxPaymentSessionModel.aggregate<Record<string, any>>([
      { $match: orderMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
      { $sort: { count: -1 } },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: orderMatch },
      {
        $group: {
          _id: {
            paymentMethod: "$paymentMethod",
            paymentStatus: "$paymentStatus",
          },
          orders: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
        },
      },
      { $sort: { orders: -1 } },
    ]),
    CustomerModel.aggregate<Record<string, any>>([
      { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
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
        $project: {
          createdAt: 1,
          orders: 1,
          firstOrderAt: { $min: "$orders.createdAt" },
          orderCount: { $size: "$orders" },
          orderedWithin1Day: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$orders",
                    as: "order",
                    cond: {
                      $lte: [
                        "$$order.createdAt",
                        { $add: ["$createdAt", DAY_MS] },
                      ],
                    },
                  },
                },
              },
              0,
            ],
          },
          orderedWithin7Days: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$orders",
                    as: "order",
                    cond: {
                      $lte: [
                        "$$order.createdAt",
                        { $add: ["$createdAt", 7 * DAY_MS] },
                      ],
                    },
                  },
                },
              },
              0,
            ],
          },
          orderedWithin30Days: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$orders",
                    as: "order",
                    cond: {
                      $lte: [
                        "$$order.createdAt",
                        { $add: ["$createdAt", 30 * DAY_MS] },
                      ],
                    },
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          newCustomers: { $sum: 1 },
          orderedWithin1Day: { $sum: { $cond: ["$orderedWithin1Day", 1, 0] } },
          orderedWithin7Days: { $sum: { $cond: ["$orderedWithin7Days", 1, 0] } },
          orderedWithin30Days: { $sum: { $cond: ["$orderedWithin30Days", 1, 0] } },
          repeatCustomers: { $sum: { $cond: [{ $gt: ["$orderCount", 1] }, 1, 0] } },
        },
      },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: { $ne: "" } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customerId",
          lifetimeOrders: { $sum: 1 },
          lifetimeSpend: { $sum: { $ifNull: ["$pricing.total", 0] } },
          timeframeOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", range.start] },
                    { $lte: ["$createdAt", range.end] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          timeframeSpend: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", range.start] },
                    { $lte: ["$createdAt", range.end] },
                  ],
                },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
          deliveredOrders: {
            $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] },
          },
          cancelledOrders: {
            $sum: {
              $cond: [
                { $in: ["$status", ["Cancelled", "Rejected"]] },
                1,
                0,
              ],
            },
          },
          firstOrderAt: { $min: "$createdAt" },
          lastOrderAt: { $max: "$createdAt" },
          latestCustomerSnapshot: { $first: "$customerSnapshot" },
          paymentMethods: { $push: "$paymentMethod" },
          orderRows: {
            $push: {
              orderId: "$_id",
              orderNumber: "$orderNumber",
              restaurantId: "$restaurantId",
              status: "$status",
              paymentMethod: "$paymentMethod",
              paymentStatus: "$paymentStatus",
              total: { $ifNull: ["$pricing.total", 0] },
              createdAt: "$createdAt",
            },
          },
        },
      },
      {
        $match: {
          lifetimeOrders: { $gt: 1 },
          timeframeOrders: { $gt: 0 },
        },
      },
      { $sort: { timeframeOrders: -1, lifetimeOrders: -1, lastOrderAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, sessionId: { $ne: "" } } },
      { $sort: { sessionId: 1, occurredAt: 1 } },
      {
        $group: {
          _id: "$sessionId",
          actorType: { $last: "$actorType" },
          customerId: { $last: "$customerId" },
          anonymousId: { $first: "$anonymousId" },
          firstSeenAt: { $first: "$occurredAt" },
          lastSeenAt: { $last: "$occurredAt" },
          lastPath: { $last: "$path" },
          eventCount: { $sum: 1 },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          restaurantIds: {
            $addToSet: {
              $ifNull: [
                "$metadata.restaurantId",
                {
                  $cond: [
                    { $eq: ["$entityType", "restaurant"] },
                    "$entityId",
                    "",
                  ],
                },
              ],
            },
          },
          estimatedCartValue: {
            $max: {
              $ifNull: [
                "$metadata.total",
                {
                  $ifNull: [
                    "$metadata.amount",
                    { $ifNull: ["$metadata.subtotal", 0] },
                  ],
                },
              ],
            },
          },
          itemCount: { $max: { $ifNull: ["$metadata.itemCount", 0] } },
          events: {
            $push: {
              eventType: "$eventType",
              path: "$path",
              screenName: "$screenName",
              entityType: "$entityType",
              entityId: "$entityId",
              metadata: "$metadata",
              occurredAt: "$occurredAt",
            },
          },
        },
      },
      {
        $match: {
          checkoutStarts: { $gt: 0 },
          ordersCreated: 0,
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerModel.aggregate<Record<string, any>>([
      { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
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
        $project: {
          fullName: 1,
          phone: 1,
          status: 1,
          createdAt: 1,
          lastLoginAt: 1,
          orderCount: { $size: "$orders" },
          lifetimeSpend: { $sum: "$orders.pricing.total" },
          firstOrderAt: { $min: "$orders.createdAt" },
          lastOrderAt: { $max: "$orders.createdAt" },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, customerId: { $ne: "" } } },
      { $sort: { customerId: 1, occurredAt: 1 } },
      {
        $group: {
          _id: "$customerId",
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          firstSeenAt: { $first: "$occurredAt" },
          lastSeenAt: { $last: "$occurredAt" },
          lastPath: { $last: "$path" },
          events: {
            $push: {
              eventType: "$eventType",
              path: "$path",
              screenName: "$screenName",
              entityType: "$entityType",
              entityId: "$entityId",
              occurredAt: "$occurredAt",
            },
          },
        },
      },
      {
        $match: {
          pageViews: { $gt: 0 },
          ordersCreated: 0,
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, anonymousId: { $ne: "" } } },
      { $sort: { anonymousId: 1, occurredAt: 1 } },
      {
        $group: {
          _id: "$anonymousId",
          pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          signupCompleted: { $sum: { $cond: [{ $eq: ["$eventType", "signup_completed"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          firstSeenAt: { $first: "$occurredAt" },
          lastSeenAt: { $last: "$occurredAt" },
          lastPath: { $last: "$path" },
          events: {
            $push: {
              eventType: "$eventType",
              path: "$path",
              screenName: "$screenName",
              entityType: "$entityType",
              entityId: "$entityId",
              occurredAt: "$occurredAt",
            },
          },
        },
      },
      {
        $match: {
          pageViews: { $gt: 0 },
          signupCompleted: 0,
          ordersCreated: 0,
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    OrderModel.aggregate<Record<string, any>>([
      { $match: { customerId: { $ne: "" } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customerId",
          lifetimeOrders: { $sum: 1 },
          lifetimeSpend: { $sum: { $ifNull: ["$pricing.total", 0] } },
          timeframeOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", range.start] },
                    { $lte: ["$createdAt", range.end] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          timeframeSpend: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", range.start] },
                    { $lte: ["$createdAt", range.end] },
                  ],
                },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
          firstOrderAt: { $min: "$createdAt" },
          lastOrderAt: { $max: "$createdAt" },
          latestCustomerSnapshot: { $first: "$customerSnapshot" },
        },
      },
      { $sort: { lifetimeSpend: -1, lifetimeOrders: -1, lastOrderAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: { ...match, customerId: { $ne: "" } } },
      { $sort: { customerId: 1, occurredAt: 1 } },
      {
        $group: {
          _id: "$customerId",
          firstSeenAt: { $first: "$occurredAt" },
          lastSeenAt: { $last: "$occurredAt" },
          lastPath: { $last: "$path" },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          ordersCreated: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          events: {
            $push: {
              eventType: "$eventType",
              path: "$path",
              screenName: "$screenName",
              entityType: "$entityType",
              entityId: "$entityId",
              occurredAt: "$occurredAt",
            },
          },
        },
      },
      {
        $lookup: {
          from: OrderModel.collection.name,
          localField: "_id",
          foreignField: "customerId",
          as: "orders",
        },
      },
      {
        $project: {
          firstSeenAt: 1,
          lastSeenAt: 1,
          lastPath: 1,
          checkoutStarts: 1,
          ordersCreated: 1,
          events: 1,
          lifetimeOrders: { $size: "$orders" },
          lifetimeSpend: { $sum: "$orders.pricing.total" },
          lastOrderAt: { $max: "$orders.createdAt" },
          timeframeOrders: {
            $size: {
              $filter: {
                input: "$orders",
                as: "order",
                cond: {
                  $and: [
                    { $gte: ["$$order.createdAt", range.start] },
                    { $lte: ["$$order.createdAt", range.end] },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $match: {
          lifetimeOrders: { $gt: 0 },
          timeframeOrders: 0,
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ]),
    CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
      { $match: match },
      {
        $project: {
          eventType: 1,
          actorType: 1,
          occurredAt: 1,
          customerId: 1,
          anonymousId: 1,
          restaurantId: {
            $ifNull: [
              "$metadata.restaurantId",
              {
                $cond: [
                  { $eq: ["$entityType", "restaurant"] },
                  "$entityId",
                  "",
                ],
              },
            ],
          },
        },
      },
      { $match: { restaurantId: { $ne: "" } } },
      {
        $group: {
          _id: "$restaurantId",
          restaurantViews: { $sum: { $cond: [{ $eq: ["$eventType", "restaurant_view"] }, 1, 0] } },
          menuItemViews: { $sum: { $cond: [{ $eq: ["$eventType", "menu_item_view"] }, 1, 0] } },
          cartAdds: { $sum: { $cond: [{ $eq: ["$eventType", "cart_add"] }, 1, 0] } },
          checkoutStarts: { $sum: { $cond: [{ $eq: ["$eventType", "checkout_start"] }, 1, 0] } },
          paymentInitiated: { $sum: { $cond: [{ $eq: ["$eventType", "payment_initiated"] }, 1, 0] } },
          paymentIssues: {
            $sum: {
              $cond: [
                { $in: ["$eventType", ["payment_failed", "payment_cancelled"]] },
                1,
                0,
              ],
            },
          },
          analyticsOrders: { $sum: { $cond: [{ $eq: ["$eventType", "order_created"] }, 1, 0] } },
          guestVisitors: { $addToSet: { $cond: [{ $eq: ["$actorType", "guest"] }, "$anonymousId", ""] } },
          customerVisitors: { $addToSet: "$customerId" },
          lastSeenAt: { $max: "$occurredAt" },
        },
      },
      { $sort: { checkoutStarts: -1, cartAdds: -1, restaurantViews: -1 } },
      { $limit: limit },
    ]),
  ]);

  const restaurantIds = Array.from(
    new Set(
      [
        ...restaurantViewRows.map((row) => stringValue(row._id)),
        ...restaurantOrderRows.map((row) => normalizeId(row._id)),
        ...menuItemViewRows.map((row) => stringValue(row.restaurantId)),
        ...cartAddRows.map((row) => stringValue(row.restaurantId)),
        ...menuItemOrderRows.map((row) => normalizeId(row.restaurantId)),
        ...searchRows.map((row) => stringValue(row._id?.restaurantId)),
        ...restaurantFunnelEventRows.map((row) => stringValue(row._id)),
        ...abandonedCheckoutRows.flatMap((row) =>
          Array.isArray(row.restaurantIds)
            ? row.restaurantIds.map((restaurantId: unknown) =>
                normalizeId(restaurantId),
              )
            : [],
        ),
        ...repeatCustomerRows.flatMap((row) =>
          Array.isArray(row.orderRows)
            ? row.orderRows.map((order: Record<string, unknown>) =>
                normalizeId(order.restaurantId),
              )
            : [],
        ),
      ].filter(Boolean),
    ),
  );
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } })
        .select({ name: 1 })
        .lean()
    : [];
  const restaurantNameById = new Map(
    restaurants.map((restaurant) => [
      normalizeId(restaurant._id),
      stringValue((restaurant as { name?: string }).name),
    ]),
  );

  const customerProfileIds = Array.from(
    new Set(
      [
        ...repeatCustomerRows.map((row) => stringValue(row._id)),
        ...newCustomerRows.map((row) => normalizeId(row._id)),
        ...registeredNoOrderCustomerRows.map((row) => stringValue(row._id)),
        ...highValueCustomerRows.map((row) => stringValue(row._id)),
        ...atRiskCustomerRows.map((row) => stringValue(row._id)),
        ...abandonedCheckoutRows.map((row) => stringValue(row.customerId)),
      ].filter((id) => id && mongoose.isValidObjectId(id)),
    ),
  );
  const customerProfiles = customerProfileIds.length
    ? await CustomerModel.find({ _id: { $in: customerProfileIds } })
        .select({ fullName: 1, phone: 1, status: 1, createdAt: 1, lastLoginAt: 1 })
        .lean()
    : [];
  const customerProfileById = new Map(
    customerProfiles.map((customer) => [
      normalizeId(customer._id),
      customer as Record<string, unknown>,
    ]),
  );

  const orderStatsRows = customerProfileIds.length
    ? await OrderModel.aggregate<Record<string, any>>([
        { $match: { customerId: { $in: customerProfileIds } } },
        {
          $group: {
            _id: "$customerId",
            lifetimeOrders: { $sum: 1 },
            lifetimeSpend: { $sum: { $ifNull: ["$pricing.total", 0] } },
            timeframeOrders: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$createdAt", range.start] },
                      { $lte: ["$createdAt", range.end] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            timeframeSpend: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$createdAt", range.start] },
                      { $lte: ["$createdAt", range.end] },
                    ],
                  },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            firstOrderAt: { $min: "$createdAt" },
            lastOrderAt: { $max: "$createdAt" },
          },
        },
      ])
    : [];
  const orderStatsByCustomerId = new Map(
    orderStatsRows.map((row) => [stringValue(row._id), row]),
  );

  const segmentAnonymousIds = Array.from(
    new Set(
      [
        ...guestOnlyVisitorRows.map((row) => stringValue(row._id)),
        ...abandonedCheckoutRows.map((row) => stringValue(row.anonymousId)),
      ].filter(Boolean),
    ),
  );
  const segmentActivityRows =
    customerProfileIds.length || segmentAnonymousIds.length
      ? await CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
          {
            $match: {
              ...match,
              $or: [
                customerProfileIds.length
                  ? { customerId: { $in: customerProfileIds } }
                  : { customerId: "__none__" },
                segmentAnonymousIds.length
                  ? { anonymousId: { $in: segmentAnonymousIds } }
                  : { anonymousId: "__none__" },
              ],
            },
          },
          { $sort: { occurredAt: -1 } },
          {
            $group: {
              _id: {
                kind: {
                  $cond: [
                    { $ne: ["$customerId", ""] },
                    "customer",
                    "anonymous",
                  ],
                },
                id: {
                  $cond: [
                    { $ne: ["$customerId", ""] },
                    "$customerId",
                    "$anonymousId",
                  ],
                },
              },
              activities: {
                $push: {
                  eventType: "$eventType",
                  path: "$path",
                  screenName: "$screenName",
                  entityType: "$entityType",
                  entityId: "$entityId",
                  occurredAt: "$occurredAt",
                },
              },
            },
          },
        ])
      : [];
  const activitiesByActorKey = new Map(
    segmentActivityRows.map((row) => [
      `${stringValue(row._id?.kind)}:${stringValue(row._id?.id)}`,
      Array.isArray(row.activities) ? buildActivityItems(row.activities) : [],
    ]),
  );
  const repeatCustomerIds = repeatCustomerRows
    .map((row) => stringValue(row._id))
    .filter(Boolean);
  const repeatActivityRows = repeatCustomerIds.length
    ? await CustomerAnalyticsEventModel.aggregate<Record<string, any>>([
        {
          $match: {
            ...match,
            customerId: { $in: repeatCustomerIds },
          },
        },
        { $sort: { occurredAt: -1 } },
        {
          $group: {
            _id: "$customerId",
            activities: {
              $push: {
                eventType: "$eventType",
                path: "$path",
                screenName: "$screenName",
                entityType: "$entityType",
                entityId: "$entityId",
                occurredAt: "$occurredAt",
              },
            },
          },
        },
      ])
    : [];
  const repeatActivitiesByCustomerId = new Map(
    repeatActivityRows.map((row) => [
      stringValue(row._id),
      Array.isArray(row.activities)
        ? row.activities.slice(0, 12).map((activity: Record<string, unknown>) => ({
            eventType: stringValue(activity.eventType),
            path: stringValue(activity.path),
            screenName: stringValue(activity.screenName),
            entityType: stringValue(activity.entityType),
            entityId: stringValue(activity.entityId),
            occurredAt: serializeDate(activity.occurredAt),
          }))
        : [],
    ]),
  );

  function buildPaymentMethodSummary(paymentMethods: unknown[]) {
    const counts = paymentMethods.reduce<Record<string, number>>((summary, value) => {
      const method = stringValue(value) || "unknown";
      summary[method] = (summary[method] ?? 0) + 1;
      return summary;
    }, {});

    return Object.entries(counts)
      .map(([paymentMethod, count]) => ({ paymentMethod, count }))
      .sort((a, b) => b.count - a.count);
  }

  function buildRepeatCustomerOrderTrend(orderRows: Array<Record<string, unknown>>) {
    const trendByDate = new Map<string, { date: string; orders: number; revenue: number }>();

    for (const order of orderRows) {
      const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date(String(order.createdAt));
      if (
        Number.isNaN(createdAt.getTime()) ||
        createdAt < range.start ||
        createdAt > range.end
      ) {
        continue;
      }
      const date = createdAt.toISOString().slice(0, 10);
      const current = trendByDate.get(date) ?? { date, orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += numberValue(order.total);
      trendByDate.set(date, current);
    }

    return Array.from(trendByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  function buildRepeatCustomerTopRestaurants(orderRows: Array<Record<string, unknown>>) {
    const restaurantsById = new Map<
      string,
      { restaurantId: string; restaurantName: string; orders: number; revenue: number }
    >();

    for (const order of orderRows) {
      const restaurantId = normalizeId(order.restaurantId);
      if (!restaurantId) continue;
      const current =
        restaurantsById.get(restaurantId) ??
        {
          restaurantId,
          restaurantName:
            restaurantNameById.get(restaurantId) || "Unknown restaurant",
          orders: 0,
          revenue: 0,
        };
      current.orders += 1;
      current.revenue += numberValue(order.total);
      restaurantsById.set(restaurantId, current);
    }

    return Array.from(restaurantsById.values())
      .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)
      .slice(0, 5);
  }

  function getCustomerProfile(customerId: string) {
    return customerProfileById.get(customerId) ?? {};
  }

  function getCustomerOrderStats(customerId: string) {
    return orderStatsByCustomerId.get(customerId) ?? {};
  }

  function buildCustomerDisplay(
    customerId: string,
    fallbackSnapshot?: Record<string, unknown>,
  ) {
    const profile = getCustomerProfile(customerId);
    const snapshot = fallbackSnapshot ?? {};

    return {
      fullName:
        stringValue(profile.fullName) ||
        stringValue(snapshot.fullName) ||
        stringValue(snapshot.name) ||
        "Foodbela customer",
      phone: stringValue(profile.phone) || stringValue(snapshot.phone),
      status: stringValue(profile.status) || "active",
      createdAt: serializeDate(profile.createdAt),
      lastLoginAt: serializeDate(profile.lastLoginAt),
    };
  }

  function buildRegisteredMember(params: {
    customerId: string;
    segmentReason: string;
    lastPath?: unknown;
    firstSeenAt?: unknown;
    lastSeenAt?: unknown;
    checkoutStarts?: unknown;
    ordersCreated?: unknown;
    activities?: unknown[];
    fallbackSnapshot?: Record<string, unknown>;
  }) {
    const stats = getCustomerOrderStats(params.customerId);
    const display = buildCustomerDisplay(
      params.customerId,
      params.fallbackSnapshot,
    );

    return {
      id: params.customerId,
      actorType: "customer",
      customerId: params.customerId,
      anonymousId: "",
      fullName: display.fullName,
      phone: display.phone,
      status: display.status,
      createdAt: display.createdAt,
      lastLoginAt: display.lastLoginAt,
      segmentReason: params.segmentReason,
      lifetimeOrders: numberValue(stats.lifetimeOrders),
      lifetimeSpend: numberValue(stats.lifetimeSpend),
      timeframeOrders: numberValue(stats.timeframeOrders),
      timeframeSpend: numberValue(stats.timeframeSpend),
      firstOrderAt: serializeDate(stats.firstOrderAt),
      lastOrderAt: serializeDate(stats.lastOrderAt),
      checkoutStarted: numberValue(params.checkoutStarts) > 0,
      ordersCreated: numberValue(params.ordersCreated),
      lastPath: stringValue(params.lastPath),
      firstSeenAt: serializeDate(params.firstSeenAt),
      lastSeenAt: serializeDate(params.lastSeenAt),
      activities: params.activities?.length
        ? buildActivityItems(params.activities)
        : activitiesByActorKey.get(`customer:${params.customerId}`) ?? [],
    };
  }

  function buildGuestMember(params: {
    anonymousId: string;
    segmentReason: string;
    lastPath?: unknown;
    firstSeenAt?: unknown;
    lastSeenAt?: unknown;
    checkoutStarts?: unknown;
    ordersCreated?: unknown;
    activities?: unknown[];
  }) {
    return {
      id: params.anonymousId,
      actorType: "guest",
      customerId: "",
      anonymousId: params.anonymousId,
      fullName: "Guest visitor",
      phone: "",
      status: "guest",
      createdAt: null,
      lastLoginAt: null,
      segmentReason: params.segmentReason,
      lifetimeOrders: 0,
      lifetimeSpend: 0,
      timeframeOrders: 0,
      timeframeSpend: 0,
      firstOrderAt: null,
      lastOrderAt: null,
      checkoutStarted: numberValue(params.checkoutStarts) > 0,
      ordersCreated: numberValue(params.ordersCreated),
      lastPath: stringValue(params.lastPath),
      firstSeenAt: serializeDate(params.firstSeenAt),
      lastSeenAt: serializeDate(params.lastSeenAt),
      activities: params.activities?.length
        ? buildActivityItems(params.activities)
        : activitiesByActorKey.get(`anonymous:${params.anonymousId}`) ?? [],
    };
  }

  const restaurantConversionMap = new Map<
    string,
    {
      restaurantId: string;
      restaurantName: string;
      views: number;
      guestViews: number;
      customerViews: number;
      orders: number;
      deliveredOrders: number;
      revenue: number;
      uniqueCustomers: number;
      lastSeenAt: string | null;
      lastOrderAt: string | null;
    }
  >();

  for (const row of restaurantViewRows) {
    const restaurantId = stringValue(row._id);
    restaurantConversionMap.set(restaurantId, {
      restaurantId,
      restaurantName: restaurantNameById.get(restaurantId) || "Unknown restaurant",
      views: numberValue(row.views),
      guestViews: numberValue(row.guestViews),
      customerViews: numberValue(row.customerViews),
      orders: 0,
      deliveredOrders: 0,
      revenue: 0,
      uniqueCustomers: 0,
      lastSeenAt: serializeDate(row.lastSeenAt),
      lastOrderAt: null,
    });
  }

  for (const row of restaurantOrderRows) {
    const restaurantId = normalizeId(row._id);
    const current =
      restaurantConversionMap.get(restaurantId) ??
      {
        restaurantId,
        restaurantName: restaurantNameById.get(restaurantId) || "Unknown restaurant",
        views: 0,
        guestViews: 0,
        customerViews: 0,
        orders: 0,
        deliveredOrders: 0,
        revenue: 0,
        uniqueCustomers: 0,
        lastSeenAt: null,
        lastOrderAt: null,
      };
    current.orders = numberValue(row.orders);
    current.deliveredOrders = numberValue(row.deliveredOrders);
    current.revenue = numberValue(row.revenue);
    current.uniqueCustomers = Array.isArray(row.customers)
      ? row.customers.filter(Boolean).length
      : 0;
    current.lastOrderAt = serializeDate(row.lastOrderAt);
    restaurantConversionMap.set(restaurantId, current);
  }

  const itemConversionMap = new Map<
    string,
    {
      itemId: string;
      itemName: string;
      restaurantId: string;
      restaurantName: string;
      categoryId: string;
      views: number;
      cartAdds: number;
      cartQuantity: number;
      orders: number;
      orderedQuantity: number;
      revenue: number;
      lastSeenAt: string | null;
      lastOrderAt: string | null;
    }
  >();

  function ensureItemConversion(row: Record<string, any>) {
    const itemId = stringValue(row._id);
    const restaurantId = normalizeId(row.restaurantId);
    const current =
      itemConversionMap.get(itemId) ??
      {
        itemId,
        itemName: stringValue(row.itemName) || "Unknown item",
        restaurantId,
        restaurantName: restaurantNameById.get(restaurantId) || "Unknown restaurant",
        categoryId: stringValue(row.categoryId),
        views: 0,
        cartAdds: 0,
        cartQuantity: 0,
        orders: 0,
        orderedQuantity: 0,
        revenue: 0,
        lastSeenAt: null,
        lastOrderAt: null,
      };
    current.itemName = current.itemName || stringValue(row.itemName) || "Unknown item";
    current.restaurantId = current.restaurantId || restaurantId;
    current.restaurantName =
      restaurantNameById.get(current.restaurantId) || current.restaurantName;
    current.categoryId = current.categoryId || stringValue(row.categoryId);
    return current;
  }

  for (const row of menuItemViewRows) {
    const item = ensureItemConversion(row);
    item.views = numberValue(row.views);
    item.lastSeenAt = serializeDate(row.lastSeenAt);
    itemConversionMap.set(item.itemId, item);
  }

  for (const row of cartAddRows) {
    const item = ensureItemConversion(row);
    item.cartAdds = numberValue(row.adds);
    item.cartQuantity = numberValue(row.quantity);
    item.lastSeenAt = item.lastSeenAt ?? serializeDate(row.lastSeenAt);
    itemConversionMap.set(item.itemId, item);
  }

  for (const row of menuItemOrderRows) {
    const item = ensureItemConversion(row);
    item.orders = numberValue(row.orders);
    item.orderedQuantity = numberValue(row.quantity);
    item.revenue = numberValue(row.revenue);
    item.lastOrderAt = serializeDate(row.lastOrderAt);
    itemConversionMap.set(item.itemId, item);
  }

  const paymentEvents = paymentEventRows.map((row) => ({
    eventType: stringValue(row._id?.eventType),
    provider: stringValue(row._id?.provider) || "unknown",
    count: numberValue(row.count),
  }));
  const paymentInitiated = paymentEvents
    .filter((row) => row.eventType === "payment_initiated")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentCompleted = paymentEvents
    .filter((row) => row.eventType === "payment_completed")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentFailed = paymentEvents
    .filter((row) => row.eventType === "payment_failed")
    .reduce((sum, row) => sum + row.count, 0);
  const paymentCancelled = paymentEvents
    .filter((row) => row.eventType === "payment_cancelled")
    .reduce((sum, row) => sum + row.count, 0);
  const retention = retentionRows[0] ?? {};
  const signupCompletionRate = calculateRate(
    numberValue(overview.signupCompleted),
    numberValue(overview.signupStarted),
  );
  const checkoutConversionRate = calculateRate(
    numberValue(overview.ordersCreated),
    numberValue(overview.checkoutStarts),
  );
  const paymentCompletionRate = calculateRate(paymentCompleted, paymentInitiated);
  const zeroResultSearchCount = searchRows.reduce(
    (sum, row) => sum + numberValue(row.zeroResultCount),
    0,
  );
  const restaurantFunnels = restaurantFunnelEventRows
    .map((row) => {
      const restaurantId = stringValue(row._id);
      const conversion = restaurantConversionMap.get(restaurantId);
      const views = numberValue(row.restaurantViews);
      const menuItemViews = numberValue(row.menuItemViews);
      const cartAdds = numberValue(row.cartAdds);
      const checkoutStarts = numberValue(row.checkoutStarts);
      const orders = conversion?.orders ?? numberValue(row.analyticsOrders);
      const revenue = conversion?.revenue ?? 0;
      const paymentIssues = numberValue(row.paymentIssues);
      const uniqueGuests = Array.isArray(row.guestVisitors)
        ? row.guestVisitors.filter(Boolean).length
        : 0;
      const uniqueCustomers = Array.isArray(row.customerVisitors)
        ? row.customerVisitors.filter(Boolean).length
        : 0;
      const stageRates = {
        viewToMenuRate: calculateRate(menuItemViews, views),
        menuToCartRate: calculateRate(cartAdds, menuItemViews),
        cartToCheckoutRate: calculateRate(checkoutStarts, cartAdds),
        checkoutToOrderRate: calculateRate(orders, checkoutStarts),
      };
      const stageDrops = [
        { stage: "view_to_menu", rate: stageRates.viewToMenuRate },
        { stage: "menu_to_cart", rate: stageRates.menuToCartRate },
        { stage: "cart_to_checkout", rate: stageRates.cartToCheckoutRate },
        { stage: "checkout_to_order", rate: stageRates.checkoutToOrderRate },
      ].sort((a, b) => a.rate - b.rate);

      return {
        restaurantId,
        restaurantName:
          restaurantNameById.get(restaurantId) || "Unknown restaurant",
        restaurantViews: views,
        menuItemViews,
        cartAdds,
        checkoutStarts,
        paymentInitiated: numberValue(row.paymentInitiated),
        paymentIssues,
        orders,
        revenue,
        uniqueGuests,
        uniqueCustomers,
        lastSeenAt: serializeDate(row.lastSeenAt),
        lastOrderAt: conversion?.lastOrderAt ?? null,
        ...stageRates,
        weakestStage: stageDrops[0]?.stage ?? "unknown",
      };
    })
    .sort((a, b) => b.checkoutStarts - a.checkoutStarts || b.cartAdds - a.cartAdds)
    .slice(0, limit);

  const abandonedCheckouts = abandonedCheckoutRows.map((row) => {
    const events = Array.isArray(row.events) ? row.events : [];
    const recentFirstEvents = [...events].slice(-16).reverse();
    const checkoutEvent = [...events]
      .reverse()
      .map((event) => asRecord(event))
      .find((event) => stringValue(event.eventType) === "checkout_start");
    const voucherEvent = [...events]
      .reverse()
      .map((event) => asRecord(event))
      .find((event) => stringValue(event.eventType) === "voucher_applied");
    const metadata = asRecord(checkoutEvent?.metadata);
    const voucherMetadata = asRecord(voucherEvent?.metadata);
    const restaurantIds = Array.isArray(row.restaurantIds)
      ? row.restaurantIds.map((id: unknown) => normalizeId(id)).filter(Boolean)
      : [];
    const restaurantId =
      stringValue(metadata.restaurantId) ||
      restaurantIds[0] ||
      "";
    const customerId = stringValue(row.customerId);
    const display = customerId
      ? buildCustomerDisplay(customerId)
      : { fullName: "Guest visitor", phone: "", status: "guest" };
    const orderStats = customerId ? getCustomerOrderStats(customerId) : {};
    const cartItems = buildCartItemsFromMetadata(metadata);
    const itemCount =
      numberValue(row.itemCount) ||
      readMetadataNumber(metadata, ["itemCount"]) ||
      cartItems.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedCartValue =
      numberValue(row.estimatedCartValue) ||
      readMetadataNumber(metadata, ["total", "amount", "subtotal"]);

    return {
      sessionId: stringValue(row._id),
      actorType: stringValue(row.actorType),
      customerId,
      anonymousId: stringValue(row.anonymousId),
      fullName: display.fullName,
      phone: display.phone,
      restaurantId,
      restaurantName:
        restaurantNameById.get(restaurantId) || "Unknown restaurant",
      estimatedCartValue,
      itemCount,
      paymentMethod:
        stringValue(metadata.paymentMethod) ||
        stringValue(metadata.provider) ||
        "unknown",
      voucherCode:
        stringValue(metadata.voucherCode) ||
        stringValue(voucherMetadata.code) ||
        stringValue(voucherEvent?.entityId),
      repeatVisitor: numberValue(orderStats.lifetimeOrders) > 0,
      lifetimeOrders: numberValue(orderStats.lifetimeOrders),
      lifetimeSpend: numberValue(orderStats.lifetimeSpend),
      firstSeenAt: serializeDate(row.firstSeenAt),
      lastSeenAt: serializeDate(row.lastSeenAt),
      lastPath: stringValue(row.lastPath),
      eventCount: numberValue(row.eventCount),
      cartItems,
      events: buildActivityItems(recentFirstEvents),
      recommendedAction: customerId
        ? "Send a checkout reminder or targeted coupon."
        : "Retarget this guest through campaign/source analysis.",
    };
  });

  const customerSegments = [
    {
      key: "new_customers",
      label: "New customers",
      description: "Registered in this timeframe.",
      count: numberValue(retention.newCustomers),
      actionLabel: "Send welcome offer",
      members: newCustomerRows.map((row) =>
        buildRegisteredMember({
          customerId: normalizeId(row._id),
          segmentReason: "Recently registered account",
          firstSeenAt: row.createdAt,
          lastSeenAt: row.lastLoginAt || row.createdAt,
          fallbackSnapshot: row,
        }),
      ),
    },
    {
      key: "repeat_customers",
      label: "Repeat customers",
      description: "Customers with more than one lifetime order.",
      count: numberValue(retention.repeatCustomers),
      actionLabel: "Protect loyalty",
      members: repeatCustomerRows.map((row) => {
        const snapshot =
          row.latestCustomerSnapshot && typeof row.latestCustomerSnapshot === "object"
            ? (row.latestCustomerSnapshot as Record<string, unknown>)
            : {};
        return buildRegisteredMember({
          customerId: stringValue(row._id),
          segmentReason: "Multiple lifetime orders",
          firstSeenAt: row.firstOrderAt,
          lastSeenAt: row.lastOrderAt,
          fallbackSnapshot: snapshot,
        });
      }),
    },
    {
      key: "high_value",
      label: "High value",
      description: "Top customers by lifetime spend.",
      count: highValueCustomerRows.length,
      actionLabel: "Reward with VIP offer",
      members: highValueCustomerRows.map((row) => {
        const snapshot =
          row.latestCustomerSnapshot && typeof row.latestCustomerSnapshot === "object"
            ? (row.latestCustomerSnapshot as Record<string, unknown>)
            : {};
        return buildRegisteredMember({
          customerId: stringValue(row._id),
          segmentReason: `${formatCurrencyForText(numberValue(row.lifetimeSpend))} lifetime spend`,
          firstSeenAt: row.firstOrderAt,
          lastSeenAt: row.lastOrderAt,
          fallbackSnapshot: snapshot,
        });
      }),
    },
    {
      key: "at_risk",
      label: "At-risk customers",
      description: "Ordered before, active now, but did not order in timeframe.",
      count: atRiskCustomerRows.length,
      actionLabel: "Send comeback reminder",
      members: atRiskCustomerRows.map((row) =>
        buildRegisteredMember({
          customerId: stringValue(row._id),
          segmentReason: "Active browsing without a new order",
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          lastPath: row.lastPath,
          checkoutStarts: row.checkoutStarts,
          ordersCreated: row.ordersCreated,
          activities: Array.isArray(row.events) ? row.events : [],
        }),
      ),
    },
    {
      key: "abandoned_checkout",
      label: "Abandoned checkout",
      description: "Reached checkout but did not place an order in same session.",
      count: numberValue(checkoutAbandonedRows[0]?.count),
      actionLabel: "Recover checkout",
      members: abandonedCheckouts.map((row) => {
        const base = row.customerId
          ? buildRegisteredMember({
              customerId: row.customerId,
              segmentReason: "Checkout started without order",
              firstSeenAt: row.firstSeenAt,
              lastSeenAt: row.lastSeenAt,
              lastPath: row.lastPath,
              checkoutStarts: 1,
              activities: row.events,
            })
          : buildGuestMember({
              anonymousId: row.anonymousId,
              segmentReason: "Guest checkout started without order",
              firstSeenAt: row.firstSeenAt,
              lastSeenAt: row.lastSeenAt,
              lastPath: row.lastPath,
              checkoutStarts: 1,
              activities: row.events,
            });
        return {
          ...base,
          cartValue: row.estimatedCartValue,
          itemCount: row.itemCount,
          restaurantName: row.restaurantName,
        };
      }),
    },
    {
      key: "registered_no_order",
      label: "Registered no order",
      description: "Registered customers browsing without an order.",
      count: numberValue(registeredBrowseNoOrderRows[0]?.count),
      actionLabel: "Send first-order offer",
      members: registeredNoOrderCustomerRows.map((row) =>
        buildRegisteredMember({
          customerId: stringValue(row._id),
          segmentReason: "Browsed in range but did not order",
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          lastPath: row.lastPath,
          checkoutStarts: row.checkoutStarts,
          ordersCreated: row.ordersCreated,
          activities: Array.isArray(row.events) ? row.events : [],
        }),
      ),
    },
    {
      key: "guest_only",
      label: "Guest only browsers",
      description: "Anonymous visitors who browsed without signup/order.",
      count: numberValue(browseOnlyRows[0]?.count),
      actionLabel: "Improve signup prompt",
      members: guestOnlyVisitorRows.map((row) =>
        buildGuestMember({
          anonymousId: stringValue(row._id),
          segmentReason: "Browsed as guest only",
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          lastPath: row.lastPath,
          checkoutStarts: row.checkoutStarts,
          ordersCreated: row.ordersCreated,
          activities: Array.isArray(row.events) ? row.events : [],
        }),
      ),
    },
  ];

  const weakestRestaurant = restaurantFunnels.find(
    (row) => row.checkoutStarts >= 3 && row.checkoutToOrderRate < 35,
  );
  const recommendedActions = [
    abandonedCheckouts.length
      ? {
          key: "recover_abandoned_checkouts",
          severity: abandonedCheckouts.length >= 10 ? "critical" : "warning",
          title: "Recover abandoned checkouts",
          description: `${abandonedCheckouts.length} checkout session(s) have enough detail for follow-up.`,
          targetCount: abandonedCheckouts.length,
          actionType: "open_abandoned_checkout",
          actionLabel: "Open drawer",
          href: "",
        }
      : null,
    numberValue(registeredBrowseNoOrderRows[0]?.count) > 0
      ? {
          key: "first_order_campaign",
          severity: "info",
          title: "Create first-order campaign",
          description: `${numberValue(registeredBrowseNoOrderRows[0]?.count)} registered customer(s) browsed without ordering.`,
          targetCount: numberValue(registeredBrowseNoOrderRows[0]?.count),
          actionType: "open_notifications",
          actionLabel: "Open notifications",
          href: "/notifications",
        }
      : null,
    weakestRestaurant
      ? {
          key: "restaurant_conversion_review",
          severity: "warning",
          title: "Review restaurant conversion",
          description: `${weakestRestaurant.restaurantName} has ${weakestRestaurant.checkoutToOrderRate}% checkout-to-order conversion.`,
          targetCount: weakestRestaurant.checkoutStarts,
          actionType: "open_restaurants",
          actionLabel: "Open restaurants",
          href: "/restaurants",
        }
      : null,
    paymentInitiated >= 10 && paymentCompletionRate < 70
      ? {
          key: "payment_reliability_review",
          severity: "critical",
          title: "Review payment reliability",
          description: `${paymentCompletionRate}% of initiated payments completed.`,
          targetCount: paymentFailed + paymentCancelled,
          actionType: "open_payments",
          actionLabel: "Open payments",
          href: "/payments",
        }
      : null,
  ].filter(Boolean);
  const alerts = [
    numberValue(overview.checkoutStarts) >= 10 && checkoutConversionRate < 35
      ? makeAlert({
          key: "checkout_conversion_low",
          severity: "critical",
          title: "Checkout conversion is low",
          description: `${checkoutConversionRate}% of checkout starts are becoming orders.`,
          metric: checkoutConversionRate,
        })
      : null,
    numberValue(overview.signupStarted) >= 10 && signupCompletionRate < 55
      ? makeAlert({
          key: "signup_completion_low",
          severity: "warning",
          title: "Signup completion needs attention",
          description: `${signupCompletionRate}% of signup starts are completing verification.`,
          metric: signupCompletionRate,
        })
      : null,
    paymentInitiated >= 10 && paymentCompletionRate < 70
      ? makeAlert({
          key: "payment_completion_low",
          severity: "critical",
          title: "Payment completion is weak",
          description: `${paymentCompletionRate}% of initiated payments completed.`,
          metric: paymentCompletionRate,
        })
      : null,
    zeroResultSearchCount >= 5
      ? makeAlert({
          key: "zero_result_searches",
          severity: "info",
          title: "Search demand is not being satisfied",
          description: `${zeroResultSearchCount} search event(s) returned no results.`,
          metric: zeroResultSearchCount,
        })
      : null,
  ].filter(Boolean);

  return {
    timeframe: {
      preset: range.preset,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    overview: {
      totalEvents: numberValue(overview.totalEvents),
      pageViews: numberValue(overview.pageViews),
      restaurantViews: numberValue(overview.restaurantViews),
      cartViews: numberValue(overview.cartViews),
      checkoutStarts: numberValue(overview.checkoutStarts),
      signupStarted: numberValue(overview.signupStarted),
      signupCompleted: numberValue(overview.signupCompleted),
      ordersCreated: numberValue(overview.ordersCreated),
      uniqueAnonymousVisitors: anonymousIds.length,
      uniqueRegisteredCustomers: customerIds.length,
      uniqueSessions: sessions.length,
      browseOnlyAnonymousVisitors: numberValue(browseOnlyRows[0]?.count),
      registeredBrowseNoOrderCustomers: numberValue(
        registeredBrowseNoOrderRows[0]?.count
      ),
      checkoutAbandonedSessions: numberValue(checkoutAbandonedRows[0]?.count),
      signupAbandonedVisitors: numberValue(signupAbandonedRows[0]?.count),
    },
    insights: {
      signupCompletionRate,
      checkoutConversionRate,
      paymentCompletionRate,
      paymentFailureRate: calculateRate(
        paymentFailed + paymentCancelled,
        paymentInitiated,
      ),
    },
    alerts,
    recommendedActions,
    trend: trendRows.map((row) => ({
      date: stringValue(row._id),
      totalEvents: numberValue(row.totalEvents),
      pageViews: numberValue(row.pageViews),
      checkoutStarts: numberValue(row.checkoutStarts),
      signupStarted: numberValue(row.signupStarted),
      signupCompleted: numberValue(row.signupCompleted),
      ordersCreated: numberValue(row.ordersCreated),
    })),
    sessionJourneys: sessionJourneyRows.map((row) => ({
      sessionId: stringValue(row._id),
      actorType: stringValue(row.actorType),
      customerId: stringValue(row.customerId),
      anonymousId: stringValue(row.anonymousId),
      startPath: stringValue(row.startPath),
      lastPath: stringValue(row.lastPath),
      firstSeenAt: serializeDate(row.firstSeenAt),
      lastSeenAt: serializeDate(row.lastSeenAt),
      eventCount: numberValue(row.eventCount),
      checkoutStarted: numberValue(row.checkoutStarts) > 0,
      converted: numberValue(row.ordersCreated) > 0,
      paymentHadIssue: numberValue(row.paymentFailures) > 0,
      events: Array.isArray(row.events)
        ? row.events.slice(-14).map((event: Record<string, unknown>) => ({
            eventType: stringValue(event.eventType),
            path: stringValue(event.path),
            screenName: stringValue(event.screenName),
            entityType: stringValue(event.entityType),
            entityId: stringValue(event.entityId),
            occurredAt: serializeDate(event.occurredAt),
          }))
        : [],
    })),
    restaurantConversions: Array.from(restaurantConversionMap.values())
      .map((row) => ({
        ...row,
        viewToOrderRate: calculateRate(row.orders, row.views),
      }))
      .sort((a, b) => b.orders - a.orders || b.views - a.views)
      .slice(0, limit),
    restaurantFunnels,
    menuItemConversions: Array.from(itemConversionMap.values())
      .map((row) => ({
        ...row,
        viewToCartRate: calculateRate(row.cartAdds, row.views),
        cartToOrderRate: calculateRate(row.orders, row.cartAdds),
      }))
      .sort((a, b) => b.orders - a.orders || b.cartAdds - a.cartAdds || b.views - a.views)
      .slice(0, limit),
    searchAnalytics: searchRows.map((row) => ({
      query: stringValue(row._id?.query),
      scope: stringValue(row._id?.scope) || "unknown",
      restaurantId: stringValue(row._id?.restaurantId),
      restaurantName:
        restaurantNameById.get(stringValue(row._id?.restaurantId)) || "",
      count: numberValue(row.count),
      zeroResultCount: numberValue(row.zeroResultCount),
      averageResults:
        Math.round(numberValue(row.averageResults) * 10) / 10,
      lastSeenAt: serializeDate(row.lastSeenAt),
    })),
    attribution: attributionRows.map((row) => ({
      source: stringValue(row._id?.source) || "unknown",
      campaignId: stringValue(row._id?.campaignId),
      events: numberValue(row.events),
      checkouts: numberValue(row.checkouts),
      orders: numberValue(row.orders),
      checkoutRate: calculateRate(numberValue(row.checkouts), numberValue(row.events)),
      orderRate: calculateRate(numberValue(row.orders), numberValue(row.events)),
      lastSeenAt: serializeDate(row.lastSeenAt),
    })),
    paymentHealth: {
      initiated: paymentInitiated,
      completed: paymentCompleted,
      failed: paymentFailed,
      cancelled: paymentCancelled,
      completionRate: paymentCompletionRate,
      events: paymentEvents,
      bkashSessions: bkashPaymentRows.map((row) => ({
        status: stringValue(row._id),
        count: numberValue(row.count),
        amount: numberValue(row.amount),
      })),
      orderMethods: paymentMethodOrderRows.map((row) => ({
        paymentMethod: stringValue(row._id?.paymentMethod) || "unknown",
        paymentStatus: stringValue(row._id?.paymentStatus) || "unknown",
        orders: numberValue(row.orders),
        revenue: numberValue(row.revenue),
      })),
    },
    retention: {
      newCustomers: numberValue(retention.newCustomers),
      orderedWithin1Day: numberValue(retention.orderedWithin1Day),
      orderedWithin7Days: numberValue(retention.orderedWithin7Days),
      orderedWithin30Days: numberValue(retention.orderedWithin30Days),
      repeatCustomers: numberValue(retention.repeatCustomers),
      day1OrderRate: calculateRate(
        numberValue(retention.orderedWithin1Day),
        numberValue(retention.newCustomers),
      ),
      day7OrderRate: calculateRate(
        numberValue(retention.orderedWithin7Days),
        numberValue(retention.newCustomers),
      ),
      day30OrderRate: calculateRate(
        numberValue(retention.orderedWithin30Days),
        numberValue(retention.newCustomers),
      ),
    },
    repeatCustomers: repeatCustomerRows.map((row) => {
      const customerId = stringValue(row._id);
      const snapshot =
        row.latestCustomerSnapshot && typeof row.latestCustomerSnapshot === "object"
          ? (row.latestCustomerSnapshot as Record<string, unknown>)
          : {};
      const orderRows = Array.isArray(row.orderRows)
        ? row.orderRows.slice(0, 20)
        : [];
      const paymentMethods = buildPaymentMethodSummary(
        Array.isArray(row.paymentMethods) ? row.paymentMethods : [],
      );

      return {
        customerId,
        fullName:
          stringValue(snapshot.fullName) ||
          stringValue(snapshot.name) ||
          "Foodbela customer",
        phone: stringValue(snapshot.phone),
        lifetimeOrders: numberValue(row.lifetimeOrders),
        timeframeOrders: numberValue(row.timeframeOrders),
        deliveredOrders: numberValue(row.deliveredOrders),
        cancelledOrders: numberValue(row.cancelledOrders),
        lifetimeSpend: numberValue(row.lifetimeSpend),
        timeframeSpend: numberValue(row.timeframeSpend),
        averageOrderValue: numberValue(row.lifetimeOrders)
          ? Math.round(numberValue(row.lifetimeSpend) / numberValue(row.lifetimeOrders))
          : 0,
        firstOrderAt: serializeDate(row.firstOrderAt),
        lastOrderAt: serializeDate(row.lastOrderAt),
        favoritePaymentMethod: paymentMethods[0]?.paymentMethod ?? "unknown",
        paymentMethods,
        topRestaurants: buildRepeatCustomerTopRestaurants(orderRows),
        orderTrend: buildRepeatCustomerOrderTrend(orderRows),
        recentOrders: orderRows.slice(0, 8).map((order) => {
          const restaurantId = normalizeId(order.restaurantId);
          return {
            orderId: normalizeId(order.orderId),
            orderNumber: stringValue(order.orderNumber),
            restaurantId,
            restaurantName:
              restaurantNameById.get(restaurantId) || "Unknown restaurant",
            status: stringValue(order.status),
            paymentMethod: stringValue(order.paymentMethod),
            paymentStatus: stringValue(order.paymentStatus),
            total: numberValue(order.total),
            createdAt: serializeDate(order.createdAt),
          };
        }),
        recentActivities: repeatActivitiesByCustomerId.get(customerId) ?? [],
      };
    }),
    customerSegments,
    abandonedCheckouts,
    eventTypes: eventTypeRows.map((row) => ({
      eventType: stringValue(row._id),
      count: numberValue(row.count),
    })),
    actorTypes: actorTypeRows.map((row) => ({
      actorType: stringValue(row._id),
      count: numberValue(row.count),
    })),
    sourceApps: sourceAppRows.map((row) => ({
      sourceApp: stringValue(row._id) || "unknown",
      count: numberValue(row.count),
    })),
    topPaths: topPathRows.map((row) => ({
      path: stringValue(row._id),
      count: numberValue(row.count),
      guestCount: numberValue(row.guestCount),
      customerCount: numberValue(row.customerCount),
      lastSeenAt: serializeDate(row.lastSeenAt),
    })),
    checkoutDropOffPaths: checkoutDropOffPathRows.map((row) => ({
      path: stringValue(row._id),
      sessions: numberValue(row.sessions),
      guestSessions: numberValue(row.guestSessions),
      customerSessions: numberValue(row.customerSessions),
      lastSeenAt: serializeDate(row.lastSeenAt),
    })),
    recentEvents: recentEvents.map((event) => ({
      id: String(event._id),
      eventType: event.eventType,
      actorType: event.actorType,
      customerId: event.customerId,
      anonymousId: event.anonymousId,
      sessionId: event.sessionId,
      path: event.path,
      screenName: event.screenName,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: serializeDate(event.occurredAt),
      createdAt: serializeDate(event.createdAt),
    })),
  };
}
