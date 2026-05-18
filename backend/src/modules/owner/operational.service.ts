import { StatusCodes } from "http-status-codes"
import mongoose from "mongoose"
import type { SortOrder } from "mongoose"

import { emitSocketEvent } from "../../config/socket"
import { slugify } from "../../common/utils/slugify"
import { AppError } from "../../common/utils/app-error"
import { runAutoDispatchForReadyOrders } from "../admin/orders-monitor.service"
import { OwnerModel, RestaurantModel, RiderModel } from "../auth/auth.model"
import { sendPushToCustomer } from "../customer/push.service"
import { VoucherRedemptionModel } from "../customer/customer.model"
import { grantReferralRewardForDeliveredOrder } from "../customer/referral.service"
import { getPlatformContent } from "../public/content.service"
import { sendPushToRider } from "../rider/push.service"
import { syncOrderLedgerForFinalStatus } from "./finance.service"
import {
  CategoryModel,
  MenuItemModel,
  NotificationModel,
  OrderModel
} from "./operational.model"
import {
  buildOrderPreparationTiming,
  buildPreparationMetaForExtension,
  buildPreparationMetaForStart
} from "./preparation-timing"
import { buildDhakaPresetRange, type OwnerDateRange } from "./date-ranges"

const liveStatuses = new Set(["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"])
const historyStatuses = new Set(["Delivered", "Rejected", "Cancelled"])
const MAX_ORDER_HISTORY_ENTRIES = 100

const ownerOrderTransitions: Record<string, string[]> = {
  New: ["Accepted", "Rejected"],
  Accepted: ["Preparing", "Cancelled"],
  Preparing: ["ReadyForPickup", "Cancelled"]
}

const systemOrderTransitions: Record<string, string[]> = {
  ReadyForPickup: ["PickedUp", "Cancelled"],
  PickedUp: ["Delivered"],
  Accepted: ["Cancelled"],
  Preparing: ["Cancelled"]
}

const orderTimestampFieldByStatus: Partial<Record<string, string>> = {
  Accepted: "acceptedAt",
  Preparing: "preparingAt",
  ReadyForPickup: "readyForPickupAt",
  PickedUp: "pickedUpAt",
  Delivered: "deliveredAt",
  Rejected: "rejectedAt",
  Cancelled: "cancelledAt"
}

function getOwnerAutoCancelSettings(content: Record<string, any>) {
  const dispatch = content?.operations?.dispatch ?? {}
  return {
    autoCancelUnacceptedOrdersEnabled:
      typeof dispatch.autoCancelUnacceptedOrdersEnabled === "boolean"
        ? dispatch.autoCancelUnacceptedOrdersEnabled
        : false,
    autoCancelAfterMinutes:
      typeof dispatch.autoCancelAfterMinutes === "number"
        ? dispatch.autoCancelAfterMinutes
        : 12,
    autoCancelNotifyBeforeMinutes:
      typeof dispatch.autoCancelNotifyBeforeMinutes === "number"
        ? dispatch.autoCancelNotifyBeforeMinutes
        : 3,
    prepStartGraceMinutes:
      typeof dispatch.prepStartGraceMinutes === "number" ? dispatch.prepStartGraceMinutes : 3,
    preparationMaxExtraMinutes:
      typeof dispatch.preparationMaxExtraMinutes === "number"
        ? dispatch.preparationMaxExtraMinutes
        : 20
  }
}

function decorateOwnerOrderAutomation(
  order: Record<string, any>,
  settings: ReturnType<typeof getOwnerAutoCancelSettings>,
  restaurant?: Record<string, any> | null
) {
  const createdAt = order.createdAt ? new Date(order.createdAt).getTime() : 0
  const applies =
    settings.autoCancelUnacceptedOrdersEnabled &&
    order.status === "New" &&
    createdAt > 0 &&
    !Number.isNaN(createdAt)
  const autoCancelAt = applies
    ? new Date(createdAt + settings.autoCancelAfterMinutes * 60_000)
    : null

  return {
    ...order,
    autoCancel: {
      enabled: settings.autoCancelUnacceptedOrdersEnabled,
      applies,
      autoCancelAfterMinutes: settings.autoCancelAfterMinutes,
      notifyBeforeMinutes: settings.autoCancelNotifyBeforeMinutes,
      autoCancelAt: autoCancelAt ? autoCancelAt.toISOString() : null,
      remainingSeconds: autoCancelAt
        ? Math.max(0, Math.ceil((autoCancelAt.getTime() - Date.now()) / 1000))
        : null
    },
    preparationTiming: buildOrderPreparationTiming({
      order,
      restaurant,
      prepStartGraceMinutes: settings.prepStartGraceMinutes,
      maxExtraMinutes: settings.preparationMaxExtraMinutes
    })
  }
}

async function clearRiderActiveTrackingForFinalOrder(order: {
  _id?: unknown
  id?: string
  riderId?: unknown
}) {
  const riderId = String(order.riderId ?? "").trim()
  const orderId = String(order._id ?? order.id ?? "").trim()

  if (!riderId || !orderId) {
    return
  }

  const nextPickedUpOrder = await OrderModel.findOne({
    riderId,
    status: "PickedUp",
    _id: { $ne: orderId }
  })
    .sort({ "timestamps.PickedUp": 1, createdAt: 1 })
    .select("_id")

  const updatedRider = await RiderModel.findByIdAndUpdate(
    riderId,
    {
      $set: {
        activeTrackingOrderId: nextPickedUpOrder?.id ?? ""
      }
    },
    { new: true }
  )

  if (updatedRider) {
    emitSocketEvent(`rider:${updatedRider.id}`, "rider.profile.updated", updatedRider.toObject())
  }
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function calculateDirectDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  const earthRadius = 6371
  const deltaLat = toRadians(latitudeB - latitudeA)
  const deltaLng = toRadians(longitudeB - longitudeA)
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function roundDistanceKm(distanceKm: number) {
  const rounded = Number(distanceKm.toFixed(2))
  return rounded < 0.1 ? 0 : rounded
}

function estimateCycleRouteDistanceKm(directDistanceKm: number) {
  if (directDistanceKm <= 0.1) return 0
  if (directDistanceKm < 1) return directDistanceKm * 1.12
  if (directDistanceKm < 3) return directDistanceKm * 1.18
  return directDistanceKm * 1.22
}

function clampCycleSpeedKmph(speedKmph: number) {
  return Math.min(22, Math.max(8, speedKmph))
}

function deriveCycleSpeedKmph(params: {
  previousLatitude?: number
  previousLongitude?: number
  previousUpdatedAt?: string | Date | null
  latitude: number
  longitude: number
  reportedSpeedKmph?: number
}) {
  if (typeof params.reportedSpeedKmph === "number" && Number.isFinite(params.reportedSpeedKmph)) {
    return clampCycleSpeedKmph(params.reportedSpeedKmph)
  }

  if (
    typeof params.previousLatitude !== "number" ||
    typeof params.previousLongitude !== "number" ||
    !params.previousUpdatedAt
  ) {
    return 14
  }

  const previousUpdatedAt = new Date(params.previousUpdatedAt).getTime()
  const now = Date.now()
  const elapsedHours = (now - previousUpdatedAt) / (1000 * 60 * 60)

  if (elapsedHours <= 0 || elapsedHours > 0.35) {
    return 14
  }

  const movedDistanceKm = calculateDirectDistanceKm(
    params.previousLatitude,
    params.previousLongitude,
    params.latitude,
    params.longitude
  )

  if (movedDistanceKm < 0.02) {
    return 12
  }

  return clampCycleSpeedKmph(movedDistanceKm / elapsedHours)
}

function estimateCycleTracking(params: {
  riderLatitude: number
  riderLongitude: number
  customerLatitude: number
  customerLongitude: number
  previousLatitude?: number
  previousLongitude?: number
  previousUpdatedAt?: string | Date | null
  reportedSpeedKmph?: number
}) {
  const directDistanceKm = calculateDirectDistanceKm(
    params.riderLatitude,
    params.riderLongitude,
    params.customerLatitude,
    params.customerLongitude
  )
  const routeDistanceKm = estimateCycleRouteDistanceKm(directDistanceKm)
  const speedKmph = deriveCycleSpeedKmph({
    previousLatitude: params.previousLatitude,
    previousLongitude: params.previousLongitude,
    previousUpdatedAt: params.previousUpdatedAt,
    latitude: params.riderLatitude,
    longitude: params.riderLongitude,
    reportedSpeedKmph: params.reportedSpeedKmph
  })
  const remainingDurationMinutes =
    routeDistanceKm <= 0 ? 0 : Math.max(1, Math.round((routeDistanceKm / speedKmph) * 60))

  return {
    directDistanceKm: roundDistanceKm(directDistanceKm),
    routeDistanceKm: roundDistanceKm(routeDistanceKm),
    remainingDurationMinutes,
    speedKmph: Number(speedKmph.toFixed(1)),
    isNearCustomer: directDistanceKm <= 0.2
  }
}

function getOrderActionTitle(nextStatus: string) {
  switch (nextStatus) {
    case "Accepted":
      return "Order accepted"
    case "Preparing":
      return "Order is being prepared"
    case "ReadyForPickup":
      return "Order is ready for pickup"
    case "PickedUp":
      return "Order picked up by rider"
    case "Delivered":
      return "Order delivered"
    case "Rejected":
      return "Order rejected"
    case "Cancelled":
      return "Order cancelled"
    default:
      return "Order updated"
  }
}

function getCustomerOrderStatusMessage(nextStatus: string) {
  switch (nextStatus) {
    case "Accepted":
      return {
        title: "✅ Order accepted",
        body: "Your order is confirmed. The kitchen will start soon."
      }
    case "Preparing":
      return {
        title: "🍳 Food is preparing",
        body: "Your food is being prepared now."
      }
    case "ReadyForPickup":
      return {
        title: "📦 Ready for pickup",
        body: "Your order is packed. A rider will pick it up soon."
      }
    case "PickedUp":
      return {
        title: "🛵 On the way",
        body: "Your rider picked up the order and is heading to you."
      }
    case "Delivered":
      return {
        title: "🎉 Delivered",
        body: "Your food has arrived. Tap to rate your order."
      }
    case "Rejected":
      return {
        title: "😕 Order not accepted",
        body: "The restaurant could not accept your order. Please try another restaurant."
      }
    case "Cancelled":
      return {
        title: "❌ Order cancelled",
        body: "Your order was cancelled. You can order again anytime."
      }
    default:
      return {
        title: "🔔 Order update",
        body: "There is a new update on your order."
      }
  }
}

async function getMaxActiveOrdersPerRider() {
  const content = await getPlatformContent()
  const value = content.operations?.dispatch?.maxActiveOrdersPerRider
  return typeof value === "number" && Number.isFinite(value) ? value : 3
}

async function safeSendCustomerOrderStatusPush(params: {
  customerId: string
  orderId: string
  orderNumber: string
  nextStatus: string
}) {
  const customerMessage = getCustomerOrderStatusMessage(params.nextStatus)

  try {
    await sendPushToCustomer({
      customerId: params.customerId,
      payload: {
        title: customerMessage.title,
        body: customerMessage.body,
        data: {
          type: "order_status",
          status: params.nextStatus,
          orderId: params.orderId,
          path: `/orders/${params.orderId}/tracking`
        }
      }
    })
  } catch {
    // Order state must remain successful even when external push delivery is unavailable.
  }
}

function applyOrderStatusTimestamp(
  timestamps: Record<string, unknown> | undefined,
  status: string,
  value: Date
) {
  const nextTimestamps = {
    ...(timestamps ?? {}),
    [status]: value
  } as Record<string, unknown>

  const normalizedField = orderTimestampFieldByStatus[status]
  if (normalizedField) {
    nextTimestamps[normalizedField] = value
  }

  return nextTimestamps
}

function buildOrderHistoryDateRangeMatch(
  params: { status?: string; tab?: "live" | "history" },
  range: OwnerDateRange
) {
  const statuses =
    params.status && historyStatuses.has(params.status)
      ? [params.status]
      : [...historyStatuses]
  const clauses = statuses.flatMap((status) => {
    const timestampField = orderTimestampFieldByStatus[status]
    return [
      { [`timestamps.${status}`]: { $gte: range.start, $lte: range.end } },
      ...(timestampField
        ? [{ [`timestamps.${timestampField}`]: { $gte: range.start, $lte: range.end } }]
        : [])
    ]
  })

  return clauses.length ? { $or: clauses } : null
}

function shouldUseHistoryDateRange(params: {
  tab?: "live" | "history"
  status?: string
  dateBasis?: string
}) {
  if (params.dateBasis === "history") return true
  if (params.dateBasis === "created") return false
  return params.tab === "history" || Boolean(params.status && historyStatuses.has(params.status))
}

export async function getOwnerRestaurantContext(ownerId: string) {
  const owner = await OwnerModel.findById(ownerId)

  if (!owner) {
    throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
  }

  if (!owner.activeRestaurantId || owner.restaurantLifecycleStatus !== "approved") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "RESTAURANT_NOT_READY",
      "Restaurant operational data is only available after approval"
    )
  }

  return {
    owner,
    restaurantId: owner.activeRestaurantId.toString()
  }
}

export async function createOwnerNotification(params: {
  ownerId: string
  restaurantId: string
  type: "order" | "payout" | "system" | "promotion" | "support" | "review"
  eventType: string
  entityType: string
  entityId: string
  title: string
  description: string
  actionPath: string
}) {
  const notification = await NotificationModel.create({
    ownerId: params.ownerId,
    restaurantId: params.restaurantId,
    type: params.type,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    title: params.title,
    description: params.description,
    actionPath: params.actionPath
  })

  emitSocketEvent(`owner:${params.ownerId}`, "notification.created", notification.toObject())

  return notification
}

export async function listCategories(ownerId: string) {
  return listCategoriesWithFilters({ ownerId })
}

export async function listCategoriesWithFilters(params: {
  ownerId: string
  search?: string
  status?: string
  sortBy?: string
  page?: number
  pageSize?: number
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const matchStage: Record<string, unknown> = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId)
  }

  if (params.status && params.status !== "all") {
    matchStage.status = params.status === "Hidden" ? "archived" : params.status
  }

  if (params.search) {
    matchStage.$or = [
      { name: { $regex: params.search, $options: "i" } },
      { slug: { $regex: params.search, $options: "i" } },
      { description: { $regex: params.search, $options: "i" } }
    ]
  }

  const sortStage: Record<string, 1 | -1> =
    params.sortBy === "nameAsc"
      ? { name: 1 }
      : params.sortBy === "nameDesc"
        ? { name: -1 }
        : params.sortBy === "newestUpdated"
          ? { updatedAt: -1 }
          : params.sortBy === "oldestCreated"
            ? { createdAt: 1 }
            : params.sortBy === "mostItems"
              ? { totalItems: -1, displayOrder: 1 }
              : { displayOrder: 1, createdAt: 1 }
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

  const [items, total] = await Promise.all([
    CategoryModel.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: "menuitems",
          let: { categoryId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$categoryId", "$$categoryId"] } } },
            { $count: "count" }
          ],
          as: "menuItemStats"
        }
      },
      {
        $addFields: {
          totalItems: {
            $ifNull: [{ $arrayElemAt: ["$menuItemStats.count", 0] }, 0]
          }
        }
      },
      { $sort: sortStage },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $project: { menuItemStats: 0 } }
    ]),
    CategoryModel.countDocuments(matchStage)
  ])

  return { items, total }
}

export async function createCategory(params: {
  ownerId: string
  name: string
  description?: string
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)

  const category = await CategoryModel.create({
    restaurantId,
    name: params.name,
    slug: slugify(params.name),
    description: params.description ?? ""
  })

  return category
}

export async function updateCategory(params: {
  ownerId: string
  categoryId: string
  name?: string
  description?: string
  status?: "active" | "archived"
  displayOrder?: number
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const category = await CategoryModel.findOne({ _id: params.categoryId, restaurantId })

  if (!category) {
    throw new AppError(StatusCodes.NOT_FOUND, "CATEGORY_NOT_FOUND", "Category not found")
  }

  if (params.name !== undefined) {
    category.name = params.name
    category.slug = slugify(params.name)
  }

  if (params.description !== undefined) {
    category.description = params.description
  }

  if (params.status !== undefined) {
    category.status = params.status
  }

  if (params.displayOrder !== undefined) {
    category.displayOrder = params.displayOrder
  }

  await category.save()
  return category
}

export async function archiveCategory(params: { ownerId: string; categoryId: string }) {
  return updateCategory({
    ownerId: params.ownerId,
    categoryId: params.categoryId,
    status: "archived"
  })
}

export async function deleteCategoryPermanently(params: {
  ownerId: string
  categoryId: string
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const category = await CategoryModel.findOne({ _id: params.categoryId, restaurantId })

  if (!category) {
    throw new AppError(StatusCodes.NOT_FOUND, "CATEGORY_NOT_FOUND", "Category not found")
  }

  await MenuItemModel.deleteMany({ restaurantId, categoryId: params.categoryId })
  await CategoryModel.deleteOne({ _id: params.categoryId, restaurantId })

  return { deleted: true }
}

export async function listMenuItems(ownerId: string) {
  return listMenuItemsWithFilters({ ownerId })
}

export async function listMenuItemsWithFilters(params: {
  ownerId: string
  search?: string
  status?: string
  availability?: "all" | "available" | "unavailable"
  categoryId?: string
  popularFilter?: string
  sortBy?: string
  page?: number
  pageSize?: number
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const query: Record<string, unknown> = { restaurantId, status: "active" }

  if (params.status && params.status !== "all") {
    query.status =
      params.status === "Hidden"
        ? "archived"
        : params.status === "Active"
          ? "active"
          : params.status
  }

  if (params.availability && params.availability !== "all") {
    query.availability = params.availability
  }

  if (params.categoryId && params.categoryId !== "all") {
    query.categoryId = params.categoryId
  }

  if (params.popularFilter === "popular") {
    query.isPopular = true
  } else if (params.popularFilter === "regular") {
    query.isPopular = false
  }

  if (params.search) {
    query.$or = [
      { name: { $regex: params.search, $options: "i" } },
      { slug: { $regex: params.search, $options: "i" } },
      { description: { $regex: params.search, $options: "i" } }
    ]
  }

  const sort: Record<string, SortOrder> =
    params.sortBy === "nameAsc"
      ? { name: 1 }
      : params.sortBy === "nameDesc"
        ? { name: -1 }
        : params.sortBy === "priceHigh"
          ? { basePrice: -1, updatedAt: -1 }
          : params.sortBy === "priceLow"
            ? { basePrice: 1, updatedAt: -1 }
            : { updatedAt: -1 }
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 20))
  const [items, total] = await Promise.all([
    MenuItemModel.find(query).sort(sort).skip((page - 1) * pageSize).limit(pageSize),
    MenuItemModel.countDocuments(query)
  ])

  return { items, total }
}

export async function createMenuItem(params: {
  ownerId: string
  categoryId: string
  name: string
  description?: string
  images?: Array<{ url?: string; publicId?: string }>
  status: "active" | "archived"
  availability: "available" | "unavailable"
  kind: "simple" | "variant"
  basePrice: number
  variants?: unknown[]
  addOnGroups?: unknown[]
  isPopular?: boolean
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const category = await CategoryModel.findOne({
    _id: params.categoryId,
    restaurantId,
    status: "active"
  })

  if (!category) {
    throw new AppError(StatusCodes.BAD_REQUEST, "INVALID_CATEGORY", "Category is not available")
  }

  const menuItem = await MenuItemModel.create({
    restaurantId,
    categoryId: params.categoryId,
    name: params.name,
    slug: slugify(params.name),
    description: params.description ?? "",
    images: params.images ?? [],
    status: params.status,
    availability: params.availability,
    kind: params.kind,
    basePrice: params.basePrice,
    variants: params.variants ?? [],
    addOnGroups: params.addOnGroups ?? [],
    isPopular: params.isPopular ?? false
  })

  emitSocketEvent(`owner:${params.ownerId}`, "menu.updated", menuItem.toObject())
  emitSocketEvent(`restaurant:${restaurantId}`, "menu.updated", menuItem.toObject())

  return menuItem
}

export async function updateMenuItem(params: {
  ownerId: string
  itemId: string
  categoryId?: string
  name?: string
  description?: string
  images?: Array<{ url?: string; publicId?: string }>
  status?: "active" | "archived"
  availability?: "available" | "unavailable"
  kind?: "simple" | "variant"
  basePrice?: number
  variants?: unknown[]
  addOnGroups?: unknown[]
  isPopular?: boolean
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const menuItem = await MenuItemModel.findOne({ _id: params.itemId, restaurantId })

  if (!menuItem) {
    throw new AppError(StatusCodes.NOT_FOUND, "MENU_ITEM_NOT_FOUND", "Menu item not found")
  }

  if (params.categoryId !== undefined) {
    const category = await CategoryModel.findOne({
      _id: params.categoryId,
      restaurantId,
      status: "active"
    })

    if (!category) {
      throw new AppError(StatusCodes.BAD_REQUEST, "INVALID_CATEGORY", "Category is not available")
    }

    menuItem.categoryId = category._id
  }

  if (params.name !== undefined) {
    menuItem.name = params.name
    menuItem.slug = slugify(params.name)
  }

  if (params.description !== undefined) menuItem.description = params.description
  if (params.images !== undefined) {
    menuItem.set("images", params.images)
  }
  if (params.status !== undefined) menuItem.status = params.status
  if (params.availability !== undefined) menuItem.availability = params.availability
  if (params.kind !== undefined) menuItem.kind = params.kind
  if (params.basePrice !== undefined) menuItem.basePrice = params.basePrice
  if (params.variants !== undefined) {
    menuItem.set("variants", params.variants)
  }
  if (params.addOnGroups !== undefined) {
    menuItem.set("addOnGroups", params.addOnGroups)
  }
  if (params.isPopular !== undefined) menuItem.isPopular = params.isPopular

  await menuItem.save()
  emitSocketEvent(`owner:${params.ownerId}`, "menu.updated", menuItem.toObject())
  emitSocketEvent(`restaurant:${restaurantId}`, "menu.updated", menuItem.toObject())
  return menuItem
}

export async function archiveMenuItem(params: { ownerId: string; itemId: string }) {
  return updateMenuItem({
    ownerId: params.ownerId,
    itemId: params.itemId,
    status: "archived"
  })
}

export async function deleteMenuItemPermanently(params: { ownerId: string; itemId: string }) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const menuItem = await MenuItemModel.findOne({ _id: params.itemId, restaurantId })

  if (!menuItem) {
    throw new AppError(StatusCodes.NOT_FOUND, "MENU_ITEM_NOT_FOUND", "Menu item not found")
  }

  await MenuItemModel.deleteOne({ _id: params.itemId, restaurantId })
  emitSocketEvent(`owner:${params.ownerId}`, "menu.updated", {
    itemId: params.itemId,
    deleted: true
  })
  emitSocketEvent(`restaurant:${restaurantId}`, "menu.updated", {
    itemId: params.itemId,
    deleted: true
  })

  return { deleted: true }
}

export async function listOrders(params: {
  ownerId: string
  tab?: "live" | "history"
  status?: string
  search?: string
  paymentMethod?: string
  sortBy?: string
  preset?: string
  from?: string
  to?: string
  dateBasis?: "created" | "history" | "activity"
  page?: number
  pageSize?: number
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const query: Record<string, unknown> = { restaurantId }
  const andClauses: Array<Record<string, unknown>> = []

  if (params.tab === "live") {
    query.status = { $in: [...liveStatuses] }
  }

  if (params.tab === "history") {
    query.status = { $in: [...historyStatuses] }
  }

  if (params.status) {
    query.status = params.status
  }

  if (params.paymentMethod) {
    query.paymentMethod = params.paymentMethod
  }

  if (params.search) {
    andClauses.push({
      $or: [
        { orderNumber: { $regex: params.search, $options: "i" } },
        { "customerSnapshot.fullName": { $regex: params.search, $options: "i" } },
        { "customerSnapshot.phone": { $regex: params.search, $options: "i" } },
      ],
    })
  }

  const range = buildDhakaPresetRange(params)

  if (range) {
    const createdRangeClause = { createdAt: { $gte: range.start, $lte: range.end } }
    const historyRangeClause = buildOrderHistoryDateRangeMatch(params, range)

    if (params.dateBasis === "activity") {
      andClauses.push({
        $or: [
          createdRangeClause,
          ...(historyRangeClause?.$or ?? [])
        ]
      })
    } else if (shouldUseHistoryDateRange(params) && historyRangeClause) {
      andClauses.push(historyRangeClause)
    } else {
      query.createdAt = createdRangeClause.createdAt
    }
  }

  if (andClauses.length > 0) {
    query.$and = andClauses
  }

  const sort: Record<string, SortOrder> =
    params.sortBy === "oldest"
      ? { createdAt: 1 }
      : params.sortBy === "highestValue"
        ? { "pricing.total": -1, createdAt: -1 }
        : { createdAt: -1 }
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 20))

  const [items, total, content, restaurant] = await Promise.all([
    OrderModel.find(query).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(),
    OrderModel.countDocuments(query),
    getPlatformContent(),
    RestaurantModel.findById(restaurantId).lean()
  ])
  const autoCancelSettings = getOwnerAutoCancelSettings(content as Record<string, any>)

  return {
    items: items.map((order) =>
      decorateOwnerOrderAutomation(order, autoCancelSettings, restaurant as Record<string, any> | null)
    ),
    total
  }
}

export async function getOrderById(params: { ownerId: string; orderId: string }) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const [order, content, restaurant] = await Promise.all([
    OrderModel.findOne({ _id: params.orderId, restaurantId }).lean(),
    getPlatformContent(),
    RestaurantModel.findById(restaurantId).lean()
  ])

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  return decorateOwnerOrderAutomation(
    order,
    getOwnerAutoCancelSettings(content as Record<string, any>),
    restaurant as Record<string, any> | null
  )
}

export async function listOwnerRidersForAssignment(ownerId: string) {
  await getOwnerRestaurantContext(ownerId)

  const riders = await RiderModel.find({
    status: "active"
  })
    .sort({ createdAt: -1 })
    .lean()

  const riderIds = riders.map((rider) => rider._id.toString())
  const activeCounts = riderIds.length
    ? await OrderModel.aggregate<{ _id: string; activeOrders: number }>([
        {
          $match: {
            riderId: { $in: riderIds },
            status: { $in: ["ReadyForPickup", "PickedUp"] }
          }
        },
        {
          $group: {
            _id: "$riderId",
            activeOrders: { $sum: 1 }
          }
        }
      ])
    : []

  const countMap = new Map(activeCounts.map((entry) => [entry._id, entry.activeOrders]))

  return riders.map((rider) => ({
    id: rider._id.toString(),
    fullName: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType ?? "cycle",
    isAvailableForAssignments: rider.isAvailableForAssignments ?? true,
    activeOrders: countMap.get(rider._id.toString()) ?? 0
  }))
}

export async function assignOwnerRiderToOrder(params: {
  ownerId: string
  orderId: string
  riderId: string
}) {
  const { restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const rider = await RiderModel.findById(params.riderId)

  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found")
  }

  if (rider.status !== "active") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_ACCOUNT_UNAVAILABLE",
      "This rider account is not active"
    )
  }

  if (!rider.isAvailableForAssignments) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_NOT_AVAILABLE",
      "This rider is currently unavailable for new assignments"
    )
  }

  const order = await OrderModel.findOne({ _id: params.orderId, restaurantId })

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (order.status !== "ReadyForPickup") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_ASSIGNABLE",
      "Only ready-for-pickup orders can be assigned to a rider"
    )
  }

  const previousRiderId = typeof order.riderId === "string" ? order.riderId : ""
  if (previousRiderId !== rider.id) {
    const [activeOrdersCount, maxActiveOrdersPerRider] = await Promise.all([
      OrderModel.countDocuments({
        _id: { $ne: order._id },
        riderId: rider.id,
        status: { $in: ["ReadyForPickup", "PickedUp"] }
      }),
      getMaxActiveOrdersPerRider()
    ])

    if (activeOrdersCount >= maxActiveOrdersPerRider) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "RIDER_CAPACITY_REACHED",
        `This rider already has ${activeOrdersCount} active orders. Choose another rider or increase the dispatch capacity.`
      )
    }
  }
  order.riderId = rider.id
  order.riderSnapshot = {
    ...(order.riderSnapshot ?? {}),
    name: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType
  }
  await order.save()

  if (previousRiderId && previousRiderId !== rider.id) {
    emitSocketEvent(`rider:${previousRiderId}`, "rider.assignment.updated", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      message: `Order ${order.orderNumber} has been reassigned to another rider.`,
      assignmentAction: "unassigned"
    })
    emitSocketEvent(`rider:${previousRiderId}`, "rider.order.updated", order.toObject())
    try {
      await sendPushToRider({
        riderId: previousRiderId,
        payload: {
          title: "Assignment updated",
          body: `Order ${order.orderNumber} has been reassigned to another rider.`,
          data: {
            type: "rider_assignment",
            orderId: order.id,
            path: "/(app)/available"
          }
        }
      })
    } catch {
      // Assignment is already saved; external push delivery should not fail it.
    }
  }

  emitSocketEvent(`owner:${params.ownerId}`, "order.updated", order.toObject())
  emitSocketEvent(`restaurant:${restaurantId}`, "order.updated", order.toObject())
  emitSocketEvent(`rider:${rider.id}`, "rider.assignment.updated", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    message: `A ready order has been assigned to you.`,
    assignmentAction: previousRiderId && previousRiderId !== rider.id ? "reassigned" : "assigned"
  })
  emitSocketEvent(`rider:${rider.id}`, "rider.order.updated", order.toObject())
  emitSocketEvent(`customer:${order.customerId}`, "customer.order.updated", order.toObject())
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.assignment",
    orderId: order.id,
    riderId: rider.id,
  })
  try {
    await sendPushToRider({
      riderId: rider.id,
      payload: {
        title: previousRiderId && previousRiderId !== rider.id ? "Order reassigned" : "New delivery assignment",
        body:
          previousRiderId && previousRiderId !== rider.id
            ? `${order.orderNumber} is now assigned to you.`
            : `${order.orderNumber} is ready for pickup and assigned to you.`,
        data: {
          type: "rider_assignment",
          orderId: order.id,
          path: `/orders/${order.id}`
        }
      }
    })
  } catch {
    // Assignment is already saved; external push delivery should not fail it.
  }
  try {
    await sendPushToCustomer({
      customerId: order.customerId,
      payload: {
        title: previousRiderId && previousRiderId !== rider.id ? "🛵 Rider updated" : "🛵 Rider assigned",
        body:
          previousRiderId && previousRiderId !== rider.id
            ? `${rider.fullName} will now deliver your order.`
            : `${rider.fullName} is assigned to deliver your order.`,
        data: {
          type: "rider_assigned",
          orderId: order.id,
          path: `/orders/${order.id}/tracking`
        }
      }
    })
  } catch {
    // Assignment is already saved; external push delivery should not fail it.
  }

  return order
}

export async function transitionOrder(params: {
  ownerId: string
  orderId: string
  nextStatus: "Accepted" | "Rejected" | "Preparing" | "ReadyForPickup" | "Cancelled"
  actor: "owner"
  note?: string
}) {
  const { owner, restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const currentOrder = await OrderModel.findOne({ _id: params.orderId, restaurantId }).lean()

  if (!currentOrder) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  const allowedNextStatuses = ownerOrderTransitions[currentOrder.status] ?? []

  if (!allowedNextStatuses.includes(params.nextStatus)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_ORDER_TRANSITION",
      `Order cannot move from ${currentOrder.status} to ${params.nextStatus}`
    )
  }

  const now = new Date()
  const restaurant =
    params.nextStatus === "Preparing"
      ? await RestaurantModel.findById(restaurantId).lean()
      : null
  const setPayload: Record<string, unknown> = {
    status: params.nextStatus,
    timestamps: applyOrderStatusTimestamp(
      currentOrder.timestamps as Record<string, unknown> | undefined,
      params.nextStatus,
      now
    )
  }

  if (params.nextStatus === "Preparing") {
    const content = await getPlatformContent()
    const settings = getOwnerAutoCancelSettings(content)
    setPayload.preparationMeta = buildPreparationMetaForStart({
      order: currentOrder,
      restaurant: restaurant as Record<string, any> | null,
      startedAt: now,
      autoStarted: false,
      maxExtraMinutes: settings.preparationMaxExtraMinutes
    })
  }

  if (params.nextStatus === "Rejected") {
    setPayload.rejectionReason = params.note ?? ""
    setPayload.terminalReason = "owner_rejected"

    if (currentOrder.paymentMethod === "Bkash" && currentOrder.paymentStatus === "paid") {
      setPayload.paymentStatus = "refund_pending"
      setPayload["paymentSnapshot.refundStatus"] = "pending"
      setPayload["paymentSnapshot.refundRequestedAt"] = now
    }
  }

  if (params.nextStatus === "Cancelled") {
    setPayload.cancelledBy = "owner"
    setPayload.terminalReason = params.note ?? "owner_cancelled"
    setPayload["riderTracking.isActive"] = false
    setPayload["riderTracking.completedAt"] = now
    setPayload["riderTracking.endedAt"] = now

    if (currentOrder.paymentMethod === "Bkash" && currentOrder.paymentStatus === "paid") {
      setPayload.paymentStatus = "refund_pending"
      setPayload["paymentSnapshot.refundStatus"] = "pending"
      setPayload["paymentSnapshot.refundRequestedAt"] = now
    }
  }

  const order = await OrderModel.findOneAndUpdate(
    { _id: currentOrder._id, restaurantId, status: currentOrder.status },
    {
      $set: setPayload,
      $push: {
        history: {
          $each: [
            {
              status: params.nextStatus,
              actor: params.actor,
              note: params.note ?? "",
              createdAt: now
            }
          ],
          $slice: -MAX_ORDER_HISTORY_ENTRIES
        }
      }
    },
    { new: true }
  )

  if (!order) {
    const latestOrder = await OrderModel.findById(params.orderId).lean()
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_STATUS_CHANGED",
      `Order status is already ${latestOrder?.status ?? "updated"}`
    )
  }

  if (params.nextStatus === "Rejected" || params.nextStatus === "Cancelled") {
    await Promise.all([
      syncOrderLedgerForFinalStatus({
        restaurantId,
        orderId: order.id,
        nextStatus: params.nextStatus,
        finalizedAt: now
      }),
      VoucherRedemptionModel.updateMany(
        { orderId: order._id, releasedAt: null },
        {
          $set: {
            releasedAt: now,
            releaseReason:
              params.nextStatus === "Rejected" ? "owner_rejected" : "owner_cancelled"
          }
        }
      )
    ])
  }

  const orderObject = order.toObject()
  emitSocketEvent(`owner:${owner.id}`, "order.updated", orderObject)
  emitSocketEvent(`restaurant:${restaurantId}`, "order.updated", orderObject)
  emitSocketEvent(`customer:${order.customerId}`, "customer.order.updated", orderObject)
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "order.transition",
    orderId: order.id,
    status: order.status,
  })

  await safeSendCustomerOrderStatusPush({
    customerId: order.customerId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    nextStatus: params.nextStatus
  })

  if (params.nextStatus === "ReadyForPickup") {
    void runAutoDispatchForReadyOrders().catch(() => undefined)
  }

  return order
}

export async function extendOrderPreparation(params: {
  ownerId: string
  orderId: string
  minutes: 5 | 10
}) {
  const { owner, restaurantId } = await getOwnerRestaurantContext(params.ownerId)
  const [currentOrder, restaurant, content] = await Promise.all([
    OrderModel.findOne({ _id: params.orderId, restaurantId }).lean(),
    RestaurantModel.findById(restaurantId).lean(),
    getPlatformContent()
  ])

  if (!currentOrder) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (currentOrder.status !== "Preparing") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PREPARATION_EXTENSION_NOT_ALLOWED",
      "Extra preparation time can only be added while food is being prepared"
    )
  }

  const currentExtraMinutes =
    typeof currentOrder.preparationMeta?.extraMinutes === "number"
      ? currentOrder.preparationMeta.extraMinutes
      : 0
  const settings = getOwnerAutoCancelSettings(content)
  const remainingExtraMinutes = Math.max(
    0,
    settings.preparationMaxExtraMinutes - currentExtraMinutes
  )

  if (remainingExtraMinutes <= 0 || params.minutes > remainingExtraMinutes) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PREPARATION_EXTENSION_LIMIT_REACHED",
      `Only ${remainingExtraMinutes} minutes can be added to this order`
    )
  }

  const now = new Date()
  const preparationMeta = buildPreparationMetaForExtension({
    order: currentOrder,
    restaurant: restaurant as Record<string, any> | null,
    minutesToAdd: params.minutes,
    extendedAt: now,
    maxExtraMinutes: settings.preparationMaxExtraMinutes
  })

  const updatedOrder = await OrderModel.findOneAndUpdate(
    { _id: currentOrder._id, restaurantId, status: "Preparing" },
    {
      $set: {
        preparationMeta
      },
      $push: {
        history: {
          $each: [
            {
              status: "Preparing",
              actor: "owner",
              note: `Owner added ${params.minutes} minutes to preparation time.`,
              createdAt: now
            }
          ],
          $slice: -MAX_ORDER_HISTORY_ENTRIES
        }
      }
    },
    { new: true }
  )

  if (!updatedOrder) {
    const latestOrder = await OrderModel.findById(params.orderId).lean()
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_STATUS_CHANGED",
      `Order status is already ${latestOrder?.status ?? "updated"}`
    )
  }

  const orderObject = updatedOrder.toObject()
  emitSocketEvent(`owner:${owner.id}`, "order.updated", orderObject)
  emitSocketEvent(`restaurant:${restaurantId}`, "order.updated", orderObject)
  emitSocketEvent(`customer:${updatedOrder.customerId}`, "customer.order.updated", orderObject)
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "order.preparation_extended",
    orderId: updatedOrder.id,
    status: updatedOrder.status
  })

  return decorateOwnerOrderAutomation(
    orderObject,
    getOwnerAutoCancelSettings(content as Record<string, any>),
    restaurant as Record<string, any> | null
  )
}

export async function transitionOrderBySystem(params: {
  orderId: string
  nextStatus: "PickedUp" | "Delivered" | "Cancelled"
  actor: "rider" | "system" | "admin"
  note?: string
}) {
  const order = await OrderModel.findById(params.orderId)

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  const allowedNextStatuses = systemOrderTransitions[order.status] ?? []

  if (!allowedNextStatuses.includes(params.nextStatus)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_ORDER_TRANSITION",
      `Order cannot move from ${order.status} to ${params.nextStatus}`
    )
  }

  const now = new Date()
  const setPayload: Record<string, unknown> = {
    status: params.nextStatus,
    timestamps: applyOrderStatusTimestamp(order.timestamps, params.nextStatus, now)
  }
  if (params.nextStatus === "Cancelled") {
    setPayload.cancelledBy = params.actor
    setPayload.terminalReason = params.note ?? "system_cancelled"

    if (order.paymentMethod === "Bkash" && order.paymentStatus === "paid") {
      setPayload.paymentStatus = "refund_pending"
      setPayload["paymentSnapshot.refundStatus"] = "pending"
      setPayload["paymentSnapshot.refundRequestedAt"] = now
    }
  }

  if (params.nextStatus === "Delivered") {
    setPayload.terminalReason = "delivered"
  }

  if (params.nextStatus === "PickedUp") {
    setPayload.riderTracking = {
      ...(order.get("riderTracking") ?? {}),
      isActive: true,
      startedAt: new Date(),
      lastUpdatedAt: new Date()
    }
  }

  if (params.nextStatus === "Delivered" || params.nextStatus === "Cancelled") {
    setPayload.riderTracking = {
      ...(order.get("riderTracking") ?? {}),
      isActive: false,
      completedAt: new Date(),
      lastUpdatedAt: new Date(),
      endedAt: new Date(),
      disconnectedAt: new Date()
    }
  }

  const updatedOrder = await OrderModel.findOneAndUpdate(
    { _id: order._id, status: order.status },
    {
      $set: setPayload,
      $push: {
        history: {
          $each: [
            {
              status: params.nextStatus,
              actor: params.actor,
              note: params.note ?? "",
              createdAt: now
            }
          ],
          $slice: -MAX_ORDER_HISTORY_ENTRIES
        }
      }
    },
    { new: true }
  )

  if (!updatedOrder) {
    const latestOrder = await OrderModel.findById(params.orderId).lean()
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_STATUS_CHANGED",
      `Order status is already ${latestOrder?.status ?? "updated"}`
    )
  }

  if (params.nextStatus === "Delivered" || params.nextStatus === "Cancelled") {
    await Promise.all([
      syncOrderLedgerForFinalStatus({
        restaurantId: updatedOrder.restaurantId.toString(),
        orderId: updatedOrder.id,
        nextStatus: params.nextStatus,
        finalizedAt: now
      }),
      params.nextStatus === "Cancelled"
        ? VoucherRedemptionModel.updateMany(
            { orderId: updatedOrder._id, releasedAt: null },
            {
              $set: {
                releasedAt: now,
                releaseReason: params.note ?? "system_cancelled"
              }
            }
          )
        : Promise.resolve()
    ])

    await clearRiderActiveTrackingForFinalOrder(updatedOrder)
  }

  if (params.nextStatus === "Delivered") {
    await grantReferralRewardForDeliveredOrder({ orderId: updatedOrder.id }).catch(() => undefined)
  }

  const restaurantOwner = await OwnerModel.findOne({ activeRestaurantId: updatedOrder.restaurantId })

  if (restaurantOwner) {
    try {
      await createOwnerNotification({
        ownerId: restaurantOwner.id,
        restaurantId: updatedOrder.restaurantId.toString(),
        type: "order",
        eventType: "order.updated",
        entityType: "order",
        entityId: updatedOrder.id,
        title: getOrderActionTitle(params.nextStatus),
        description: `Order ${updatedOrder.orderNumber} is now ${params.nextStatus}.`,
        actionPath: `/orders?order=${updatedOrder.id}`
      })
    } catch {
      // The order transition already succeeded; notification persistence is best-effort.
    }

    emitSocketEvent(`owner:${restaurantOwner.id}`, "order.updated", updatedOrder.toObject())
  }

  emitSocketEvent(`restaurant:${updatedOrder.restaurantId.toString()}`, "order.updated", updatedOrder.toObject())
  emitSocketEvent(`customer:${updatedOrder.customerId}`, "customer.order.updated", updatedOrder.toObject())
  if (updatedOrder.riderId) {
    emitSocketEvent(`rider:${updatedOrder.riderId}`, "rider.order.updated", updatedOrder.toObject())
  }
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "order.transition",
    orderId: updatedOrder.id,
    status: updatedOrder.status,
  })
  await safeSendCustomerOrderStatusPush({
    customerId: updatedOrder.customerId,
    orderId: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    nextStatus: params.nextStatus
  })

  return updatedOrder
}

export async function updateOrderRiderLocation(params: {
  orderId: string
  actor: "rider" | "admin" | "system"
  latitude: number
  longitude: number
  heading?: number
  accuracyMeters?: number
  speedKmph?: number
  riderName?: string
  riderPhone?: string
}) {
  const order = await OrderModel.findById(params.orderId)

  if (!order) {
    throw new AppError(StatusCodes.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found")
  }

  if (order.status !== "PickedUp") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_TRACKING_NOT_ACTIVE",
      "Rider tracking can only update after pickup"
    )
  }

  const deliveryAddress = order.customerSnapshot?.deliveryAddress
  if (
    typeof deliveryAddress?.latitude !== "number" ||
    typeof deliveryAddress?.longitude !== "number"
  ) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "DELIVERY_LOCATION_NOT_AVAILABLE",
      "Customer delivery coordinates are required for live tracking"
    )
  }

  const currentTracking =
    (order.get("riderTracking") as {
      isFocused?: boolean
      currentLocation?: {
        latitude?: number
        longitude?: number
      }
      lastUpdatedAt?: string | Date | null
      nearCustomerNotifiedAt?: string | Date | null
      history?: Array<Record<string, unknown>>
    } | null) ?? {}

  const trackingEstimate = estimateCycleTracking({
    riderLatitude: params.latitude,
    riderLongitude: params.longitude,
    customerLatitude: deliveryAddress.latitude,
    customerLongitude: deliveryAddress.longitude,
    previousLatitude: currentTracking.currentLocation?.latitude,
    previousLongitude: currentTracking.currentLocation?.longitude,
    previousUpdatedAt: currentTracking.lastUpdatedAt,
    reportedSpeedKmph: params.speedKmph
  })

  const trackingSnapshot = {
    isActive: true,
    isFocused: Boolean(currentTracking.isFocused),
    startedAt: currentTracking.lastUpdatedAt ?? order.timestamps?.PickedUp ?? order.createdAt,
    lastUpdatedAt: new Date(),
    currentLocation: {
      latitude: params.latitude,
      longitude: params.longitude,
      heading: params.heading ?? null,
      accuracyMeters: params.accuracyMeters ?? null
    },
    remainingDistanceKm: trackingEstimate.routeDistanceKm,
    directDistanceKm: trackingEstimate.directDistanceKm,
    remainingDurationMinutes: trackingEstimate.remainingDurationMinutes,
    speedKmph: trackingEstimate.speedKmph,
    isNearCustomer: trackingEstimate.isNearCustomer,
    nearCustomerNotifiedAt:
      currentTracking.nearCustomerNotifiedAt ?? (trackingEstimate.isNearCustomer ? new Date() : null),
    history: [
      ...((currentTracking.history ?? []) as Array<Record<string, unknown>>),
      {
        latitude: params.latitude,
        longitude: params.longitude,
        heading: params.heading ?? null,
        accuracyMeters: params.accuracyMeters ?? null,
        speedKmph: trackingEstimate.speedKmph,
        createdAt: new Date()
      }
    ].slice(-12)
  }

  if (params.riderName || params.riderPhone) {
    order.riderSnapshot = {
      ...(order.riderSnapshot ?? {}),
      name: params.riderName ?? order.riderSnapshot?.name ?? "",
      phone: params.riderPhone ?? order.riderSnapshot?.phone ?? "",
      vehicleType: "cycle"
    }
  }

  order.set("riderTracking", trackingSnapshot)
  await order.save()

  const restaurantOwner = await OwnerModel.findOne({ activeRestaurantId: order.restaurantId })

  if (restaurantOwner) {
    emitSocketEvent(`owner:${restaurantOwner.id}`, "order.updated", order.toObject())
  }
  emitSocketEvent(`restaurant:${order.restaurantId.toString()}`, "order.updated", order.toObject())
  emitSocketEvent(`customer:${order.customerId}`, "customer.order.updated", order.toObject())
  if (order.riderId) {
    emitSocketEvent(`rider:${order.riderId}`, "rider.order.updated", order.toObject())
  }
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.location",
    orderId: order.id,
    status: order.status,
  })

  if (trackingEstimate.isNearCustomer && !currentTracking.nearCustomerNotifiedAt) {
    try {
      await sendPushToCustomer({
        customerId: order.customerId,
        payload: {
          title: "📍 Rider is nearby",
          body: "Your rider is almost there. Please be ready to receive your order.",
          data: {
            type: "rider_near",
            orderId: order.id,
            path: `/orders/${order.id}/tracking`
          }
        }
      })
    } catch {
      // Location updates should continue even if push delivery is temporarily unavailable.
    }
  }

  return order
}

export async function listNotifications(ownerId: string) {
  return listNotificationsWithFilters({ ownerId })
}

export async function listNotificationsWithFilters(params: {
  ownerId: string
  filter?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const query: Record<string, unknown> = { ownerId: params.ownerId }

  if (params.filter === "unread") {
    query.isRead = false
  } else if (
    params.filter &&
    ["order", "payout", "system", "promotion", "support", "review"].includes(params.filter)
  ) {
    query.type = params.filter
  }

  if (params.search) {
    query.$or = [
      { title: { $regex: params.search, $options: "i" } },
      { description: { $regex: params.search, $options: "i" } },
      { eventType: { $regex: params.search, $options: "i" } }
    ]
  }

  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

  const [items, total, unreadCount] = await Promise.all([
    NotificationModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    NotificationModel.countDocuments(query),
    NotificationModel.countDocuments({ ownerId: params.ownerId, isRead: false })
  ])

  return { items, total, unreadCount }
}

export async function markNotificationAsRead(params: { ownerId: string; notificationId: string }) {
  const existingNotification = await NotificationModel.findOne({
    _id: params.notificationId,
    ownerId: params.ownerId
  })

  if (!existingNotification) {
    throw new AppError(StatusCodes.NOT_FOUND, "NOTIFICATION_NOT_FOUND", "Notification not found")
  }

  if (existingNotification.isRead) {
    return existingNotification
  }

  existingNotification.isRead = true
  existingNotification.readAt = new Date()
  await existingNotification.save()

  return existingNotification
}

export async function markAllNotificationsAsRead(ownerId: string) {
  await NotificationModel.updateMany(
    { ownerId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  )

  return { updated: true }
}
