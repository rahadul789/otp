import mongoose, { Schema } from "mongoose";

const websiteLeadSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["restaurant", "rider", "contact"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "converted", "closed"],
      default: "new",
      index: true,
    },
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    email: { type: String, default: "" },
    area: { type: String, required: true, index: true },
    businessName: { type: String, default: "" },
    cuisineType: { type: String, default: "" },
    vehicleType: { type: String, default: "" },
    message: { type: String, default: "" },
    source: { type: String, default: "foodbela.com", index: true },
    landingPage: { type: String, default: "" },
    referrer: { type: String, default: "" },
    language: { type: String, default: "bn" },
    visitorId: { type: String, default: "", index: true },
    sessionId: { type: String, default: "", index: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    notes: { type: String, default: "" },
    assignedAdminId: { type: String, default: "" },
    lastContactedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

websiteLeadSchema.index({ createdAt: -1 });
websiteLeadSchema.index({ type: 1, status: 1, createdAt: -1 });

const websiteAnalyticsEventSchema = new Schema(
  {
    eventName: { type: String, required: true, index: true },
    pagePath: { type: String, default: "/", index: true },
    visitorId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    language: { type: String, default: "bn" },
    referrer: { type: String, default: "" },
    source: { type: String, default: "foodbela.com", index: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

websiteAnalyticsEventSchema.index({ createdAt: -1 });
websiteAnalyticsEventSchema.index({ eventName: 1, createdAt: -1 });
websiteAnalyticsEventSchema.index({ pagePath: 1, createdAt: -1 });

const websiteSettingsSchema = new Schema(
  {
    singletonKey: {
      type: String,
      default: "foodbela.com",
      unique: true,
      immutable: true,
    },
    siteUrl: { type: String, default: "https://foodbela.com" },
    seoDefaultTitle: {
      type: String,
      default: "Foodbela | আপনার শহরের ফুড ডেলিভারি নেটওয়ার্ক",
    },
    seoDefaultDescription: {
      type: String,
      default:
        "Foodbela দিয়ে খাবার অর্ডার, রেস্টুরেন্ট পার্টনারশিপ এবং রাইডার অনবোর্ডিং এক প্ল্যাটফর্মে করুন।",
    },
    seoOgImageUrl: { type: String, default: "" },
    googleSiteVerification: { type: String, default: "" },
    businessAddress: { type: String, default: "" },
    businessCity: { type: String, default: "Dhaka" },
    businessRegion: { type: String, default: "Dhaka" },
    businessPostalCode: { type: String, default: "" },
    businessCountry: { type: String, default: "BD" },
    playStoreUrl: { type: String, default: "" },
    appDownloadUrl: { type: String, default: "" },
    restaurantApplyUrl: { type: String, default: "/restaurants#apply" },
    riderApplyUrl: { type: String, default: "/riders#apply" },
    supportPhone: { type: String, default: "+880 1700-000000" },
    supportEmail: { type: String, default: "hello@foodbela.com" },
    facebookUrl: { type: String, default: "#" },
    instagramUrl: { type: String, default: "#" },
    linkedinUrl: { type: String, default: "#" },
    tiktokUrl: { type: String, default: "#" },
    youtubeUrl: { type: String, default: "#" },
    snapchatUrl: { type: String, default: "#" },
    socialLinksOrder: {
      type: [String],
      default: ["facebook", "instagram", "youtube", "linkedin", "tiktok", "snapchat"],
    },
    heroTitle: {
      type: String,
      default:
        "খাবার অর্ডার, রেস্টুরেন্ট গ্রোথ আর রাইডার নেটওয়ার্ক—একসাথে Foodbela.",
    },
    heroSubtitle: {
      type: String,
      default:
        "আপনার এলাকার প্রিয় খাবার, লাইভ ট্র্যাকিং আর দ্রুত ডেলিভারি—সব এক অ্যাপে।",
    },
    heroTitleEn: {
      type: String,
      default: "Order food, grow restaurants, and power riders with Foodbela.",
    },
    heroSubtitleEn: {
      type: String,
      default: "Your local favorites, live tracking, and fast delivery in one app.",
    },
    customerYoutubeUrl: {
      type: String,
      default: "https://www.youtube-nocookie.com/embed/ysz5S6PUM-U",
    },
    customerVideoOrientation: {
      type: String,
      enum: ["portrait", "landscape"],
      default: "portrait",
    },
    customerOfferEnabled: { type: Boolean, default: false },
    customerOfferTitle: { type: String, default: "" },
    customerOfferDescription: { type: String, default: "" },
    customerOfferCtaLabel: { type: String, default: "অফার দেখুন" },
    customerOfferCtaUrl: { type: String, default: "#" },
    coverageRewardAmount: { type: Number, default: 2000 },
    serviceAreas: {
      type: [
        {
          name: { type: String, required: true },
          status: {
            type: String,
            enum: ["active", "coming_soon", "paused"],
            default: "active",
          },
          note: { type: String, default: "" },
          noteBn: { type: String, default: "" },
          noteEn: { type: String, default: "" },
          seoTitle: { type: String, default: "" },
          seoDescription: { type: String, default: "" },
          popularSearches: { type: [String], default: [] },
          cuisineKeywords: { type: [String], default: [] },
          postalCodes: { type: [String], default: [] },
        },
      ],
      default: [
        { name: "Dhaka", status: "active", note: "Selected zones now live" },
        {
          name: "Mirpur",
          status: "active",
          note: "Fast local delivery coverage",
        },
        { name: "Dhanmondi", status: "coming_soon", note: "Launching soon" },
      ],
    },
    updatedByAdminId: { type: String, default: "" },
  },
  { timestamps: true },
);

export const WebsiteLeadModel = mongoose.model(
  "WebsiteLead",
  websiteLeadSchema,
);
export const WebsiteAnalyticsEventModel = mongoose.model(
  "WebsiteAnalyticsEvent",
  websiteAnalyticsEventSchema,
);
export const WebsiteSettingsModel = mongoose.model(
  "WebsiteSettings",
  websiteSettingsSchema,
);
