import { StatusCodes } from "http-status-codes"
import mongoose, { type PipelineStage, type SortOrder } from "mongoose"

import { AppError } from "../../common/utils/app-error"
import { OwnerModel, PayoutMethodModel, RestaurantModel } from "../auth/auth.model"
import { createOtpSession } from "../auth/auth.service"
import { LedgerEntryModel, PayoutBatchModel, RestaurantMetricsModel } from "./finance.model"
import { OrderModel } from "./operational.model"

type DashboardPreset =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "thisWeek"
  | "thisMonth"
  | "custom"

const finalizedFinancialOrderStatuses = ["Delivered"] as const
const SETTLEMENT_DELAY_DAYS = 3

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

function getSettlementAvailableAt(deliveredAt: Date) {
  return new Date(
    deliveredAt.getTime() + SETTLEMENT_DELAY_DAYS * 24 * 60 * 60 * 1000
  )
}

function getStartOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function getEndOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function buildDeliveredRangeClause(range: { start: Date; end: Date }) {
  return {
    $or: [
      { "timestamps.Delivered": { $gte: range.start, $lte: range.end } },
      { "timestamps.deliveredAt": { $gte: range.start, $lte: range.end } }
    ]
  }
}

function buildPreviousRange(range: { start: Date; end: Date }) {
  return {
    start: new Date(range.start.getTime() - (range.end.getTime() - range.start.getTime() + 1)),
    end: new Date(range.start.getTime() - 1)
  }
}

function getDashboardRange(params?: {
  preset?: DashboardPreset
  from?: string
  to?: string
}) {
  const now = new Date()
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  if (params?.preset === "custom" && params.from) {
    return {
      start: getStartOfDay(new Date(params.from)),
      end: getEndOfDay(new Date(params.to ?? params.from))
    }
  }

  switch (params?.preset) {
    case "yesterday": {
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      return { start: getStartOfDay(yesterday), end: getEndOfDay(yesterday) }
    }
    case "last7Days": {
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      return { start: getStartOfDay(start), end: endOfToday }
    }
    case "last30Days": {
      const start = new Date(now)
      start.setDate(now.getDate() - 29)
      return { start: getStartOfDay(start), end: endOfToday }
    }
    case "thisWeek": {
      const start = new Date(now)
      const day = start.getDay()
      const diff = day === 0 ? 6 : day - 1
      start.setDate(start.getDate() - diff)
      return { start: getStartOfDay(start), end: endOfToday }
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: getStartOfDay(start), end: endOfToday }
    }
    case "today":
    default:
      return { start: getStartOfDay(now), end: endOfToday }
  }
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
  await reconcileRestaurantLedgerStatuses(restaurantId)
  const [
    pendingAggregate,
    availableAggregate,
    paidOutAggregate,
    lifetimeAggregate,
    nextSettlementAggregate
  ] = await Promise.all([
    aggregateFinalizedLedgerEntries({
      restaurantId,
      settlementStatus: "pending"
    }, [{ $group: { _id: null, total: { $sum: "$netAmount" } } }]),
    aggregateFinalizedLedgerEntries({
      restaurantId,
      settlementStatus: "available"
    }, [{ $group: { _id: null, total: { $sum: "$netAmount" } } }]),
    aggregateFinalizedLedgerEntries({
      restaurantId,
      settlementStatus: "paid_out"
    }, [{ $group: { _id: null, total: { $sum: "$netAmount" } } }]),
    aggregateFinalizedLedgerEntries(
      {
        restaurantId,
        entryType: { $in: ["earning", "adjustment", "refund"] }
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
    aggregateFinalizedLedgerEntries(
      {
        restaurantId,
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
    paidOutBalance: Math.abs(paidOutAggregate[0]?.total ?? 0),
    lifetimeGrossAmount: lifetimeTotals?.grossAmount ?? 0,
    lifetimeNetEarnings: lifetimeTotals?.netAmount ?? 0,
    lifetimeCommission: lifetimeTotals?.commission ?? 0,
    lifetimeDiscountCost: lifetimeTotals?.discountCost ?? 0,
    lifetimeDeliveryCost: lifetimeTotals?.deliveryCost ?? 0,
    nextSettlementAvailableAt: nextSettlement?.toISOString?.() ?? null
  }
}

export async function reconcileRestaurantLedgerStatuses(restaurantId: string) {
  await LedgerEntryModel.updateMany(
    {
      restaurantId,
      entryType: { $in: ["earning", "refund", "adjustment"] },
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
    const deliveredAt = params.finalizedAt ?? new Date()
    ledgerEntry.settlementStatus =
      getSettlementAvailableAt(deliveredAt) <= new Date() ? "available" : "pending"
    ledgerEntry.availableAt = getSettlementAvailableAt(deliveredAt)
    await ledgerEntry.save()
    return ledgerEntry
  }

  ledgerEntry.settlementStatus = "pending"
  ledgerEntry.availableAt = null
  await ledgerEntry.save()
  return ledgerEntry
}

async function buildMetricsSummary(restaurantId: string) {
  const metrics = await RestaurantMetricsModel.findOne({ restaurantId })
  const aggregateRestaurantId = toObjectId(restaurantId)

  if (metrics) {
    return metrics
  }

  const [totalOrders, totalDeliveredOrders, totalCancelledOrders, deliveredRevenueAggregate] =
    await Promise.all([
      OrderModel.countDocuments({ restaurantId }),
      OrderModel.countDocuments({ restaurantId, status: "Delivered" }),
      OrderModel.countDocuments({
        restaurantId,
        status: { $in: ["Cancelled", "Rejected"] }
      }),
      OrderModel.aggregate([
        { $match: { restaurantId: aggregateRestaurantId, status: "Delivered" } },
        { $group: { _id: null, total: { $sum: "$pricing.total" } } }
      ])
    ])

  const totalRevenue = deliveredRevenueAggregate[0]?.total ?? 0
  const totalNetEarnings = (
    await aggregateFinalizedLedgerEntries(
      {
        restaurantId,
        entryType: { $in: ["earning", "adjustment", "refund"] }
      },
      [{ $group: { _id: null, total: { $sum: "$netAmount" } } }])
  )[0]?.total ?? 0

  const metricsDoc = await RestaurantMetricsModel.create({
    restaurantId,
    totalOrders,
    totalDeliveredOrders,
    totalCancelledOrders,
    totalRevenue,
    totalNetEarnings,
    averageOrderValue: totalDeliveredOrders > 0 ? totalRevenue / totalDeliveredOrders : 0,
    averagePreparationTimeMinutes: 0,
    averageRating: 0,
    reviewCount: 0,
    repeatCustomerCount: 0,
    lastAggregatedAt: new Date()
  })

  return metricsDoc
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
          { relatedOrderStatus: { $in: [...finalizedFinancialOrderStatuses] } }
        ]
      }
    },
    ...extraStages
  ]
}

async function aggregateFinalizedLedgerEntries(
  match: Record<string, unknown>,
  extraStages: PipelineStage[] = []
) {
  return LedgerEntryModel.aggregate(buildFinalizedLedgerPipeline(match, extraStages))
}

function getListRange(params?: {
  preset?: string
  from?: string
  to?: string
}) {
  const now = new Date()

  switch (params?.preset) {
    case "today":
      return { start: getStartOfDay(now), end: getEndOfDay(now) }
    case "yesterday": {
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      return { start: getStartOfDay(yesterday), end: getEndOfDay(yesterday) }
    }
    case "last7Days": {
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      return { start: getStartOfDay(start), end: getEndOfDay(now) }
    }
    case "last30Days": {
      const start = new Date(now)
      start.setDate(now.getDate() - 29)
      return { start: getStartOfDay(start), end: getEndOfDay(now) }
    }
    case "thisWeek": {
      const start = new Date(now)
      const day = start.getDay()
      const diff = day === 0 ? 6 : day - 1
      start.setDate(start.getDate() - diff)
      return { start: getStartOfDay(start), end: getEndOfDay(now) }
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: getStartOfDay(start), end: getEndOfDay(now) }
    }
    case "custom":
      if (params?.from) {
        return {
          start: getStartOfDay(new Date(params.from)),
          end: getEndOfDay(new Date(params.to ?? params.from))
        }
      }
      return null
    default:
      return null
  }
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
  await reconcileRestaurantLedgerStatuses(restaurantId)
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
        verificationSessionId: otpSession.id
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
  const [ledgerSummary, payoutMethod] = await Promise.all([
    getLedgerSummary(restaurantId),
    PayoutMethodModel.findOne({ restaurantId })
  ])

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

  if (params.amount <= 0 || params.amount > ledgerSummary.availableBalance) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_PAYOUT_AMOUNT",
      "Requested amount exceeds available balance"
    )
  }

  const payoutBatch = await PayoutBatchModel.create({
    restaurantId,
    methodId: payoutMethod._id,
    amount: params.amount,
    status: "pending",
    batchReference: `PO-${Date.now()}`,
    requestedAt: new Date()
  })

  await LedgerEntryModel.create({
    restaurantId,
    payoutBatchId: payoutBatch._id,
    sourceEntityType: "payout_batch",
    sourceEntityId: payoutBatch.id,
    entryType: "payout",
    netAmount: -params.amount,
    settlementStatus: "paid_out",
    availableAt: new Date()
  })

  return payoutBatch
}

export async function getDashboardSummary(params: {
  ownerId: string
  preset?: DashboardPreset
  from?: string
  to?: string
}) {
  const { restaurant, restaurantId } = await getOwnerFinanceContext(params.ownerId)
  await reconcileRestaurantLedgerStatuses(restaurantId)
  const range = getDashboardRange(params)
  const previousRange = buildPreviousRange(range)

  const [
    filteredOrders,
    deliveredOrdersInRange,
    previousOrders,
    previousDeliveredOrders,
    netAggregate,
    previousNetAggregate,
    activeOrders,
    previousActiveOrders,
    latestPayout
  ] = await Promise.all([
    OrderModel.find({
      restaurantId,
      createdAt: { $gte: range.start, $lte: range.end }
    }),
    OrderModel.find({
      restaurantId,
      status: "Delivered",
      ...buildDeliveredRangeClause(range)
    }),
    OrderModel.find({
      restaurantId,
      createdAt: { $gte: previousRange.start, $lte: previousRange.end }
    }),
    OrderModel.find({
      restaurantId,
      status: "Delivered",
      ...buildDeliveredRangeClause(previousRange)
    }),
    aggregateFinalizedLedgerEntries(
      {
        restaurantId,
        entryType: "earning"
      },
      [
        { $match: { effectiveAt: { $gte: range.start, $lte: range.end } } },
        { $group: { _id: null, total: { $sum: "$netAmount" } } }
      ]),
    aggregateFinalizedLedgerEntries(
      {
        restaurantId,
        entryType: "earning"
      },
      [
        { $match: { effectiveAt: { $gte: previousRange.start, $lte: previousRange.end } } },
        { $group: { _id: null, total: { $sum: "$netAmount" } } }
      ]),
    OrderModel.countDocuments({
      restaurantId,
      status: { $in: ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"] }
    }),
    OrderModel.countDocuments({
      restaurantId,
      status: { $in: ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"] },
      createdAt: { $gte: previousRange.start, $lte: previousRange.end }
    }),
    PayoutBatchModel.findOne({ restaurantId, status: "completed" }).sort({ createdAt: -1 })
  ])

  const filteredRevenue = deliveredOrdersInRange.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const previousRevenue = previousDeliveredOrders.reduce(
    (sum, order) => sum + (order.pricing?.total ?? 0),
    0
  )
  const totalOrders = filteredOrders.length
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
      previousTotalOrders: previousOrders.length,
      totalRevenue: filteredRevenue,
      previousTotalRevenue: previousRevenue,
      totalNetEarnings: netAggregate[0]?.total ?? 0,
      previousTotalNetEarnings: previousNetAggregate[0]?.total ?? 0,
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
