import { logger } from "../../config/logger";
import { processAdminOperationalAlerts } from "./orders-monitor.service";
import {
  markOperationalJobFinished,
  markOperationalJobStarted,
  recordBusinessEvent,
} from "./business-event.service";
import { pruneAdminOperationalAlerts } from "./admin-alert.service";
import { processDueAdminNotificationSchedules } from "./notifications.service";

let intervalHandle: NodeJS.Timeout | null = null;
let isProcessing = false;

function runAdminSchedulerCycle() {
  if (isProcessing) return;
  isProcessing = true;
  const startedAt = Date.now();
  markOperationalJobStarted("admin_notifications", "Admin notifications and operations");
  void Promise.all([
    processDueAdminNotificationSchedules(),
    processAdminOperationalAlerts(),
    pruneAdminOperationalAlerts(),
  ])
    .then(() => {
      markOperationalJobFinished("admin_notifications", "ok", startedAt);
    })
    .catch((error) => {
      markOperationalJobFinished("admin_notifications", "failed", startedAt, error);
      logger.error(error, "Scheduled admin notifications failed");
      void recordBusinessEvent({
        event: "scheduler.admin_notifications.failed",
        category: "scheduler",
        severity: "critical",
        title: "Admin scheduler failed",
        description:
          error instanceof Error ? error.message : "Scheduled admin work failed",
      });
    })
    .finally(() => {
      isProcessing = false;
    });
}

export function startAdminNotificationScheduler() {
  if (intervalHandle) return;

  runAdminSchedulerCycle();
  intervalHandle = setInterval(runAdminSchedulerCycle, 60_000);

  logger.info("Admin notification scheduler started");
}

export function stopAdminNotificationScheduler() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  isProcessing = false;
  logger.info("Admin notification scheduler stopped");
}
