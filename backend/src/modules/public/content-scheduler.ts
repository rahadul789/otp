import { logger } from "../../config/logger"
import {
  markOperationalJobFinished,
  markOperationalJobStarted,
  recordBusinessEvent,
} from "../admin/business-event.service"
import { processDueCustomerHomeCmsPushCampaigns } from "./content.service"

let intervalHandle: NodeJS.Timeout | null = null
let isProcessing = false

function runPlatformContentSchedulerCycle() {
  if (isProcessing) return
  isProcessing = true
  const startedAt = Date.now()
  markOperationalJobStarted("platform_content", "Platform content campaigns")
  void processDueCustomerHomeCmsPushCampaigns()
    .then(() => {
      markOperationalJobFinished("platform_content", "ok", startedAt)
    })
    .catch((error) => {
      markOperationalJobFinished("platform_content", "failed", startedAt, error)
      logger.error(error, "Scheduled customer home push failed")
      void recordBusinessEvent({
        event: "scheduler.platform_content.failed",
        category: "scheduler",
        severity: "critical",
        title: "Platform content scheduler failed",
        description:
          error instanceof Error
            ? error.message
            : "Scheduled customer home push failed",
      })
    })
    .finally(() => {
      isProcessing = false
    })
}

export function startPlatformContentScheduler() {
  if (intervalHandle) return

  runPlatformContentSchedulerCycle()
  intervalHandle = setInterval(runPlatformContentSchedulerCycle, 60_000)

  logger.info("Platform content scheduler started")
}

export function stopPlatformContentScheduler() {
  if (!intervalHandle) return
  clearInterval(intervalHandle)
  intervalHandle = null
  isProcessing = false
  logger.info("Platform content scheduler stopped")
}
