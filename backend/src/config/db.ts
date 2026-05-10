import mongoose from "mongoose"

import { BkashSandboxPaymentSessionModel } from "../modules/customer/customer.model"
import { env } from "./env"
import { logger } from "./logger"

export async function connectDatabase() {
  mongoose.set("strictQuery", true)

  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 10000
  })

  await BkashSandboxPaymentSessionModel.updateMany(
    {
      $or: [{ sandboxPaymentId: "" }, { otpCodeHash: "" }]
    },
    {
      $unset: {
        sandboxPaymentId: 1,
        otpCodeHash: 1
      }
    }
  )

  await BkashSandboxPaymentSessionModel.syncIndexes()

  logger.info("MongoDB connected successfully")
}
