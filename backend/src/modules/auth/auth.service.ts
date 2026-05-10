import crypto from "node:crypto"

import { StatusCodes } from "http-status-codes"
import mongoose from "mongoose"

import type { OtpPurpose, RestaurantLifecycleStatus } from "../../common/constants/lifecycle"
import { AppError } from "../../common/utils/app-error"
import { env } from "../../config/env"
import {
  OnboardingDraftModel,
  OtpSessionModel,
  OwnerModel,
  PayoutMethodModel,
  RefreshTokenSessionModel
} from "./auth.model"
import type { SendOtpParams } from "./auth.types"
import {
  compareOtpCode,
  comparePassword,
  hashOtpCode,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "./auth.utils"
import { getMockOtpCode } from "./mock-otp"

const OTP_EXPIRY_SECONDS = 300
const REFRESH_SESSION_EXPIRY_DAYS = 30

function buildInitialDraft(ownerId: mongoose.Types.ObjectId, fullName: string, phone: string) {
  return {
    ownerId,
    basicInfo: {
      fullName,
      phone
    }
  }
}

function buildAuthResponse(params: {
  ownerId: string
  role: "owner"
  restaurantId?: string
  lifecycleStatus: RestaurantLifecycleStatus
  fullName: string
  phone: string
  isPhoneVerified: boolean
  refreshToken: string
}) {
  return {
    accessToken: signAccessToken({
      subject: params.ownerId,
      role: params.role,
      restaurantId: params.restaurantId
    }),
    refreshToken: params.refreshToken,
    owner: {
      id: params.ownerId,
      fullName: params.fullName,
      phone: params.phone,
      isPhoneVerified: params.isPhoneVerified
    },
    restaurantLifecycleStatus: params.lifecycleStatus
  }
}

async function createRefreshTokenSession(params: {
  ownerId: string
  role: "owner"
  restaurantId?: string
  userAgent?: string
  ipAddress?: string
}) {
  const tokenId = crypto.randomUUID()
  const refreshToken = signRefreshToken({
    subject: params.ownerId,
    role: params.role,
    restaurantId: params.restaurantId,
    tokenId
  })

  const tokenHash = await hashPassword(refreshToken)

  await RefreshTokenSessionModel.create({
    ownerId: params.ownerId,
    tokenId,
    tokenHash,
    userAgent: params.userAgent ?? "",
    ipAddress: params.ipAddress ?? "",
    expiresAt: new Date(Date.now() + REFRESH_SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  })

  return refreshToken
}

export async function createOtpSession(params: SendOtpParams) {
  const duplicatePending = await OtpSessionModel.findOne({
    phone: params.phone,
    purpose: params.purpose,
    status: "pending",
    expiresAt: { $gt: new Date() }
  })

  if (duplicatePending) {
    duplicatePending.otpCodeHash = await hashOtpCode(env.MOCK_OTP_CODE)
    duplicatePending.expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000)
    await duplicatePending.save()

    return duplicatePending
  }

  return OtpSessionModel.create({
    ownerId: params.ownerId ?? null,
    referenceId: params.referenceId,
    phone: params.phone,
    purpose: params.purpose,
    otpCodeHash: await hashOtpCode(env.MOCK_OTP_CODE),
    expiresAt: new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000)
  })
}

export async function signupOwner(params: {
  fullName: string
  phone: string
  password: string
}) {
  const existingOwner = await OwnerModel.findOne({
    $or: [{ phone: params.phone }, { pendingPhone: params.phone }]
  })

  if (existingOwner) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "PHONE_ALREADY_IN_USE",
      "An account already exists with this phone number"
    )
  }

  const passwordHash = await hashPassword(params.password)

  const owner = await OwnerModel.create({
    fullName: params.fullName,
    phone: params.phone,
    passwordHash
  })

  await OnboardingDraftModel.create(buildInitialDraft(owner._id, params.fullName, params.phone))

  const verificationSession = await createOtpSession({
    ownerId: owner.id,
    phone: params.phone,
    purpose: "owner_signup_verify",
    referenceId: owner.id
  })

  return {
    ownerId: owner.id,
    verificationSessionId: verificationSession.id,
    nextStatus: owner.restaurantLifecycleStatus,
    expiresInSeconds: OTP_EXPIRY_SECONDS,
    mockCode: getMockOtpCode()
  }
}

export async function signinOwner(params: {
  phone: string
  password: string
  userAgent?: string
  ipAddress?: string
}) {
  const owner = await OwnerModel.findOne({ phone: params.phone })

  if (!owner) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "INVALID_CREDENTIALS",
      "Invalid phone number or password"
    )
  }

  if (owner.status !== "active") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "ACCOUNT_UNAVAILABLE",
      "This account is not available for sign in"
    )
  }

  if (!owner.isPhoneVerified) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "PHONE_NOT_VERIFIED",
      "Please verify your phone number before signing in"
    )
  }

  const isPasswordValid = await comparePassword(params.password, owner.passwordHash)

  if (!isPasswordValid) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "INVALID_CREDENTIALS",
      "Invalid phone number or password"
    )
  }

  owner.lastLoginAt = new Date()
  await owner.save()

  const refreshToken = await createRefreshTokenSession({
    ownerId: owner.id,
    role: "owner",
    restaurantId: owner.activeRestaurantId?.toString(),
    userAgent: params.userAgent,
    ipAddress: params.ipAddress
  })

  return buildAuthResponse({
    ownerId: owner.id,
    role: "owner",
    restaurantId: owner.activeRestaurantId?.toString(),
    lifecycleStatus: owner.restaurantLifecycleStatus,
    fullName: owner.fullName,
    phone: owner.phone,
    isPhoneVerified: owner.isPhoneVerified
    ,
    refreshToken
  })
}

export async function sendOtpForPurpose(params: SendOtpParams) {
  if (params.purpose === "owner_signup_verify") {
    const owner = await OwnerModel.findById(params.referenceId)

    if (!owner) {
      throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
    }
  }

  if (params.purpose === "owner_phone_change") {
    const owner = await OwnerModel.findById(params.referenceId)

    if (!owner || owner.pendingPhone !== params.phone) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "INVALID_PHONE_CHANGE",
        "No pending phone change found for this phone number"
      )
    }
  }

  if (params.purpose === "owner_payout_verify") {
    const payoutMethod = await PayoutMethodModel.findById(params.referenceId)

    if (!payoutMethod || payoutMethod.pendingAccountNumber !== params.phone) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "INVALID_PAYOUT_VERIFICATION",
        "No pending payout verification found for this phone number"
      )
    }
  }

  const otpSession = await createOtpSession(params)

  return {
    verificationSessionId: otpSession.id,
    expiresInSeconds: OTP_EXPIRY_SECONDS,
    mockCode: getMockOtpCode()
  }
}

function resolveNextStatus(
  currentStatus: RestaurantLifecycleStatus,
  purpose: OtpPurpose
): RestaurantLifecycleStatus {
  if (purpose === "owner_signup_verify" && currentStatus === "account_created") {
    return "phone_verified"
  }

  return currentStatus
}

export async function verifyOtpSession(params: {
  verificationSessionId: string
  otpCode: string
}) {
  const otpSession = await OtpSessionModel.findById(params.verificationSessionId)

  if (!otpSession) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "OTP_SESSION_NOT_FOUND",
      "Verification session not found"
    )
  }

  if (otpSession.status !== "pending") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "OTP_ALREADY_USED",
      "This verification session is no longer active"
    )
  }

  if (otpSession.expiresAt.getTime() < Date.now()) {
    otpSession.status = "expired"
    await otpSession.save()
    throw new AppError(StatusCodes.BAD_REQUEST, "OTP_EXPIRED", "OTP has expired")
  }

  const isValidOtp = await compareOtpCode(params.otpCode, otpSession.otpCodeHash)

  if (!isValidOtp) {
    throw new AppError(StatusCodes.BAD_REQUEST, "INVALID_OTP", "Invalid OTP code")
  }

  let nextStatus: RestaurantLifecycleStatus | undefined

  if (otpSession.purpose === "owner_signup_verify" || otpSession.purpose === "owner_phone_change") {
    const owner = await OwnerModel.findById(otpSession.referenceId)

    if (!owner) {
      throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
    }

    if (otpSession.purpose === "owner_signup_verify") {
      owner.isPhoneVerified = true
    }

    if (otpSession.purpose === "owner_phone_change") {
      if (owner.pendingPhone !== otpSession.phone) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "PHONE_CHANGE_MISMATCH",
          "Pending phone number does not match verification request"
        )
      }

      owner.phone = otpSession.phone
      owner.pendingPhone = null
      owner.isPhoneVerified = true
    }

    nextStatus = resolveNextStatus(owner.restaurantLifecycleStatus, otpSession.purpose)
    owner.restaurantLifecycleStatus = nextStatus
    await owner.save()
  }

  if (otpSession.purpose === "owner_payout_verify") {
    const payoutMethod = await PayoutMethodModel.findById(otpSession.referenceId)

    if (!payoutMethod) {
      throw new AppError(StatusCodes.NOT_FOUND, "PAYOUT_METHOD_NOT_FOUND", "Payout method not found")
    }

    if (payoutMethod.pendingAccountNumber !== otpSession.phone) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "PAYOUT_NUMBER_MISMATCH",
        "Pending payout account number does not match the verification request"
      )
    }

    payoutMethod.accountNumber = otpSession.phone
    payoutMethod.pendingAccountNumber = null
    payoutMethod.isVerified = true
    payoutMethod.verifiedAt = new Date()
    payoutMethod.verificationSource = "otp"
    await payoutMethod.save()
  }

  otpSession.status = otpSession.purpose === "password_reset" ? "verified" : "consumed"
  otpSession.verifiedAt = new Date()
  await otpSession.save()

  return {
    verified: true,
    purpose: otpSession.purpose,
    nextStatus
  }
}

async function getVerifiedPasswordResetSession(verificationSessionId: string) {
  const otpSession = await OtpSessionModel.findById(verificationSessionId)

  if (!otpSession || otpSession.purpose !== "password_reset") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RESET_SESSION_NOT_FOUND",
      "Password reset session not found"
    )
  }

  if (otpSession.status !== "verified") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RESET_SESSION_NOT_VERIFIED",
      "Verify OTP before resetting the password"
    )
  }

  return otpSession
}

export async function requestPasswordReset(phone: string) {
  const owner = await OwnerModel.findOne({ phone })

  if (!owner) {
    throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
  }

  return sendOtpForPurpose({
    ownerId: owner.id,
    phone,
    purpose: "password_reset",
    referenceId: owner.id
  })
}

export async function resetPassword(params: {
  verificationSessionId: string
  newPassword: string
}) {
  const otpSession = await getVerifiedPasswordResetSession(params.verificationSessionId)
  const owner = await OwnerModel.findById(otpSession.referenceId)

  if (!owner) {
    throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
  }

  owner.passwordHash = await hashPassword(params.newPassword)
  await owner.save()

  otpSession.status = "consumed"
  await otpSession.save()

  return { reset: true }
}

export async function refreshOwnerSession(params: {
  refreshToken: string
  userAgent?: string
  ipAddress?: string
}) {
  const payload = verifyRefreshToken(params.refreshToken)

  if (!payload.tokenId) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Invalid refresh token")
  }

  const refreshSession = await RefreshTokenSessionModel.findOne({
    tokenId: payload.tokenId,
    ownerId: payload.sub
  })

  if (!refreshSession || refreshSession.revokedAt) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "SESSION_REVOKED", "Refresh session is not active")
  }

  if (refreshSession.expiresAt.getTime() < Date.now()) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "SESSION_EXPIRED", "Refresh session has expired")
  }

  const isTokenValid = await comparePassword(params.refreshToken, refreshSession.tokenHash)

  if (!isTokenValid) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Invalid refresh token")
  }

  const owner = await OwnerModel.findById(payload.sub)

  if (!owner) {
    throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
  }

  refreshSession.revokedAt = new Date()
  await refreshSession.save()

  const nextRefreshToken = await createRefreshTokenSession({
    ownerId: owner.id,
    role: "owner",
    restaurantId: owner.activeRestaurantId?.toString(),
    userAgent: params.userAgent,
    ipAddress: params.ipAddress
  })

  return buildAuthResponse({
    ownerId: owner.id,
    role: "owner",
    restaurantId: owner.activeRestaurantId?.toString(),
    lifecycleStatus: owner.restaurantLifecycleStatus,
    fullName: owner.fullName,
    phone: owner.phone,
    isPhoneVerified: owner.isPhoneVerified,
    refreshToken: nextRefreshToken
  })
}

export async function logoutOwnerSession(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken)

  if (!payload.tokenId) {
    return { revoked: true }
  }

  await RefreshTokenSessionModel.findOneAndUpdate(
    { tokenId: payload.tokenId, ownerId: payload.sub, revokedAt: null },
    { revokedAt: new Date() }
  )

  return { revoked: true }
}
