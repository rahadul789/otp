import { Router } from "express"
import {
  createOrderActionLimiter,
  createOtpSendIpLimiter,
  createOtpSendLimiter,
  createOtpVerifyLimiter,
  createPaymentLimiter,
  createPasswordRecoveryLimiter,
  createRefreshLimiter,
  createSigninLimiter,
  createSupportWriteLimiter,
  createAnalyticsEventLimiter
} from "../../common/middleware/rate-limit"

import { requireAuth, requireRole } from "../../common/middleware/auth"
import { postCustomerAnalyticsEvent } from "./customer-analytics.controller"
import {
  getCustomerOrder,
  getCustomerOrders,
  getCustomerProfileSummary,
  getCustomerReferralSummaryController,
  postCustomerReferralApplyController,
  getCustomerLocations,
  getCustomerNotifications,
  getCustomerNotificationCampaign,
  deleteCustomerAccountRequest,
  deleteCustomerPushToken,
  getCustomerDiscovery,
  getCustomerDiscoveryHomePage,
  getCustomerFavoriteRestaurants,
  postCustomerVoucherDisplayEvent,
  postCustomerPushOpenEvent,
  getCustomerFavoriteRestaurantCards,
  getCustomerRestaurant,
  getCustomerSupportCaseController,
  getCustomerLatestSupportCaseController,
  getBkashReturnPage,
  getBkashCallback,
  logoutCustomerAuth,
  startCustomerPhoneChangeOtp,
  postBkashInitiate,
  deleteCustomerLocation,
  patchCustomerLocation,
  patchCustomerLocationDefault,
  patchCustomerLocationTouch,
  postCustomerFavoriteToggle,
  patchCustomerPassword,
  patchCustomerProfile,
  patchCustomerNotificationRead,
  patchCustomerNotificationsReadAll,
  postCustomerLocation,
  postCustomerPushToken,
  postCustomerCartQuote,
  postCustomerAccountRequest,
  postCustomerOrder,
  postCustomerOrderCancel,
  postCustomerReview,
  postCustomerSupportCaseController,
  postCustomerSupportCaseMessageController,
  refreshCustomerAuth,
  resetCustomerPasswordController,
  signinCustomerGoogle,
  signinCustomerWithPasswordController,
  startCustomerPasswordReset,
  startCustomerPhoneAuth,
  verifyCustomerPhoneOtpCode,
  verifyCustomerPhoneChangeOtp,
  verifyCustomerPhoneAuth,
  verifyCustomerPasswordResetOtpCode
} from "./customer.controller"

export const customerRouter = Router()
const customerAuthStartLimiter = createOtpSendLimiter()
const customerAuthStartIpLimiter = createOtpSendIpLimiter()
const customerPasswordSigninLimiter = createSigninLimiter()
const customerOtpVerifyLimiter = createOtpVerifyLimiter()
const customerPasswordRecoveryLimiter = createPasswordRecoveryLimiter()
const customerRefreshLimiter = createRefreshLimiter()
const customerSupportWriteLimiter = createSupportWriteLimiter()
const customerPaymentLimiter = createPaymentLimiter()
const customerOrderActionLimiter = createOrderActionLimiter()
const customerAnalyticsEventLimiter = createAnalyticsEventLimiter()

customerRouter.post("/analytics/events", customerAnalyticsEventLimiter, postCustomerAnalyticsEvent)
customerRouter.post("/auth/phone/start", customerAuthStartIpLimiter, customerAuthStartLimiter, startCustomerPhoneAuth)
customerRouter.post("/auth/phone/password", customerPasswordSigninLimiter, signinCustomerWithPasswordController)
customerRouter.post(
  "/auth/password/forgot",
  customerAuthStartIpLimiter,
  customerPasswordRecoveryLimiter,
  startCustomerPasswordReset
)
customerRouter.post("/auth/password/otp/verify", customerOtpVerifyLimiter, verifyCustomerPasswordResetOtpCode)
customerRouter.post("/auth/password/reset", customerPasswordRecoveryLimiter, resetCustomerPasswordController)
customerRouter.post("/auth/phone/otp/verify", customerOtpVerifyLimiter, verifyCustomerPhoneOtpCode)
customerRouter.post("/auth/phone/verify", customerOtpVerifyLimiter, verifyCustomerPhoneAuth)
customerRouter.post(
  "/auth/phone-change/start",
  customerAuthStartIpLimiter,
  customerAuthStartLimiter,
  requireAuth,
  requireRole("customer"),
  startCustomerPhoneChangeOtp
)
customerRouter.post(
  "/auth/phone-change/verify",
  customerOtpVerifyLimiter,
  requireAuth,
  requireRole("customer"),
  verifyCustomerPhoneChangeOtp
)
customerRouter.post("/auth/google", signinCustomerGoogle)
customerRouter.get("/profile", requireAuth, requireRole("customer"), getCustomerProfileSummary)
customerRouter.get("/referrals/summary", requireAuth, requireRole("customer"), getCustomerReferralSummaryController)
customerRouter.post("/referrals/apply", requireAuth, requireRole("customer"), postCustomerReferralApplyController)
customerRouter.patch("/profile", requireAuth, requireRole("customer"), patchCustomerProfile)
customerRouter.patch("/profile/password", requireAuth, requireRole("customer"), patchCustomerPassword)
customerRouter.post("/account-request", requireAuth, requireRole("customer"), postCustomerAccountRequest)
customerRouter.delete(
  "/account-request",
  requireAuth,
  requireRole("customer"),
  deleteCustomerAccountRequest
)
customerRouter.get(
  "/support-cases/latest",
  requireAuth,
  requireRole("customer"),
  getCustomerLatestSupportCaseController
)
customerRouter.get(
  "/support-cases/:supportCaseId",
  requireAuth,
  requireRole("customer"),
  getCustomerSupportCaseController
)
customerRouter.post(
  "/support-cases",
  customerSupportWriteLimiter,
  requireAuth,
  requireRole("customer"),
  postCustomerSupportCaseController
)
customerRouter.post(
  "/support-cases/:supportCaseId/messages",
  customerSupportWriteLimiter,
  requireAuth,
  requireRole("customer"),
  postCustomerSupportCaseMessageController
)
customerRouter.post("/auth/refresh", customerRefreshLimiter, refreshCustomerAuth)
customerRouter.post("/auth/logout", logoutCustomerAuth)
customerRouter.get("/discovery/home", getCustomerDiscoveryHomePage)
customerRouter.post("/vouchers/display-event", postCustomerVoucherDisplayEvent)
customerRouter.post("/push-events/open", requireAuth, requireRole("customer"), postCustomerPushOpenEvent)
customerRouter.get("/restaurants", getCustomerDiscovery)
customerRouter.get("/restaurants/:restaurantId", getCustomerRestaurant)
customerRouter.post("/cart/quote", postCustomerCartQuote)
customerRouter.get("/payments/bkash/callback", getBkashCallback)
customerRouter.get("/payments/bkash/return", getBkashReturnPage)
customerRouter.post(
  "/payments/bkash/initiate",
  customerPaymentLimiter,
  requireAuth,
  requireRole("customer"),
  postBkashInitiate
)
customerRouter.get(
  "/favorites/restaurants",
  requireAuth,
  requireRole("customer"),
  getCustomerFavoriteRestaurants
)
customerRouter.get(
  "/favorites/restaurants/cards",
  requireAuth,
  requireRole("customer"),
  getCustomerFavoriteRestaurantCards
)
customerRouter.post(
  "/favorites/restaurants/:restaurantId/toggle",
  requireAuth,
  requireRole("customer"),
  postCustomerFavoriteToggle
)
customerRouter.get("/locations", requireAuth, requireRole("customer"), getCustomerLocations)
customerRouter.post("/locations", requireAuth, requireRole("customer"), postCustomerLocation)
customerRouter.patch("/locations/:locationId", requireAuth, requireRole("customer"), patchCustomerLocation)
customerRouter.patch(
  "/locations/:locationId/default",
  requireAuth,
  requireRole("customer"),
  patchCustomerLocationDefault
)
customerRouter.patch(
  "/locations/:locationId/touch",
  requireAuth,
  requireRole("customer"),
  patchCustomerLocationTouch
)
customerRouter.post(
  "/push-tokens",
  requireAuth,
  requireRole("customer"),
  postCustomerPushToken
)
customerRouter.get("/notifications", requireAuth, requireRole("customer"), getCustomerNotifications)
customerRouter.get(
  "/notifications/campaigns/:campaignId",
  requireAuth,
  requireRole("customer"),
  getCustomerNotificationCampaign
)
customerRouter.patch(
  "/notifications/:notificationId/read",
  requireAuth,
  requireRole("customer"),
  patchCustomerNotificationRead
)
customerRouter.patch(
  "/notifications/read-all",
  requireAuth,
  requireRole("customer"),
  patchCustomerNotificationsReadAll
)
customerRouter.delete(
  "/push-tokens",
  requireAuth,
  requireRole("customer"),
  deleteCustomerPushToken
)
customerRouter.delete(
  "/locations/:locationId",
  requireAuth,
  requireRole("customer"),
  deleteCustomerLocation
)
customerRouter.get("/orders", requireAuth, requireRole("customer"), getCustomerOrders)
customerRouter.get("/orders/:orderId", requireAuth, requireRole("customer"), getCustomerOrder)
customerRouter.post("/orders", requireAuth, requireRole("customer"), postCustomerOrder)
customerRouter.post(
  "/orders/:orderId/cancel",
  customerOrderActionLimiter,
  requireAuth,
  requireRole("customer"),
  postCustomerOrderCancel
)
customerRouter.post(
  "/orders/:orderId/review",
  customerOrderActionLimiter,
  requireAuth,
  requireRole("customer"),
  postCustomerReview
)
