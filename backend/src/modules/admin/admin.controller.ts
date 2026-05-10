import type { Request, Response } from "express"
import { z } from "zod"

import { asyncHandler } from "../../common/utils/async-handler"
import { sendSuccess } from "../../common/utils/api-response"
import {
  bootstrapAdminIfMissing,
  logoutAdminSession,
  refreshAdminSession,
  signinAdmin
} from "./admin.service"

const adminSigninSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
})

const logoutSchema = z.object({
  refreshToken: z.string().min(1)
})

export const postAdminBootstrap = asyncHandler(async (_req: Request, res: Response) => {
  const admin = await bootstrapAdminIfMissing()

  return sendSuccess(res, {
    message: "Admin bootstrap ensured successfully",
    data: {
      id: admin.id,
      email: admin.email
    }
  })
})

export const postAdminSignin = asyncHandler(async (req: Request, res: Response) => {
  const payload = adminSigninSchema.parse(req.body)
  const data = await signinAdmin({
    ...payload,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip
  })

  return sendSuccess(res, {
    message: "Admin signed in successfully",
    data
  })
})

export const postAdminRefresh = asyncHandler(async (req: Request, res: Response) => {
  const payload = refreshSchema.parse(req.body)
  const data = await refreshAdminSession({
    refreshToken: payload.refreshToken,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip
  })

  return sendSuccess(res, {
    message: "Admin session refreshed successfully",
    data
  })
})

export const postAdminLogout = asyncHandler(async (req: Request, res: Response) => {
  const payload = logoutSchema.parse(req.body)
  const data = await logoutAdminSession(payload.refreshToken)

  return sendSuccess(res, {
    message: "Admin signed out successfully",
    data
  })
})
