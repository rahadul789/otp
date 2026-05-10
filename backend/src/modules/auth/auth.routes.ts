import { Router } from "express"
import {
  createOtpSendLimiter,
  createOtpVerifyLimiter,
  createPasswordRecoveryLimiter,
  createRefreshLimiter,
  createSigninLimiter,
  createSignupLimiter
} from "../../common/middleware/rate-limit"

import {
  forgotPassword,
  ownerLogout,
  ownerSignin,
  ownerSignup,
  refreshOwnerAuthSession,
  resetOwnerPassword,
  sendOtp,
  verifyOtp
} from "./auth.controller"

export const authRouter = Router()
const ownerSignupLimiter = createSignupLimiter()
const ownerSigninLimiter = createSigninLimiter()
const otpSendLimiter = createOtpSendLimiter()
const otpVerifyLimiter = createOtpVerifyLimiter()
const passwordRecoveryLimiter = createPasswordRecoveryLimiter()
const refreshLimiter = createRefreshLimiter()

authRouter.post("/owner/signup", ownerSignupLimiter, ownerSignup)
authRouter.post("/owner/signin", ownerSigninLimiter, ownerSignin)
authRouter.post("/owner/refresh", refreshLimiter, refreshOwnerAuthSession)
authRouter.post("/owner/logout", ownerLogout)
authRouter.post("/otp/send", otpSendLimiter, sendOtp)
authRouter.post("/otp/verify", otpVerifyLimiter, verifyOtp)
authRouter.post("/password/forgot", passwordRecoveryLimiter, forgotPassword)
authRouter.post("/password/reset", passwordRecoveryLimiter, resetOwnerPassword)
