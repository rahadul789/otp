import mongoose, { Schema } from "mongoose"

const ledgerEntrySchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    payoutBatchId: { type: Schema.Types.ObjectId, ref: "PayoutBatch", default: null },
    sourceEntityType: { type: String, required: true },
    sourceEntityId: { type: String, required: true },
    entryType: {
      type: String,
      enum: ["earning", "refund", "payout", "adjustment"],
      required: true
    },
    grossAmount: { type: Number, default: 0 },
    commissionBase: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    discountCost: { type: Number, default: 0 },
    platformDiscountCost: { type: Number, default: 0 },
    deliveryCost: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    settlementStatus: {
      type: String,
      enum: ["pending", "available", "paid_out"],
      default: "pending"
    },
    availableAt: { type: Date, default: null }
  },
  { timestamps: true }
)

ledgerEntrySchema.index({ restaurantId: 1, settlementStatus: 1, createdAt: -1 })

const payoutBatchSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    methodId: { type: Schema.Types.ObjectId, ref: "PayoutMethod", required: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending"
    },
    batchReference: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    requestedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

payoutBatchSchema.index({ restaurantId: 1, createdAt: -1 })

const restaurantMetricsSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true
    },
    totalOrders: { type: Number, default: 0 },
    totalDeliveredOrders: { type: Number, default: 0 },
    totalCancelledOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalNetEarnings: { type: Number, default: 0 },
    averageOrderValue: { type: Number, default: 0 },
    averagePreparationTimeMinutes: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    repeatCustomerCount: { type: Number, default: 0 },
    lastOrderAt: { type: Date, default: null },
    lastAggregatedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

export const LedgerEntryModel = mongoose.model("LedgerEntry", ledgerEntrySchema)
export const PayoutBatchModel = mongoose.model("PayoutBatch", payoutBatchSchema)
export const RestaurantMetricsModel = mongoose.model("RestaurantMetrics", restaurantMetricsSchema)
