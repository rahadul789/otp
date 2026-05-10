import { CustomerAnalyticsEventModel } from "../customer/customer-analytics.model";

type AnalyticsPreset =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "last90Days"
  | "custom";

type AnalyticsSummaryParams = {
  preset?: AnalyticsPreset;
  from?: string;
  to?: string;
  limit?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

  return {
    preset: "last30Days" as const,
    start: startOfDay(new Date(now.getTime() - 29 * DAY_MS)),
    end: endOfDay(now),
  };
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

export async function getCustomerAnalyticsSummary(params: AnalyticsSummaryParams) {
  const range = buildRange(params);
  const limit = Math.min(Math.max(params.limit ?? 20, 5), 100);
  const match = {
    occurredAt: {
      $gte: range.start,
      $lte: range.end,
    },
  };

  const [
    overviewRows,
    eventTypeRows,
    actorTypeRows,
    topPathRows,
    browseOnlyRows,
    registeredBrowseNoOrderRows,
    recentEvents,
  ] = await Promise.all([
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
    },
    eventTypes: eventTypeRows.map((row) => ({
      eventType: stringValue(row._id),
      count: numberValue(row.count),
    })),
    actorTypes: actorTypeRows.map((row) => ({
      actorType: stringValue(row._id),
      count: numberValue(row.count),
    })),
    topPaths: topPathRows.map((row) => ({
      path: stringValue(row._id),
      count: numberValue(row.count),
      guestCount: numberValue(row.guestCount),
      customerCount: numberValue(row.customerCount),
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
