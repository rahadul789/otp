import type { Request, Response } from "express"
import { StatusCodes } from "http-status-codes"
import { z } from "zod"

import { asyncHandler } from "../../common/utils/async-handler"
import { sendSuccess } from "../../common/utils/api-response"
import {
  acceptRiderOrder,
  activateRiderTrackingOrder,
  deliverRiderOrder,
  getRiderOrderDetails,
  getRiderProfile,
  listRiderOrders,
  logoutRiderSession,
  pickupRiderOrder,
  postRiderLocation,
  refreshRiderSession,
  registerRiderPushToken,
  startRiderPhoneSignin,
  unregisterRiderPushToken,
  updateRiderLastKnownLocation,
  updateRiderAvailability,
  verifyRiderPhoneSignin
} from "./rider.service"

const riderPhoneStartSchema = z.object({
  phone: z.string().regex(/^01\d{9}$/)
})

const riderPhoneVerifySchema = z.object({
  verificationSessionId: z.string().min(1),
  otpCode: z.string().length(6),
  fullName: z.string().optional()
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
})

const logoutSchema = z.object({
  refreshToken: z.string().min(1)
})

const riderOrdersQuerySchema = z.object({
  scope: z.enum(["available", "active", "history"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional()
})

const riderLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  accuracyMeters: z.number().positive().optional(),
  speedKmph: z.number().nonnegative().optional()
})

const riderAvailabilitySchema = z.object({
  isAvailableForAssignments: z.boolean()
})

const riderPushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(["android", "ios"]),
  deviceId: z.string().optional(),
  appVersion: z.string().optional()
})

const riderPushTokenDeleteSchema = z.object({
  expoPushToken: z.string().min(1)
})

function getStringValue(value: unknown) {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    const firstValue = value[0]
    return typeof firstValue === "string" ? firstValue : ""
  }
  return ""
}

export const startRiderPhoneAuth = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderPhoneStartSchema.parse(req.body)
  const data = await startRiderPhoneSignin(payload.phone)

  return sendSuccess(res, {
    statusCode: StatusCodes.ACCEPTED,
    message: "Rider OTP sent successfully",
    data
  })
})

export const verifyRiderPhoneAuth = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderPhoneVerifySchema.parse(req.body)
  const data = await verifyRiderPhoneSignin({
    ...payload,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip
  })

  return sendSuccess(res, {
    message: "Rider signed in successfully",
    data
  })
})

export const refreshRiderAuth = asyncHandler(async (req: Request, res: Response) => {
  const payload = refreshSchema.parse(req.body)
  const data = await refreshRiderSession({
    refreshToken: payload.refreshToken,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip
  })

  return sendSuccess(res, {
    message: "Rider session refreshed successfully",
    data
  })
})

export const logoutRiderAuth = asyncHandler(async (req: Request, res: Response) => {
  const payload = logoutSchema.parse(req.body)
  const data = await logoutRiderSession(payload.refreshToken)

  return sendSuccess(res, {
    message: "Rider signed out successfully",
    data
  })
})

export const getRiderProfileSummary = asyncHandler(async (req: Request, res: Response) => {
  const data = await getRiderProfile(req.user?.id ?? "")

  return sendSuccess(res, { data })
})

export const patchRiderProfileAvailability = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderAvailabilitySchema.parse(req.body)
  const data = await updateRiderAvailability({
    riderId: req.user?.id ?? "",
    isAvailableForAssignments: payload.isAvailableForAssignments
  })

  return sendSuccess(res, {
    message: "Rider availability updated successfully",
    data
  })
})

export const patchRiderProfileLocation = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderLocationSchema.parse(req.body)
  const data = await updateRiderLastKnownLocation({
    riderId: req.user?.id ?? "",
    ...payload
  })

  return sendSuccess(res, {
    message: "Rider location updated successfully",
    data
  })
})

export const postRiderPushToken = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderPushTokenSchema.parse(req.body)
  const data = await registerRiderPushToken({
    riderId: req.user?.id ?? "",
    ...payload
  })

  return sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: "Push token registered successfully",
    data
  })
})

export const deleteRiderPushToken = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderPushTokenDeleteSchema.parse({
    expoPushToken: getStringValue(req.query.expoPushToken) || req.body?.expoPushToken
  })
  const data = await unregisterRiderPushToken({
    riderId: req.user?.id ?? "",
    expoPushToken: payload.expoPushToken
  })

  return sendSuccess(res, {
    message: "Push token removed successfully",
    data
  })
})

export const getRiderOrders = asyncHandler(async (req: Request, res: Response) => {
  const query = riderOrdersQuerySchema.parse(req.query)
  const data = await listRiderOrders({
    riderId: req.user?.id ?? "",
    scope: query.scope,
    page: query.page,
    pageSize: query.pageSize
  })

  return sendSuccess(res, { data })
})

export const getRiderOrder = asyncHandler(async (req: Request, res: Response) => {
  const data = await getRiderOrderDetails({
    riderId: req.user?.id ?? "",
    orderId: String(req.params.orderId ?? "")
  })

  return sendSuccess(res, { data })
})

export const postRiderPickup = asyncHandler(async (req: Request, res: Response) => {
  const data = await pickupRiderOrder({
    riderId: req.user?.id ?? "",
    orderId: String(req.params.orderId ?? "")
  })

  return sendSuccess(res, {
    message: "Order picked up successfully",
    data
  })
})

export const postRiderAccept = asyncHandler(async (req: Request, res: Response) => {
  const data = await acceptRiderOrder({
    riderId: req.user?.id ?? "",
    orderId: String(req.params.orderId ?? "")
  })

  return sendSuccess(res, {
    message: "Order accepted successfully",
    data
  })
})

export const postRiderDelivered = asyncHandler(async (req: Request, res: Response) => {
  const data = await deliverRiderOrder({
    riderId: req.user?.id ?? "",
    orderId: String(req.params.orderId ?? "")
  })

  return sendSuccess(res, {
    message: "Order delivered successfully",
    data
  })
})

export const postRiderTrackingActivate = asyncHandler(async (req: Request, res: Response) => {
  const data = await activateRiderTrackingOrder({
    riderId: req.user?.id ?? "",
    orderId: String(req.params.orderId ?? "")
  })

  return sendSuccess(res, {
    message: "Live tracking switched successfully",
    data
  })
})

export const postRiderOrderLocation = asyncHandler(async (req: Request, res: Response) => {
  const payload = riderLocationSchema.parse(req.body)
  const data = await postRiderLocation({
    riderId: req.user?.id ?? "",
    orderId: String(req.params.orderId ?? ""),
    ...payload
  })

  return sendSuccess(res, {
    message: "Rider location updated successfully",
    data
  })
})
