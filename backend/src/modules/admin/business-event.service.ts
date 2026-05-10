import { logger } from "../../config/logger";
import { getRequestMonitorSnapshot } from "../../common/middleware/request-monitor";
import mongoose from "mongoose";
import { AdminOperationalAlertModel } from "./admin-alert.model";
import { AdminBusinessEventModel } from "./business-event.model";

type BusinessEventCategory =
  | "orders"
  | "dispatch"
  | "notifications"
  | "scheduler"
  | "security"
  | "system";

type BusinessEventSeverity = "info" | "warning" | "critical";

type BusinessEventInput = {
  event: string;
  category: BusinessEventCategory;
  severity?: BusinessEventSeverity;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  actorId?: string;
  actorName?: string;
  metadata?: Record<string, unknown>;
};

type JobState = {
  key: string;
  label: string;
  status: "idle" | "running" | "ok" | "failed";
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string;
};

const schedulerJobs = new Map<string, JobState>();

function databaseState() {
  const state = mongoose.connection.readyState;
  if (state === 1) return "connected";
  if (state === 2) return "connecting";
  if (state === 3) return "disconnecting";
  return "disconnected";
}

function getRuntimeSnapshot() {
  const memory = process.memoryUsage();
  const database = databaseState();
  return {
    ready: database === "connected",
    database,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    },
    nodeEnv: process.env.NODE_ENV ?? "development",
    pid: process.pid,
  };
}

function serializeDate(value: unknown) {
  return value ? new Date(value as Date).toISOString() : null;
}

function serializeBusinessEvent(row: Record<string, any>) {
  return {
    id: String(row._id ?? row.id ?? ""),
    event: String(row.event ?? ""),
    category: String(row.category ?? "system"),
    severity: String(row.severity ?? "info"),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    entityType: String(row.entityType ?? ""),
    entityId: String(row.entityId ?? ""),
    actorType: String(row.actorType ?? "system"),
    actorId: String(row.actorId ?? ""),
    actorName: String(row.actorName ?? ""),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: serializeDate(row.createdAt),
  };
}

export async function recordBusinessEvent(input: BusinessEventInput) {
  const severity = input.severity ?? "info";
  const payload = {
    event: input.event,
    category: input.category,
    severity,
    title: input.title,
    description: input.description ?? "",
    entityType: input.entityType ?? "",
    entityId: input.entityId ?? "",
    actorType: input.actorType ?? "system",
    actorId: input.actorId ?? "",
    actorName: input.actorName ?? "",
    metadata: input.metadata ?? {},
  };

  const logPayload = { businessEvent: true, ...payload };
  if (severity === "critical") {
    logger.error(logPayload, input.title);
  } else if (severity === "warning") {
    logger.warn(logPayload, input.title);
  } else {
    logger.info(logPayload, input.title);
  }

  try {
    await AdminBusinessEventModel.create(payload);
  } catch (error) {
    logger.warn({ error, event: input.event }, "Business event persistence failed");
  }
}

export function fireBusinessEvent(input: BusinessEventInput) {
  void recordBusinessEvent(input);
}

export function markOperationalJobStarted(key: string, label: string) {
  schedulerJobs.set(key, {
    key,
    label,
    status: "running",
    lastStartedAt: new Date().toISOString(),
    lastFinishedAt: null,
    lastDurationMs: null,
    lastError: "",
  });
}

export function markOperationalJobFinished(
  key: string,
  status: "ok" | "failed",
  startedAt: number,
  error?: unknown,
) {
  const previous = schedulerJobs.get(key);
  schedulerJobs.set(key, {
    key,
    label: previous?.label ?? key,
    status,
    lastStartedAt: previous?.lastStartedAt ?? null,
    lastFinishedAt: new Date().toISOString(),
    lastDurationMs: Math.max(0, Date.now() - startedAt),
    lastError: error instanceof Error ? error.message : error ? String(error) : "",
  });
}

export async function getAdminOperationalHealthSnapshot() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();
  const activeAlertQuery = {
    isRead: { $ne: true },
    resolvedAt: null,
    $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
  };

  const [
    recentEvents,
    openCriticalAlerts,
    openWarningAlerts,
    openInfoAlerts,
    activeAlerts,
    eventsLast24h,
    criticalEventsLast24h,
    warningEventsLast24h,
  ] = await Promise.all([
    AdminBusinessEventModel.find().sort({ createdAt: -1 }).limit(80).lean(),
    AdminOperationalAlertModel.countDocuments({
      ...activeAlertQuery,
      severity: "critical",
    }),
    AdminOperationalAlertModel.countDocuments({
      ...activeAlertQuery,
      severity: "warning",
    }),
    AdminOperationalAlertModel.countDocuments({
      ...activeAlertQuery,
      severity: "info",
    }),
    AdminOperationalAlertModel.find(activeAlertQuery)
      .sort({ lastSeenAt: -1, createdAt: -1 })
      .limit(20)
      .lean(),
    AdminBusinessEventModel.countDocuments({ createdAt: { $gte: since24h } }),
    AdminBusinessEventModel.countDocuments({
      createdAt: { $gte: since24h },
      severity: "critical",
    }),
    AdminBusinessEventModel.countDocuments({
      createdAt: { $gte: since24h },
      severity: "warning",
    }),
  ]);

  const attentionScore =
    openCriticalAlerts * 5 +
    criticalEventsLast24h * 3 +
    openWarningAlerts * 2 +
    warningEventsLast24h;

  const systemStatus =
    openCriticalAlerts > 0 || criticalEventsLast24h > 0
      ? "needs_attention"
      : openWarningAlerts > 0 || warningEventsLast24h > 0
        ? "watching"
        : "healthy";

  return {
    generatedAt: new Date().toISOString(),
    systemStatus,
    attentionScore,
    runtime: getRuntimeSnapshot(),
    requestMonitor: getRequestMonitorSnapshot(),
    summary: {
      openCriticalAlerts,
      openWarningAlerts,
      openInfoAlerts,
      failedSchedules: 0,
      pendingSchedules: 0,
      eventsLast24h,
      criticalEventsLast24h,
      warningEventsLast24h,
    },
    schedulerJobs: Array.from(schedulerJobs.values()),
    timeline: recentEvents.map((event) => serializeBusinessEvent(event)),
    activeAlerts: activeAlerts.map((alert) => ({
      id: String(alert._id ?? ""),
      alertType: String(alert.alertType ?? ""),
      severity: String(alert.severity ?? "warning"),
      title: String(alert.title ?? ""),
      description: String(alert.description ?? ""),
      source: String(alert.source ?? "operations"),
      entityType: String(alert.entityType ?? ""),
      entityId: String(alert.entityId ?? ""),
      path: String(alert.path ?? ""),
      iconKey: String(alert.iconKey ?? "bell"),
      lastSeenAt: serializeDate(alert.lastSeenAt),
      createdAt: serializeDate(alert.createdAt),
      resolvedAt: serializeDate(alert.resolvedAt),
      snoozedUntil: serializeDate(alert.snoozedUntil),
    })),
    schedules: [],
  };
}
