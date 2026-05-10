import crypto from "node:crypto"

import { StatusCodes } from "http-status-codes"

import { AppError } from "../../common/utils/app-error"
import { decorateTrackingSnapshot } from "../../common/utils/tracking-freshness"
import { emitSocketEvent } from "../../config/socket"
import { runAutoDispatchForReadyOrders } from "../admin/orders-monitor.service"
import { createOtpSession } from "../auth/auth.service"
import {
  OtpSessionModel,
  RestaurantModel,
  RiderModel,
  RiderRefreshTokenSessionModel
} from "../auth/auth.model"
import {
  compareOtpCode,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "../auth/auth.utils"
import { OrderModel } from "../owner/operational.model"
import { transitionOrderBySystem, updateOrderRiderLocation } from "../owner/operational.service"
import { getPlatformContent } from "../public/content.service"
import { syncRiderAvailabilitySession } from "./availability-session.service"

const RIDER_REFRESH_EXPIRY_DAYS = 30
const DEFAULT_MAX_ACTIVE_ORDERS_PER_RIDER = 3
const DEFAULT_RIDER_ORDER_PAGE_SIZE = 80
const MAX_RIDER_ORDER_PAGE_SIZE = 100
const MAX_RIDER_PUSH_TOKENS = 5
const DISABLED_RIDER_PUSH_TOKEN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

function normalizeRiderPageBounds(params?: { page?: number; pageSize?: number }) {
  const page = Math.max(1, Math.floor(Number(params?.page ?? 1)) || 1)
  const pageSize = Math.min(
    MAX_RIDER_ORDER_PAGE_SIZE,
    Math.max(1, Math.floor(Number(params?.pageSize ?? DEFAULT_RIDER_ORDER_PAGE_SIZE)) || DEFAULT_RIDER_ORDER_PAGE_SIZE)
  )
  return { page, pageSize }
}

function pruneRiderPushTokens(rider: { pushTokens: any[] }) {
  const disabledCutoff = Date.now() - DISABLED_RIDER_PUSH_TOKEN_RETENTION_MS
  rider.pushTokens = (rider.pushTokens ?? [])
    .filter((token) => {
      if (!token?.disabledAt) return true
      return new Date(token.disabledAt).getTime() >= disabledCutoff
    })
    .sort((left, right) => {
      const leftActive = left.disabledAt ? 0 : 1
      const rightActive = right.disabledAt ? 0 : 1
      if (leftActive !== rightActive) return rightActive - leftActive
      return new Date(right.lastSeenAt ?? 0).getTime() - new Date(left.lastSeenAt ?? 0).getTime()
    })
    .slice(0, MAX_RIDER_PUSH_TOKENS)
}

async function getMaxActiveOrdersPerRider() {
  const content = await getPlatformContent()
  const value = content.operations?.dispatch?.maxActiveOrdersPerRider

  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(50, Math.max(1, Math.floor(value)))
    : DEFAULT_MAX_ACTIVE_ORDERS_PER_RIDER
}

function assertRiderAccessible(rider: {
  status?: string | null
  verification?: { status?: string | null } | null
}) {
  if (rider.status !== "active") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "RIDER_ACCOUNT_UNAVAILABLE",
      "This rider account is not available right now"
    )
  }

  if (rider.verification?.status !== "approved") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "RIDER_KYC_NOT_APPROVED",
      "Your rider account is waiting for admin verification"
    )
  }
}

function buildRiderAuthPayload(params: {
  riderId: string
  fullName: string
  phone: string
  vehicleType?: string
  activeTrackingOrderId?: string
  isAvailableForAssignments?: boolean
  status?: string
  profileImage?: { url?: string; publicId?: string }
  refreshToken: string
}) {
  return {
    accessToken: signAccessToken({
      subject: params.riderId,
      role: "rider"
    }),
    refreshToken: params.refreshToken,
    rider: {
      id: params.riderId,
      fullName: params.fullName,
      phone: params.phone,
      vehicleType: params.vehicleType ?? "cycle",
      activeTrackingOrderId: params.activeTrackingOrderId ?? "",
      isAvailableForAssignments: params.isAvailableForAssignments ?? true,
      status: params.status ?? "active",
      profileImage: params.profileImage ?? { url: "", publicId: "" }
    }
  }
}

async function createRiderRefreshSession(params: {
  riderId: string
  userAgent?: string
  ipAddress?: string
}) {
  const tokenId = crypto.randomUUID()
  const refreshToken = signRefreshToken({
    subject: params.riderId,
    role: "rider",
    tokenId
  })

  const tokenHash = await hashPassword(refreshToken)

  await RiderRefreshTokenSessionModel.create({
    riderId: params.riderId,
    tokenId,
    tokenHash,
    userAgent: params.userAgent ?? "",
    ipAddress: params.ipAddress ?? "",
    expiresAt: new Date(Date.now() + RIDER_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  })

  return refreshToken
}

function mapRiderProfile(rider: {
  _id?: unknown
  id?: string
  fullName: string
  phone: string
  vehicleType?: string
  activeTrackingOrderId?: string
  profileImage?: { url?: string; publicId?: string }
  status?: string
  lastLoginAt?: Date | null
  isAvailableForAssignments?: boolean
  lastKnownLocation?: {
    latitude?: number | null
    longitude?: number | null
    heading?: number | null
    accuracyMeters?: number | null
    speedKmph?: number | null
    updatedAt?: Date | null
  }
}) {
  return {
    id: rider.id ?? String(rider._id ?? ""),
    fullName: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType ?? "cycle",
    activeTrackingOrderId: rider.activeTrackingOrderId ?? "",
    profileImage: rider.profileImage ?? { url: "", publicId: "" },
    status: rider.status ?? "active",
    isAvailableForAssignments: rider.isAvailableForAssignments ?? true,
    lastLoginAt: rider.lastLoginAt ? new Date(rider.lastLoginAt).toISOString() : null,
    lastKnownLocation: rider.lastKnownLocation
      ? {
          latitude: rider.lastKnownLocation.latitude ?? null,
          longitude: rider.lastKnownLocation.longitude ?? null,
          heading: rider.lastKnownLocation.heading ?? null,
          accuracyMeters: rider.lastKnownLocation.accuracyMeters ?? null,
          speedKmph: rider.lastKnownLocation.speedKmph ?? null,
          updatedAt: rider.lastKnownLocation.updatedAt
            ? new Date(rider.lastKnownLocation.updatedAt).toISOString()
            : null
        }
      : null
  }
}

function mapRiderOrder(
  order: Record<string, any>,
  restaurant?: Record<string, any> | null,
  riderId?: string,
  activeTrackingOrderId?: string
) {
  const assignedRiderId = typeof order.riderId === "string" ? order.riderId : ""
  const assignmentState =
    !assignedRiderId && order.status === "ReadyForPickup"
      ? "unassigned"
      : assignedRiderId === riderId
        ? "assigned_to_you"
        : "assigned_to_other"

  return {
    id: String(order._id ?? order.id ?? ""),
    orderNumber: order.orderNumber ?? "",
    status: order.status ?? "",
    paymentMethod: order.paymentMethod ?? "Cash",
    paymentStatus: order.paymentStatus ?? "pending",
    assignmentState,
    isTrackingActiveForRider:
      Boolean(activeTrackingOrderId) &&
      activeTrackingOrderId === String(order._id ?? order.id ?? "") &&
      order.status === "PickedUp",
    createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
    updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
    pricing: order.pricing ?? {},
    timestamps: order.timestamps ?? {},
    riderSnapshot: order.riderSnapshot ?? {},
    riderTracking: decorateTrackingSnapshot(order.riderTracking ?? {}, order.status ?? ""),
    customer: {
      name: order.customerSnapshot?.name ?? order.customerSnapshot?.fullName ?? "",
      phone: order.customerSnapshot?.phone ?? "",
      deliveryAddress: {
        label: order.customerSnapshot?.deliveryAddress?.label ?? "",
        addressLine: order.customerSnapshot?.deliveryAddress?.addressLine ?? "",
        latitude: order.customerSnapshot?.deliveryAddress?.latitude ?? null,
        longitude: order.customerSnapshot?.deliveryAddress?.longitude ?? null
      }
    },
    restaurant: restaurant
      ? {
          id: String(restaurant._id ?? restaurant.id ?? ""),
          name: restaurant.name ?? "",
          phone: restaurant.contact?.phone ?? "",
          address: restaurant.address?.address ?? "",
          city: restaurant.address?.city ?? "",
          latitude: restaurant.location?.latitude ?? null,
          longitude: restaurant.location?.longitude ?? null,
          preparationTimeMinutes: restaurant.preparationTimeMinutes ?? null
        }
      : null,
    items: Array.isArray(order.itemsSnapshot)
      ? order.itemsSnapshot.map((item: Record<string, any>) => ({
          name: item.name ?? "",
          quantity: item.quantity ?? 0,
          totalPrice: item.totalPrice ?? item.lineTotal ?? 0
        }))
      : [],
    history: Array.isArray(order.history)
      ? order.history.map((entry: Record<string, any>) => ({
          status: entry.status ?? "",
          actor: entry.actor ?? "",
          note: entry.note ?? "",
          createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null
        }))
      : []
  }
}

async function enrichRiderOrders(
  orders: Array<Record<string, any>>,
  riderId?: string,
  activeTrackingOrderId?: string
) {
  const restaurantIds = [...new Set(orders.map((order) => String(order.restaurantId ?? "")).filter(Boolean))]

  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } })
    : []

  const restaurantMap = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant.toObject()]))

  return orders.map((order) =>
    mapRiderOrder(
      order,
      restaurantMap.get(String(order.restaurantId ?? "")) ?? null,
      riderId,
      activeTrackingOrderId
    )
  )
}

async function setActiveTrackingOrder(params: { riderId: string; orderId: string }) {
  await OrderModel.updateMany(
    { riderId: params.riderId, status: "PickedUp", _id: { $ne: params.orderId } },
    {
      $set: {
        "riderTracking.isActive": false
      }
    }
  )

  await OrderModel.updateOne(
    { _id: params.orderId },
    {
      $set: {
        "riderTracking.isActive": true
      }
    }
  )

  await RiderModel.updateOne(
    { _id: params.riderId },
    {
      $set: {
        activeTrackingOrderId: params.orderId
      }
    }
  )
}

async function clearActiveTrackingOrderIfMatches(params: { riderId: string; orderId: string }) {
  await RiderModel.updateOne(
    {
      _id: params.riderId,
      activeTrackingOrderId: params.orderId
    },
    {
      $set: {
        activeTrackingOrderId: ""
      }
    }
  )
}

export async function startRiderPhoneSignin(phone: string) {
  const otpSession = await createOtpSession({
    phone,
    purpose: "rider_phone_signin",
    referenceId: phone
  })

  return {
    verificationSessionId: otpSession.id,
    expiresInSeconds: 300
  }
}

export async function verifyRiderPhoneSignin(params: {
  verificationSessionId: string
  otpCode: string
  fullName?: string
  userAgent?: string
  ipAddress?: string
}) {
  const otpSession = await OtpSessionModel.findById(params.verificationSessionId)

  if (!otpSession || otpSession.purpose !== "rider_phone_signin") {
    throw new AppError(StatusCodes.NOT_FOUND, "OTP_SESSION_NOT_FOUND", "Verification session not found")
  }

  if (otpSession.status !== "pending") {
    throw new AppError(StatusCodes.BAD_REQUEST, "OTP_NOT_ACTIVE", "OTP session is not active")
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

  let rider = await RiderModel.findOne({ phone: otpSession.phone })

  if (!rider) {
    rider = await RiderModel.create({
      fullName: params.fullName?.trim() || "Foodbela Rider",
      phone: otpSession.phone,
      vehicleType: "cycle",
      isPhoneVerified: true
    })
  }

  assertRiderAccessible(rider)

  rider.lastLoginAt = new Date()
  await rider.save()

  otpSession.status = "consumed"
  otpSession.verifiedAt = new Date()
  await otpSession.save()

  const refreshToken = await createRiderRefreshSession({
    riderId: rider.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress
  })

  return buildRiderAuthPayload({
    riderId: rider.id,
    fullName: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType,
    activeTrackingOrderId: rider.activeTrackingOrderId ?? "",
    isAvailableForAssignments: rider.isAvailableForAssignments ?? true,
    status: rider.status,
    profileImage: rider.profileImage,
    refreshToken
  })
}

export async function refreshRiderSession(params: {
  refreshToken: string
  userAgent?: string
  ipAddress?: string
}) {
  let payload: ReturnType<typeof verifyRefreshToken>

  try {
    payload = verifyRefreshToken(params.refreshToken)
  } catch {
    throw new AppError(StatusCodes.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Refresh session is not active")
  }

  if (payload.role !== "rider" || !payload.tokenId) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Refresh session is not active")
  }

  const session = await RiderRefreshTokenSessionModel.findOne({
    riderId: payload.sub,
    tokenId: payload.tokenId,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  })

  if (!session) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Refresh session is not active")
  }

  session.revokedAt = new Date()
  await session.save()

  const rider = await RiderModel.findById(payload.sub)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  rider.lastLoginAt = new Date()
  await rider.save()

  const refreshToken = await createRiderRefreshSession({
    riderId: rider.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress
  })

  return buildRiderAuthPayload({
    riderId: rider.id,
    fullName: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType,
    activeTrackingOrderId: rider.activeTrackingOrderId ?? "",
    isAvailableForAssignments: rider.isAvailableForAssignments ?? true,
    status: rider.status,
    profileImage: rider.profileImage,
    refreshToken
  })
}

export async function logoutRiderSession(refreshToken: string) {
  let payload: ReturnType<typeof verifyRefreshToken>

  try {
    payload = verifyRefreshToken(refreshToken)
  } catch {
    return { revoked: true }
  }

  if (payload.role !== "rider" || !payload.tokenId) {
    return { revoked: true }
  }

  await RiderRefreshTokenSessionModel.updateOne(
    { riderId: payload.sub, tokenId: payload.tokenId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  )

  return { revoked: true }
}

export async function getRiderProfile(riderId: string) {
  const rider = await RiderModel.findById(riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  return mapRiderProfile(rider)
}

export async function updateRiderAvailability(params: {
  riderId: string
  isAvailableForAssignments: boolean
}) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  if (!params.isAvailableForAssignments) {
    const activeAssignedOrdersCount = await OrderModel.countDocuments({
      riderId: rider.id,
      status: { $in: ["ReadyForPickup", "PickedUp"] }
    })

    if (activeAssignedOrdersCount > 0 || (rider.activeTrackingOrderId ?? "").trim().length > 0) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "RIDER_HAS_ACTIVE_ORDERS",
        "Complete your active assigned orders before going offline"
      )
    }
  }

  rider.isAvailableForAssignments = params.isAvailableForAssignments
  await rider.save()
  await syncRiderAvailabilitySession({
    riderId: rider.id,
    isAvailableForAssignments: params.isAvailableForAssignments,
    source: "rider_app",
    endReason: "manual_offline",
  })

  const profile = mapRiderProfile(rider)
  emitSocketEvent(`rider:${rider.id}`, "rider.profile.updated", profile)

  if (params.isAvailableForAssignments) {
    void runAutoDispatchForReadyOrders().catch(() => undefined)
  }

  return profile
}

export async function registerRiderPushToken(params: {
  riderId: string
  expoPushToken: string
  platform: "android" | "ios"
  deviceId?: string
  appVersion?: string
}) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const existingToken = rider.pushTokens.find(
    (token) => token.expoPushToken === params.expoPushToken
  )

  if (existingToken) {
    existingToken.platform = params.platform
    existingToken.deviceId = params.deviceId ?? existingToken.deviceId ?? ""
    existingToken.appVersion = params.appVersion ?? existingToken.appVersion ?? ""
    existingToken.lastSeenAt = new Date()
    existingToken.disabledAt = null
  } else {
    if (params.deviceId) {
      rider.pushTokens.forEach((token) => {
        if (token.deviceId === params.deviceId && token.expoPushToken !== params.expoPushToken) {
          token.disabledAt = new Date()
        }
      })
    }
    rider.pushTokens.push({
      expoPushToken: params.expoPushToken,
      platform: params.platform,
      deviceId: params.deviceId ?? "",
      appVersion: params.appVersion ?? "",
      lastSeenAt: new Date(),
      disabledAt: null
    } as any)
  }

  pruneRiderPushTokens(rider)
  await rider.save()

  return { registered: true }
}

export async function unregisterRiderPushToken(params: {
  riderId: string
  expoPushToken: string
}) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const pushToken = rider.pushTokens.find(
    (token) => token.expoPushToken === params.expoPushToken
  )

  if (pushToken) {
    pushToken.disabledAt = new Date()
    pushToken.lastSeenAt = new Date()
    pruneRiderPushTokens(rider)
    await rider.save()
  }

  return { removed: true }
}

export async function updateRiderLastKnownLocation(params: {
  riderId: string
  latitude: number
  longitude: number
  heading?: number
  accuracyMeters?: number
  speedKmph?: number
}) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  rider.lastKnownLocation = {
    latitude: params.latitude,
    longitude: params.longitude,
    heading: params.heading ?? null,
    accuracyMeters: params.accuracyMeters ?? null,
    speedKmph: params.speedKmph ?? null,
    updatedAt: new Date()
  }

  await rider.save()

  const profile = mapRiderProfile(rider)
  emitSocketEvent(`rider:${rider.id}`, "rider.profile.updated", profile)

  return profile
}

export async function listRiderOrders(params: {
  riderId: string
  scope?: "available" | "active" | "history"
  page?: number
  pageSize?: number
}) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const scope = params.scope ?? "active"

  if (scope === "available" && rider.isAvailableForAssignments === false) {
    return []
  }

  const query =
    scope === "available"
      ? { status: "ReadyForPickup", $or: [{ riderId: "" }, { riderId: { $exists: false } }] }
      : scope === "history"
        ? { riderId: rider.id, status: { $in: ["Delivered", "Cancelled"] } }
        : { riderId: rider.id, status: { $in: ["ReadyForPickup", "PickedUp"] } }
  const { page, pageSize } = normalizeRiderPageBounds(params)

  const orders = await OrderModel.find(query)
    .sort({ createdAt: scope === "history" ? -1 : 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean()

  return enrichRiderOrders(orders, rider.id, rider.activeTrackingOrderId ?? "")
}

export async function getRiderOrderDetails(params: { riderId: string; orderId: string }) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const order = await OrderModel.findById(params.orderId).lean()

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  const orderRiderId = typeof order.riderId === "string" ? order.riderId : ""
  const isAvailableOrder = order.status === "ReadyForPickup" && !orderRiderId

  if (!isAvailableOrder && orderRiderId !== rider.id) {
    throw new AppError(StatusCodes.FORBIDDEN, "FORBIDDEN", "You do not have access to this order")
  }

  const restaurant = await RestaurantModel.findById(order.restaurantId).lean()

  return mapRiderOrder(order, restaurant, rider.id, rider.activeTrackingOrderId ?? "")
}

export async function acceptRiderOrder(params: { riderId: string; orderId: string }) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  if (rider.isAvailableForAssignments === false) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_OFFLINE",
      "Go online before accepting a new order"
    )
  }

  const order = await OrderModel.findById(params.orderId)

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (order.status !== "ReadyForPickup") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_ACCEPTABLE",
      "This order is not available for rider assignment"
    )
  }

  if (order.riderId && order.riderId !== rider.id) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_ALREADY_ASSIGNED",
      "This order is already assigned to another rider"
    )
  }

  const [activeAssignedOrdersCount, maxActiveOrdersPerRider] = await Promise.all([
    OrderModel.countDocuments({
      riderId: rider.id,
      status: { $in: ["ReadyForPickup", "PickedUp"] }
    }),
    getMaxActiveOrdersPerRider()
  ])

  if (!order.riderId && activeAssignedOrdersCount >= maxActiveOrdersPerRider) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_CAPACITY_REACHED",
      `You already have ${activeAssignedOrdersCount} active orders. Complete one before accepting more.`
    )
  }

  order.riderId = rider.id
  order.riderSnapshot = {
    ...(order.riderSnapshot ?? {}),
    name: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType
  }
  order.set("dispatchMeta", {
    ...(order.get("dispatchMeta") ?? {}),
    acknowledgedAt: new Date()
  })
  await order.save()

  emitSocketEvent(`rider:${rider.id}`, "rider.order.updated", order.toObject())

  return getRiderOrderDetails({
    riderId: rider.id,
    orderId: order.id
  })
}

export async function pickupRiderOrder(params: { riderId: string; orderId: string }) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const order = await OrderModel.findById(params.orderId)

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (order.status !== "ReadyForPickup") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_READY",
      "This order is not ready for pickup yet"
    )
  }

  if (order.riderId && order.riderId !== rider.id) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_ALREADY_ASSIGNED",
      "This order is already assigned to another rider"
    )
  }

  if (!order.riderId) {
    order.riderId = rider.id
    order.riderSnapshot = {
      ...(order.riderSnapshot ?? {}),
      name: rider.fullName,
      phone: rider.phone,
      vehicleType: rider.vehicleType
    }
  }
  order.set("dispatchMeta", {
    ...(order.get("dispatchMeta") ?? {}),
    acknowledgedAt: new Date()
  })
  await order.save()

  const updatedOrder = await transitionOrderBySystem({
    orderId: order.id,
    nextStatus: "PickedUp",
    actor: "rider",
    note: "Picked up by rider"
  })

  if (!rider.activeTrackingOrderId) {
    await setActiveTrackingOrder({
      riderId: rider.id,
      orderId: order.id
    })
  }

  emitSocketEvent(`rider:${rider.id}`, "rider.order.updated", updatedOrder.toObject())

  return getRiderOrderDetails({
    riderId: rider.id,
    orderId: order.id
  })
}

export async function deliverRiderOrder(params: { riderId: string; orderId: string }) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const order = await OrderModel.findById(params.orderId)

  if (!order || order.riderId !== rider.id) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (order.status !== "PickedUp") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_IN_TRANSIT",
      "This order is not currently in transit"
    )
  }

  const updatedOrder = await transitionOrderBySystem({
    orderId: order.id,
    nextStatus: "Delivered",
    actor: "rider",
    note: "Delivered by rider"
  })

  updatedOrder.set("riderTracking", {
    ...(updatedOrder.get("riderTracking") ?? {}),
    isActive: false,
    endedAt: new Date(),
    disconnectedAt: new Date()
  })
  await updatedOrder.save()

  await clearActiveTrackingOrderIfMatches({
    riderId: rider.id,
    orderId: order.id
  })

  emitSocketEvent(`rider:${rider.id}`, "rider.order.updated", updatedOrder.toObject())

  return getRiderOrderDetails({
    riderId: rider.id,
    orderId: order.id
  })
}

export async function activateRiderTrackingOrder(params: { riderId: string; orderId: string }) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const order = await OrderModel.findById(params.orderId)

  if (!order || order.riderId !== rider.id) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (order.status !== "PickedUp") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_IN_TRANSIT",
      "Only picked up orders can start live tracking"
    )
  }

  await setActiveTrackingOrder({
    riderId: rider.id,
    orderId: order.id
  })

  return getRiderOrderDetails({
    riderId: rider.id,
    orderId: order.id
  })
}

export async function postRiderLocation(params: {
  riderId: string
  orderId: string
  latitude: number
  longitude: number
  heading?: number
  accuracyMeters?: number
  speedKmph?: number
}) {
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  assertRiderAccessible(rider)

  const order = await OrderModel.findById(params.orderId)

  if (!order || order.riderId !== rider.id) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if ((rider.activeTrackingOrderId ?? "") !== order.id) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "TRACKING_NOT_ACTIVE_FOR_ORDER",
      "Make this order your active live trip before sharing location"
    )
  }

  const updatedOrder = await updateOrderRiderLocation({
    orderId: order.id,
    actor: "rider",
    latitude: params.latitude,
    longitude: params.longitude,
    heading: params.heading,
    accuracyMeters: params.accuracyMeters,
    speedKmph: params.speedKmph,
    riderName: rider.fullName,
    riderPhone: rider.phone
  })

  rider.lastKnownLocation = {
    latitude: params.latitude,
    longitude: params.longitude,
    heading: params.heading ?? null,
    accuracyMeters: params.accuracyMeters ?? null,
    speedKmph: params.speedKmph ?? null,
    updatedAt: new Date(),
  }
  await rider.save()

  emitSocketEvent(`rider:${rider.id}`, "rider.order.updated", updatedOrder.toObject())

  return getRiderOrderDetails({
    riderId: rider.id,
    orderId: order.id
  })
}
