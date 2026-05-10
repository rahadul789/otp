import mongoose, { Schema } from "mongoose"

const customerSavedLocationSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    source: { type: String, enum: ["gps", "manual", "saved"], default: "saved" },
    isDefault: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: Date.now }
  },
  { _id: true }
)

const customerPushTokenSchema = new Schema(
  {
    expoPushToken: { type: String, required: true, trim: true },
    platform: { type: String, enum: ["android", "ios"], required: true },
    deviceId: { type: String, default: "", trim: true },
    appVersion: { type: String, default: "", trim: true },
    lastSeenAt: { type: Date, default: Date.now },
    disabledAt: { type: Date, default: null }
  },
  { _id: true }
)

const customerPhoneHistorySchema = new Schema(
  {
    phone: { type: String, required: true, trim: true },
    changedAt: { type: Date, default: Date.now }
  },
  { _id: true }
)

const customerNotificationSchema = new Schema(
  {
    type: { type: String, default: "system", trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    path: { type: String, default: "", trim: true },
    campaignId: { type: String, default: "", trim: true },
    campaignVariant: { type: String, default: "", trim: true },
    contentType: { type: String, enum: ["text", "image", "image_text"], default: "text" },
    imageUrl: { type: String, default: "", trim: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
)

const customerNotificationSettingsSchema = new Schema(
  {
    orderUpdates: { type: Boolean, default: true },
    restaurantStatus: { type: Boolean, default: true },
    reviewReplies: { type: Boolean, default: true }
  },
  { _id: false }
)

const customerAccountRequestSchema = new Schema(
  {
    type: { type: String, enum: ["deactivate", "delete"], default: null },
    reason: { type: String, default: "" },
    reviewNote: { type: String, default: "" },
    reviewedByAdminId: { type: String, default: null },
    reviewedByAdminName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "cancelled", "reviewed", "completed"],
      default: null
    },
    requestedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    history: {
      type: [
        new Schema(
          {
            action: {
              type: String,
              enum: ["submitted", "cancelled", "approved", "rejected"],
              required: true
            },
            note: { type: String, default: "" },
            actorId: { type: String, default: "" },
            actorName: { type: String, default: "" },
            createdAt: { type: Date, default: Date.now }
          },
          { _id: false }
        )
      ],
      default: []
    }
  },
  { _id: false }
)

const customerSchema = new Schema(
  {
    fullName: { type: String, default: "" },
    phone: { type: String, unique: true, sparse: true },
    pendingPhone: { type: String, default: null, trim: true },
    email: { type: String, default: "", trim: true },
    passwordHash: { type: String, default: "" },
    googleSub: { type: String, unique: true, sparse: true },
    profileImage: {
      type: new Schema(
        {
          url: { type: String, default: "" },
          publicId: { type: String, default: "" }
        },
        { _id: false }
      ),
      default: () => ({})
    },
    authProviders: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["active", "suspended", "locked"],
      default: "active"
    },
    lastLoginAt: { type: Date, default: null },
    previousPhones: { type: [customerPhoneHistorySchema], default: [] },
    notificationSettings: {
      type: customerNotificationSettingsSchema,
      default: () => ({})
    },
    accountRequest: {
      type: customerAccountRequestSchema,
      default: () => ({})
    },
    favoriteRestaurantIds: { type: [Schema.Types.ObjectId], ref: "Restaurant", default: [] },
    savedLocations: { type: [customerSavedLocationSchema], default: [] },
    pushTokens: { type: [customerPushTokenSchema], default: [] },
    notifications: { type: [customerNotificationSchema], default: [] }
  },
  { timestamps: true }
)

customerSchema.index(
  { pendingPhone: 1 },
  { unique: true, partialFilterExpression: { pendingPhone: { $type: "string" } } }
)

const customerRefreshTokenSessionSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    tokenId: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

const bkashSandboxPaymentSessionSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
    sandboxPaymentId: { type: String },
    otpCodeHash: { type: String },
    walletNumber: { type: String, required: true },
    amount: { type: Number, required: true },
    voucherCode: { type: String, default: "" },
    status: {
      type: String,
      enum: ["initiated", "confirmed", "cancelled", "failed", "expired"],
      default: "initiated"
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    usedAt: { type: Date, default: null },
    transactionId: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    confirmedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

customerRefreshTokenSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 45 }
)

bkashSandboxPaymentSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 })
bkashSandboxPaymentSessionSchema.index(
  { sandboxPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sandboxPaymentId: { $exists: true, $type: "string" }
    }
  }
)

const voucherSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
    scopeType: {
      type: String,
      enum: ["restaurant", "selected_restaurants", "all_restaurants"],
      default: "restaurant"
    },
    selectedRestaurantIds: { type: [Schema.Types.ObjectId], ref: "Restaurant", default: [] },
    audienceType: {
      type: String,
      enum: ["all_users", "new_users", "returning_users", "selected_users"],
      default: "all_users"
    },
    selectedCustomerIds: { type: [Schema.Types.ObjectId], ref: "Customer", default: [] },
    customerGroupKey: { type: String, default: "" },
    display: {
      type: new Schema(
        {
          showOnHome: { type: Boolean, default: false },
          showInOfferStrip: { type: Boolean, default: true },
          placement: { type: String, enum: ["top", "after_banner", "offers_row"], default: "offers_row" },
          variant: { type: String, enum: ["chip", "block", "image", "carousel"], default: "chip" },
          position: { type: Number, default: 0 },
          title: { type: String, default: "" },
          subtitle: { type: String, default: "" },
          imageUrl: { type: String, default: "" },
          carouselImageUrls: { type: [String], default: [] },
          openInModal: { type: Boolean, default: false },
          ctaLabel: { type: String, default: "" },
          ctaPath: { type: String, default: "" },
          backgroundColor: { type: String, default: "#FFF0F6" },
          textColor: { type: String, default: "#3F2432" },
          accentColor: { type: String, default: "#FF5C93" }
        },
        { _id: false }
      ),
      default: () => ({})
    },
    displayAnalytics: {
      type: new Schema(
        {
          impressions: { type: Number, default: 0 },
          clicks: { type: Number, default: 0 },
          modalOpens: { type: Number, default: 0 },
          stripClicks: { type: Number, default: 0 },
          lastEventAt: { type: Date, default: null }
        },
        { _id: false }
      ),
      default: () => ({})
    },
    pushCampaign: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          title: { type: String, default: "" },
          body: { type: String, default: "" },
          path: { type: String, default: "" },
          sentAt: { type: Date, default: null },
          sentByAdminId: { type: String, default: "" },
          totalTargets: { type: Number, default: 0 },
          sentCount: { type: Number, default: 0 },
          disabledCount: { type: Number, default: 0 },
          openCount: { type: Number, default: 0 },
          openEvents: {
            type: [
              new Schema(
                {
                  customerId: { type: String, default: "" },
                  customerName: { type: String, default: "" },
                  customerPhone: { type: String, default: "" },
                  openedAt: { type: Date, default: Date.now },
                  path: { type: String, default: "" },
                },
                { _id: false }
              )
            ],
            default: []
          }
        },
        { _id: false }
      ),
      default: () => ({})
    },
    createdByType: { type: String, enum: ["owner", "admin", "system"], required: true },
    createdById: { type: String, required: true },
    fundedBy: { type: String, enum: ["owner", "platform", "shared"], required: true },
    ownerSharePercent: { type: Number, default: 100, min: 0, max: 100 },
    platformSharePercent: { type: Number, default: 0, min: 0, max: 100 },
    stackingRule: { type: String, enum: ["exclusive", "stackable"], default: "exclusive" },
    priority: { type: Number, default: 0 },
    mode: { type: String, enum: ["auto", "coupon"], required: true },
    type: { type: String, enum: ["flat", "percentage", "free_delivery"], required: true },
    name: { type: String, required: true },
    code: { type: String, default: "" },
    discountValue: { type: Number, default: 0 },
    maxDiscountAmount: { type: Number, default: 0 },
    minimumOrderAmount: { type: Number, default: 0 },
    maxTotalUses: { type: Number, default: 0 },
    maxUsesPerUser: { type: Number, default: 0 },
    allowRepeatUsage: { type: Boolean, default: false },
    status: { type: String, enum: ["Draft", "Active"], default: "Draft" },
    applicability: { type: String, enum: ["all", "categories", "items"], default: "all" },
    categoryIds: { type: [Schema.Types.ObjectId], default: [] },
    itemIds: { type: [Schema.Types.ObjectId], default: [] },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    archivedAt: { type: Date, default: null },
    archivedByAdminId: { type: String, default: "" },
    archiveReason: { type: String, default: "" }
  },
  { timestamps: true }
)

voucherSchema.index(
  { restaurantId: 1, code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: "string", $ne: "" } } }
)

const voucherAuditSchema = new Schema(
  {
    voucherId: { type: Schema.Types.ObjectId, ref: "Voucher", required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
    actorType: { type: String, enum: ["admin", "owner", "system"], required: true },
    actorId: { type: String, default: "" },
    action: {
      type: String,
      enum: ["created", "updated", "archived", "restored"],
      required: true
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    note: { type: String, default: "" }
  },
  { timestamps: true }
)

const restaurantCollectionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["static", "dynamic"], required: true },
    criteria: { type: Schema.Types.Mixed, default: {} },
    restaurantIds: { type: [Schema.Types.ObjectId], default: [] },
    sortOrders: {
      type: [
        new Schema(
          {
            restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
            order: { type: Number, required: true }
          },
          { _id: false }
        )
      ],
      default: []
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
)

const voucherRedemptionSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    voucherId: { type: Schema.Types.ObjectId, ref: "Voucher", required: true },
    voucherSnapshot: { type: Schema.Types.Mixed, required: true },
    discountBreakdown: { type: Schema.Types.Mixed, default: {} },
    appliedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
)

export const CustomerModel = mongoose.model("Customer", customerSchema)
export const CustomerRefreshTokenSessionModel = mongoose.model(
  "CustomerRefreshTokenSession",
  customerRefreshTokenSessionSchema
)
export const BkashSandboxPaymentSessionModel = mongoose.model(
  "BkashSandboxPaymentSession",
  bkashSandboxPaymentSessionSchema
)
export const VoucherModel = mongoose.model("Voucher", voucherSchema)
export const VoucherAuditModel = mongoose.model("VoucherAudit", voucherAuditSchema)
export const RestaurantCollectionModel = mongoose.model(
  "RestaurantCollection",
  restaurantCollectionSchema
)
export const VoucherRedemptionModel = mongoose.model(
  "VoucherRedemption",
  voucherRedemptionSchema
)
