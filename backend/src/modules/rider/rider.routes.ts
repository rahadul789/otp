import { Router } from "express"
import {
  createOtpSendLimiter,
  createOtpVerifyLimiter,
  createPasswordRecoveryLimiter,
  createRefreshLimiter,
  createRiderLocationLimiter,
  createSigninLimiter
} from "../../common/middleware/rate-limit"

import { requireAuth, requireRole } from "../../common/middleware/auth"
import {
  getRiderLiveMapView,
  getRiderOrder,
  getRiderOrders,
  getRiderOrdersSummary,
  getRiderProfileSummary,
  logoutRiderAuth,
  deleteRiderPushToken,
  patchRiderProfileAvailability,
  patchRiderProfileLocation,
  postRiderAccept,
  postRiderDelivered,
  postRiderOrderLocation,
  postRiderPickup,
  postRiderPushToken,
  postRiderTrackingActivate,
  refreshRiderAuth,
  resetRiderPasswordAuth,
  signinRiderPasswordAuth,
  startRiderPhoneAuth,
  startRiderPasswordResetAuth,
  verifyRiderPasswordResetAuth,
  verifyRiderPhoneAuth
} from "./rider.controller"

export const riderRouter = Router()
const riderAuthStartLimiter = createOtpSendLimiter()
const riderAuthVerifyLimiter = createOtpVerifyLimiter()
const riderSigninLimiter = createSigninLimiter()
const riderPasswordRecoveryLimiter = createPasswordRecoveryLimiter()
const riderRefreshLimiter = createRefreshLimiter()
const riderLocationLimiter = createRiderLocationLimiter()

riderRouter.post("/auth/phone/start", riderAuthStartLimiter, startRiderPhoneAuth)
riderRouter.post("/auth/phone/verify", riderAuthVerifyLimiter, verifyRiderPhoneAuth)
riderRouter.post("/auth/password/signin", riderSigninLimiter, signinRiderPasswordAuth)
riderRouter.post("/auth/password/forgot", riderPasswordRecoveryLimiter, startRiderPasswordResetAuth)
riderRouter.post("/auth/password/verify", riderAuthVerifyLimiter, verifyRiderPasswordResetAuth)
riderRouter.post("/auth/password/reset", riderPasswordRecoveryLimiter, resetRiderPasswordAuth)
riderRouter.post("/auth/refresh", riderRefreshLimiter, refreshRiderAuth)
riderRouter.post("/auth/logout", logoutRiderAuth)

riderRouter.get("/profile", requireAuth, requireRole("rider"), getRiderProfileSummary)
riderRouter.patch(
  "/profile/availability",
  requireAuth,
  requireRole("rider"),
  patchRiderProfileAvailability
)
riderRouter.patch(
  "/profile/location",
  requireAuth,
  requireRole("rider"),
  riderLocationLimiter,
  patchRiderProfileLocation
)
riderRouter.post("/push-tokens", requireAuth, requireRole("rider"), postRiderPushToken)
riderRouter.delete("/push-tokens", requireAuth, requireRole("rider"), deleteRiderPushToken)
riderRouter.get("/live-map", requireAuth, requireRole("rider"), getRiderLiveMapView)
riderRouter.get("/orders", requireAuth, requireRole("rider"), getRiderOrders)
riderRouter.get("/orders/summary", requireAuth, requireRole("rider"), getRiderOrdersSummary)
riderRouter.get("/orders/:orderId", requireAuth, requireRole("rider"), getRiderOrder)
riderRouter.post("/orders/:orderId/accept", requireAuth, requireRole("rider"), postRiderAccept)
riderRouter.post("/orders/:orderId/pickup", requireAuth, requireRole("rider"), postRiderPickup)
riderRouter.post("/orders/:orderId/deliver", requireAuth, requireRole("rider"), postRiderDelivered)
riderRouter.post(
  "/orders/:orderId/tracking/activate",
  requireAuth,
  requireRole("rider"),
  postRiderTrackingActivate
)
riderRouter.post(
  "/orders/:orderId/location",
  requireAuth,
  requireRole("rider"),
  riderLocationLimiter,
  postRiderOrderLocation
)
