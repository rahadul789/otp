import type { Request, Response } from "express"
import { StatusCodes } from "http-status-codes"
import { z } from "zod"

import { sendSuccess } from "../../common/utils/api-response"
import { asyncHandler } from "../../common/utils/async-handler"
import {
  logoutOwnerSession,
  requestPasswordReset,
  refreshOwnerSession,
  resetPassword,
  sendOtpForPurpose,
  signinOwner,
  signupOwner,
  verifyOtpSession
} from "./auth.service"

const ownerSignupSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().regex(/^01\d{9}$/),
  password: z.string().min(6)
})

const ownerSigninSchema = z.object({
  phone: z.string().regex(/^01\d{9}$/),
  password: z.string().min(6)
})

const otpSendSchema = z.object({
  channel: z.literal("phone"),
  phone: z.string().regex(/^01\d{9}$/),
  purpose: z.enum([
    "owner_signup_verify",
    "owner_phone_change",
    "owner_payout_verify",
    "password_reset"
  ]),
  referenceId: z.string().min(1)
})

const otpVerifySchema = z.object({
  verificationSessionId: z.string().min(1),
  otpCode: z.string().length(6)
})

const forgotPasswordSchema = z.object({
  phone: z.string().regex(/^01\d{9}$/)
})

const resetPasswordSchema = z.object({
  verificationSessionId: z.string().min(1),
  newPassword: z.string().min(6)
})

const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1)
})

const logoutSchema = z.object({
  refreshToken: z.string().min(1)
})

export const ownerSignup = asyncHandler(async (req: Request, res: Response) => {
  const payload = ownerSignupSchema.parse(req.body)
  const result = await signupOwner(payload)

  return sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: "Owner account created. OTP sent.",
    data: result
  })
})

export const ownerSignin = asyncHandler(async (req: Request, res: Response) => {
  const payload = ownerSigninSchema.parse(req.body)
  const result = await signinOwner({
    ...payload,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip
  })

  return sendSuccess(res, {
    message: "Signed in successfully",
    data: result
  })
})

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const payload = otpSendSchema.parse(req.body)
  const result = await sendOtpForPurpose({
    phone: payload.phone,
    purpose: payload.purpose,
    referenceId: payload.referenceId
  })

  return sendSuccess(res, {
    message: "OTP sent",
    data: result
  })
})

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const payload = otpVerifySchema.parse(req.body)
  const result = await verifyOtpSession(payload)

  return sendSuccess(res, {
    message: "OTP verified",
    data: result
  })
})

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const payload = forgotPasswordSchema.parse(req.body)
  const result = await requestPasswordReset(payload.phone)

  return sendSuccess(res, {
    message: "Password reset OTP sent",
    data: result
  })
})

export const resetOwnerPassword = asyncHandler(async (req: Request, res: Response) => {
  const payload = resetPasswordSchema.parse(req.body)
  const result = await resetPassword(payload)

  return sendSuccess(res, {
    message: "Password reset successfully",
    data: result
  })
})

export const refreshOwnerAuthSession = asyncHandler(async (req: Request, res: Response) => {
  const payload = refreshSessionSchema.parse(req.body)
  const result = await refreshOwnerSession({
    refreshToken: payload.refreshToken,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip
  })

  return sendSuccess(res, {
    message: "Session refreshed successfully",
    data: result
  })
})

export const ownerLogout = asyncHandler(async (req: Request, res: Response) => {
  const payload = logoutSchema.parse(req.body)
  const result = await logoutOwnerSession(payload.refreshToken)

  return sendSuccess(res, {
    message: "Signed out successfully",
    data: result
  })
})
