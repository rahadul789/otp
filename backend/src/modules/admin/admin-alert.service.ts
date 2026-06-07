import { emitSocketEvent } from "../../config/socket";
import { logger } from "../../config/logger";
import { createInMemoryAsyncCache } from "../../common/utils/in-memory-cache";
import { sendOperationalAlert } from "../monitoring/alert-notifier";
import { RestaurantModel } from "../auth/auth.model";
import { OrderModel } from "../owner/operational.model";
import {
  classifyAdminAlertType,
  getAdminNotificationSettings,
  isAdminNotificationCategoryEnabled,
} from "./admin-notification-settings";
import { invalidateAdminOperationalHealthCache } from "./business-event.service";
import { AdminOperationalAlertModel } from "./admin-alert.model";

const RESOLVED_ALERT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const adminOperationalAlertsCache = createInMemoryAsyncCache<any>({
  ttlMs: 5_000,
  staleWhileRevalidateMs: 15_000,
  maxEntries: 2,
});

function invalidateAdminOperationalAlertsCache() {
  adminOperationalAlertsCache.clear();
}

type AdminOperationalAlertInput = {
  alertType: string;
  severity?: "info" | "warning" | "critical";
  title: string;
  description?: string;
  source?: string;
  entityType?: string;
  entityId?: string;
  path?: string;
  iconKey?: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

function serializeAlert(alert: Record<string, any>) {
  return {
    id: String(alert._id ?? alert.id ?? ""),
    source: "ops" as const,
    type: String(alert.alertType ?? "operations"),
    title: String(alert.title ?? ""),
    description: String(alert.description ?? ""),
    recipientId: String(alert.entityId ?? ""),
    recipientName: String(alert.source ?? "Operations"),
    recipientPhone: "",
    path: String(alert.path ?? ""),
    isRead: alert.isRead === true,
    readAt: alert.readAt ? new Date(alert.readAt).toISOString() : null,
    createdAt: alert.createdAt ? new Date(alert.createdAt).toISOString() : null,
    deliveryStatus: String(alert.severity ?? "warning"),
    iconKey: String(alert.iconKey ?? "bell"),
    severity: String(alert.severity ?? "warning"),
    entityType: String(alert.entityType ?? ""),
    entityId: String(alert.entityId ?? ""),
    metadata: alert.metadata ?? {},
    resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt).toISOString() : null,
    snoozedUntil: alert.snoozedUntil
      ? new Date(alert.snoozedUntil).toISOString()
      : null,
  };
}

function isOrderRelatedAlert(input: AdminOperationalAlertInput) {
  const alertType = input.alertType;
  return (
    input.entityType === "order" ||
    input.path?.startsWith("/orders") ||
    alertType.startsWith("order_") ||
    alertType.startsWith("rider_") ||
    alertType.startsWith("delivery_") ||
    alertType.startsWith("restaurant_") ||
    alertType === "owner_response_late" ||
    alertType === "prep_start_late" ||
    alertType === "food_prepare_late"
  );
}

function stringDetail(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function joinNameAndContact(name: unknown, contact: unknown) {
  return [stringDetail(name), stringDetail(contact)].filter(Boolean).join(" · ");
}

async function buildExternalOrderAlertMessage(
  payload: ReturnType<typeof serializeAlert>,
  input: AdminOperationalAlertInput,
) {
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const orderId = stringDetail(metadata.orderId) || payload.entityId || input.entityId || "";
  const order = orderId
    ? await OrderModel.findById(orderId)
        .select({
          orderNumber: 1,
          status: 1,
          customerSnapshot: 1,
          riderSnapshot: 1,
          restaurantId: 1,
          pricing: 1,
        })
        .lean()
    : null;
  const restaurant = order?.restaurantId
    ? await RestaurantModel.findById(order.restaurantId)
        .select({ name: 1, contact: 1 })
        .lean()
    : null;
  const details: Record<string, unknown> = {
    orderNumber:
      stringDetail(metadata.orderNumber) ||
      stringDetail(order?.orderNumber) ||
      stringDetail(payload.entityId),
    status: stringDetail(metadata.status) || stringDetail(order?.status),
    customer: joinNameAndContact(
      metadata.customerName || order?.customerSnapshot?.fullName,
      metadata.customerPhone || order?.customerSnapshot?.phone,
    ),
    restaurant: joinNameAndContact(
      metadata.restaurantName || restaurant?.name,
      metadata.restaurantPhone || restaurant?.contact?.phone,
    ),
    rider: joinNameAndContact(
      metadata.riderName || order?.riderSnapshot?.name,
      metadata.riderPhone || order?.riderSnapshot?.phone,
    ),
    total: stringDetail(metadata.total || order?.pricing?.total)
      ? `Tk ${Math.round(Number(metadata.total || order?.pricing?.total) || 0)}`
      : "",
    lateByMinutes: stringDetail(metadata.lateByMinutes),
    readyMinutes: stringDetail(metadata.readyMinutes),
    assignedMinutes: stringDetail(metadata.assignedMinutes),
    pickupMinutes: stringDetail(metadata.pickupMinutes),
    deliveryAddress: stringDetail(metadata.deliveryAddress),
    path: payload.path,
  };

  return {
    dedupeKey: `admin-alert:${input.dedupeKey}`,
    severity: (payload.severity === "critical" || payload.severity === "info"
      ? payload.severity
      : "warning") as "critical" | "warning" | "info",
    layer: "operations" as const,
    title: payload.title,
    body: [payload.description, payload.path ? `Admin path: ${payload.path}` : ""]
      .filter(Boolean)
      .join("\n"),
    details: Object.fromEntries(
      Object.entries(details).filter(([, value]) => stringDetail(value)),
    ),
  };
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function updateExistingAlert(input: AdminOperationalAlertInput) {
  const existing = await AdminOperationalAlertModel.findOne({
    dedupeKey: input.dedupeKey,
  });

  if (!existing) return null;

  existing.lastSeenAt = new Date();
  existing.description = input.description ?? existing.description;
  existing.title = input.title || existing.title;
  existing.severity = input.severity ?? existing.severity;
  existing.source = input.source ?? existing.source;
  existing.entityType = input.entityType ?? existing.entityType;
  existing.entityId = input.entityId ?? existing.entityId;
  existing.path = input.path ?? existing.path;
  existing.iconKey = input.iconKey ?? existing.iconKey;
  existing.metadata = { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) };
  await existing.save();
  return existing;
}

export async function createAdminOperationalAlert(
  input: AdminOperationalAlertInput,
) {
  const settings = await getAdminNotificationSettings();
  const category = classifyAdminAlertType(input.alertType);
  if (!isAdminNotificationCategoryEnabled(settings, category)) {
    return { alert: null, created: false, skipped: true };
  }

  const existing = await updateExistingAlert(input);

  if (existing) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
    return { alert: serializeAlert(existing.toObject()), created: false };
  }

  let alert;
  try {
    alert = await AdminOperationalAlertModel.create({
      alertType: input.alertType,
      severity: input.severity ?? "warning",
      title: input.title,
      description: input.description ?? "",
      source: input.source ?? "operations",
      entityType: input.entityType ?? "",
      entityId: input.entityId ?? "",
      path: input.path ?? "",
      iconKey: input.iconKey ?? "bell",
      dedupeKey: input.dedupeKey,
      metadata: input.metadata ?? {},
      lastSeenAt: new Date(),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await updateExistingAlert(input);
    if (!duplicate) throw error;
    return { alert: serializeAlert(duplicate.toObject()), created: false };
  }
  const payload = serializeAlert(alert.toObject());

  emitSocketEvent("admin:ops", "admin.notification.created", payload);
  if (isOrderRelatedAlert(input)) {
    void buildExternalOrderAlertMessage(payload, input)
      .then((message) => sendOperationalAlert(message))
      .catch((error) => {
        logger.warn(
          { error, alertId: payload.id },
          "Failed to send external admin order alert",
        );
      });
  }
  invalidateAdminOperationalAlertsCache();
  invalidateAdminOperationalHealthCache();
  return { alert: payload, created: true };
}

export async function listAdminOperationalAlerts() {
  return adminOperationalAlertsCache.getOrSet("admin-operational-alerts", async () => {
    const rows = await AdminOperationalAlertModel.find()
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return rows.map((row) => serializeAlert(row));
  });
}

export async function markAdminOperationalAlertRead(alertId: string) {
  const result = await AdminOperationalAlertModel.updateOne(
    { _id: alertId },
    { $set: { isRead: true, readAt: new Date() } },
  );
  if (result.modifiedCount > 0) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
  }
  return { updated: result.modifiedCount > 0 };
}

export async function resolveAdminOperationalAlert(alertId: string) {
  const resolvedAt = new Date();
  const result = await AdminOperationalAlertModel.updateOne(
    { _id: alertId },
    {
      $set: {
        isRead: true,
        readAt: resolvedAt,
        resolvedAt,
        snoozedUntil: null,
      },
    },
  );
  if (result.modifiedCount > 0) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
  }
  return { updated: result.modifiedCount > 0 };
}

export async function resolveAdminOperationalAlertByDedupeKey(dedupeKey: string) {
  const resolvedAt = new Date();
  const result = await AdminOperationalAlertModel.updateOne(
    { dedupeKey, resolvedAt: null },
    {
      $set: {
        isRead: true,
        readAt: resolvedAt,
        resolvedAt,
        snoozedUntil: null,
      },
    },
  );
  if (result.modifiedCount > 0) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
  }
  return { updated: result.modifiedCount > 0 };
}

export async function snoozeAdminOperationalAlert(alertId: string, minutes: number) {
  const snoozeMinutes = Math.min(24 * 60, Math.max(5, Math.round(minutes)));
  const snoozedUntil = new Date(Date.now() + snoozeMinutes * 60 * 1000);
  const result = await AdminOperationalAlertModel.updateOne(
    { _id: alertId },
    {
      $set: {
        snoozedUntil,
      },
    },
  );
  if (result.modifiedCount > 0) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
  }
  return {
    updated: result.modifiedCount > 0,
    snoozedUntil: snoozedUntil.toISOString(),
  };
}

export async function markAllAdminOperationalAlertsRead() {
  const result = await AdminOperationalAlertModel.updateMany(
    { isRead: { $ne: true } },
    { $set: { isRead: true, readAt: new Date() } },
  );
  if (result.modifiedCount > 0) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
  }
  return { updated: result.modifiedCount };
}

export async function pruneAdminOperationalAlerts() {
  const cutoff = new Date(Date.now() - RESOLVED_ALERT_RETENTION_MS);
  const result = await AdminOperationalAlertModel.deleteMany({
    resolvedAt: { $lte: cutoff },
  });
  if ((result.deletedCount ?? 0) > 0) {
    invalidateAdminOperationalAlertsCache();
    invalidateAdminOperationalHealthCache();
  }
  return { deleted: result.deletedCount ?? 0 };
}
