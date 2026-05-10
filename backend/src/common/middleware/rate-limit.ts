import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

import { logger } from "../../config/logger";

function withIdentity(req: Request, fieldNames: string[]) {
  const body = req.body as Record<string, unknown> | undefined;
  const identity = fieldNames
    .map((fieldName) => body?.[fieldName])
    .find((value) => typeof value === "string" && value.trim().length > 0);

  return `${ipKeyGenerator(req.ip ?? "")}:${typeof identity === "string" ? identity.trim() : "anonymous"}`;
}

function buildLimiter(options: {
  windowMs: number;
  limit: number;
  fieldNames?: string[];
  message: string;
  event?: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: options.message,
    },
    keyGenerator: (req) =>
      options.fieldNames?.length
        ? withIdentity(req, options.fieldNames)
        : ipKeyGenerator(req.ip ?? ""),
    handler: (req, res, _next, limiterOptions) => {
      logger.warn(
        {
          businessEvent: true,
          event: options.event ?? "rate_limit.exceeded",
          category: "security",
          severity: "warning",
          path: req.originalUrl,
          method: req.method,
          ip: req.ip,
          limit: options.limit,
          windowMs: options.windowMs,
        },
        options.message,
      );
      res.status(limiterOptions.statusCode).json(limiterOptions.message);
    },
  });
}

export function createSigninLimiter() {
  return buildLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    fieldNames: ["phone", "email"],
    message: "Too many sign-in attempts. Please wait a few minutes and try again.",
    event: "auth.signin.rate_limited",
  });
}

export function createSignupLimiter() {
  return buildLimiter({
    windowMs: 30 * 60 * 1000,
    limit: 5,
    fieldNames: ["phone", "email"],
    message: "Too many sign-up attempts. Please wait before trying again.",
    event: "auth.signup.rate_limited",
  });
}

export function createOtpSendLimiter() {
  return buildLimiter({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    fieldNames: ["phone"],
    message: "Too many OTP requests. Please wait before requesting another code.",
    event: "auth.otp_send.rate_limited",
  });
}

export function createOtpVerifyLimiter() {
  return buildLimiter({
    windowMs: 10 * 60 * 1000,
    limit: 8,
    fieldNames: ["verificationSessionId", "phone"],
    message: "Too many verification attempts. Please wait before trying again.",
    event: "auth.otp_verify.rate_limited",
  });
}

export function createPasswordRecoveryLimiter() {
  return buildLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    fieldNames: ["phone", "email"],
    message: "Too many password recovery attempts. Please wait before trying again.",
    event: "auth.password_recovery.rate_limited",
  });
}

export function createSupportWriteLimiter() {
  return buildLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: "Too many support messages. Please slow down and try again shortly.",
    event: "support.write.rate_limited",
  });
}

export function createPaymentLimiter() {
  return buildLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    message: "Too many payment attempts. Please wait a moment and try again.",
    event: "payment.initiate.rate_limited",
  });
}

export function createOrderActionLimiter() {
  return buildLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: "Too many order actions. Please wait a moment and try again.",
    event: "order.action.rate_limited",
  });
}

export function createRefreshLimiter() {
  return buildLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    message: "Too many session refresh attempts. Please try again in a few minutes.",
    event: "auth.refresh.rate_limited",
  });
}
