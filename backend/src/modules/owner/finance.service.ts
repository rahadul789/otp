import { StatusCodes } from "http-status-codes"
import mongoose, { type PipelineStage, type SortOrder } from "mongoose"

import { AppError } from "../../common/utils/app-error"
import { createAdminOperationalAlert } from "../admin/admin-alert.service"
import { OwnerModel, PayoutMethodModel, RestaurantModel } from "../auth/auth.model"
import { createOtpSession, getOtpSessionTiming } from "../auth/auth.service"
import { getOperationalFinanceSettings } from "../public/content.service"
import {
  buildRelatedOrderPayoutEligibilityMatch,
  isRestaurantPayoutEligibleOrder
} from "./finance-rules"
import { LedgerEntryModel, PayoutBatchModel } from "./finance.model"
import { OrderModel } from "./operational.model"
import {
  buildDhakaPresetRange,
  buildDhakaTodayRange,
  buildPreviousRange,
  type OwnerDateRange
} from "./date-ranges"

type DashboardPreset =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "last90Days"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "lifetime"
  | "custom"

const walletLedgerEntryTypes = ["earning", "refund", "adjustment"] as const
const payoutResidualSourceTypes = ["payout_residual", "payout_residual_reversal"] as const
const ledgerFreshnessTtlMs = 15 * 60_000
const ledgerFreshnessByRestaurant = new Map<
  string,
  { checkedAt: number; promise?: Promise<void> }
>()

function toObjectId(value: string) {
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value
}

function normalizeAggregateMatch(match: Record<string, unknown>) {
  if (typeof match.restaurantId !== "string") {
    return match
  }

  return {
    ...match,
    restaurantId: toObjectId(match.restaurantId)
  }
}

function getSettlementAvailableAt(deliveredAt: Date, settlementDelayDays: number) {
  return new Date(
    deliveredAt.getTime() + settlementDelayDays * 24 * 60 * 60 * 1000
  )
}

function getOrderDeliveredAt(order: {
  timestamps?: Record<string, unknown>
  updatedAt?: Date | string | null
}) {
  const timestamp =
    order.timestamps?.deliveredAt ?? order.timestamps?.Delivered ?? order.updatedAt
  const deliveredAt = timestamp ? new Date(timestamp as Date | string) : new Date()
  return Number.isNaN(deliveredAt.getTime()) ? new Date() : deliveredAt
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeCommissionRate(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return 15
  return Math.min(100, Math.max(0, value))
}

function resolveCommissionRateForDate(restaurant: Record<string, any>, date: Date) {
  const currentRate = normalizeCommissionRate(restaurant.commercial?.commissionRate)
  const history = Array.isArray(restaurant.commercial?.commissionHistory)
    ? [...restaurant.commercial.commissionHistory]
        .map((entry) => ({
          previousRate:
            typeof entry.previousRate === "number"
              ? normalizeCommissionRate(entry.previousRate)
              : null,
          rate: normalizeCommissionRate(entry.rate),
          createdAt: entry.createdAt ? new Date(entry.createdAt) : null
        }))
        .filter((entry) => entry.createdAt && !Number.isNaN(entry.createdAt.getTime()))
        .sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime())
    : []

  if (!history.length) return currentRate

  let rate = history[0]?.previousRate ?? history[0]?.rate ?? currentRate
  for (const entry of history) {
    if (entry.createdAt!.getTime() <= date.getTime()) {
      rate = entry.rate
    }
  }

  return rate
}

function getOrderDiscountAmount(order: Record<string, any>) {
  return numberValue(
    order.pricing?.discountAmount,
    numberValue(order.pricing?.discount)
  )
}

function getOrderOwnerDiscountCost(order: Record<string, any>) {
  return numberValue(order.pricing?.ownerDiscountCost, getOrderDiscountAmount(order))
}

function getOrderPlatformDiscountCost(order: Record<string, any>) {
  return numberValue(order.pricing?.platformDiscountCost)
}

function getOrderSubtotalForOwner(order: Record<string, any>) {
  if (typeof order.pricing?.subtotal === "number" && Number.isFinite(order.pricing.subtotal)) {
    return Math.max(0, order.pricing.subtotal)
  }

  const total = numberValue(order.pricing?.total)
  const deliveryFee = numberValue(order.pricing?.deliveryFee)
  return Math.max(0, total - deliveryFee)
}

function getOrderNetEarnings(order: Record<string, any>, restaurant: Record<string, any>) {
  const deliveredAt = getOrderDeliveredAt(order)
  const grossAmount = getOrderSubtotalForOwner(order)
  const commissionRate = resolveCommissionRateForDate(restaurant, deliveredAt)
  const commission = Math.round(grossAmount * (commissionRate / 100))
  const discountCost = getOrderOwnerDiscountCost(order)

  return {
    grossAmount,
    commission,
    discountCost,
    platformDiscountCost: getOrderPlatformDiscountCost(order),
    deliveryCost: numberValue(order.pricing?.deliveryFee),
    netAmount: grossAmount - commission - discountCost
  }
}

function summarizeDeliveredOrdersForOwner(
  orders: Array<Record<string, any>>,
  restaurant: Record<string, any>
) {
  return orders.reduce(
    (summary, order) => {
      const values = getOrderNetEarnings(order, restaurant)
      summary.gross += values.grossAmount
      summary.net += values.netAmount
      summary.commission += values.commission
      summary.discountCost += values.discountCost
      summary.deliveryCost += values.deliveryCost
      summary.platformDiscountCost += values.platformDiscountCost
      return summary
    },
    {
      gross: 0,
      net: 0,
      commission: 0,
      discountCost: 0,
      deliveryCost: 0,
      platformDiscountCost: 0,
      available: 0,
      pending: 0,
      paidOutBalance: 0
    }
  )
}

function dateTimeValue(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value as Date | string)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

async function ensureRestaurantEarningLedgerEntries(
  restaurantId: string,
  settlementDelayDays: number
) {
  const restaurantObjectId = toObjectId(restaurantId)
  const restaurant = await RestaurantModel.findById(restaurantObjectId).lean()
  if (!restaurant) return

  const deliveredOrders = await OrderModel.find({
    restaurantId: restaurantObjectId,
    status: "Delivered"
  })
    .select({
      pricing: 1,
      timestamps: 1,
      updatedAt: 1,
      paymentMethod: 1,
      paymentStatus: 1
    })
    .lean()
  const deliveredOrderIds = deliveredOrders.map((order) => order._id)
  const existingLedgerEntries = deliveredOrderIds.length
    ? await LedgerEntryModel.find({
        restaurantId: restaurantObjectId,
        orderId: { $in: deliveredOrderIds },
        entryType: "earning"
      })
    : []
  const ledgerByOrderId = new Map(
    existingLedgerEntries.map((entry) => [String(entry.orderId), entry])
  )
  const now = new Date()

  for (const order of deliveredOrders) {
    const deliveredAt = getOrderDeliveredAt(order)
    const isEligible = isRestaurantPayoutEligibleOrder(order)
    const availableAt = isEligible
      ? getSettlementAvailableAt(deliveredAt, settlementDelayDays)
      : null
    const settlementStatus = isEligible
      ? availableAt && availableAt <= now
        ? "available"
        : "pending"
      : "pending"
    const grossAmount = numberValue(order.pricing?.subtotal)
    const commissionRate = resolveCommissionRateForDate(restaurant, deliveredAt)
    const discountCost = getOrderOwnerDiscountCost(order)
    const platformDiscountCost = getOrderPlatformDiscountCost(order)
    const commissionBase = grossAmount
    const commission = Math.round(commissionBase * (commissionRate / 100))
    const deliveryCost = numberValue(order.pricing?.deliveryFee)
    const netAmount = grossAmount - commission - discountCost
    const existingLedger = ledgerByOrderId.get(String(order._id))

    if (!existingLedger) {
      await LedgerEntryModel.create({
        restaurantId: restaurantObjectId,
        orderId: order._id,
        sourceEntityType: "order",
        sourceEntityId: String(order._id),
        entryType: "earning",
        grossAmount,
        commissionBase,
        commission,
        discountCost,
        platformDiscountCost,
        deliveryCost,
        netAmount,
        settlementStatus,
        availableAt
      })
      continue
    }

    if (existingLedger.settlementStatus === "paid_out") {
      continue
    }

    const hasChanges =
      numberValue(existingLedger.grossAmount) !== grossAmount ||
      numberValue(existingLedger.commissionBase, grossAmount) !== commissionBase ||
      numberValue(existingLedger.commission) !== commission ||
      numberValue(existingLedger.discountCost) !== discountCost ||
      numberValue(existingLedger.platformDiscountCost) !== platformDiscountCost ||
      numberValue(existingLedger.deliveryCost) !== deliveryCost ||
      numberValue(existingLedger.netAmount) !== netAmount ||
      existingLedger.settlementStatus !== settlementStatus ||
      dateTimeValue(existingLedger.availableAt) !== dateTimeValue(availableAt)

    if (hasChanges) {
      existingLedger.grossAmount = grossAmount
      existingLedger.commissionBase = commissionBase
      existingLedger.commission = commission
      existingLedger.discountCost = discountCost
      existingLedger.platformDiscountCost = platformDiscountCost
      existingLedger.deliveryCost = deliveryCost
      existingLedger.netAmount = netAmount
      existingLedger.settlementStatus = settlementStatus
      existingLedger.availableAt = availableAt
      await existingLedger.save()
    }
  }

  await LedgerEntryModel.updateMany(
    {
      restaurantId: restaurantObjectId,
      entryType: "earning",
      settlementStatus: { $ne: "paid_out" },
      orderId: { $nin: deliveredOrderIds }
    },
    {
      $set: {
        settlementStatus: "pending",
        availableAt: null
      }
    }
  )
}

async function ensureRestaurantLedgerFresh(
  restaurantId: string,
  settlementDelayDays: number,
  options: { force?: boolean } = {}
) {
  const cacheKey = String(restaurantId)
  const cached = ledgerFreshnessByRestaurant.get(cacheKey)
  const now = Date.now()

  if (!options.force && cached?.promise) {
    return cached.promise
  }

  if (
    !options.force &&
    cached &&
    now - cached.checkedAt < ledgerFreshnessTtlMs
  ) {
    return
  }

  const promise = (async () => {
    await ensureRestaurantEarningLedgerEntries(restaurantId, settlementDelayDays)
    await reconcileRestaurantLedgerStatuses(restaurantId, settlementDelayDays)
  })()

  ledgerFreshnessByRestaurant.set(cacheKey, {
    checkedAt: cached?.checkedAt ?? 0,
    promise
  })

  try {
    await promise
    ledgerFreshnessByRestaurant.set(cacheKey, {
      checkedAt: Date.now()
    })
  } catch (error) {
    ledgerFreshnessByRestaurant.delete(cacheKey)
    throw error
  }
}

async function promoteMatureLedgerEntries(restaurantId: string) {
  await LedgerEntryModel.updateMany(
    {
      restaurantId: toObjectId(restaurantId),
      entryType: { $in: [...walletLedgerEntryTypes] },
      settlementStatus: "pending",
      availableAt: { $lte: new Date() }
    },
    {
      $set: {
        settlementStatus: "available"
      }
    }
  )
}

function buildDeliveredRangeClause(range: OwnerDateRange) {
  return {
    $or: [
      { "timestamps.Delivered": { $gte: range.start, $lte: range.end } },
      { "timestamps.deliveredAt": { $gte: range.start, $lte: range.end } }
    ]
  }
}

function buildCancelledRangeClause(range: OwnerDateRange) {
  return {
    $or: [
      { "timestamps.Cancelled": { $gte: range.start, $lte: range.end } },
      { "timestamps.cancelledAt": { $gte: range.start, $lte: range.end } }
    ]
  }
}

function buildRejectedRangeClause(range: OwnerDateRange) {
  return {
    $or: [
      { "timestamps.Rejected": { $gte: range.start, $lte: range.end } },
      { "timestamps.rejectedAt": { $gte: range.start, $lte: range.end } }
    ]
  }
}

function getDashboardRange(params?: {
  preset?: DashboardPreset
  from?: string
  to?: string
}) {
  if (params?.preset === "lifetime") {
    return { start: new Date(0), end: buildDhakaTodayRange().end }
  }

  return buildDhakaPresetRange(params ?? { preset: "today" }) ?? buildDhakaTodayRange()
}

async function getOwnerFinanceContext(ownerId: string) {
  const owner = await OwnerModel.findById(ownerId)

  if (!owner) {
    throw new AppError(StatusCodes.NOT_FOUND, "OWNER_NOT_FOUND", "Owner not found")
  }

  if (!owner.activeRestaurantId || owner.restaurantLifecycleStatus !== "approved") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "RESTAURANT_NOT_READY",
      "Financial data is only available after restaurant approval"
    )
  }

  const restaurant = await RestaurantModel.findById(owner.activeRestaurantId)

  if (!restaurant) {
    throw new AppError(StatusCodes.NOT_FOUND, "RESTAURANT_NOT_FOUND", "Restaurant not found")
  }

  return {
    owner,
    restaurant,
    restaurantId: restaurant.id
  }
}

export async function getLedgerSummary(restaurantId: string) {
  const financeSettings = await getOperationalFinanceSettings()
  await promoteMatureLedgerEntries(restaurantId)
  const [
    pendingAggregate,
    availableAggregate,
    paidOutAggregate,
    requestedPayoutAggregate,
    activePayoutRequest,
    lifetimeAggregate,
    nextSettlementAggregate
  ] = await Promise.all([
    aggregateLedgerEntries({
      restaurantId,
      entryType: { $in: [...walletLedgerEntryTypes] },
      settlementStatus: "pending"
    }, [{ $group: { _id: null, total: { $sum: "$netAmount" } } }]),
    aggregateLedgerEntries({
      restaurantId,
      entryType: { $in: [...walletLedgerEntryTypes] },
      settlementStatus: "available"
    }, [{ $group: { _id: null, total: { $sum: "$netAmount" } } }]),
    PayoutBatchModel.aggregate([
      { $match: { restaurantId: toObjectId(restaurantId), status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]),
    PayoutBatchModel.aggregate([
      { $match: { restaurantId: toObjectId(restaurantId), status: { $in: ["pending", "processing"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]),
    PayoutBatchModel.exists({
      restaurantId: toObjectId(restaurantId),
      status: { $in: ["pending", "processing"] }
    }),
    aggregateLedgerEntries(
      {
        restaurantId,
        entryType: { $in: [...walletLedgerEntryTypes] },
        sourceEntityType: { $nin: [...payoutResidualSourceTypes] }
      },
      [
        {
          $group: {
            _id: null,
            grossAmount: { $sum: { $ifNull: ["$grossAmount", 0] } },
            netAmount: { $sum: { $ifNull: ["$netAmount", 0] } },
            commission: { $sum: { $ifNull: ["$commission", 0] } },
            discountCost: { $sum: { $ifNull: ["$discountCost", 0] } },
            deliveryCost: { $sum: { $ifNull: ["$deliveryCost", 0] } }
          }
        }
      ]
    ),
    aggregateLedgerEntries(
      {
        restaurantId,
        entryType: { $in: [...walletLedgerEntryTypes] },
        settlementStatus: "pending",
        availableAt: { $ne: null }
      },
      [
        {
          $group: {
            _id: null,
            earliestAvailableAt: { $min: "$availableAt" }
          }
        }
      ]
    )
  ])

  const lifetimeTotals = lifetimeAggregate[0]
  const nextSettlement = nextSettlementAggregate[0]?.earliestAvailableAt ?? null

  return {
    pendingBalance: pendingAggregate[0]?.total ?? 0,
    availableBalance: availableAggregate[0]?.total ?? 0,
    paidOutBalance: paidOutAggregate[0]?.total ?? 0,
    requestedPayoutBalance: requestedPayoutAggregate[0]?.total ?? 0,
    lifetimeGrossAmount: lifetimeTotals?.grossAmount ?? 0,
    lifetimeNetEarnings: lifetimeTotals?.netAmount ?? 0,
    lifetimeCommission: lifetimeTotals?.commission ?? 0,
    lifetimeDiscountCost: lifetimeTotals?.discountCost ?? 0,
    lifetimeDeliveryCost: lifetimeTotals?.deliveryCost ?? 0,
    nextSettlementAvailableAt: nextSettlement?.toISOString?.() ?? null,
    settlementDelayDays: financeSettings.settlementDelayDays,
    minimumPayoutAmountTaka: financeSettings.minimumPayoutAmountTaka,
    oneActivePayoutRequest: financeSettings.oneActivePayoutRequest,
    hasActivePayoutRequest: Boolean(activePayoutRequest)
  }
}

export async function reconcileRestaurantLedgerStatuses(
  restaurantId: string,
  settlementDelayDays?: number
) {
  const delayDays =
    settlementDelayDays ?? (await getOperationalFinanceSettings()).settlementDelayDays
  const now = new Date()
  const settlementEntries = await LedgerEntryModel.find({
    restaurantId: toObjectId(restaurantId),
    entryType: { $in: [...walletLedgerEntryTypes] },
    settlementStatus: { $in: ["pending", "available"] },
    orderId: { $ne: null }
  }).select({ orderId: 1, settlementStatus: 1, availableAt: 1 })

  const orderIds = settlementEntries
    .map((entry) => entry.orderId)
    .filter(Boolean)

  if (orderIds.length) {
    const orders = await OrderModel.find({ _id: { $in: orderIds } })
      .select({ status: 1, paymentMethod: 1, paymentStatus: 1, timestamps: 1, updatedAt: 1 })
      .lean()
    const orderById = new Map(orders.map((order) => [String(order._id), order]))
    const updates = settlementEntries.flatMap((entry) => {
      const order = orderById.get(String(entry.orderId))
      const isPayoutEligibleOrder = isRestaurantPayoutEligibleOrder(order)
      const nextAvailableAt = isPayoutEligibleOrder && order
        ? getSettlementAvailableAt(getOrderDeliveredAt(order), delayDays)
        : null
      const nextSettlementStatus: "pending" | "available" = isPayoutEligibleOrder
        ? nextAvailableAt && nextAvailableAt <= now
          ? "available"
          : "pending"
        : "pending"
      const currentAvailableAt = entry.availableAt
        ? new Date(entry.availableAt).getTime()
        : null
      const nextAvailableTime = nextAvailableAt?.getTime() ?? null

      if (
        entry.settlementStatus === nextSettlementStatus &&
        currentAvailableAt === nextAvailableTime
      ) {
        return []
      }

      return [
        {
          updateOne: {
            filter: { _id: entry._id },
            update: {
              $set: {
                settlementStatus: nextSettlementStatus,
                availableAt: nextAvailableAt
              }
            }
          }
        }
      ]
    })

    if (updates.length) {
      await LedgerEntryModel.bulkWrite(updates)
    }
  }

  await LedgerEntryModel.updateMany(
    {
      restaurantId: toObjectId(restaurantId),
      entryType: { $in: [...walletLedgerEntryTypes] },
      settlementStatus: "pending",
      availableAt: { $lte: now }
    },
    {
      $set: {
        settlementStatus: "available"
      }
    }
  )
}

export async function syncOrderLedgerForFinalStatus(params: {
  restaurantId: string
  orderId: string
  nextStatus: "Delivered" | "Cancelled" | "Rejected"
  finalizedAt?: Date
}) {
  const ledgerEntry = await LedgerEntryModel.findOne({
    restaurantId: params.restaurantId,
    orderId: params.orderId,
    entryType: "earning"
  })

  if (!ledgerEntry) {
    return null
  }

  if (params.nextStatus === "Delivered") {
    const financeSettings = await getOperationalFinanceSettings()
    const deliveredAt = params.finalizedAt ?? new Date()
    ledgerEntry.settlementStatus =
      getSettlementAvailableAt(deliveredAt, financeSettings.settlementDelayDays) <= new Date()
        ? "available"
        : "pending"
    ledgerEntry.availableAt = getSettlementAvailableAt(
      deliveredAt,
      financeSettings.settlementDelayDays
    )
    await ledgerEntry.save()
    return ledgerEntry
  }

  ledgerEntry.settlementStatus = "pending"
  ledgerEntry.availableAt = null
  await ledgerEntry.save()
  return ledgerEntry
}

function buildFinalizedLedgerPipeline(
  match: Record<string, unknown>,
  extraStages: PipelineStage[] = []
): PipelineStage[] {
  return [
    { $match: normalizeAggregateMatch(match) },
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "_id",
        as: "orderDocs"
      }
    },
    {
      $addFields: {
        relatedOrderStatus: {
          $let: {
            vars: {
              relatedOrder: { $arrayElemAt: ["$orderDocs", 0] }
            },
            in: "$$relatedOrder.status"
          }
        },
        relatedOrderDeliveredAt: {
          $let: {
            vars: {
              relatedOrder: { $arrayElemAt: ["$orderDocs", 0] }
            },
            in: {
              $ifNull: ["$$relatedOrder.timestamps.deliveredAt", "$$relatedOrder.timestamps.Delivered"]
            }
          }
        },
        relatedOrderPaymentStatus: {
          $let: {
            vars: {
              relatedOrder: { $arrayElemAt: ["$orderDocs", 0] }
            },
            in: "$$relatedOrder.paymentStatus"
          }
        },
        relatedOrderPaymentMethod: {
          $let: {
            vars: {
              relatedOrder: { $arrayElemAt: ["$orderDocs", 0] }
            },
            in: "$$relatedOrder.paymentMethod"
          }
        },
        orderIdString: {
          $cond: [{ $ifNull: ["$orderId", false] }, { $toString: "$orderId" }, ""]
        },
        payoutBatchIdString: {
          $cond: [{ $ifNull: ["$payoutBatchId", false] }, { $toString: "$payoutBatchId" }, ""]
        },
        effectiveAt: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$entryType", "payout"] },
                then: "$createdAt"
              },
              {
                case: { $ifNull: ["$relatedOrderDeliveredAt", false] },
                then: "$relatedOrderDeliveredAt"
              }
            ],
            default: "$createdAt"
          }
        }
      }
    },
    {
      $match: {
        $or: [
          { entryType: "payout" },
          { orderId: null },
          buildRelatedOrderPayoutEligibilityMatch()
        ]
      }
    },
    ...extraStages
  ]
}

export async function aggregateFinalizedLedgerEntries(
  match: Record<string, unknown>,
  extraStages: PipelineStage[] = []
) {
  return LedgerEntryModel.aggregate(buildFinalizedLedgerPipeline(match, extraStages))
}

function aggregateLedgerEntries(
  match: Record<string, unknown>,
  extraStages: PipelineStage[] = []
) {
  return LedgerEntryModel.aggregate([
    { $match: normalizeAggregateMatch(match) },
    ...extraStages
  ])
}

function getListRange(params?: {
  preset?: string
  from?: string
  to?: string
}) {
  return buildDhakaPresetRange(params ?? {})
}

export async function getPayoutSummary(ownerId: string) {
  const { restaurantId } = await getOwnerFinanceContext(ownerId)
  const [ledgerSummary, latestBatch, payoutMethod] = await Promise.all([
    getLedgerSummary(restaurantId),
    PayoutBatchModel.findOne({ restaurantId }).sort({ createdAt: -1 }),
    PayoutMethodModel.findOne({ restaurantId })
  ])

  return {
    ...ledgerSummary,
    lastPayout: latestBatch,
    payoutMethod
  }
}

export async function listPayoutHistory(ownerId: string) {
  return listPayoutHistoryWithFilters({ ownerId })
}

export async function listPayoutTransactions(ownerId: string) {
  return listPayoutTransactionsWithFilters({ ownerId })
}

export async function listPayoutHistoryWithFilters(params: {
  ownerId: string
  search?: string
  status?: string
  sortBy?: string
  preset?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}) {
  const { restaurantId } = await getOwnerFinanceContext(params.ownerId)
  const query: Record<string, unknown> = { restaurantId }
  const range = getListRange(params)

  if (params.status && params.status !== "all") query.status = params.status
  if (range) {
    query.createdAt = { $gte: range.start, $lte: range.end }
  }
  if (params.search) {
    query.$or = [
      { batchReference: { $regex: params.search, $options: "i" } },
      { failureReason: { $regex: params.search, $options: "i" } }
    ]
  }

  const sort: Record<string, SortOrder> =
    params.sortBy === "oldest"
      ? { createdAt: 1 }
      : params.sortBy === "highestNet"
        ? { amount: -1, createdAt: -1 }
        : { createdAt: -1 }
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 20))

  const [items, total] = await Promise.all([
    PayoutBatchModel.find(query).sort(sort).skip((page - 1) * pageSize).limit(pageSize),
    PayoutBatchModel.countDocuments(query)
  ])

  return { items, total }
}

export async function listPayoutTransactionsWithFilters(params: {
  ownerId: string
  search?: string
  type?: string
  sortBy?: string
  preset?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}) {
  const { restaurantId } = await getOwnerFinanceContext(params.ownerId)
  await promoteMatureLedgerEntries(restaurantId)
  const range = getListRange(params)

  const query: Record<string, unknown> = { restaurantId }
  if (params.type && params.type !== "all") query.entryType = params.type

  const sort: Record<string, 1 | -1> =
    params.sortBy === "oldest"
      ? { effectiveAt: 1, createdAt: 1 }
      : params.sortBy === "highestNet"
        ? { netAmount: -1, effectiveAt: -1, createdAt: -1 }
        : { effectiveAt: -1, createdAt: -1 }
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 20))
  const searchRegex = params.search ? new RegExp(params.search, "i") : null
  const searchStage = searchRegex
    ? [{
        $match: {
          $or: [
            { orderIdString: { $regex: searchRegex } },
            { payoutBatchIdString: { $regex: searchRegex } }
          ]
        }
      }]
    : []
  const rangeStage = range
    ? [{ $match: { effectiveAt: { $gte: range.start, $lte: range.end } } }]
    : []

  const [result] = await aggregateFinalizedLedgerEntries(query, [
    ...searchStage,
    ...rangeStage,
    { $sort: sort },
    {
      $facet: {
        items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        meta: [{ $count: "total" }]
      }
    }
  ])

  return {
    items: result?.items ?? [],
    total: result?.meta?.[0]?.total ?? 0
  }
}

export async function updatePayoutMethod(params: {
  ownerId: string
  type: "bkash" | "bank"
  accountName: string
  accountNumber: string
  bankName?: string
  branchName?: string
}) {
  const { owner, restaurantId } = await getOwnerFinanceContext(params.ownerId)

  if (params.type === "bkash") {
    const isSameAsOwnerPhone = params.accountNumber === owner.phone

    const payoutMethod = await PayoutMethodModel.findOneAndUpdate(
      { restaurantId },
      {
        restaurantId,
        type: params.type,
        accountName: params.accountName,
        accountNumber: isSameAsOwnerPhone ? params.accountNumber : "",
        bankName: "",
        branchName: "",
        isVerified: isSameAsOwnerPhone,
        pendingAccountNumber: isSameAsOwnerPhone ? null : params.accountNumber,
        verificationSource: isSameAsOwnerPhone ? "owner_phone" : null,
        verifiedAt: isSameAsOwnerPhone ? new Date() : null
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    if (!isSameAsOwnerPhone) {
      const otpSession = await createOtpSession({
        ownerId: owner.id,
        phone: params.accountNumber,
        purpose: "owner_payout_verify",
        referenceId: payoutMethod.id
      })

      return {
        payoutMethod,
        verificationSessionId: otpSession.id,
        ...getOtpSessionTiming(otpSession)
      }
    }

    return {
      payoutMethod,
      verificationSessionId: null
    }
  }

  const payoutMethod = await PayoutMethodModel.findOneAndUpdate(
    { restaurantId },
    {
      restaurantId,
      type: params.type,
      accountName: params.accountName,
      accountNumber: params.accountNumber,
      bankName: params.bankName ?? "",
      branchName: params.branchName ?? "",
      isVerified: true,
      pendingAccountNumber: null,
      verificationSource: "manual_bank",
      verifiedAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  return {
    payoutMethod,
    verificationSessionId: null
  }
}

export async function requestPayout(params: {
  ownerId: string
  amount: number
}) {
  const { restaurantId } = await getOwnerFinanceContext(params.ownerId)
  const financeSettings = await getOperationalFinanceSettings()
  await ensureRestaurantLedgerFresh(
    restaurantId,
    financeSettings.settlementDelayDays,
    { force: true }
  )
  const payoutMethod = await PayoutMethodModel.findOne({ restaurantId })

  if (!payoutMethod) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PAYOUT_METHOD_REQUIRED",
      "Configure a payout method before requesting payout"
    )
  }

  if (!payoutMethod.isVerified) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PAYOUT_METHOD_NOT_VERIFIED",
      "Verify the payout method before requesting payout"
    )
  }

  if (params.amount <= 0 || !Number.isInteger(params.amount)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_PAYOUT_AMOUNT",
      "Requested amount must be a whole number greater than zero"
    )
  }

  if (params.amount < financeSettings.minimumPayoutAmountTaka) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PAYOUT_MINIMUM_AMOUNT_REQUIRED",
      `Minimum payout request is ${financeSettings.minimumPayoutAmountTaka}tk`
    )
  }

  if (financeSettings.oneActivePayoutRequest) {
    const activePayout = await PayoutBatchModel.exists({
      restaurantId: toObjectId(restaurantId),
      status: { $in: ["pending", "processing"] }
    })

    if (activePayout) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "ACTIVE_PAYOUT_REQUEST_EXISTS",
        "A payout request is already pending or processing"
      )
    }
  }

  const session = await mongoose.startSession()
  let payoutBatch: mongoose.Document | null = null

  try {
    await session.withTransaction(async () => {
      await reconcileRestaurantLedgerStatuses(
        restaurantId,
        financeSettings.settlementDelayDays
      )

      const selectableEntries = await LedgerEntryModel.aggregate(
        buildFinalizedLedgerPipeline(
          {
            restaurantId,
            entryType: { $in: [...walletLedgerEntryTypes] },
            settlementStatus: "available",
            netAmount: { $gt: 0 }
          },
          [
            { $sort: { availableAt: 1, createdAt: 1 } },
            { $project: { _id: 1, netAmount: 1 } }
          ]
        )
      ).session(session)

      const selectedEntryIds: mongoose.Types.ObjectId[] = []
      let selectedTotal = 0

      for (const entry of selectableEntries) {
        if (selectedTotal >= params.amount) break
        selectedEntryIds.push(entry._id)
        selectedTotal += Number(entry.netAmount ?? 0)
      }

      if (selectedTotal < params.amount || selectedEntryIds.length === 0) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "INVALID_PAYOUT_AMOUNT",
          "Requested amount exceeds available balance"
        )
      }

      const [createdBatch] = await PayoutBatchModel.create(
        [
          {
            restaurantId,
            methodId: payoutMethod._id,
            amount: params.amount,
            status: "pending",
            provider: payoutMethod.type === "bkash" ? "bkash" : "bank",
            batchReference: `PO-${Date.now()}`,
            requestedAt: new Date()
          }
        ],
        { session }
      )
      payoutBatch = createdBatch

      const reserveResult = await LedgerEntryModel.updateMany(
        {
          _id: { $in: selectedEntryIds },
          restaurantId,
          settlementStatus: "available"
        },
        {
          $set: {
            settlementStatus: "paid_out",
            payoutBatchId: createdBatch._id
          }
        },
        { session }
      )

      if (reserveResult.modifiedCount !== selectedEntryIds.length) {
        throw new AppError(
          StatusCodes.CONFLICT,
          "PAYOUT_BALANCE_CHANGED",
          "Available balance changed. Please try again"
        )
      }

      await LedgerEntryModel.create(
        [
          {
            restaurantId,
            payoutBatchId: createdBatch._id,
            sourceEntityType: "payout_batch",
            sourceEntityId: createdBatch.id,
            entryType: "payout",
            netAmount: -params.amount,
            settlementStatus: "pending",
            availableAt: new Date()
          }
        ],
        { session }
      )

      const residualAmount = Number((selectedTotal - params.amount).toFixed(2))
      if (residualAmount > 0) {
        await LedgerEntryModel.create(
          [
            {
              restaurantId,
              payoutBatchId: createdBatch._id,
              sourceEntityType: "payout_residual",
              sourceEntityId: createdBatch.id,
              entryType: "adjustment",
              netAmount: residualAmount,
              settlementStatus: "available",
              availableAt: new Date()
            }
          ],
          { session }
        )
      }
    })
  } finally {
    await session.endSession()
  }

  if (!payoutBatch) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "PAYOUT_REQUEST_FAILED",
      "Payout request could not be created"
    )
  }

  try {
    const restaurant = await RestaurantModel.findById(restaurantId)
      .select({ name: 1 })
      .lean()
    const payoutId = String(
      (payoutBatch as { _id?: unknown; id?: unknown })._id ??
        (payoutBatch as { id?: unknown }).id ??
        ""
    )
    await createAdminOperationalAlert({
      alertType: "payout_request",
      severity: "info",
      title: "Payout request submitted",
      description: `${restaurant?.name ?? "Restaurant"} requested ${params.amount.toLocaleString("en-US")}tk payout.`,
      source: "Payouts",
      entityType: "payout",
      entityId: payoutId,
      path: `/restaurants?restaurantId=${restaurantId}`,
      iconKey: "credit-card",
      dedupeKey: `payout:${payoutId}:request`,
      metadata: {
        payoutId,
        restaurantId,
        restaurantName: restaurant?.name ?? "",
        amount: params.amount,
        provider: payoutMethod.type === "bkash" ? "bkash" : "bank",
      },
    })
  } catch {
    // Payout is already committed; admin alert is best-effort.
  }

  return payoutBatch
}

type AnalyticsOverviewParams = {
  ownerId: string
  preset?: DashboardPreset
  from?: string
  to?: string
  paymentMethod?: "Cash" | "Bkash"
  orderType?: "delivery" | "pickup"
  categoryId?: string
}

type AnalyticsCustomerRow = {
  name: string
  orders: number
  revenue: number
}

type AnalyticsMenuRow = {
  name: string
  categoryName: string
  quantitySold: number
  revenue: number
}

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const dhakaDateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Dhaka"
})

function formatHourLabel(hour: number) {
  const normalizedHour = ((hour % 24) + 24) % 24
  const suffix = normalizedHour >= 12 ? "PM" : "AM"
  const hour12 = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12
  return `${hour12} ${suffix}`
}

function formatDailySeriesLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00+06:00`)
  return Number.isNaN(date.getTime())
    ? dateKey
    : dhakaDateLabelFormatter.format(date)
}

function buildAnalyticsOrderFilter(params: AnalyticsOverviewParams, restaurantId: string) {
  const clauses: Record<string, unknown>[] = [{ restaurantId: toObjectId(restaurantId) }]

  if (params.paymentMethod) {
    clauses.push({ paymentMethod: params.paymentMethod })
  }

  if (params.categoryId && params.categoryId !== "all") {
    clauses.push({ "itemsSnapshot.categoryId": params.categoryId })
  }

  if (params.orderType === "delivery") {
    clauses.push({
      riderId: { $exists: true, $nin: ["", null] }
    })
  } else if (params.orderType === "pickup") {
    clauses.push({
      $or: [
        { riderId: { $exists: false } },
        { riderId: null },
        { riderId: "" }
      ]
    })
  }

  return clauses.length === 1 ? clauses[0] : { $and: clauses }
}

function buildCreatedAtMatch(range: OwnerDateRange) {
  return {
    createdAt: { $gte: range.start, $lte: range.end }
  }
}

function buildDeliveredAtMatch(range: OwnerDateRange) {
  return {
    $or: [
      { "timestamps.Delivered": { $gte: range.start, $lte: range.end } },
      { "timestamps.deliveredAt": { $gte: range.start, $lte: range.end } }
    ]
  }
}

function combineMatchClauses(...clauses: Record<string, unknown>[]) {
  return clauses.length === 1 ? clauses[0] : { $and: clauses }
}

function mapCountRows(rows: Array<{ _id: string; count: number }>) {
  return rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[String(row._id)] = Number(row.count ?? 0)
    return accumulator
  }, {})
}

function mapNumberRows(rows: Array<{ _id: number; count: number }>, size: number) {
  const values = Array.from({ length: size }, () => 0)
  rows.forEach((row) => {
    const index = Number(row._id)
    if (Number.isInteger(index) && index >= 0 && index < size) {
      values[index] = Number(row.count ?? 0)
    }
  })
  return values
}

export async function getAnalyticsOverview(params: AnalyticsOverviewParams) {
  const { restaurant, restaurantId } = await getOwnerFinanceContext(params.ownerId)

  const currentRange = getDashboardRange(params)
  const previousRange = buildPreviousRange(currentRange)
  const baseMatch = buildAnalyticsOrderFilter(params, restaurantId)
  const currentPlacedMatch = combineMatchClauses(
    baseMatch,
    buildCreatedAtMatch(currentRange)
  )
  const previousPlacedMatch = combineMatchClauses(
    baseMatch,
    buildCreatedAtMatch(previousRange)
  )
  const currentDeliveredMatch = combineMatchClauses(
    baseMatch,
    { status: "Delivered" },
    buildDeliveredAtMatch(currentRange)
  )
  const previousDeliveredMatch = combineMatchClauses(
    baseMatch,
    { status: "Delivered" },
    buildDeliveredAtMatch(previousRange)
  )

  const [
    placedFacet,
    previousPlacedFacet,
    deliveredFacet,
    previousDeliveredFacet,
    deliveredOrdersForNet,
    previousDeliveredOrdersForNet,
    payoutAggregate
  ] = await Promise.all([
    OrderModel.aggregate([
      { $match: currentPlacedMatch },
      {
        $facet: {
          total: [{ $count: "count" }],
          status: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          weekday: [
            {
              $group: {
                _id: {
                  $subtract: [
                    { $isoDayOfWeek: { date: "$createdAt", timezone: "Asia/Dhaka" } },
                    1
                  ]
                },
                count: { $sum: 1 }
              }
            }
          ],
          hour: [
            {
              $group: {
                _id: { $hour: { date: "$createdAt", timezone: "Asia/Dhaka" } },
                count: { $sum: 1 }
              }
            }
          ],
          dailySeries: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "Asia/Dhaka"
                  }
                },
                orders: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ]
        }
      }
    ]),
    OrderModel.aggregate([
      { $match: previousPlacedMatch },
      { $count: "count" }
    ]),
    OrderModel.aggregate([
      { $match: currentDeliveredMatch },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
                discountedOrdersCount: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          {
                            $ifNull: [
                              "$pricing.discountAmount",
                              { $ifNull: ["$pricing.discount", 0] }
                            ]
                          },
                          0
                        ]
                      },
                      1,
                      0
                    ]
                  }
                },
                discountedRevenue: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          {
                            $ifNull: [
                              "$pricing.discountAmount",
                              { $ifNull: ["$pricing.discount", 0] }
                            ]
                          },
                          0
                        ]
                      },
                      { $ifNull: ["$pricing.total", 0] },
                      0
                    ]
                  }
                },
                discountGiven: {
                  $sum: {
                    $ifNull: [
                      "$pricing.discountAmount",
                      { $ifNull: ["$pricing.discount", 0] }
                    ]
                  }
                }
              }
            }
          ],
          customers: [
            {
              $group: {
                _id: "$customerSnapshot.phone",
                name: { $first: "$customerSnapshot.fullName" },
                orders: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$pricing.total", 0] } }
              }
            },
            { $match: { _id: { $nin: ["", null] } } },
            { $sort: { revenue: -1 } }
          ],
          menu: [
            { $unwind: "$itemsSnapshot" },
            {
              $group: {
                _id: {
                  itemId: "$itemsSnapshot.itemId",
                  name: { $ifNull: ["$itemsSnapshot.name", "$itemsSnapshot.itemName"] },
                  categoryName: "$itemsSnapshot.categoryName"
                },
                quantitySold: { $sum: { $ifNull: ["$itemsSnapshot.quantity", 0] } },
                revenue: {
                  $sum: {
                    $ifNull: [
                      "$itemsSnapshot.lineTotal",
                      {
                        $multiply: [
                          { $ifNull: ["$itemsSnapshot.quantity", 0] },
                          { $ifNull: ["$itemsSnapshot.unitPrice", 0] }
                        ]
                      }
                    ]
                  }
                }
              }
            },
            { $sort: { revenue: -1 } }
          ]
        }
      }
    ]),
    OrderModel.aggregate([
      { $match: previousDeliveredMatch },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$pricing.total", 0] } }
              }
            }
          ],
          customers: [
            {
              $group: {
                _id: "$customerSnapshot.phone",
                name: { $first: "$customerSnapshot.fullName" },
                orders: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$pricing.total", 0] } }
              }
            },
            { $match: { _id: { $nin: ["", null] } } }
          ]
        }
      }
    ]),
    OrderModel.find(currentDeliveredMatch)
      .select({ pricing: 1, timestamps: 1, updatedAt: 1 })
      .lean(),
    OrderModel.find(previousDeliveredMatch)
      .select({ pricing: 1, timestamps: 1, updatedAt: 1 })
      .lean(),
    PayoutBatchModel.aggregate([
      {
        $match: {
          restaurantId: toObjectId(restaurantId),
          status: "completed",
          createdAt: { $gte: currentRange.start, $lte: currentRange.end }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ])
  ])

  const placed = placedFacet[0] ?? {}
  const delivered = deliveredFacet[0] ?? {}
  const previousDelivered = previousDeliveredFacet[0] ?? {}
  const deliveredTotals = delivered.totals?.[0] ?? {}
  const previousDeliveredTotals = previousDelivered.totals?.[0] ?? {}
  const customerRows: AnalyticsCustomerRow[] = ((delivered.customers ?? []) as any[]).map((row) => ({
    name: row.name || "Customer",
    orders: Number(row.orders ?? 0),
    revenue: Number(row.revenue ?? 0)
  }))
  const previousCustomerRows: AnalyticsCustomerRow[] = ((previousDelivered.customers ?? []) as any[]).map((row) => ({
    name: row.name || "Customer",
    orders: Number(row.orders ?? 0),
    revenue: Number(row.revenue ?? 0)
  }))
  const repeatCustomers = customerRows.filter((customer) => customer.orders > 1).length
  const previousRepeatCustomers = previousCustomerRows.filter(
    (customer) => customer.orders > 1
  ).length
  const menuRows: AnalyticsMenuRow[] = ((delivered.menu ?? []) as any[]).map((row) => ({
    name: row._id?.name || "Item",
    categoryName: row._id?.categoryName || "Unassigned",
    quantitySold: Number(row.quantitySold ?? 0),
    revenue: Number(row.revenue ?? 0)
  }))
  const weekdayCounts = mapNumberRows(placed.weekday ?? [], 7)
  const hourCounts = mapNumberRows(placed.hour ?? [], 24)
  const ledgerTotals = summarizeDeliveredOrdersForOwner(
    deliveredOrdersForNet as Array<Record<string, any>>,
    restaurant
  )
  const previousLedgerTotals = summarizeDeliveredOrdersForOwner(
    previousDeliveredOrdersForNet as Array<Record<string, any>>,
    restaurant
  )

  return {
    filter: {
      current: {
        from: currentRange.start.toISOString(),
        to: currentRange.end.toISOString()
      },
      previous: {
        from: previousRange.start.toISOString(),
        to: previousRange.end.toISOString()
      }
    },
    metrics: {
      totalOrders: Number(placed.total?.[0]?.count ?? 0),
      previousTotalOrders: Number(previousPlacedFacet[0]?.count ?? 0),
      deliveredRevenue: Number(deliveredTotals.revenue ?? 0),
      previousDeliveredRevenue: Number(previousDeliveredTotals.revenue ?? 0),
      netEarnings: ledgerTotals.net,
      previousNetEarnings: previousLedgerTotals.net,
      deliveredCount: Number(deliveredTotals.count ?? 0),
      previousDeliveredCount: Number(previousDeliveredTotals.count ?? 0),
      averageOrderValue:
        Number(deliveredTotals.count ?? 0) > 0
          ? Number(deliveredTotals.revenue ?? 0) / Number(deliveredTotals.count ?? 0)
          : 0,
      previousAverageOrderValue:
        Number(previousDeliveredTotals.count ?? 0) > 0
          ? Number(previousDeliveredTotals.revenue ?? 0) /
            Number(previousDeliveredTotals.count ?? 0)
          : 0,
      uniqueCustomers: customerRows.length,
      previousUniqueCustomers: previousCustomerRows.length,
      repeatCustomers,
      previousRepeatCustomers,
      discountedOrdersCount: Number(deliveredTotals.discountedOrdersCount ?? 0),
      discountedRevenue: Number(deliveredTotals.discountedRevenue ?? 0),
      discountGiven: Number(deliveredTotals.discountGiven ?? 0)
    },
    statusCounts: mapCountRows(placed.status ?? []),
    weekdayOrders: weekdayLabels.map((label, index) => ({
      label,
      orders: weekdayCounts[index] ?? 0
    })),
    peakHours: hourCounts
      .map((orders, hour) => ({ label: formatHourLabel(hour), orders }))
      .filter((entry) => entry.orders > 0)
      .sort((left, right) => right.orders - left.orders),
    orderSeries: (placed.dailySeries ?? []).map((row: any) => ({
      date: String(row._id),
      label: formatDailySeriesLabel(String(row._id)),
      orders: Number(row.orders ?? 0)
    })),
    customerInsights: {
      unique: customerRows.length,
      repeat: repeatCustomers,
      repeatRate: customerRows.length > 0 ? (repeatCustomers / customerRows.length) * 100 : 0,
      rows: customerRows.slice(0, 5),
      donut: [
        {
          name: "New",
          value: Math.max(customerRows.length - repeatCustomers, 0),
          color: "#60a5fa"
        },
        { name: "Repeat", value: repeatCustomers, color: "#10b981" }
      ]
    },
    menuPerformance: {
      rows: menuRows,
      lowPerformers: [...menuRows]
        .sort((left, right) => left.quantitySold - right.quantitySold)
        .slice(0, 3),
      categories: Array.from(
        menuRows
          .reduce<Map<string, { name: string; revenue: number }>>((accumulator, row) => {
            const existing = accumulator.get(row.categoryName)
            accumulator.set(row.categoryName, {
              name: row.categoryName,
              revenue: (existing?.revenue ?? 0) + row.revenue
            })
            return accumulator
          }, new Map())
          .values()
      ).sort((left, right) => right.revenue - left.revenue)
    },
    payoutInsights: {
      ...ledgerTotals,
      totalPayouts: Number(payoutAggregate[0]?.total ?? 0),
      lifetimeEarnings: ledgerTotals.net,
      availableSoon: ledgerTotals.pending
    }
  }
}

export async function getDashboardSummary(params: {
  ownerId: string
  preset?: DashboardPreset
  from?: string
  to?: string
}) {
  const { restaurant, restaurantId } = await getOwnerFinanceContext(params.ownerId)
  const range = getDashboardRange(params)
  const previousRange = buildPreviousRange(range)

  const [
    filteredOrders,
    deliveredOrdersInRange,
    previousOrders,
    previousDeliveredOrders,
    cancelledOrdersInRange,
    previousCancelledOrdersInRange,
    rejectedOrdersInRange,
    previousRejectedOrdersInRange,
    activeOrders,
    previousActiveOrders,
    latestPayout
  ] = await Promise.all([
    OrderModel.find({
      restaurantId,
      createdAt: { $gte: range.start, $lte: range.end }
    })
      .select({ status: 1, pricing: 1, customerSnapshot: 1, createdAt: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      status: "Delivered",
      ...buildDeliveredRangeClause(range)
    })
      .select({ status: 1, pricing: 1, timestamps: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      createdAt: { $gte: previousRange.start, $lte: previousRange.end }
    })
      .select({ status: 1, pricing: 1, createdAt: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      status: "Delivered",
      ...buildDeliveredRangeClause(previousRange)
    })
      .select({ status: 1, pricing: 1, timestamps: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      status: "Cancelled",
      ...buildCancelledRangeClause(range)
    })
      .select({ status: 1, pricing: 1, timestamps: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      status: "Cancelled",
      ...buildCancelledRangeClause(previousRange)
    })
      .select({ status: 1, pricing: 1, timestamps: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      status: "Rejected",
      ...buildRejectedRangeClause(range)
    })
      .select({ status: 1, pricing: 1, timestamps: 1 })
      .lean(),
    OrderModel.find({
      restaurantId,
      status: "Rejected",
      ...buildRejectedRangeClause(previousRange)
    })
      .select({ status: 1, pricing: 1, timestamps: 1 })
      .lean(),
    OrderModel.countDocuments({
      restaurantId,
      status: { $in: ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"] }
    }),
    OrderModel.countDocuments({
      restaurantId,
      status: { $in: ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"] },
      createdAt: { $gte: previousRange.start, $lte: previousRange.end }
    }),
    PayoutBatchModel.findOne({ restaurantId, status: "completed" })
      .sort({ createdAt: -1 })
      .select({ createdAt: 1 })
      .lean()
  ])

  const filteredRevenue = deliveredOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const previousRevenue = previousDeliveredOrders.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const netAggregate = summarizeDeliveredOrdersForOwner(
    deliveredOrdersInRange as Array<Record<string, any>>,
    restaurant
  )
  const previousNetAggregate = summarizeDeliveredOrdersForOwner(
    previousDeliveredOrders as Array<Record<string, any>>,
    restaurant
  )
  const placedOrdersInRange = filteredOrders.filter(
    (order) => order.status !== "Cancelled" && order.status !== "Rejected"
  )
  const previousPlacedOrders = previousOrders.filter(
    (order) => order.status !== "Cancelled" && order.status !== "Rejected"
  )
  const placedOrderValue = placedOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const previousPlacedOrderValue = previousPlacedOrders.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const cancelledOrderValue = cancelledOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const previousCancelledOrderValue = previousCancelledOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const rejectedOrderValue = rejectedOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const previousRejectedOrderValue = previousRejectedOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const totalOrders = placedOrdersInRange.length
  const completedOrders = deliveredOrdersInRange.length
  const previousCompletedOrders = previousDeliveredOrders.length
  const averageOrderValue = completedOrders > 0 ? filteredRevenue / completedOrders : 0
  const previousAverageOrderValue =
    previousCompletedOrders > 0 ? previousRevenue / previousCompletedOrders : 0
  const customerCount = new Set(
    filteredOrders
      .map((order) => order.customerSnapshot?.phone ?? "")
      .filter(Boolean)
  ).size
  const nextEstimatedPayoutAt = latestPayout
    ? new Date(new Date(latestPayout.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000)
    : null

  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      isOnline: restaurant.runtime?.isOnline ?? false,
      isVisible: restaurant.runtime?.isVisible ?? false,
      currentOperationalStatus: restaurant.runtime?.currentOperationalStatus ?? "closed"
    },
    filter: {
      preset: params.preset ?? "today",
      from: range.start.toISOString(),
      to: range.end.toISOString()
    },
    metrics: {
      totalOrders,
      previousTotalOrders: previousPlacedOrders.length,
      totalRevenue: filteredRevenue,
      previousTotalRevenue: previousRevenue,
      placedOrderValue,
      previousPlacedOrderValue,
      deliveredOrderValue: filteredRevenue,
      previousDeliveredOrderValue: previousRevenue,
      totalNetEarnings: netAggregate.net,
      previousTotalNetEarnings: previousNetAggregate.net,
      cancelledOrders: cancelledOrdersInRange.length,
      previousCancelledOrders: previousCancelledOrdersInRange.length,
      cancelledOrderValue,
      previousCancelledOrderValue,
      rejectedOrders: rejectedOrdersInRange.length,
      previousRejectedOrders: previousRejectedOrdersInRange.length,
      rejectedOrderValue,
      previousRejectedOrderValue,
      averageOrderValue,
      previousAverageOrderValue,
      pendingOrders: activeOrders,
      previousPendingOrders: previousActiveOrders,
      completedOrders,
      previousCompletedOrders,
      uniqueCustomers: customerCount,
      nextEstimatedPayoutAt: nextEstimatedPayoutAt?.toISOString() ?? null
    }
  }
}
