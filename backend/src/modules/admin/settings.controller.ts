import type { Request, Response } from "express"
import { z } from "zod"

import type { AuthenticatedRequest } from "../../common/middleware/auth"
import { asyncHandler } from "../../common/utils/async-handler"
import { sendSuccess } from "../../common/utils/api-response"
import { getSmsProviderBalance } from "../auth/otp-sms.service"
import {
  type AdminPlatformSettings,
  getAdminPlatformSettings,
  updateAdminPlatformSettings,
} from "./settings.service"

const settingsSchema = z.object({
  settings: z.object({
    branding: z.unknown(),
    operations: z.unknown(),
    auth: z.unknown(),
    supportContact: z.unknown(),
    helpCenter: z.unknown(),
    legal: z.unknown(),
  }),
})

export const getAdminSettingsController = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await getAdminPlatformSettings()
    return sendSuccess(res, { data })
  },
)

export const getAdminSmsBalanceController = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await getSmsProviderBalance()
    return sendSuccess(res, { data })
  },
)

export const putAdminSettingsController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = settingsSchema.parse(req.body)
    const data = await updateAdminPlatformSettings({
      adminId: req.user?.id ?? "",
      settings: payload.settings as AdminPlatformSettings,
    })

    return sendSuccess(res, {
      message: "Platform settings updated successfully",
      data,
    })
  },
)
