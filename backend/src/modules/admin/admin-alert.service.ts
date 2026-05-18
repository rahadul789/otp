import { emitSocketEvent } from "../../config/socket";
import {
  classifyAdminAlertType,
  getAdminNotificationSettings,
  isAdminNotificationCategoryEnabled,
} from "./admin-notification-settings";
import { AdminOperationalAlertModel } from "./admin-alert.model";

const RESOLVED_ALERT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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
  return { alert: payload, created: true };
}

export async function listAdminOperationalAlerts() {
  const rows = await AdminOperationalAlertModel.find()
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return rows.map((row) => serializeAlert(row));
}

export async function markAdminOperationalAlertRead(alertId: string) {
  const result = await AdminOperationalAlertModel.updateOne(
    { _id: alertId },
    { $set: { isRead: true, readAt: new Date() } },
  );
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
  return { updated: result.modifiedCount };
}

export async function pruneAdminOperationalAlerts() {
  const cutoff = new Date(Date.now() - RESOLVED_ALERT_RETENTION_MS);
  const result = await AdminOperationalAlertModel.deleteMany({
    resolvedAt: { $lte: cutoff },
  });
  return { deleted: result.deletedCount ?? 0 };
}
