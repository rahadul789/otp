import type { Response } from "express"
import { z } from "zod"

import { sendSuccess } from "../../common/utils/api-response"
import { asyncHandler } from "../../common/utils/async-handler"
import type { AuthenticatedRequest } from "../../common/middleware/auth"
import { getOwnerProfile, updateOwnerPassword, updateOwnerProfile } from "./owner.service"

const ownerProfileUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().regex(/^01\d{9}$/).optional()
})

const ownerPasswordUpdateSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6)
})

export const getOwnerMe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ownerId = req.user?.id ?? ""
  const owner = await getOwnerProfile(ownerId)

  return sendSuccess(res, {
    data: {
      id: owner.id,
      fullName: owner.fullName,
      phone: owner.phone,
      pendingPhone: owner.pendingPhone,
      email: owner.email,
      profileImage: owner.profileImage,
      isPhoneVerified: owner.isPhoneVerified,
      createdAt: owner.createdAt,
      lastLoginAt: owner.lastLoginAt,
      restaurantLifecycleStatus: owner.restaurantLifecycleStatus
    }
  })
})

export const patchOwnerMe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ownerId = req.user?.id ?? ""
  const payload = ownerProfileUpdateSchema.parse(req.body)
  const result = await updateOwnerProfile({
    ownerId,
    ...payload
  })

  return sendSuccess(res, {
    message: result.verificationSessionId
      ? "Profile updated. Phone verification required to complete the number change."
      : "Profile updated successfully",
    data: {
      owner: {
        id: result.owner.id,
        fullName: result.owner.fullName,
        phone: result.owner.phone,
        pendingPhone: result.owner.pendingPhone,
        email: result.owner.email,
        profileImage: result.owner.profileImage,
        isPhoneVerified: result.owner.isPhoneVerified,
        createdAt: result.owner.createdAt,
        lastLoginAt: result.owner.lastLoginAt
      },
      verificationSessionId: result.verificationSessionId,
      mockCode: result.mockCode
    }
  })
})

export const patchOwnerPassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ownerId = req.user?.id ?? ""
  const payload = ownerPasswordUpdateSchema.parse(req.body)
  const result = await updateOwnerPassword({
    ownerId,
    ...payload
  })

  return sendSuccess(res, {
    message: "Password updated successfully",
    data: result
  })
})
