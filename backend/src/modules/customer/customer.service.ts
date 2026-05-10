import crypto from "node:crypto";
import mongoose from "mongoose";

import { StatusCodes } from "http-status-codes";

import { AppError } from "../../common/utils/app-error";
import { decorateTrackingSnapshot } from "../../common/utils/tracking-freshness";
import { logger } from "../../config/logger";
import { env } from "../../config/env";
import { emitSocketEvent } from "../../config/socket";
import { createAdminOperationalAlert } from "../admin/admin-alert.service";
import { createOtpSession } from "../auth/auth.service";
import { getPlatformContent } from "../public/content.service";
import {
  compareOtpCode,
  comparePassword,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../auth/auth.utils";
import { OtpSessionModel, RestaurantModel } from "../auth/auth.model";
import { LedgerEntryModel } from "../owner/finance.model";
import { createOwnerNotification } from "../owner/operational.service";
import { ReviewModel, SupportCaseModel } from "../owner/experience.model";
import {
  CategoryModel,
  MenuItemModel,
  OrderModel,
} from "../owner/operational.model";
import {
  BkashSandboxPaymentSessionModel,
  CustomerModel,
  CustomerRefreshTokenSessionModel,
  RestaurantCollectionModel,
  VoucherModel,
  VoucherRedemptionModel,
} from "./customer.model";

const CUSTOMER_REFRESH_EXPIRY_DAYS = 30;
const DEFAULT_CUSTOMER_ORDER_PAGE_SIZE = 80;
const MAX_CUSTOMER_ORDER_PAGE_SIZE = 100;
const MAX_CUSTOMER_PUSH_TOKENS = 5;
const DISABLED_CUSTOMER_PUSH_TOKEN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SUPPORT_CASE_REPLIES = 300;
const MAX_ORDER_HISTORY_ENTRIES = 100;
let restaurantDataBackfillPromise: Promise<void> | null = null;
let customerIdentityBackfillPromise: Promise<void> | null = null;

function normalizePageBounds(params?: { page?: number; pageSize?: number }) {
  const page = Math.max(1, Math.floor(Number(params?.page ?? 1)) || 1);
  const pageSize = Math.min(
    MAX_CUSTOMER_ORDER_PAGE_SIZE,
    Math.max(
      1,
      Math.floor(
        Number(params?.pageSize ?? DEFAULT_CUSTOMER_ORDER_PAGE_SIZE),
      ) || DEFAULT_CUSTOMER_ORDER_PAGE_SIZE,
    ),
  );
  return { page, pageSize };
}

function pruneCustomerPushTokens(customer: { pushTokens: any[] }) {
  const disabledCutoff = Date.now() - DISABLED_CUSTOMER_PUSH_TOKEN_RETENTION_MS;
  customer.pushTokens = (customer.pushTokens ?? [])
    .filter((token) => {
      if (!token?.disabledAt) return true;
      return new Date(token.disabledAt).getTime() >= disabledCutoff;
    })
    .sort((left, right) => {
      const leftActive = left.disabledAt ? 0 : 1;
      const rightActive = right.disabledAt ? 0 : 1;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return (
        new Date(right.lastSeenAt ?? 0).getTime() -
        new Date(left.lastSeenAt ?? 0).getTime()
      );
    })
    .slice(0, MAX_CUSTOMER_PUSH_TOKENS);
}

async function ensureCustomerIdentityBackfill() {
  if (!customerIdentityBackfillPromise) {
    customerIdentityBackfillPromise = Promise.all([
      CustomerModel.updateMany(
        { googleSub: "" },
        {
          $unset: {
            googleSub: 1,
          },
        },
      ),
      CustomerModel.updateMany(
        { phone: "" },
        {
          $unset: {
            phone: 1,
          },
        },
      ),
      CustomerModel.updateMany(
        { passwordHash: null },
        {
          $set: {
            passwordHash: "",
          },
        },
      ),
    ])
      .then(() => undefined)
      .catch(() => undefined);
  }

  await customerIdentityBackfillPromise;
}

async function ensureRestaurantDiscoveryBackfill() {
  if (!restaurantDataBackfillPromise) {
    restaurantDataBackfillPromise = Promise.all([
      RestaurantModel.updateMany(
        {
          locationPoint: null,
          "location.latitude": { $type: "number" },
          "location.longitude": { $type: "number" },
        },
        [
          {
            $set: {
              locationPoint: {
                type: "Point",
                coordinates: ["$location.longitude", "$location.latitude"],
              },
            },
          },
        ],
      ),
      RestaurantModel.updateMany(
        {
          $or: [
            { "runtime.isVisible": { $exists: false } },
            { "runtime.isVisible": false },
          ],
        },
        {
          $set: {
            "runtime.isVisible": true,
          },
        },
      ),
    ])
      .then(() => undefined)
      .catch(() => undefined);
  }

  await restaurantDataBackfillPromise;
}

function buildCustomerAuthPayload(params: {
  customerId: string;
  fullName: string;
  phone?: string;
  email?: string;
  profileImage?: { url?: string; publicId?: string };
  previousPhones?: Array<{ phone?: string; changedAt?: Date | string | null }>;
  notificationSettings?: {
    orderUpdates?: boolean;
    restaurantStatus?: boolean;
    reviewReplies?: boolean;
  };
  accountRequest?: {
    type?: "deactivate" | "delete" | null;
    reason?: string;
    reviewNote?: string;
    reviewedByAdminId?: string | null;
    reviewedByAdminName?: string;
    status?: string | null;
    requestedAt?: Date | string | null;
    reviewedAt?: Date | string | null;
    history?: Array<{
      action?: string;
      note?: string;
      actorId?: string;
      actorName?: string;
      createdAt?: Date | string | null;
    }>;
  };
  refreshToken: string;
}) {
  return {
    accessToken: signAccessToken({
      subject: params.customerId,
      role: "customer",
    }),
    refreshToken: params.refreshToken,
    customer: {
      id: params.customerId,
      fullName: params.fullName,
      phone: params.phone ?? "",
      email: params.email ?? "",
      profileImage: params.profileImage ?? { url: "", publicId: "" },
      previousPhones: (params.previousPhones ?? []).map((entry) => ({
        phone: entry.phone ?? "",
        changedAt: entry.changedAt
          ? new Date(entry.changedAt).toISOString()
          : null,
      })),
      notificationSettings: {
        orderUpdates: params.notificationSettings?.orderUpdates ?? true,
        restaurantStatus: params.notificationSettings?.restaurantStatus ?? true,
        reviewReplies: params.notificationSettings?.reviewReplies ?? true,
      },
      accountRequest: {
        type: params.accountRequest?.type ?? null,
        reason: params.accountRequest?.reason ?? "",
        reviewNote: params.accountRequest?.reviewNote ?? "",
        reviewedByAdminId: params.accountRequest?.reviewedByAdminId ?? null,
        reviewedByAdminName: params.accountRequest?.reviewedByAdminName ?? "",
        status: params.accountRequest?.status ?? null,
        requestedAt: params.accountRequest?.requestedAt
          ? new Date(params.accountRequest.requestedAt).toISOString()
          : null,
        reviewedAt: params.accountRequest?.reviewedAt
          ? new Date(params.accountRequest.reviewedAt).toISOString()
          : null,
        history: (params.accountRequest?.history ?? []).map((entry) => ({
          action: entry.action ?? "",
          note: entry.note ?? "",
          actorId: entry.actorId ?? "",
          actorName: entry.actorName ?? "",
          createdAt: entry.createdAt
            ? new Date(entry.createdAt).toISOString()
            : null,
        })),
      },
    },
  };
}

function mapSavedLocation(location: {
  _id?: mongoose.Types.ObjectId | string;
  id?: string;
  label?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  isDefault?: boolean;
  lastUsedAt?: Date | string | null;
}) {
  return {
    id: String(location._id ?? location.id ?? ""),
    label: location.label ?? "",
    address: location.address ?? "",
    latitude: location.latitude ?? 0,
    longitude: location.longitude ?? 0,
    source:
      location.source === "gps" ||
      location.source === "manual" ||
      location.source === "saved"
        ? location.source
        : "saved",
    isDefault: Boolean(location.isDefault),
    lastUsedAt: location.lastUsedAt
      ? new Date(location.lastUsedAt).toISOString()
      : null,
  };
}

async function createCustomerRefreshSession(params: {
  customerId: string;
  userAgent?: string;
  ipAddress?: string;
}) {
  const tokenId = crypto.randomUUID();
  const refreshToken = signRefreshToken({
    subject: params.customerId,
    role: "customer",
    tokenId,
  });

  const tokenHash = await hashPassword(refreshToken);

  await CustomerRefreshTokenSessionModel.create({
    customerId: params.customerId,
    tokenId,
    tokenHash,
    userAgent: params.userAgent ?? "",
    ipAddress: params.ipAddress ?? "",
    expiresAt: new Date(
      Date.now() + CUSTOMER_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ),
  });

  return refreshToken;
}

function normalizeCustomerEmail(email?: string) {
  return email?.trim().toLowerCase() ?? "";
}

function validateCustomerPassword(password?: string) {
  const normalizedPassword = password?.trim() ?? "";

  if (normalizedPassword.length < 8) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PASSWORD_TOO_SHORT",
      "Use at least 8 characters for your password",
    );
  }

  return normalizedPassword;
}

function getBkashConfig() {
  if (
    !env.BKASH_BASE_URL ||
    !env.BKASH_USERNAME ||
    !env.BKASH_PASSWORD ||
    !env.BKASH_APP_KEY ||
    !env.BKASH_APP_SECRET
  ) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "BKASH_NOT_CONFIGURED",
      "bKash is not configured yet on the server",
    );
  }

  return {
    baseUrl: env.BKASH_BASE_URL.replace(/\/+$/, ""),
    username: env.BKASH_USERNAME,
    password: env.BKASH_PASSWORD,
    appKey: env.BKASH_APP_KEY,
    appSecret: env.BKASH_APP_SECRET,
  };
}

async function postBkashJson<T>(params: {
  url: string;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}) {
  const response = await fetch(params.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(params.headers ?? {}),
    },
    body: JSON.stringify(params.body),
  });

  const rawText = await response.text();
  const payload = rawText
    ? (JSON.parse(rawText) as Record<string, unknown>)
    : {};

  if (!response.ok) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      "BKASH_GATEWAY_ERROR",
      typeof payload.errorMessage === "string"
        ? payload.errorMessage
        : typeof payload.statusMessage === "string"
          ? payload.statusMessage
          : "bKash gateway request failed",
    );
  }

  if (
    (typeof payload.statusCode === "string" && payload.statusCode !== "0000") ||
    typeof payload.errorCode === "string"
  ) {
    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      "BKASH_GATEWAY_ERROR",
      typeof payload.errorMessage === "string"
        ? payload.errorMessage
        : typeof payload.statusMessage === "string"
          ? payload.statusMessage
          : "bKash gateway request failed",
    );
  }

  return payload as T;
}

async function grantBkashToken() {
  const config = getBkashConfig();

  return postBkashJson<{
    id_token: string;
    refresh_token?: string;
  }>({
    url: `${config.baseUrl}/tokenized/checkout/token/grant`,
    headers: {
      username: config.username,
      password: config.password,
    },
    body: {
      app_key: config.appKey,
      app_secret: config.appSecret,
    },
  });
}

async function createBkashUrlPayment(params: {
  amount: number;
  payerReference: string;
  merchantInvoiceNumber: string;
  callbackURL: string;
}) {
  const config = getBkashConfig();
  const token = await grantBkashToken();

  return postBkashJson<{
    paymentID: string;
    bkashURL: string;
  }>({
    url: `${config.baseUrl}/tokenized/checkout/create`,
    headers: {
      Authorization: token.id_token,
      "X-APP-Key": config.appKey,
    },
    body: {
      mode: "0011",
      payerReference: params.payerReference,
      callbackURL: params.callbackURL,
      amount: params.amount.toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: params.merchantInvoiceNumber,
    },
  });
}

async function executeBkashPayment(paymentID: string) {
  const config = getBkashConfig();
  const token = await grantBkashToken();

  return postBkashJson<{
    paymentID: string;
    trxID?: string;
    transactionStatus?: string;
  }>({
    url: `${config.baseUrl}/tokenized/checkout/execute`,
    headers: {
      Authorization: token.id_token,
      "X-APP-Key": config.appKey,
    },
    body: {
      paymentID,
    },
  });
}

export async function startCustomerPhoneSignin(phone: string) {
  await ensureCustomerIdentityBackfill();
  const customer = await CustomerModel.findOne({ phone });

  if (customer) {
    assertCustomerAccountAccessible(customer);

    if (customer.passwordHash?.trim()) {
      return {
        flow: "password" as const,
        phone,
        customer: {
          fullName: customer.fullName ?? "",
          email: customer.email ?? "",
        },
      };
    }
  }

  const otpSession = await createOtpSession({
    phone,
    purpose: "customer_phone_signin",
    referenceId: phone,
  });

  return {
    flow: "otp" as const,
    phone,
    verificationSessionId: otpSession.id,
    expiresInSeconds: 300,
    customer: customer
      ? {
          fullName: customer.fullName ?? "",
          email: customer.email ?? "",
        }
      : null,
  };
}

export async function signinCustomerWithPassword(params: {
  phone: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}) {
  await ensureCustomerIdentityBackfill();
  const customer = await CustomerModel.findOne({ phone: params.phone });

  if (!customer || !customer.passwordHash?.trim()) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "INVALID_CREDENTIALS",
      "This phone number or password is incorrect",
    );
  }

  assertCustomerAccountAccessible(customer);

  const isPasswordValid = await comparePassword(
    params.password,
    customer.passwordHash,
  );

  if (!isPasswordValid) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "INVALID_CREDENTIALS",
      "This phone number or password is incorrect",
    );
  }

  customer.lastLoginAt = new Date();
  await customer.save();

  const refreshToken = await createCustomerRefreshSession({
    customerId: customer.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return buildCustomerAuthPayload({
    customerId: customer.id,
    fullName: customer.fullName,
    phone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    profileImage: customer.profileImage,
    previousPhones: customer.previousPhones,
    notificationSettings: customer.notificationSettings,
    accountRequest: customer.accountRequest,
    refreshToken,
  });
}

export async function verifyCustomerPhoneOtp(params: {
  verificationSessionId: string;
  otpCode: string;
}) {
  await ensureCustomerIdentityBackfill();
  const otpSession = await OtpSessionModel.findById(
    params.verificationSessionId,
  );

  if (!otpSession || otpSession.purpose !== "customer_phone_signin") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "OTP_SESSION_NOT_FOUND",
      "Verification session not found",
    );
  }

  if (otpSession.status !== "pending") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "OTP_NOT_ACTIVE",
      "OTP session is not active",
    );
  }

  if (otpSession.expiresAt.getTime() < Date.now()) {
    otpSession.status = "expired";
    await otpSession.save();
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "OTP_EXPIRED",
      "OTP has expired",
    );
  }

  const isOtpValid = await compareOtpCode(
    params.otpCode,
    otpSession.otpCodeHash,
  );

  if (!isOtpValid) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_OTP",
      "Invalid OTP code",
    );
  }

  otpSession.status = "verified";
  otpSession.verifiedAt = new Date();
  await otpSession.save();

  return {
    verificationSessionId: otpSession.id,
    phone: otpSession.phone,
    expiresInSeconds: Math.max(
      0,
      Math.floor((otpSession.expiresAt.getTime() - Date.now()) / 1000),
    ),
  };
}

export async function verifyCustomerPhoneSignin(params: {
  verificationSessionId: string;
  fullName?: string;
  email?: string;
  password?: string;
  userAgent?: string;
  ipAddress?: string;
}) {
  await ensureCustomerIdentityBackfill();
  const otpSession = await OtpSessionModel.findById(
    params.verificationSessionId,
  );

  if (!otpSession || otpSession.purpose !== "customer_phone_signin") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "OTP_SESSION_NOT_FOUND",
      "Verification session not found",
    );
  }

  if (otpSession.status !== "verified") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "OTP_NOT_VERIFIED",
      "Verify the OTP first before finishing registration",
    );
  }

  let customer = await CustomerModel.findOne({ phone: otpSession.phone });
  const normalizedFullName = params.fullName?.trim() ?? "";
  const normalizedEmail = normalizeCustomerEmail(params.email);

  if (!customer) {
    const password = validateCustomerPassword(params.password);

    if (!normalizedFullName) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "FULL_NAME_REQUIRED",
        "Enter your name to finish creating this account",
      );
    }

    customer = await CustomerModel.create({
      fullName: normalizedFullName,
      phone: otpSession.phone,
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      authProviders: ["phone"],
    });
  } else {
    assertCustomerAccountAccessible(customer);

    if (!customer.passwordHash?.trim()) {
      const password = validateCustomerPassword(params.password);

      if (!normalizedFullName && !customer.fullName?.trim()) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "FULL_NAME_REQUIRED",
          "Enter your name to finish creating this account",
        );
      }

      customer.fullName =
        normalizedFullName || customer.fullName || "Foodex Customer";

      if (normalizedEmail) {
        customer.email = normalizedEmail;
      }

      customer.passwordHash = await hashPassword(password);
    }

    if (!customer.authProviders.includes("phone")) {
      customer.authProviders = [...customer.authProviders, "phone"];
    }

    await customer.save();
  }

  assertCustomerAccountAccessible(customer);

  customer.lastLoginAt = new Date();
  await customer.save();

  otpSession.status = "consumed";
  await otpSession.save();

  const refreshToken = await createCustomerRefreshSession({
    customerId: customer.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return buildCustomerAuthPayload({
    customerId: customer.id,
    fullName: customer.fullName,
    phone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    profileImage: customer.profileImage,
    previousPhones: customer.previousPhones,
    notificationSettings: customer.notificationSettings,
    accountRequest: customer.accountRequest,
    refreshToken,
  });
}

export async function signinCustomerWithGoogle(params: {
  googleSub: string;
  email: string;
  fullName: string;
  profileImage?: { url?: string; publicId?: string };
  userAgent?: string;
  ipAddress?: string;
}) {
  await ensureCustomerIdentityBackfill();
  let customer = await CustomerModel.findOne({ googleSub: params.googleSub });

  if (!customer) {
    customer = await CustomerModel.create({
      googleSub: params.googleSub,
      email: params.email,
      fullName: params.fullName,
      profileImage: params.profileImage ?? { url: "", publicId: "" },
      authProviders: ["google"],
    });
  } else {
    assertCustomerAccountAccessible(customer);
    customer.email = params.email;
    customer.fullName = params.fullName;
    customer.profileImage = {
      ...(customer.profileImage ?? { url: "", publicId: "" }),
      ...(params.profileImage ?? {}),
    };
    if (!customer.authProviders.includes("google")) {
      customer.authProviders = [...customer.authProviders, "google"];
    }
    await customer.save();
  }

  assertCustomerAccountAccessible(customer);

  customer.lastLoginAt = new Date();
  await customer.save();

  const refreshToken = await createCustomerRefreshSession({
    customerId: customer.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return buildCustomerAuthPayload({
    customerId: customer.id,
    fullName: customer.fullName,
    phone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    profileImage: customer.profileImage,
    previousPhones: customer.previousPhones,
    notificationSettings: customer.notificationSettings,
    accountRequest: customer.accountRequest,
    refreshToken,
  });
}

export async function refreshCustomerSession(params: {
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
}) {
  const payload = verifyRefreshToken(params.refreshToken);

  if (!payload.tokenId) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "INVALID_REFRESH_TOKEN",
      "Invalid refresh token",
    );
  }

  const session = await CustomerRefreshTokenSessionModel.findOne({
    tokenId: payload.tokenId,
    customerId: payload.sub,
  });

  if (!session || session.revokedAt) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "SESSION_REVOKED",
      "Refresh session is not active",
    );
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "SESSION_EXPIRED",
      "Refresh session has expired",
    );
  }

  const isValid = await comparePassword(params.refreshToken, session.tokenHash);

  if (!isValid) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "INVALID_REFRESH_TOKEN",
      "Invalid refresh token",
    );
  }

  const customer = await CustomerModel.findById(payload.sub);

  if (!customer) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "CUSTOMER_NOT_FOUND",
      "Customer not found",
    );
  }

  assertCustomerAccountAccessible(customer);

  session.revokedAt = new Date();
  await session.save();

  const refreshToken = await createCustomerRefreshSession({
    customerId: customer.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return buildCustomerAuthPayload({
    customerId: customer.id,
    fullName: customer.fullName,
    phone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    profileImage: customer.profileImage,
    previousPhones: customer.previousPhones,
    notificationSettings: customer.notificationSettings,
    accountRequest: customer.accountRequest,
    refreshToken,
  });
}

export async function startCustomerPhoneChange(params: {
  customerId: string;
  phone: string;
}) {
  await ensureCustomerIdentityBackfill();
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);
  const nextPhone = params.phone.trim();

  if (!/^01\d{9}$/.test(nextPhone)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_PHONE",
      "Enter a valid phone number",
    );
  }

  if (customer.phone === nextPhone) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PHONE_UNCHANGED",
      "Enter a different phone number to continue",
    );
  }

  const existingCustomer = await CustomerModel.findOne({
    _id: { $ne: customer._id },
    $or: [{ phone: nextPhone }, { pendingPhone: nextPhone }],
  });

  if (existingCustomer) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "PHONE_ALREADY_IN_USE",
      "An account already exists with this phone number",
    );
  }

  customer.pendingPhone = nextPhone;
  await customer.save();

  const otpSession = await createOtpSession({
    phone: nextPhone,
    purpose: "customer_phone_change",
    referenceId: customer.id,
  });

  return {
    verificationSessionId: otpSession.id,
    expiresInSeconds: 300,
  };
}

export async function verifyCustomerPhoneChange(params: {
  customerId: string;
  verificationSessionId: string;
  otpCode: string;
}) {
  await ensureCustomerIdentityBackfill();
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);
  const otpSession = await OtpSessionModel.findById(
    params.verificationSessionId,
  );

  if (!otpSession || otpSession.purpose !== "customer_phone_change") {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "OTP_SESSION_NOT_FOUND",
      "Verification session not found",
    );
  }

  if (otpSession.referenceId !== customer.id) {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "OTP_SESSION_MISMATCH",
      "This verification session does not belong to your account",
    );
  }

  if (otpSession.status !== "pending") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "OTP_NOT_ACTIVE",
      "OTP session is not active",
    );
  }

  if (otpSession.expiresAt.getTime() < Date.now()) {
    otpSession.status = "expired";
    await otpSession.save();
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "OTP_EXPIRED",
      "OTP has expired",
    );
  }

  const isOtpValid = await compareOtpCode(
    params.otpCode,
    otpSession.otpCodeHash,
  );

  if (!isOtpValid) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_OTP",
      "Invalid OTP code",
    );
  }

  if (customer.pendingPhone !== otpSession.phone) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PHONE_CHANGE_MISMATCH",
      "Pending phone number does not match verification request",
    );
  }

  const existingCustomer = await CustomerModel.findOne({
    _id: { $ne: customer._id },
    phone: otpSession.phone,
  });

  if (existingCustomer) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "PHONE_ALREADY_IN_USE",
      "An account already exists with this phone number",
    );
  }

  if (customer.phone) {
    customer.set("previousPhones", [
      {
        phone: customer.phone,
        changedAt: new Date(),
      },
      ...(customer.previousPhones ?? [])
        .filter((entry) => entry.phone !== customer.phone)
        .slice(0, 9),
    ]);
  }

  customer.phone = otpSession.phone;
  customer.pendingPhone = null;
  await customer.save();

  otpSession.status = "consumed";
  otpSession.verifiedAt = new Date();
  await otpSession.save();

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      profileImage: customer.profileImage ?? { url: "", publicId: "" },
      previousPhones: (customer.previousPhones ?? []).map((entry) => ({
        phone: entry.phone ?? "",
        changedAt: entry.changedAt
          ? new Date(entry.changedAt).toISOString()
          : null,
      })),
      notificationSettings: {
        orderUpdates: customer.notificationSettings?.orderUpdates ?? true,
        restaurantStatus:
          customer.notificationSettings?.restaurantStatus ?? true,
        reviewReplies: customer.notificationSettings?.reviewReplies ?? true,
      },
      accountRequest: {
        type: customer.accountRequest?.type ?? null,
        reason: customer.accountRequest?.reason ?? "",
        status: customer.accountRequest?.status ?? null,
        requestedAt: customer.accountRequest?.requestedAt
          ? new Date(customer.accountRequest.requestedAt).toISOString()
          : null,
        reviewedAt: customer.accountRequest?.reviewedAt
          ? new Date(customer.accountRequest.reviewedAt).toISOString()
          : null,
      },
    },
  };
}

export async function updateCustomerProfile(params: {
  customerId: string;
  fullName?: string;
  email?: string;
  profileImage?: { url?: string; publicId?: string };
  notificationSettings?: {
    orderUpdates?: boolean;
    restaurantStatus?: boolean;
    reviewReplies?: boolean;
  };
}) {
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);

  if (params.fullName !== undefined) {
    customer.fullName = params.fullName.trim();
  }

  if (params.email !== undefined) {
    customer.email = params.email.trim();
  }

  if (params.profileImage !== undefined) {
    customer.profileImage = {
      ...(customer.profileImage ?? { url: "", publicId: "" }),
      ...params.profileImage,
    };
  }

  if (params.notificationSettings !== undefined) {
    customer.notificationSettings = {
      ...(customer.notificationSettings ?? {
        orderUpdates: true,
        restaurantStatus: true,
        reviewReplies: true,
      }),
      ...params.notificationSettings,
    };
  }

  await customer.save();

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      profileImage: customer.profileImage ?? { url: "", publicId: "" },
      previousPhones: (customer.previousPhones ?? []).map((entry) => ({
        phone: entry.phone ?? "",
        changedAt: entry.changedAt
          ? new Date(entry.changedAt).toISOString()
          : null,
      })),
      notificationSettings: {
        orderUpdates: customer.notificationSettings?.orderUpdates ?? true,
        restaurantStatus:
          customer.notificationSettings?.restaurantStatus ?? true,
        reviewReplies: customer.notificationSettings?.reviewReplies ?? true,
      },
      accountRequest: {
        type: customer.accountRequest?.type ?? null,
        reason: customer.accountRequest?.reason ?? "",
        status: customer.accountRequest?.status ?? null,
        requestedAt: customer.accountRequest?.requestedAt
          ? new Date(customer.accountRequest.requestedAt).toISOString()
          : null,
        reviewedAt: customer.accountRequest?.reviewedAt
          ? new Date(customer.accountRequest.reviewedAt).toISOString()
          : null,
      },
    },
  };
}

export async function getCustomerProfile(customerId: string) {
  const customer = await getCustomerById(ensureCustomerIdentity(customerId));

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      profileImage: customer.profileImage ?? { url: "", publicId: "" },
      previousPhones: (customer.previousPhones ?? []).map((entry) => ({
        phone: entry.phone ?? "",
        changedAt: entry.changedAt
          ? new Date(entry.changedAt).toISOString()
          : null,
      })),
      notificationSettings: {
        orderUpdates: customer.notificationSettings?.orderUpdates ?? true,
        restaurantStatus:
          customer.notificationSettings?.restaurantStatus ?? true,
        reviewReplies: customer.notificationSettings?.reviewReplies ?? true,
      },
      accountRequest: {
        type: customer.accountRequest?.type ?? null,
        reason: customer.accountRequest?.reason ?? "",
        reviewNote: customer.accountRequest?.reviewNote ?? "",
        reviewedByAdminId: customer.accountRequest?.reviewedByAdminId ?? null,
        reviewedByAdminName: customer.accountRequest?.reviewedByAdminName ?? "",
        status: customer.accountRequest?.status ?? null,
        requestedAt: customer.accountRequest?.requestedAt
          ? new Date(customer.accountRequest.requestedAt).toISOString()
          : null,
        reviewedAt: customer.accountRequest?.reviewedAt
          ? new Date(customer.accountRequest.reviewedAt).toISOString()
          : null,
        history: (customer.accountRequest?.history ?? []).map((entry) => ({
          action: entry.action ?? "",
          note: entry.note ?? "",
          actorId: entry.actorId ?? "",
          actorName: entry.actorName ?? "",
          createdAt: entry.createdAt
            ? new Date(entry.createdAt).toISOString()
            : null,
        })),
      },
    },
  };
}

export async function requestCustomerAccountChange(params: {
  customerId: string;
  type: "deactivate" | "delete";
  reason?: string;
}) {
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);

  customer.set("accountRequest", {
    type: params.type,
    reason: params.reason?.trim() ?? "",
    reviewNote: "",
    reviewedByAdminId: null,
    reviewedByAdminName: "",
    status: "pending",
    requestedAt: new Date(),
    reviewedAt: null,
    history: [
      {
        action: "submitted",
        note: params.reason?.trim() ?? "",
        actorId: customer.id,
        actorName: customer.fullName,
        createdAt: new Date(),
      },
    ],
  });
  customer.set("accountRequest.history", [
    {
      action: "submitted",
      note: params.reason?.trim() ?? "",
      actorId: customer.id,
      actorName: customer.fullName,
      createdAt: new Date(),
    },
  ]);

  await customer.save();

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      profileImage: customer.profileImage ?? { url: "", publicId: "" },
      previousPhones: (customer.previousPhones ?? []).map((entry) => ({
        phone: entry.phone ?? "",
        changedAt: entry.changedAt
          ? new Date(entry.changedAt).toISOString()
          : null,
      })),
      notificationSettings: {
        orderUpdates: customer.notificationSettings?.orderUpdates ?? true,
        restaurantStatus:
          customer.notificationSettings?.restaurantStatus ?? true,
        reviewReplies: customer.notificationSettings?.reviewReplies ?? true,
      },
      accountRequest: {
        type: customer.accountRequest?.type ?? null,
        reason: customer.accountRequest?.reason ?? "",
        status: customer.accountRequest?.status ?? null,
        requestedAt: customer.accountRequest?.requestedAt
          ? new Date(customer.accountRequest.requestedAt).toISOString()
          : null,
        reviewedAt: customer.accountRequest?.reviewedAt
          ? new Date(customer.accountRequest.reviewedAt).toISOString()
          : null,
      },
    },
  };
}

export async function cancelCustomerAccountChangeRequest(params: {
  customerId: string;
}) {
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);

  customer.set("accountRequest", {
    type: null,
    reason: "",
    reviewNote: "",
    reviewedByAdminId: null,
    reviewedByAdminName: "",
    status: "cancelled",
    requestedAt: null,
    reviewedAt: new Date(),
    history: [],
  });
  customer.set(
    "accountRequest.history",
    [
      ...((customer.accountRequest?.history ?? []).map((entry) => ({
        action: entry.action,
        note: entry.note,
        actorId: entry.actorId,
        actorName: entry.actorName,
        createdAt: entry.createdAt,
      })) as Array<Record<string, unknown>>),
      {
        action: "cancelled",
        note: "Cancelled by customer",
        actorId: customer.id,
        actorName: customer.fullName,
        createdAt: new Date(),
      },
    ].slice(-10),
  );

  await customer.save();

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      profileImage: customer.profileImage ?? { url: "", publicId: "" },
      previousPhones: (customer.previousPhones ?? []).map((entry) => ({
        phone: entry.phone ?? "",
        changedAt: entry.changedAt
          ? new Date(entry.changedAt).toISOString()
          : null,
      })),
      notificationSettings: {
        orderUpdates: customer.notificationSettings?.orderUpdates ?? true,
        restaurantStatus:
          customer.notificationSettings?.restaurantStatus ?? true,
        reviewReplies: customer.notificationSettings?.reviewReplies ?? true,
      },
      accountRequest: {
        type: customer.accountRequest?.type ?? null,
        reason: customer.accountRequest?.reason ?? "",
        status: customer.accountRequest?.status ?? null,
        requestedAt: customer.accountRequest?.requestedAt
          ? new Date(customer.accountRequest.requestedAt).toISOString()
          : null,
        reviewedAt: customer.accountRequest?.reviewedAt
          ? new Date(customer.accountRequest.reviewedAt).toISOString()
          : null,
      },
    },
  };
}

export async function logoutCustomerSession(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);

  if (!payload.tokenId) {
    return { revoked: true };
  }

  await CustomerRefreshTokenSessionModel.findOneAndUpdate(
    { tokenId: payload.tokenId, customerId: payload.sub, revokedAt: null },
    { revokedAt: new Date() },
  );

  return { revoked: true };
}

function getVisibleRestaurantQuery() {
  return {
    "runtime.isVisible": true,
    "runtime.isOnline": true,
  };
}

function getDiscoverableRestaurantQuery() {
  return {
    "runtime.isVisible": true,
  };
}

function buildReviewMetricsPipeline() {
  return [
    {
      $lookup: {
        from: ReviewModel.collection.name,
        let: { restaurantId: "$_id" },
        pipeline: [
          {
            $match: {
              moderationStatus: "visible",
              isHidden: { $ne: true },
              $expr: {
                $eq: ["$restaurantId", "$$restaurantId"],
              },
            },
          },
          {
            $group: {
              _id: null,
              avgRating: { $avg: "$rating" },
              reviewCount: { $sum: 1 },
            },
          },
        ],
        as: "reviewMetrics",
      },
    },
    {
      $addFields: {
        reviewCount: {
          $ifNull: [{ $first: "$reviewMetrics.reviewCount" }, 0],
        },
        avgRating: {
          $cond: [
            {
              $gt: [
                { $ifNull: [{ $first: "$reviewMetrics.reviewCount" }, 0] },
                0,
              ],
            },
            { $round: [{ $first: "$reviewMetrics.avgRating" }, 1] },
            null,
          ],
        },
      },
    },
    {
      $project: {
        reviewMetrics: 0,
      },
    },
  ];
}

function buildRestaurantCommercialsPipeline() {
  return [
    {
      $lookup: {
        from: MenuItemModel.collection.name,
        let: { restaurantId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$restaurantId", "$$restaurantId"],
              },
              status: "active",
              availability: "available",
            },
          },
          {
            $group: {
              _id: null,
              lowestMenuPrice: { $min: "$basePrice" },
            },
          },
        ],
        as: "menuPricing",
      },
    },
    {
      $addFields: {
        lowestMenuPrice: {
          $ifNull: [{ $first: "$menuPricing.lowestMenuPrice" }, null],
        },
      },
    },
    {
      $project: {
        menuPricing: 0,
      },
    },
  ];
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function normalizeDistanceKm(distanceKm: number) {
  if (!Number.isFinite(distanceKm)) {
    return 0;
  }

  const roundedDistance = Number(distanceKm.toFixed(2));
  return roundedDistance < 0.1 ? 0 : roundedDistance;
}

function roundCurrencyAmount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function calculateDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadius = 6371;
  const deltaLat = toRadians(latitudeB - latitudeA);
  const deltaLng = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return normalizeDistanceKm(earthRadius * c);
}

function calculateConfiguredDeliveryFee(params: {
  baseFeeTaka: number;
  distanceSurchargeEnabled: boolean;
  surchargeStartsAfterKm: number;
  surchargeStepMeters: number;
  surchargeAmountTaka: number;
  distanceKm?: number | null;
}) {
  const baseFee = roundCurrencyAmount(params.baseFeeTaka);
  if (!params.distanceSurchargeEnabled) {
    return baseFee;
  }

  const distanceKm =
    typeof params.distanceKm === "number" && Number.isFinite(params.distanceKm)
      ? Math.max(0, params.distanceKm)
      : null;

  if (distanceKm === null || distanceKm <= params.surchargeStartsAfterKm) {
    return baseFee;
  }

  const additionalMeters = (distanceKm - params.surchargeStartsAfterKm) * 1000;
  const steps = Math.ceil(
    additionalMeters / Math.max(params.surchargeStepMeters, 1),
  );
  return baseFee + steps * roundCurrencyAmount(params.surchargeAmountTaka);
}

function resolveDeliveryPricingConfig(params: {
  platformContent: Awaited<ReturnType<typeof getPlatformContent>>;
  restaurant: Record<string, any>;
}) {
  const globalPricing = params.platformContent.operations.deliveryPricing;
  const override = params.restaurant.commercial?.deliveryPricingOverride;

  if (!override || override.enabled !== true) {
    return globalPricing;
  }

  return {
    baseFeeTaka:
      typeof override.baseFeeTaka === "number"
        ? override.baseFeeTaka
        : globalPricing.baseFeeTaka,
    distanceSurchargeEnabled:
      typeof override.distanceSurchargeEnabled === "boolean"
        ? override.distanceSurchargeEnabled
        : globalPricing.distanceSurchargeEnabled,
    surchargeStartsAfterKm:
      typeof override.surchargeStartsAfterKm === "number"
        ? override.surchargeStartsAfterKm
        : globalPricing.surchargeStartsAfterKm,
    surchargeStepMeters:
      typeof override.surchargeStepMeters === "number"
        ? override.surchargeStepMeters
        : globalPricing.surchargeStepMeters,
    surchargeAmountTaka:
      typeof override.surchargeAmountTaka === "number"
        ? override.surchargeAmountTaka
        : globalPricing.surchargeAmountTaka,
  };
}

export async function listDiscoverableRestaurants(params?: {
  search?: string;
  collectionKey?: string;
  restaurantIds?: string[];
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}) {
  await ensureRestaurantDiscoveryBackfill();
  const query: Record<string, unknown> = getDiscoverableRestaurantQuery();

  if (params?.search) {
    query.name = { $regex: params.search, $options: "i" };
  }

  if (params?.collectionKey) {
    const collection = await RestaurantCollectionModel.findOne({
      key: params.collectionKey,
      isActive: true,
    });

    if (!collection) {
      return [];
    }

    query._id = { $in: collection.restaurantIds };
  }

  if (params?.restaurantIds?.length) {
    query._id = {
      $in: params.restaurantIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  if (
    params?.latitude === undefined ||
    params?.longitude === undefined ||
    params?.radiusKm === undefined
  ) {
    return RestaurantModel.aggregate([
      {
        $match: query,
      },
      {
        $addFields: {
          distanceKm: null,
          isOpen: {
            $ifNull: ["$runtime.isOnline", false],
          },
        },
      },
      ...buildRestaurantCommercialsPipeline(),
      ...buildReviewMetricsPipeline(),
      {
        $sort: {
          "discovery.featuredSortOrder": 1,
          createdAt: -1,
        },
      },
    ]);
  }

  const geoNearQuery = {
    ...query,
    locationPoint: { $ne: null },
  };

  return RestaurantModel.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [params.longitude, params.latitude],
        },
        distanceField: "distanceMeters",
        maxDistance: params.radiusKm * 1000,
        spherical: true,
        query: geoNearQuery,
      },
    },
    {
      $addFields: {
        distanceKm: {
          $cond: [
            { $lt: ["$distanceMeters", 100] },
            0,
            { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] },
          ],
        },
        isOpen: {
          $ifNull: ["$runtime.isOnline", false],
        },
      },
    },
    ...buildRestaurantCommercialsPipeline(),
    ...buildReviewMetricsPipeline(),
    {
      $sort: {
        "discovery.featuredSortOrder": 1,
        distanceMeters: 1,
        createdAt: -1,
      },
    },
    {
      $project: {
        distanceMeters: 0,
      },
    },
  ]);
}

export async function getCustomerDiscoveryHome(params?: {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  customerId?: string;
}) {
  const [
    platformContent,
    featuredCollection,
    featuredRestaurants,
    activeOffers,
  ] = await Promise.all([
    getPlatformContent(),
    RestaurantCollectionModel.findOne({
      key: "featured_restaurants",
      isActive: true,
    }),
    listDiscoverableRestaurants({
      collectionKey: "featured_restaurants",
      latitude: params?.latitude,
      longitude: params?.longitude,
      radiusKm: params?.radiusKm,
    }),
    VoucherModel.find({
      archivedAt: null,
      status: "Active",
      startsAt: { $lte: new Date() },
      endsAt: { $gte: new Date() },
    }).limit(20),
  ]);

  const featuredIds = new Set(
    featuredCollection?.restaurantIds.map((id) => id.toString()) ?? [],
  );
  const restaurantIdsWithOffers = [
    ...new Set(
      activeOffers
        .flatMap((offer) => {
          const scopedOffer = offer as any;
          return scopedOffer.scopeType === "selected_restaurants"
            ? scopedOffer.selectedRestaurantIds.map(
                (id: unknown) => id?.toString?.() ?? "",
              )
            : [scopedOffer.restaurantId?.toString?.() ?? ""];
        })
        .filter(Boolean),
    ),
  ];

  const offerRestaurants = restaurantIdsWithOffers.length
    ? await listDiscoverableRestaurants({
        restaurantIds: restaurantIdsWithOffers,
        latitude: params?.latitude,
        longitude: params?.longitude,
        radiusKm: params?.radiusKm,
      })
    : [];

  const hasCustomerOrders = params?.customerId
    ? Boolean(await OrderModel.exists({ customerId: params.customerId }))
    : false;
  const homeCms = JSON.parse(
    JSON.stringify(platformContent.customerApp.homeCms),
  );
  if (
    homeCms.howToOrderGuide?.audience === "new_users" &&
    (!params?.customerId || hasCustomerOrders)
  ) {
    homeCms.howToOrderGuide.isActive = false;
  }

  return {
    homeBanner: platformContent.customerApp.homeBanner.isActive
      ? platformContent.customerApp.homeBanner
      : null,
    homeCms,
    featuredRestaurants: featuredRestaurants.filter((restaurant) =>
      featuredIds.has(restaurant._id.toString()),
    ),
    restaurantsWithOffers: offerRestaurants,
    campaignPlacements: activeOffers
      .filter((offer) => (offer as any).display?.showOnHome)
      .map((offer) => ({
        _id: offer.id,
        voucherId: offer.id,
        name: offer.name,
        code: offer.code,
        scopeType: (offer as any).scopeType,
        audienceType: (offer as any).audienceType,
        display: (offer as any).display ?? {},
      }))
      .sort(
        (left, right) =>
          (left.display?.position ?? 0) - (right.display?.position ?? 0),
      ),
    activeOffers: activeOffers.map((offer) => ({
      _id: offer.id,
      restaurantId: offer.restaurantId?.toString?.() ?? "",
      scopeType: (offer as any).scopeType,
      audienceType: (offer as any).audienceType,
      name: offer.name,
      code: offer.code,
      type: offer.type,
      mode: offer.mode,
      discountValue: offer.discountValue,
      minimumOrderAmount: offer.minimumOrderAmount,
      display: (offer as any).display ?? {},
    })),
  };
}

export async function getCustomerRestaurantDetails(
  restaurantId: string,
  params?: {
    latitude?: number;
    longitude?: number;
  },
) {
  await ensureRestaurantDiscoveryBackfill();
  const restaurantAggregate = await RestaurantModel.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(restaurantId),
        ...getDiscoverableRestaurantQuery(),
      },
    },
    {
      $addFields: {
        isOpen: {
          $ifNull: ["$runtime.isOnline", false],
        },
      },
    },
    ...buildRestaurantCommercialsPipeline(),
    ...buildReviewMetricsPipeline(),
  ]);

  const restaurant = restaurantAggregate[0];

  if (!restaurant) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RESTAURANT_NOT_FOUND",
      "Restaurant not found",
    );
  }

  if (
    typeof params?.latitude === "number" &&
    typeof params?.longitude === "number" &&
    typeof restaurant.location?.latitude === "number" &&
    typeof restaurant.location?.longitude === "number"
  ) {
    restaurant.distanceKm = calculateDistanceKm(
      params.latitude,
      params.longitude,
      restaurant.location.latitude,
      restaurant.location.longitude,
    );
  } else {
    restaurant.distanceKm = null;
  }

  const [categories, menuItems, activeOffers, recentReviews] =
    await Promise.all([
      CategoryModel.find({
        restaurantId: restaurant._id,
        status: "active",
      }).sort({ displayOrder: 1 }),
      MenuItemModel.find({
        restaurantId: restaurant._id,
        status: "active",
        availability: "available",
      }).sort({ isPopular: -1, createdAt: -1 }),
      VoucherModel.find({
        archivedAt: null,
        $or: [
          { restaurantId: restaurant._id },
          { scopeType: "all_restaurants" },
          {
            scopeType: "selected_restaurants",
            selectedRestaurantIds: restaurant._id,
          },
        ],
        status: "Active",
        startsAt: { $lte: new Date() },
        endsAt: { $gte: new Date() },
      }).sort({ priority: -1 }),
      ReviewModel.find({
        restaurantId: restaurant._id,
        moderationStatus: "visible",
        isHidden: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

  const reviewCustomerIds = [
    ...new Set(
      recentReviews.map((review) => review.customerId).filter(Boolean),
    ),
  ];
  const reviewCustomers = reviewCustomerIds.length
    ? await CustomerModel.find({ _id: { $in: reviewCustomerIds } })
        .select("fullName")
        .lean()
    : [];
  const reviewCustomerMap = new Map(
    reviewCustomers.map((customer) => [
      String(customer._id),
      customer.fullName?.trim() || "Foodbela customer",
    ]),
  );

  return {
    restaurant,
    categories,
    menuItems,
    activeOffers,
    recentReviews: recentReviews.map((review) => ({
      id: String(review._id),
      rating: review.rating,
      comment: review.comment ?? "",
      createdAt: review.createdAt
        ? new Date(review.createdAt).toISOString()
        : undefined,
      customerName:
        reviewCustomerMap.get(review.customerId) ?? "Foodbela customer",
      ownerReply: review.ownerReply?.message
        ? {
            message: review.ownerReply.message,
            createdAt: review.ownerReply.createdAt
              ? new Date(review.ownerReply.createdAt).toISOString()
              : null,
            updatedAt: review.ownerReply.updatedAt
              ? new Date(review.ownerReply.updatedAt).toISOString()
              : null,
          }
        : null,
    })),
  };
}

type CartInputItem = {
  itemId: string;
  quantity: number;
  selectedVariantOptions?: Array<{ groupName: string; optionLabel: string }>;
  selectedAddOnOptions?: Array<{ groupName: string; optionLabel: string }>;
};

function ensureCustomerIdentity(customerId?: string) {
  if (!customerId) {
    throw new AppError(
      StatusCodes.UNAUTHORIZED,
      "UNAUTHORIZED",
      "Customer authentication required",
    );
  }

  return customerId;
}

async function getCustomerById(customerId: string) {
  const customer = await CustomerModel.findById(customerId);

  if (!customer) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "CUSTOMER_NOT_FOUND",
      "Customer not found",
    );
  }

  return customer;
}

function assertCustomerAccountAccessible(customer: {
  status?: "active" | "suspended" | "locked" | string | null;
}) {
  if (customer.status === "suspended") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "ACCOUNT_DEACTIVATED",
      "This account has been deactivated. Please contact support if you need help.",
    );
  }

  if (customer.status === "locked") {
    throw new AppError(
      StatusCodes.FORBIDDEN,
      "ACCOUNT_LOCKED",
      "This account is no longer available. Please contact support for assistance.",
    );
  }
}

function normalizeSavedLocations(
  locations: Array<{
    _id?: mongoose.Types.ObjectId | string;
    label?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    source?: string;
    isDefault?: boolean;
    lastUsedAt?: Date | string | null;
  }>,
) {
  const sorted = [...locations].sort((left, right) => {
    if (left.isDefault && !right.isDefault) return -1;
    if (!left.isDefault && right.isDefault) return 1;

    const leftUsedAt = left.lastUsedAt
      ? new Date(left.lastUsedAt).getTime()
      : 0;
    const rightUsedAt = right.lastUsedAt
      ? new Date(right.lastUsedAt).getTime()
      : 0;
    return rightUsedAt - leftUsedAt;
  });

  return sorted.map((location, index) => ({
    ...location,
    isDefault:
      index === 0 ? true : Boolean(location.isDefault) && !sorted[0]?.isDefault,
  }));
}

function enforceSavedLocationLimit<T>(locations: T[]) {
  if (locations.length > 3) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "LOCATION_LIMIT_REACHED",
      "You can save up to 3 locations only",
    );
  }
}

export async function getCustomerSavedLocations(customerId: string) {
  const customer = await getCustomerById(ensureCustomerIdentity(customerId));
  return (customer.savedLocations ?? []).map((location) =>
    mapSavedLocation(location.toObject()),
  );
}

export async function listCustomerFavoriteRestaurantIds(customerId: string) {
  const customer = await getCustomerById(ensureCustomerIdentity(customerId));

  return (customer.favoriteRestaurantIds ?? []).map((restaurantId) =>
    restaurantId.toString(),
  );
}

export async function listCustomerFavoriteRestaurants(params: {
  customerId: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}) {
  const favoriteRestaurantIds = await listCustomerFavoriteRestaurantIds(
    params.customerId,
  );

  if (!favoriteRestaurantIds.length) {
    return [];
  }

  return listDiscoverableRestaurants({
    restaurantIds: favoriteRestaurantIds,
    latitude: params.latitude,
    longitude: params.longitude,
    radiusKm: params.radiusKm,
  });
}

export async function toggleCustomerFavoriteRestaurant(params: {
  customerId: string;
  restaurantId: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);

  if (!mongoose.Types.ObjectId.isValid(params.restaurantId)) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RESTAURANT_NOT_FOUND",
      "Restaurant not found",
    );
  }

  const restaurantExists = await RestaurantModel.exists({
    _id: new mongoose.Types.ObjectId(params.restaurantId),
    ...getDiscoverableRestaurantQuery(),
  });

  if (!restaurantExists) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RESTAURANT_NOT_FOUND",
      "Restaurant not found",
    );
  }

  const customer = await getCustomerById(safeCustomerId);
  const currentFavoriteIds = (customer.favoriteRestaurantIds ?? []).map(
    (restaurantId) => restaurantId.toString(),
  );
  const isAlreadyFavorite = currentFavoriteIds.includes(params.restaurantId);

  customer.favoriteRestaurantIds = isAlreadyFavorite
    ? customer.favoriteRestaurantIds.filter(
        (restaurantId) => restaurantId.toString() !== params.restaurantId,
      )
    : [
        ...customer.favoriteRestaurantIds,
        new mongoose.Types.ObjectId(params.restaurantId),
      ];

  await customer.save();

  const favoriteRestaurantIds = customer.favoriteRestaurantIds.map(
    (restaurantId) => restaurantId.toString(),
  );

  return {
    restaurantId: params.restaurantId,
    isFavorite: !isAlreadyFavorite,
    favoriteRestaurantIds,
  };
}

export async function registerCustomerPushToken(params: {
  customerId: string;
  expoPushToken: string;
  platform: "android" | "ios";
  deviceId?: string;
  appVersion?: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(safeCustomerId);

  await CustomerModel.updateMany(
    {
      _id: { $ne: customer._id },
      "pushTokens.expoPushToken": params.expoPushToken,
    },
    { $set: { "pushTokens.$[token].disabledAt": new Date() } },
    { arrayFilters: [{ "token.expoPushToken": params.expoPushToken }] },
  );

  const existingToken = customer.pushTokens.find(
    (token) => token.expoPushToken === params.expoPushToken,
  );

  if (existingToken) {
    existingToken.platform = params.platform;
    existingToken.deviceId = params.deviceId ?? existingToken.deviceId ?? "";
    existingToken.appVersion =
      params.appVersion ?? existingToken.appVersion ?? "";
    existingToken.lastSeenAt = new Date();
    existingToken.disabledAt = null;
  } else {
    if (params.deviceId) {
      customer.pushTokens.forEach((token) => {
        if (
          token.deviceId === params.deviceId &&
          token.expoPushToken !== params.expoPushToken
        ) {
          token.disabledAt = new Date();
        }
      });
    }
    customer.pushTokens.push({
      expoPushToken: params.expoPushToken,
      platform: params.platform,
      deviceId: params.deviceId ?? "",
      appVersion: params.appVersion ?? "",
      lastSeenAt: new Date(),
      disabledAt: null,
    } as never);
  }

  pruneCustomerPushTokens(customer);
  await customer.save();

  logger.info(
    {
      customerId: safeCustomerId,
      expoPushToken: params.expoPushToken,
      platform: params.platform,
    },
    "Customer push token registered",
  );

  return {
    registered: true,
  };
}

export async function unregisterCustomerPushToken(params: {
  customerId: string;
  expoPushToken: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(safeCustomerId);

  const matchedToken = customer.pushTokens.find(
    (token) => token.expoPushToken === params.expoPushToken,
  );

  if (!matchedToken) {
    return { removed: true };
  }

  matchedToken.disabledAt = new Date();
  matchedToken.lastSeenAt = new Date();
  pruneCustomerPushTokens(customer);
  await customer.save();

  logger.info(
    {
      customerId: safeCustomerId,
      expoPushToken: params.expoPushToken,
    },
    "Customer push token disabled",
  );

  return { removed: true };
}

export async function createCustomerSavedLocation(params: {
  customerId: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  source?: "gps" | "manual" | "saved";
  isDefault?: boolean;
}) {
  const customer = await getCustomerById(
    ensureCustomerIdentity(params.customerId),
  );
  const currentLocations = customer.savedLocations.map((location) =>
    location.toObject(),
  );

  const deduped = currentLocations.filter(
    (location) =>
      !(
        location.label === params.label &&
        location.address === params.address &&
        location.latitude === params.latitude &&
        location.longitude === params.longitude
      ),
  );

  const nextLocation = {
    label: params.label,
    address: params.address,
    latitude: params.latitude,
    longitude: params.longitude,
    source: params.source ?? "saved",
    isDefault: params.isDefault ?? deduped.length === 0,
    lastUsedAt: new Date(),
  };

  const nextLocations = normalizeSavedLocations(
    params.isDefault
      ? [
          { ...nextLocation, isDefault: true },
          ...deduped.map((location) => ({ ...location, isDefault: false })),
        ]
      : [...deduped, nextLocation],
  );

  enforceSavedLocationLimit(nextLocations);

  customer.savedLocations = nextLocations as typeof customer.savedLocations;
  await customer.save();

  return customer.savedLocations.map((location) =>
    mapSavedLocation(location.toObject()),
  );
}

export async function updateCustomerSavedLocation(params: {
  customerId: string;
  locationId: string;
  label?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  source?: "gps" | "manual" | "saved";
  isDefault?: boolean;
}) {
  const customer = await getCustomerById(
    ensureCustomerIdentity(params.customerId),
  );
  const targetLocation = customer.savedLocations.id(params.locationId);

  if (!targetLocation) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "LOCATION_NOT_FOUND",
      "Saved location not found",
    );
  }

  if (params.label !== undefined) targetLocation.label = params.label;
  if (params.address !== undefined) targetLocation.address = params.address;
  if (params.latitude !== undefined) targetLocation.latitude = params.latitude;
  if (params.longitude !== undefined)
    targetLocation.longitude = params.longitude;
  if (params.source !== undefined) targetLocation.source = params.source;
  if (params.isDefault !== undefined)
    targetLocation.isDefault = params.isDefault;
  targetLocation.lastUsedAt = new Date();

  const normalized = normalizeSavedLocations(
    customer.savedLocations.map((location) => location.toObject()),
  );
  customer.savedLocations = normalized as typeof customer.savedLocations;
  await customer.save();

  return customer.savedLocations.map((location) =>
    mapSavedLocation(location.toObject()),
  );
}

export async function setDefaultCustomerSavedLocation(params: {
  customerId: string;
  locationId: string;
}) {
  const customer = await getCustomerById(
    ensureCustomerIdentity(params.customerId),
  );
  const nextLocations = customer.savedLocations.map((location) => ({
    ...location.toObject(),
    isDefault: location.id === params.locationId,
    lastUsedAt:
      location.id === params.locationId ? new Date() : location.lastUsedAt,
  }));

  if (!nextLocations.some((location) => location.isDefault)) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "LOCATION_NOT_FOUND",
      "Saved location not found",
    );
  }

  customer.savedLocations = normalizeSavedLocations(
    nextLocations,
  ) as typeof customer.savedLocations;
  await customer.save();

  return customer.savedLocations.map((location) =>
    mapSavedLocation(location.toObject()),
  );
}

export async function touchCustomerSavedLocation(params: {
  customerId: string;
  locationId: string;
}) {
  const customer = await getCustomerById(
    ensureCustomerIdentity(params.customerId),
  );
  const targetLocation = customer.savedLocations.id(params.locationId);

  if (!targetLocation) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "LOCATION_NOT_FOUND",
      "Saved location not found",
    );
  }

  targetLocation.lastUsedAt = new Date();
  customer.savedLocations = normalizeSavedLocations(
    customer.savedLocations.map((location) => location.toObject()),
  ) as typeof customer.savedLocations;
  await customer.save();

  return customer.savedLocations.map((location) =>
    mapSavedLocation(location.toObject()),
  );
}

export async function removeCustomerSavedLocation(params: {
  customerId: string;
  locationId: string;
}) {
  const customer = await getCustomerById(
    ensureCustomerIdentity(params.customerId),
  );
  const nextLocations = customer.savedLocations
    .filter((location) => location.id !== params.locationId)
    .map((location) => location.toObject());

  if (nextLocations.length === customer.savedLocations.length) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "LOCATION_NOT_FOUND",
      "Saved location not found",
    );
  }

  customer.savedLocations = normalizeSavedLocations(
    nextLocations,
  ) as typeof customer.savedLocations;
  await customer.save();

  return customer.savedLocations.map((location) =>
    mapSavedLocation(location.toObject()),
  );
}

function resolveSelectedVariantPrice(
  variants: Array<{
    name?: string;
    options?: Array<{ label?: string; priceDelta?: number }>;
  }>,
  selectedVariantOptions?: Array<{ groupName: string; optionLabel: string }>,
) {
  if (!selectedVariantOptions?.length) return 0;

  return selectedVariantOptions.reduce((total, selectedOption) => {
    const group = variants.find(
      (variant) => variant.name === selectedOption.groupName,
    );
    const option = group?.options?.find(
      (item) => item.label === selectedOption.optionLabel,
    );
    return total + (option?.priceDelta ?? 0);
  }, 0);
}

function resolveSelectedAddOnPrice(
  addOnGroups: Array<{
    name?: string;
    options?: Array<{ label?: string; price?: number }>;
  }>,
  selectedAddOnOptions?: Array<{ groupName: string; optionLabel: string }>,
) {
  if (!selectedAddOnOptions?.length) return 0;

  return selectedAddOnOptions.reduce((total, selectedOption) => {
    const group = addOnGroups.find(
      (addOnGroup) => addOnGroup.name === selectedOption.groupName,
    );
    const option = group?.options?.find(
      (item) => item.label === selectedOption.optionLabel,
    );
    return total + (option?.price ?? 0);
  }, 0);
}

async function resolveActiveVoucher(params: {
  restaurantId: string;
  voucherCode?: string;
  subtotal: number;
  customerId?: string;
  items: Array<{ itemId: string; categoryId: string }>;
}) {
  const now = new Date();
  const previousOrderCount = params.customerId
    ? await OrderModel.countDocuments({ customerId: params.customerId })
    : 0;
  const activeVouchers = await VoucherModel.find({
    archivedAt: null,
    $or: [
      { restaurantId: params.restaurantId },
      { scopeType: "all_restaurants" },
      {
        scopeType: "selected_restaurants",
        selectedRestaurantIds: params.restaurantId,
      },
    ],
    status: "Active",
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  }).sort({ priority: -1, createdAt: 1 });

  const eligibleVouchers = [];
  const itemIdSet = new Set(params.items.map((item) => item.itemId));
  const categoryIdSet = new Set(params.items.map((item) => item.categoryId));

  for (const voucher of activeVouchers) {
    if (voucher.archivedAt) continue;
    const scopedVoucher = voucher as any;
    if (scopedVoucher.audienceType === "new_users" && previousOrderCount > 0) {
      continue;
    }
    if (
      scopedVoucher.audienceType === "returning_users" &&
      previousOrderCount === 0
    ) {
      continue;
    }
    if (
      scopedVoucher.audienceType === "selected_users" &&
      (!params.customerId ||
        !(scopedVoucher.selectedCustomerIds ?? []).some(
          (customerId: unknown) =>
            customerId?.toString?.() === params.customerId,
        ))
    ) {
      continue;
    }
    if (voucher.minimumOrderAmount > params.subtotal) {
      continue;
    }

    if (
      (scopedVoucher.scopeType ?? "restaurant") === "restaurant" &&
      voucher.applicability === "categories" &&
      !voucher.categoryIds.some((categoryId) =>
        categoryIdSet.has(categoryId.toString()),
      )
    ) {
      continue;
    }

    if (
      (scopedVoucher.scopeType ?? "restaurant") === "restaurant" &&
      voucher.applicability === "items" &&
      !voucher.itemIds.some((itemId) => itemIdSet.has(itemId.toString()))
    ) {
      continue;
    }

    if (voucher.maxTotalUses > 0) {
      const totalUses = await VoucherRedemptionModel.countDocuments({
        voucherId: voucher._id,
      });
      if (totalUses >= voucher.maxTotalUses) {
        continue;
      }
    }

    if (params.customerId && voucher.maxUsesPerUser > 0) {
      const customerUses = await VoucherRedemptionModel.countDocuments({
        voucherId: voucher._id,
        "voucherSnapshot.customerId": params.customerId,
      });
      if (customerUses >= voucher.maxUsesPerUser) {
        continue;
      }
    }

    eligibleVouchers.push(voucher);
  }

  const autoVoucher =
    eligibleVouchers.find((voucher) => voucher.mode === "auto") ?? null;

  if (!params.voucherCode) {
    return autoVoucher ? [autoVoucher] : [];
  }

  const couponVoucher = eligibleVouchers.find(
    (voucher) =>
      voucher.mode === "coupon" && voucher.code === params.voucherCode,
  );

  if (!couponVoucher) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "VOUCHER_NOT_FOUND",
      "Voucher code is invalid",
    );
  }

  if (!autoVoucher) {
    return [couponVoucher];
  }

  if (
    autoVoucher.stackingRule === "stackable" &&
    couponVoucher.stackingRule === "stackable"
  ) {
    return [autoVoucher, couponVoucher].sort((a, b) => b.priority - a.priority);
  }

  return [autoVoucher, couponVoucher]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 1);
}

function calculateVoucherDiscount(params: {
  voucher: {
    type?: string;
    discountValue?: number;
    maxDiscountAmount?: number;
  };
  subtotal: number;
  deliveryFee: number;
}) {
  if (params.voucher.type === "flat") {
    return Math.min(params.voucher.discountValue ?? 0, params.subtotal);
  }

  if (params.voucher.type === "percentage") {
    const rawDiscount =
      ((params.voucher.discountValue ?? 0) / 100) * params.subtotal;
    const cappedDiscount =
      params.voucher.maxDiscountAmount && params.voucher.maxDiscountAmount > 0
        ? Math.min(rawDiscount, params.voucher.maxDiscountAmount)
        : rawDiscount;
    return Math.min(cappedDiscount, params.subtotal);
  }

  if (params.voucher.type === "free_delivery") {
    return Math.min(params.deliveryFee, params.deliveryFee);
  }

  return 0;
}

function summarizeAppliedVouchers(
  vouchers: Array<{
    id: string;
    code?: string;
    name: string;
    type: string;
    mode: string;
    fundedBy?: string;
    scopeType?: string;
    audienceType?: string;
    ownerSharePercent?: number;
    platformSharePercent?: number;
    discountAmount?: number;
  }>,
) {
  return vouchers.map((voucher) => ({
    id: voucher.id,
    code: voucher.code,
    name: voucher.name,
    type: voucher.type,
    mode: voucher.mode,
    fundedBy: voucher.fundedBy,
    scopeType: (voucher as any).scopeType,
    audienceType: (voucher as any).audienceType,
    ownerSharePercent: voucher.ownerSharePercent,
    platformSharePercent: voucher.platformSharePercent,
    discountAmount: voucher.discountAmount,
  }));
}

export async function quoteCustomerCart(params: {
  restaurantId: string;
  items: CartInputItem[];
  voucherCode?: string;
  customerId?: string;
  latitude?: number;
  longitude?: number;
}) {
  const platformContent = await getPlatformContent();
  const restaurant = await RestaurantModel.findOne({
    _id: params.restaurantId,
    ...getVisibleRestaurantQuery(),
  });

  if (!restaurant) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RESTAURANT_NOT_FOUND",
      "Restaurant not found",
    );
  }

  if (!params.items.length) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "CART_EMPTY",
      "Add at least one item to continue",
    );
  }

  const menuItemIds = params.items.map((item) => item.itemId);
  const menuItems = await MenuItemModel.find({
    _id: { $in: menuItemIds },
    restaurantId: restaurant._id,
    status: "active",
    availability: "available",
  });

  const menuItemMap = new Map(menuItems.map((item) => [item.id, item]));
  const categoryIds = [
    ...new Set(menuItems.map((item) => item.categoryId.toString())),
  ];
  const categories = categoryIds.length
    ? await CategoryModel.find(
        { _id: { $in: categoryIds }, restaurantId: restaurant._id },
        { name: 1, slug: 1 },
      ).lean()
    : [];
  const categoryMap = new Map(
    categories.map((category) => [category._id.toString(), category]),
  );

  const resolvedItems = params.items.map((cartItem) => {
    const menuItem = menuItemMap.get(cartItem.itemId);

    if (!menuItem) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "MENU_ITEM_NOT_AVAILABLE",
        "One or more selected items are not available",
      );
    }

    const variantPrice = resolveSelectedVariantPrice(
      menuItem.variants.map((variant) => ({
        name: variant.name,
        options: variant.options.map((option) => ({
          label: option.label,
          priceDelta: option.priceDelta,
        })),
      })),
      cartItem.selectedVariantOptions,
    );

    const addOnPrice = resolveSelectedAddOnPrice(
      menuItem.addOnGroups.map((group) => ({
        name: group.name,
        options: group.options.map((option) => ({
          label: option.label,
          price: option.price,
        })),
      })),
      cartItem.selectedAddOnOptions,
    );

    const unitPrice = menuItem.basePrice + variantPrice + addOnPrice;
    const lineTotal = unitPrice * cartItem.quantity;
    const categoryId = menuItem.categoryId.toString();
    const category = categoryMap.get(categoryId);
    const image = Array.isArray(menuItem.images) ? menuItem.images[0] : null;

    return {
      itemId: menuItem.id,
      categoryId,
      itemName: menuItem.name,
      name: menuItem.name,
      itemSlug: menuItem.slug,
      categoryName: category?.name ?? "",
      categorySlug: category?.slug ?? "",
      imageUrl: image?.url ?? "",
      quantity: cartItem.quantity,
      unitPrice,
      lineTotal,
      selectedVariantOptions: cartItem.selectedVariantOptions ?? [],
      selectedAddOnOptions: cartItem.selectedAddOnOptions ?? [],
    };
  });

  const subtotal = resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryPricingConfig = resolveDeliveryPricingConfig({
    platformContent,
    restaurant,
  });
  const deliveryDistanceKm =
    typeof params.latitude === "number" &&
    typeof params.longitude === "number" &&
    typeof restaurant.location?.latitude === "number" &&
    typeof restaurant.location?.longitude === "number"
      ? calculateDistanceKm(
          params.latitude,
          params.longitude,
          restaurant.location.latitude,
          restaurant.location.longitude,
        )
      : null;
  const deliveryFee = calculateConfiguredDeliveryFee({
    baseFeeTaka: deliveryPricingConfig.baseFeeTaka,
    distanceSurchargeEnabled: deliveryPricingConfig.distanceSurchargeEnabled,
    surchargeStartsAfterKm: deliveryPricingConfig.surchargeStartsAfterKm,
    surchargeStepMeters: deliveryPricingConfig.surchargeStepMeters,
    surchargeAmountTaka: deliveryPricingConfig.surchargeAmountTaka,
    distanceKm: deliveryDistanceKm,
  });
  const vouchers = await resolveActiveVoucher({
    restaurantId: restaurant.id,
    voucherCode: params.voucherCode,
    subtotal,
    customerId: params.customerId,
    items: resolvedItems.map((item) => ({
      itemId: item.itemId,
      categoryId: item.categoryId,
    })),
  });

  const voucherDiscounts = new Map<string, number>();
  const discountAmount = vouchers.reduce((totalDiscount, voucher) => {
    const baseDeliveryFee = voucher.type === "free_delivery" ? deliveryFee : 0;
    const currentDiscount = calculateVoucherDiscount({
      voucher,
      subtotal: Math.max(subtotal - totalDiscount, 0),
      deliveryFee: baseDeliveryFee,
    });
    voucherDiscounts.set(voucher.id, currentDiscount);
    return totalDiscount + currentDiscount;
  }, 0);

  const total = Math.max(subtotal + deliveryFee - discountAmount, 0);
  const ownerDiscountCost = vouchers.reduce((totalOwnerCost, voucher) => {
    const voucherDiscount = voucherDiscounts.get(voucher.id) ?? 0;
    return (
      totalOwnerCost +
      Math.round(
        voucherDiscount * (((voucher as any).ownerSharePercent ?? 100) / 100),
      )
    );
  }, 0);
  const platformDiscountCost = vouchers.reduce((totalPlatformCost, voucher) => {
    const voucherDiscount = voucherDiscounts.get(voucher.id) ?? 0;
    return (
      totalPlatformCost +
      Math.round(
        voucherDiscount * (((voucher as any).platformSharePercent ?? 0) / 100),
      )
    );
  }, 0);

  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
    },
    items: resolvedItems,
    pricing: {
      subtotal,
      deliveryFee,
      discountAmount,
      ownerDiscountCost,
      platformDiscountCost,
      total,
    },
    appliedVouchers: summarizeAppliedVouchers(
      vouchers.map((voucher) => ({
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        mode: voucher.mode,
        fundedBy: voucher.fundedBy,
        scopeType: (voucher as any).scopeType,
        audienceType: (voucher as any).audienceType,
        ownerSharePercent: voucher.ownerSharePercent,
        platformSharePercent: voucher.platformSharePercent,
        discountAmount: voucherDiscounts.get(voucher.id) ?? 0,
      })),
    ),
  };
}

export async function placeCustomerOrder(params: {
  customerId: string;
  restaurantId: string;
  items: CartInputItem[];
  voucherCode?: string;
  paymentMethod: string;
  paymentReference?: {
    provider?: string;
    bkashSessionId?: string;
    walletNumber?: string;
  };
  note?: string;
  deliveryAddress: {
    label: string;
    addressLine: string;
    latitude?: number | null;
    longitude?: number | null;
  };
}) {
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);
  const quote = await quoteCustomerCart({
    restaurantId: params.restaurantId,
    items: params.items,
    voucherCode: params.voucherCode,
    customerId,
    latitude: params.deliveryAddress.latitude ?? undefined,
    longitude: params.deliveryAddress.longitude ?? undefined,
  });

  const restaurant = await RestaurantModel.findById(params.restaurantId);

  if (!restaurant) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RESTAURANT_NOT_FOUND",
      "Restaurant not found",
    );
  }

  let paymentStatus = "pending";
  let paymentSnapshot: Record<string, unknown> = {};
  const orderId = new mongoose.Types.ObjectId();
  let reservedBkashSessionId: string | null = null;

  if (params.paymentMethod === "Bkash") {
    const bkashSessionId = params.paymentReference?.bkashSessionId;

    if (!bkashSessionId) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "BKASH_PAYMENT_REQUIRED",
        "Complete the bKash payment before placing the order",
      );
    }

    const paymentSession =
      await BkashSandboxPaymentSessionModel.findOneAndUpdate(
        {
          _id: bkashSessionId,
          customerId,
          restaurantId: params.restaurantId,
          status: "confirmed",
          usedAt: null,
          amount: quote.pricing.total,
        },
        {
          $set: {
            orderId,
            usedAt: new Date(),
          },
        },
        {
          new: true,
        },
      );

    if (!paymentSession) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "BKASH_PAYMENT_INVALID",
        "The selected bKash payment is not valid anymore",
      );
    }

    reservedBkashSessionId = paymentSession.id;
    paymentStatus = "paid";
    paymentSnapshot = {
      provider: "Bkash",
      sessionId: paymentSession.id,
      paymentID: paymentSession.sandboxPaymentId,
      transactionId: paymentSession.transactionId,
      walletNumber: paymentSession.walletNumber,
      confirmedAt: paymentSession.confirmedAt,
    };
  } else if (params.paymentMethod === "Cash") {
    paymentStatus = "pending";
    paymentSnapshot = {
      provider: "Cash",
    };
  } else {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PAYMENT_METHOD_NOT_SUPPORTED",
      "Only Cash and bKash are available right now",
    );
  }

  try {
    const order = await OrderModel.create({
      _id: orderId,
      restaurantId: params.restaurantId,
      customerId: customer.id,
      orderNumber: `FB-${Date.now()}`,
      status: "New",
      paymentMethod: params.paymentMethod,
      paymentStatus,
      paymentSnapshot,
      pricing: quote.pricing,
      customerSnapshot: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        deliveryAddress: params.deliveryAddress,
      },
      itemsSnapshot: quote.items,
      history: [
        {
          status: "New",
          actor: "customer",
          note: params.note ?? "",
          createdAt: new Date(),
        },
      ],
      timestamps: {
        placedAt: new Date(),
      },
    });

    if (quote.appliedVouchers.length) {
      await Promise.all(
        quote.appliedVouchers.map((voucher) =>
          VoucherRedemptionModel.create({
            orderId: order._id,
            restaurantId: params.restaurantId,
            voucherId: voucher.id,
            voucherSnapshot: {
              ...voucher,
              customerId,
            },
            discountBreakdown: {
              discountAmount:
                voucher.discountAmount ?? quote.pricing.discountAmount,
              ownerFundedAmount: Math.round(
                (voucher.discountAmount ?? quote.pricing.discountAmount) *
                  ((voucher.ownerSharePercent ?? 100) / 100),
              ),
              platformFundedAmount: Math.round(
                (voucher.discountAmount ?? quote.pricing.discountAmount) *
                  ((voucher.platformSharePercent ?? 0) / 100),
              ),
            },
          }),
        ),
      );
    }

    const subtotal = quote.pricing.subtotal;
    const commissionRate =
      typeof restaurant.commercial?.commissionRate === "number"
        ? restaurant.commercial.commissionRate
        : 15;
    const discountCost =
      quote.pricing.ownerDiscountCost ?? quote.pricing.discountAmount;
    const platformDiscountCost = quote.pricing.platformDiscountCost ?? 0;
    const commissionBase = subtotal;
    const commission = Math.round(commissionBase * (commissionRate / 100));
    const deliveryCost = quote.pricing.deliveryFee;
    const netAmount = subtotal - commission - discountCost;

    await LedgerEntryModel.create({
      restaurantId: params.restaurantId,
      orderId: order._id,
      sourceEntityType: "order",
      sourceEntityId: order.id,
      entryType: "earning",
      grossAmount: subtotal,
      commissionBase,
      commission,
      discountCost,
      platformDiscountCost,
      deliveryCost,
      netAmount,
      settlementStatus: "pending",
      availableAt: null,
    });

    try {
      await createOwnerNotification({
        ownerId: restaurant.ownerId.toString(),
        restaurantId: restaurant.id,
        type: "order",
        eventType: "order.created",
        entityType: "order",
        entityId: order.id,
        title: "New order received",
        description: `Order ${order.orderNumber} has been placed.`,
        actionPath: `/orders?orderId=${order.id}`,
      });
    } catch {
      // Checkout is already committed; realtime order events still notify the owner UI.
    }

    emitSocketEvent(
      `owner:${restaurant.ownerId.toString()}`,
      "order.updated",
      order.toObject(),
    );
    emitSocketEvent(
      `restaurant:${restaurant.id}`,
      "order.updated",
      order.toObject(),
    );
    emitSocketEvent(
      `customer:${customer.id}`,
      "customer.order.created",
      order.toObject(),
    );

    return {
      order,
      quote,
    };
  } catch (error) {
    if (reservedBkashSessionId) {
      await BkashSandboxPaymentSessionModel.updateOne(
        { _id: reservedBkashSessionId, orderId },
        {
          $set: {
            usedAt: null,
            orderId: null,
          },
        },
      );
    }

    throw error;
  }
}

export async function initiateBkashPayment(params: {
  customerId: string;
  restaurantId: string;
  items: CartInputItem[];
  voucherCode?: string;
  walletNumber: string;
  latitude?: number;
  longitude?: number;
}) {
  const customerId = ensureCustomerIdentity(params.customerId);
  const customer = await getCustomerById(customerId);

  if (!/^01\d{9}$/.test(params.walletNumber)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_BKASH_NUMBER",
      "Enter a valid bKash number",
    );
  }

  const quote = await quoteCustomerCart({
    restaurantId: params.restaurantId,
    items: params.items,
    voucherCode: params.voucherCode,
    customerId,
    latitude: params.latitude,
    longitude: params.longitude,
  });

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const session = await BkashSandboxPaymentSessionModel.create({
    customerId,
    restaurantId: params.restaurantId,
    walletNumber: params.walletNumber,
    amount: quote.pricing.total,
    voucherCode: params.voucherCode ?? "",
    status: "initiated",
    expiresAt,
  });

  const callbackURL = `${env.BACKEND_PUBLIC_URL}${env.API_PREFIX}/customer/payments/bkash/callback?sessionId=${session.id}`;

  const createdPayment = await createBkashUrlPayment({
    amount: quote.pricing.total,
    payerReference: customer.phone || customer.id,
    merchantInvoiceNumber: `FB-${Date.now()}`,
    callbackURL,
  });

  session.sandboxPaymentId = createdPayment.paymentID;
  await session.save();

  return {
    sessionId: session.id,
    paymentID: createdPayment.paymentID,
    bkashURL: createdPayment.bkashURL,
    amount: quote.pricing.total,
    walletNumber: params.walletNumber,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function handleBkashCallback(params: {
  sessionId: string;
  status?: string;
  paymentID?: string;
}) {
  const redirectUrlBase = `${env.BACKEND_PUBLIC_URL}${env.API_PREFIX}/customer/payments/bkash/return`;
  const session = await BkashSandboxPaymentSessionModel.findById(
    params.sessionId,
  );

  if (!session) {
    return `${redirectUrlBase}?status=failed`;
  }

  if (
    session.status === "confirmed" &&
    params.paymentID &&
    session.sandboxPaymentId === params.paymentID
  ) {
    return `${redirectUrlBase}?status=success&sessionId=${session.id}&transactionId=${encodeURIComponent(
      session.transactionId ?? "",
    )}&confirmedAt=${encodeURIComponent(
      session.confirmedAt?.toISOString() ?? new Date().toISOString(),
    )}&walletNumber=${encodeURIComponent(session.walletNumber)}&paymentID=${encodeURIComponent(
      session.sandboxPaymentId ?? "",
    )}`;
  }

  if (params.status !== "success" || !params.paymentID) {
    session.status = params.status === "cancel" ? "cancelled" : "failed";
    await session.save();
    return `${redirectUrlBase}?status=${params.status === "cancel" ? "cancelled" : "failed"}&sessionId=${session.id}&walletNumber=${encodeURIComponent(
      session.walletNumber,
    )}`;
  }

  if (session.expiresAt.getTime() < Date.now()) {
    session.status = "expired";
    await session.save();
    return `${redirectUrlBase}?status=expired&sessionId=${session.id}&walletNumber=${encodeURIComponent(
      session.walletNumber,
    )}`;
  }

  try {
    const executeResponse = await executeBkashPayment(params.paymentID);

    session.status = "confirmed";
    session.sandboxPaymentId = params.paymentID;
    session.transactionId = executeResponse.trxID ?? "";
    session.confirmedAt = new Date();
    await session.save();

    return `${redirectUrlBase}?status=success&sessionId=${session.id}&transactionId=${encodeURIComponent(
      session.transactionId,
    )}&confirmedAt=${encodeURIComponent(session.confirmedAt.toISOString())}&walletNumber=${encodeURIComponent(
      session.walletNumber,
    )}&paymentID=${encodeURIComponent(session.sandboxPaymentId ?? "")}`;
  } catch {
    session.status = "failed";
    await session.save();
    return `${redirectUrlBase}?status=failed&sessionId=${session.id}&walletNumber=${encodeURIComponent(
      session.walletNumber,
    )}`;
  }
}

export async function listCustomerOrders(
  customerId: string,
  params?: { page?: number; pageSize?: number },
) {
  const safeCustomerId = ensureCustomerIdentity(customerId);
  const { page, pageSize } = normalizePageBounds(params);
  const orders = await OrderModel.find({ customerId: safeCustomerId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize);
  const orderIds = orders.map((order) => order._id);

  const reviews = orderIds.length
    ? await ReviewModel.find({
        customerId: safeCustomerId,
        orderId: { $in: orderIds },
      }).select("orderId rating")
    : [];

  const reviewedOrderIds = new Set(
    reviews.map((review) => review.orderId?.toString()),
  );

  return orders.map((order) => ({
    ...order.toObject(),
    hasCustomerReview: reviewedOrderIds.has(order._id.toString()),
  }));
}

export async function getCustomerOrderDetails(params: {
  customerId: string;
  orderId: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const order = await OrderModel.findOne({
    _id: params.orderId,
    customerId: safeCustomerId,
  });

  if (!order) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  const review = await ReviewModel.findOne({
    orderId: order._id,
    customerId: safeCustomerId,
  });

  return {
    ...order.toObject(),
    riderTracking: decorateTrackingSnapshot(
      (order.toObject() as Record<string, any>).riderTracking ?? {},
      order.status,
    ),
    customerReview: review
      ? {
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
          ownerReply: review.ownerReply?.message
            ? {
                message: review.ownerReply.message,
                createdAt: review.ownerReply.createdAt,
                updatedAt: review.ownerReply.updatedAt,
              }
            : null,
        }
      : null,
  };
}

export async function cancelCustomerOrder(params: {
  customerId: string;
  orderId: string;
  reason?: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const order = await OrderModel.findOne({
    _id: params.orderId,
    customerId: safeCustomerId,
  });

  if (!order) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  if (order.status !== "New") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_CANCELLATION_NOT_ALLOWED",
      "This order can no longer be cancelled",
    );
  }

  order.status = "Cancelled";
  order.cancelledBy = "customer";
  order.terminalReason = params.reason ?? "customer_cancelled";
  const cancelledAt = new Date();
  order.history.push({
    status: "Cancelled",
    actor: "customer",
    note: params.reason ?? "",
    createdAt: cancelledAt,
  });
  if (order.history.length > MAX_ORDER_HISTORY_ENTRIES) {
    order.history.splice(0, order.history.length - MAX_ORDER_HISTORY_ENTRIES);
  }
  order.timestamps = {
    ...order.timestamps,
    Cancelled: cancelledAt,
    cancelledAt: cancelledAt,
  };

  await order.save();

  const restaurant = await RestaurantModel.findById(order.restaurantId);
  if (restaurant) {
    try {
      await createOwnerNotification({
        ownerId: restaurant.ownerId.toString(),
        restaurantId: restaurant.id,
        type: "order",
        eventType: "order.updated",
        entityType: "order",
        entityId: order.id,
        title: "Order cancelled by customer",
        description: `Order ${order.orderNumber} was cancelled by the customer.`,
        actionPath: `/orders?orderId=${order.id}`,
      });
    } catch {
      // Cancellation is already saved; owner notification persistence is best-effort.
    }

    emitSocketEvent(
      `owner:${restaurant.ownerId.toString()}`,
      "order.updated",
      order.toObject(),
    );
    emitSocketEvent(
      `restaurant:${restaurant.id}`,
      "order.updated",
      order.toObject(),
    );
  }

  emitSocketEvent(
    `customer:${safeCustomerId}`,
    "customer.order.updated",
    order.toObject(),
  );

  return order;
}

export async function createCustomerReview(params: {
  customerId: string;
  orderId: string;
  rating: number;
  comment?: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const order = await OrderModel.findOne({
    _id: params.orderId,
    customerId: safeCustomerId,
    status: "Delivered",
  });

  if (!order) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "REVIEW_NOT_ALLOWED",
      "Reviews can only be added to delivered orders",
    );
  }

  const existingReview = await ReviewModel.findOne({
    orderId: order._id,
    customerId: safeCustomerId,
  });

  if (existingReview) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "REVIEW_ALREADY_EXISTS",
      "A review has already been submitted for this order",
    );
  }

  const review = await ReviewModel.create({
    restaurantId: order.restaurantId,
    customerId: safeCustomerId,
    orderId: order._id,
    rating: params.rating,
    comment: params.comment ?? "",
  });

  const restaurant = await RestaurantModel.findById(order.restaurantId);
  if (restaurant) {
    try {
      await createOwnerNotification({
        ownerId: restaurant.ownerId.toString(),
        restaurantId: restaurant.id,
        type: "review",
        eventType: "review.created",
        entityType: "review",
        entityId: review.id,
        title: "New customer review",
        description: `A ${params.rating}-star review was added for order ${order.orderNumber}.`,
        actionPath: `/reviews?reviewId=${review.id}`,
      });
    } catch {
      // Review submission should not fail after the review has been saved.
    }
  }

  return review;
}

function mapCustomerSupportCase(supportCaseDocument: {
  toObject?: () => Record<string, unknown>;
}) {
  const supportCase =
    typeof supportCaseDocument.toObject === "function"
      ? supportCaseDocument.toObject()
      : supportCaseDocument;

  const supportCaseId = String(
    (supportCase as { _id?: mongoose.Types.ObjectId | string })._id ?? "",
  );
  const attachments = (
    (supportCase as { attachments?: Array<Record<string, unknown>> })
      .attachments ?? []
  ).map((attachment) => ({
    url: String(attachment.url ?? ""),
    publicId: String(attachment.publicId ?? ""),
    fileName: String(attachment.fileName ?? ""),
    fileType: String(attachment.fileType ?? ""),
  }));

  const replies = (
    (supportCase as { replies?: Array<Record<string, unknown>> }).replies ?? []
  )
    .slice(-MAX_SUPPORT_CASE_REPLIES)
    .map((reply, index) => ({
      id: `${supportCaseId}-reply-${index}`,
      senderType: reply.senderType === "customer" ? "customer" : "admin",
      senderName: String(reply.senderName ?? ""),
      message: String(reply.message ?? ""),
      createdAt: new Date(
        typeof reply.createdAt === "string" || reply.createdAt instanceof Date
          ? reply.createdAt
          : Date.now(),
      ).toISOString(),
      attachments: (
        (reply.attachments as Array<Record<string, unknown>> | undefined) ?? []
      ).map((attachment) => ({
        url: String(attachment.url ?? ""),
        publicId: String(attachment.publicId ?? ""),
        fileName: String(attachment.fileName ?? ""),
        fileType: String(attachment.fileType ?? ""),
      })),
    }));

  const createdAt = new Date(
    ((supportCase as { createdAt?: string | Date }).createdAt as
      | string
      | Date
      | undefined) ?? Date.now(),
  ).toISOString();
  const updatedAt = new Date(
    ((supportCase as { updatedAt?: string | Date }).updatedAt as
      | string
      | Date
      | undefined) ?? Date.now(),
  ).toISOString();

  return {
    id: supportCaseId,
    status: String((supportCase as { status?: string }).status ?? "open"),
    subject: String((supportCase as { subject?: string }).subject ?? ""),
    createdAt,
    updatedAt,
    messages: [
      {
        id: `${supportCaseId}-root`,
        senderType: "customer" as const,
        senderName:
          (supportCase as { customerSnapshot?: { fullName?: string } })
            .customerSnapshot?.fullName || "You",
        message: String((supportCase as { message?: string }).message ?? ""),
        createdAt,
        attachments,
      },
      ...replies,
    ],
  };
}

export async function getLatestCustomerSupportCase(customerId: string) {
  const safeCustomerId = ensureCustomerIdentity(customerId);
  const supportCase = await SupportCaseModel.findOne({
    source: "customer",
    customerId: safeCustomerId,
  }).sort({ updatedAt: -1, createdAt: -1 });

  if (!supportCase) {
    return null;
  }

  const mappedSupportCase = mapCustomerSupportCase(supportCase);
  emitSocketEvent(
    `customer:${safeCustomerId}`,
    "customer.support.updated",
    mappedSupportCase,
  );

  return mappedSupportCase;
}

export async function getCustomerSupportCase(params: {
  customerId: string;
  supportCaseId: string;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const supportCase = await SupportCaseModel.findOne({
    _id: params.supportCaseId,
    source: "customer",
    customerId: safeCustomerId,
  });

  if (!supportCase) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "SUPPORT_CASE_NOT_FOUND",
      "Support case not found",
    );
  }

  const mappedSupportCase = mapCustomerSupportCase(supportCase);
  emitSocketEvent(
    `customer:${safeCustomerId}`,
    "customer.support.updated",
    mappedSupportCase,
  );

  return mappedSupportCase;
}

export async function createCustomerSupportCase(params: {
  customerId: string;
  message: string;
  attachments?: Array<{
    url?: string;
    publicId?: string;
    fileName?: string;
    fileType?: string;
  }>;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const customer = await CustomerModel.findById(safeCustomerId);

  if (!customer) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "CUSTOMER_NOT_FOUND",
      "Customer not found",
    );
  }

  const message = params.message.trim();
  const supportCase = await SupportCaseModel.create({
    source: "customer",
    customerId: customer._id,
    customerSnapshot: {
      fullName: customer.fullName ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
    },
    requesterSnapshot: {
      fullName: customer.fullName ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      role: "customer",
    },
    kind: "question",
    subject: message.slice(0, 80) || "Customer live chat",
    categoryId: "live_chat",
    message,
    status: "open",
    priority: "medium",
    slaDueAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    history: [
      {
        action: "created",
        actorId: customer.id,
        actorName: customer.fullName ?? "Customer",
        note: message.slice(0, 120),
        createdAt: new Date(),
      },
    ],
    attachments:
      params.attachments?.map((attachment) => ({
        url: attachment.url ?? "",
        publicId: attachment.publicId ?? "",
        fileName: attachment.fileName ?? "",
        fileType: attachment.fileType ?? "",
      })) ?? [],
  });

  await createAdminOperationalAlert({
    alertType: "support_case_created",
    severity: "warning",
    title: `Customer support: ${message.slice(0, 80) || "Live chat"}`,
    description: message.slice(0, 180),
    source: "Support",
    entityType: "support_case",
    entityId: supportCase.id,
    path: `/support?caseId=${supportCase.id}`,
    iconKey: "headphones",
    dedupeKey: `support:${supportCase.id}:created`,
    metadata: {
      supportCaseId: supportCase.id,
      source: "customer",
      priority: "medium",
    },
  });

  return mapCustomerSupportCase(supportCase);
}

export async function appendCustomerSupportCaseMessage(params: {
  customerId: string;
  supportCaseId: string;
  message: string;
  attachments?: Array<{
    url?: string;
    publicId?: string;
    fileName?: string;
    fileType?: string;
  }>;
}) {
  const safeCustomerId = ensureCustomerIdentity(params.customerId);
  const supportCase = await SupportCaseModel.findOne({
    _id: params.supportCaseId,
    source: "customer",
    customerId: safeCustomerId,
  });

  if (!supportCase) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "SUPPORT_CASE_NOT_FOUND",
      "Support case not found",
    );
  }

  const currentReplies =
    (supportCase.toObject().replies as unknown as
      | Array<Record<string, unknown>>
      | undefined) ?? [];

  const nextReplies = currentReplies
    .concat({
      message: params.message.trim(),
      senderType: "customer",
      senderId: safeCustomerId,
      senderName: supportCase.customerSnapshot?.fullName || "Customer",
      attachments:
        params.attachments?.map((attachment) => ({
          url: attachment.url ?? "",
          publicId: attachment.publicId ?? "",
          fileName: attachment.fileName ?? "",
          fileType: attachment.fileType ?? "",
        })) ?? [],
      createdAt: new Date(),
    })
    .slice(-MAX_SUPPORT_CASE_REPLIES);

  supportCase.set("replies", nextReplies);
  if (supportCase.status === "resolved" || supportCase.status === "closed") {
    supportCase.status = "open";
  }
  await supportCase.save();

  const message = params.message.trim();
  const latestReply = nextReplies[nextReplies.length - 1] as
    | Record<string, unknown>
    | undefined;
  await createAdminOperationalAlert({
    alertType: "support_customer_message",
    severity: "warning",
    title: `Customer replied: ${message.slice(0, 80) || "Support message"}`,
    description: message.slice(0, 180),
    source: "Support",
    entityType: "support_case",
    entityId: supportCase.id,
    path: `/support?caseId=${supportCase.id}`,
    iconKey: "headphones",
    dedupeKey: `support:${supportCase.id}:customer_message:${new Date(
      latestReply?.createdAt instanceof Date ||
        typeof latestReply?.createdAt === "string"
        ? latestReply.createdAt
        : Date.now(),
    ).getTime()}`,
    metadata: {
      supportCaseId: supportCase.id,
      source: "customer",
      customerId: safeCustomerId,
      customerName: supportCase.customerSnapshot?.fullName || "Customer",
      customerPhone: supportCase.customerSnapshot?.phone || "",
      replyCount: nextReplies.length,
    },
  });

  return mapCustomerSupportCase(supportCase);
}
