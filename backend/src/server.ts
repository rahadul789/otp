import http from "node:http"
import mongoose from "mongoose"

import { createApp } from "./app"
import { connectDatabase } from "./config/db"
import { env } from "./config/env"
import { logger } from "./config/logger"
import { createSocketServer } from "./config/socket"
import { markHealthShuttingDown } from "./modules/health/health.controller"
import {
  startAdminNotificationScheduler,
  stopAdminNotificationScheduler,
} from "./modules/admin/notifications-scheduler"
import {
  startPlatformContentScheduler,
  stopPlatformContentScheduler,
} from "./modules/public/content-scheduler"

async function bootstrap() {
  await connectDatabase()

  const app = createApp()
  const server = http.createServer(app)

  createSocketServer(server)
  startPlatformContentScheduler()
  startAdminNotificationScheduler()

  server.listen(env.PORT, () => {
    logger.info(`Backend running on port ${env.PORT}`)
  })

  let isShuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (isShuttingDown) return
    isShuttingDown = true
    markHealthShuttingDown()
    logger.info({ signal }, "Backend shutdown started")
    stopPlatformContentScheduler()
    stopAdminNotificationScheduler()

    const forceExitTimer = setTimeout(() => {
      logger.error("Backend shutdown timed out")
      process.exit(1)
    }, 10_000)
    forceExitTimer.unref()

    server.close((error) => {
      if (error) {
        logger.error(error, "HTTP server close failed")
      }
      mongoose
        .disconnect()
        .then(() => {
          clearTimeout(forceExitTimer)
          logger.info("Backend shutdown completed")
          process.exit(error ? 1 : 0)
        })
        .catch((disconnectError) => {
          clearTimeout(forceExitTimer)
          logger.error(disconnectError, "MongoDB disconnect failed")
          process.exit(1)
        })
    })
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

bootstrap().catch((error) => {
  logger.error(error)
  process.exit(1)
})
