import mongoose, { Schema } from "mongoose";

import {
  otpPurposes,
  otpSessionStatuses,
  ownerStatuses,
  restaurantLifecycleStatuses,
  reviewCaseStatuses,
} from "../../common/constants/lifecycle";

const mediaAssetSchema = new Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

const riderPushTokenSchema = new Schema(
  {
    expoPushToken: { type: String, required: true, trim: true },
    platform: { type: String, enum: ["android", "ios"], required: true },
    deviceId: { type: String, default: "", trim: true },
    appVersion: { type: String, default: "", trim: true },
    lastSeenAt: { type: Date, default: Date.now },
    disabledAt: { type: Date, default: null },
  },
  { _id: true },
);

const riderVerificationSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    nationalIdNumber: { type: String, default: "", trim: true },
    documentFront: { type: mediaAssetSchema, default: () => ({}) },
    documentBack: { type: mediaAssetSchema, default: () => ({}) },
    selfie: { type: mediaAssetSchema, default: () => ({}) },
    reviewNote: { type: String, default: "", trim: true },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedByAdminId: { type: String, default: "" },
  },
  { _id: false },
);

const riderPayrollSchema = new Schema(
  {
    isPayrollEnabled: { type: Boolean, default: true },
    monthlySalary: { type: Number, default: 0, min: 0 },
    payoutDay: { type: Number, default: 1, min: 1, max: 28 },
    note: { type: String, default: "", trim: true },
    updatedByAdminId: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const riderNotificationSchema = new Schema(
  {
    type: { type: String, default: "system", trim: true },
    title: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    path: { type: String, default: "", trim: true },
    campaignId: { type: String, default: "", trim: true },
    contentType: { type: String, enum: ["text", "image", "image_text"], default: "text" },
    imageUrl: { type: String, default: "", trim: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const riderSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    profileImage: { type: mediaAssetSchema, default: () => ({}) },
    vehicleType: { type: String, enum: ["cycle"], default: "cycle" },
    activeTrackingOrderId: { type: String, default: "" },
    isAvailableForAssignments: { type: Boolean, default: true },
    lastKnownLocation: {
      type: new Schema(
        {
          latitude: { type: Number, default: null },
          longitude: { type: Number, default: null },
          heading: { type: Number, default: null },
          accuracyMeters: { type: Number, default: null },
          speedKmph: { type: Number, default: null },
          updatedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    isPhoneVerified: { type: Boolean, default: true },
    verification: { type: riderVerificationSchema, default: () => ({}) },
    payroll: { type: riderPayrollSchema, default: () => ({}) },
    pushTokens: { type: [riderPushTokenSchema], default: [] },
    notifications: { type: [riderNotificationSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "suspended", "locked"],
      default: "active",
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const ownerSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    pendingPhone: { type: String, default: null, trim: true },
    email: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    profileImage: { type: mediaAssetSchema, default: () => ({}) },
    isPhoneVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ownerStatuses,
      default: "active",
    },
    restaurantLifecycleStatus: {
      type: String,
      enum: restaurantLifecycleStatuses,
      default: "account_created",
    },
    activeRestaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ownerSchema.index(
  { pendingPhone: 1 },
  {
    unique: true,
    partialFilterExpression: { pendingPhone: { $type: "string" } },
  },
);

const otpSessionSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      default: null,
    },
    referenceId: { type: String, required: true },
    phone: { type: String, required: true, trim: true },
    purpose: {
      type: String,
      enum: otpPurposes,
      required: true,
    },
    otpCodeHash: { type: String, required: true },
    status: {
      type: String,
      enum: otpSessionStatuses,
      default: "pending",
    },
    expiresAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const onboardingDraftSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: true,
      unique: true,
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    currentStep: { type: String, default: "basic_info" },
    completedSteps: { type: [String], default: [] },
    skippedSteps: { type: [String], default: [] },
    basicInfo: {
      type: new Schema(
        {
          restaurantName: { type: String, default: "" },
          fullName: { type: String, default: "" },
          phone: { type: String, default: "" },
          email: { type: String, default: "" },
          description: { type: String, default: "" },
          preparationTimeMinutes: { type: Number, default: 20 },
          cuisineTypes: { type: [String], default: [] },
          tags: { type: [String], default: [] },
          logo: { type: mediaAssetSchema, default: () => ({}) },
          coverImage: { type: mediaAssetSchema, default: () => ({}) },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    location: {
      type: new Schema(
        {
          address: { type: String, default: "" },
          city: { type: String, default: "Netrokona" },
          latitude: { type: Number, default: null },
          longitude: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    openingHours: {
      type: Schema.Types.Mixed,
      default: {},
    },
    payoutSetup: {
      type: new Schema(
        {
          type: { type: String, default: "" },
          accountName: { type: String, default: "" },
          accountNumber: { type: String, default: "" },
          isVerified: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    draftSavedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    resubmissionCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const reviewIssueSchema = new Schema(
  {
    section: { type: String, required: true },
    title: { type: String, required: true },
    fields: { type: [String], default: [] },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const reviewCaseSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: true,
    },
    draftId: {
      type: Schema.Types.ObjectId,
      ref: "OnboardingDraft",
      required: true,
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    status: {
      type: String,
      enum: reviewCaseStatuses,
      default: "submitted",
    },
    submittedSnapshot: { type: Schema.Types.Mixed, required: true },
    reviewNote: { type: String, default: "" },
    reviewIssues: { type: [reviewIssueSchema], default: [] },
    reviewedByAdminId: { type: String, default: null },
    submittedAt: { type: Date, required: true },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const restaurantSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    preparationTimeMinutes: { type: Number, default: null },
    cuisineTypes: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    logo: { type: mediaAssetSchema, default: () => ({}) },
    coverImage: { type: mediaAssetSchema, default: () => ({}) },
    contact: {
      type: new Schema(
        {
          phone: { type: String, default: "" },
          email: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    address: {
      type: new Schema(
        {
          address: { type: String, default: "" },
          city: { type: String, default: "Netrokona" },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    location: {
      type: new Schema(
        {
          latitude: { type: Number, default: null },
          longitude: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    locationPoint: {
      type: new Schema(
        {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: {
            type: [Number],
            default: undefined,
          },
        },
        { _id: false },
      ),
      default: null,
    },
    runtime: {
      type: Schema.Types.Mixed,
      default: {},
    },
    discovery: {
      type: Schema.Types.Mixed,
      default: {},
    },
    commercial: {
      type: new Schema(
        {
          commissionRate: { type: Number, min: 0, max: 100, default: 15 },
          deliveryPricingOverride: {
            type: new Schema(
              {
                enabled: { type: Boolean, default: false },
                baseFeeTaka: { type: Number, min: 0, default: null },
                distanceSurchargeEnabled: { type: Boolean, default: null },
                surchargeStartsAfterKm: { type: Number, min: 0, default: null },
                surchargeStepMeters: { type: Number, min: 1, default: null },
                surchargeAmountTaka: { type: Number, min: 0, default: null },
                updatedByAdminId: { type: String, default: "" },
                updatedAt: { type: Date, default: null },
              },
              { _id: false },
            ),
            default: () => ({}),
          },
          commissionHistory: {
            type: [
              new Schema(
                {
                  previousRate: { type: Number, default: null },
                  rate: { type: Number, min: 0, max: 100, required: true },
                  changedByAdminId: { type: String, default: "" },
                  note: { type: String, default: "" },
                  createdAt: { type: Date, default: Date.now },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    settings: {
      type: new Schema(
        {
          orderSettings: {
            type: new Schema(
              {
                autoAcceptOrders: { type: Boolean, default: false },
              },
              { _id: false },
            ),
            default: () => ({}),
          },
          notifications: {
            type: new Schema(
              {
                newOrder: { type: Boolean, default: true },
                cancellation: { type: Boolean, default: true },
                payouts: { type: Boolean, default: true },
                support: { type: Boolean, default: true },
              },
              { _id: false },
            ),
            default: () => ({}),
          },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    profileCompletion: {
      type: new Schema(
        {
          percentage: { type: Number, default: 0 },
          completedWeight: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
  { timestamps: true },
);

restaurantSchema.index({ ownerId: 1, slug: 1 }, { unique: true });
restaurantSchema.index({ locationPoint: "2dsphere" });

const payoutMethodSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ["bkash", "bank"],
      required: true,
    },
    accountName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    bankName: { type: String, default: "" },
    branchName: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },
    pendingAccountNumber: { type: String, default: null },
    verificationSource: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const openingHoursSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    timezone: { type: String, default: "Asia/Dhaka" },
    weeklySchedule: { type: [Schema.Types.Mixed], default: [] },
    exceptions: { type: [Schema.Types.Mixed], default: [] },
    temporaryClosure: {
      type: Schema.Types.Mixed,
      default: {
        isPaused: false,
        mode: null,
        resumeAt: null,
        reason: "",
      },
    },
  },
  { timestamps: true },
);

const refreshTokenSessionSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: true,
    },
    tokenId: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

refreshTokenSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 45 },
);

const riderRefreshTokenSessionSchema = new Schema(
  {
    riderId: {
      type: Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },
    tokenId: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

riderRefreshTokenSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 45 },
);

export const OwnerModel = mongoose.model("Owner", ownerSchema);
export const RiderModel = mongoose.model("Rider", riderSchema);
export const OtpSessionModel = mongoose.model("OtpSession", otpSessionSchema);
export const OnboardingDraftModel = mongoose.model(
  "OnboardingDraft",
  onboardingDraftSchema,
);
export const ReviewCaseModel = mongoose.model("ReviewCase", reviewCaseSchema);
export const RestaurantModel = mongoose.model("Restaurant", restaurantSchema);
export const PayoutMethodModel = mongoose.model(
  "PayoutMethod",
  payoutMethodSchema,
);
export const OpeningHoursModel = mongoose.model(
  "OpeningHours",
  openingHoursSchema,
);
export const RefreshTokenSessionModel = mongoose.model(
  "RefreshTokenSession",
  refreshTokenSessionSchema,
);
export const RiderRefreshTokenSessionModel = mongoose.model(
  "RiderRefreshTokenSession",
  riderRefreshTokenSessionSchema,
);
