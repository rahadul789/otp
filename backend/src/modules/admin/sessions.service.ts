import { StatusCodes } from "http-status-codes"
import type { Model } from "mongoose"

import { AppError } from "../../common/utils/app-error"
import { createInMemoryAsyncCache } from "../../common/utils/in-memory-cache"
import {
  OwnerModel,
  RefreshTokenSessionModel,
  RiderModel,
  RiderRefreshTokenSessionModel,
} from "../auth/auth.model"
import {
  CustomerModel,
  CustomerRefreshTokenSessionModel,
} from "../customer/customer.model"
import { AdminModel, AdminRefreshTokenSessionModel } from "./admin.model"

export type AdminSessionRole = "admin" | "owner" | "customer" | "rider"
export type AdminSessionStatus =
  | "all"
  | "active"
  | "recent"
  | "stale"
  | "revoked"
  | "expired"

type SessionListParams = {
  role?: AdminSessionRole | "all"
  status?: AdminSessionStatus
  page?: number
  pageSize?: number
}

type SessionConfig = {
  role: AdminSessionRole
  model: Model<any>
  actorField: string
  actorModel: Model<any>
  actorSelect: Record<string, 1>
}

const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_ACTIVITY_WINDOW_MS = 60 * 60 * 1000
const STALE_SESSION_AFTER_MS = 30 * DAY_MS

const sessionConfigs: SessionConfig[] = [
  {
    role: "admin",
    model: AdminRefreshTokenSessionModel,
    actorField: "adminId",
    actorModel: AdminModel,
    actorSelect: { fullName: 1, email: 1, role: 1, status: 1, lastLoginAt: 1 },
  },
  {
    role: "owner",
    model: RefreshTokenSessionModel,
    actorField: "ownerId",
    actorModel: OwnerModel,
    actorSelect: { fullName: 1, phone: 1, email: 1, status: 1, lastLoginAt: 1 },
  },
  {
    role: "customer",
    model: CustomerRefreshTokenSessionModel,
    actorField: "customerId",
    actorModel: CustomerModel,
    actorSelect: { fullName: 1, phone: 1, email: 1, status: 1, lastLoginAt: 1 },
  },
  {
    role: "rider",
    model: RiderRefreshTokenSessionModel,
    actorField: "riderId",
    actorModel: RiderModel,
    actorSelect: { fullName: 1, phone: 1, status: 1, lastLoginAt: 1 },
  },
]

const adminSessionsCache = createInMemoryAsyncCache<any>({
  ttlMs: 5_000,
  staleWhileRevalidateMs: 15_000,
  maxEntries: 24,
})

function invalidateAdminSessionsCache() {
  adminSessionsCache.clear()
}

function getConfig(role: AdminSessionRole) {
  const config = sessionConfigs.find((item) => item.role === role)
  if (!config) {
    throw new AppError(StatusCodes.BAD_REQUEST, "INVALID_SESSION_ROLE", "Invalid session role")
  }
  return config
}

function buildStatusQuery(status: AdminSessionStatus = "active") {
  const now = new Date()
  if (status === "all") return {}
  if (status === "revoked") return { revokedAt: { $ne: null } }
  if (status === "expired") {
    return { revokedAt: null, expiresAt: { $lte: now } }
  }
  if (status === "recent") {
    return {
      revokedAt: null,
      expiresAt: { $gt: now },
      updatedAt: { $gte: new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS) },
    }
  }
  if (status === "stale") {
    return {
      revokedAt: null,
      expiresAt: { $gt: now },
      updatedAt: { $lt: new Date(now.getTime() - STALE_SESSION_AFTER_MS) },
    }
  }
  return { revokedAt: null, expiresAt: { $gt: now } }
}

function buildValidSessionQuery() {
  return buildStatusQuery("active")
}

async function countValidUniqueActors(config: SessionConfig) {
  const actorIds = await config.model.distinct(config.actorField, buildValidSessionQuery())
  return actorIds.filter(Boolean).length
}

async function buildSessionSummary() {
  const [activeRows, revokedRows, expiredRows, uniqueRows, recentRows, staleRows] =
    await Promise.all([
      Promise.all(
        sessionConfigs.map((config) =>
          config.model.countDocuments(buildStatusQuery("active"))
        )
      ),
      Promise.all(
        sessionConfigs.map((config) =>
          config.model.countDocuments(buildStatusQuery("revoked"))
        )
      ),
      Promise.all(
        sessionConfigs.map((config) =>
          config.model.countDocuments(buildStatusQuery("expired"))
        )
      ),
      Promise.all(sessionConfigs.map(countValidUniqueActors)),
      Promise.all(
        sessionConfigs.map((config) =>
          config.model.countDocuments(buildStatusQuery("recent"))
        )
      ),
      Promise.all(
        sessionConfigs.map((config) =>
          config.model.countDocuments(buildStatusQuery("stale"))
        )
      ),
    ])

  const sum = (rows: number[]) => rows.reduce((total, count) => total + count, 0)

  return {
    active: sum(activeRows),
    valid: sum(activeRows),
    revoked: sum(revokedRows),
    expired: sum(expiredRows),
    uniqueValidAccounts: sum(uniqueRows),
    recentlyActive: sum(recentRows),
    stale: sum(staleRows),
    recentWindowMinutes: Math.round(RECENT_ACTIVITY_WINDOW_MS / 60_000),
    staleAfterDays: Math.round(STALE_SESSION_AFTER_MS / DAY_MS),
  }
}

function sessionStatus(session: Record<string, any>) {
  if (session.revokedAt) return "revoked"
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    return "expired"
  }
  return "active"
}

function serializeDate(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function mapActor(actor: Record<string, any> | undefined, fallbackId: string) {
  const fullName = String(actor?.fullName ?? "").trim()
  const email = String(actor?.email ?? "").trim()
  const phone = String(actor?.phone ?? "").trim()

  return {
    id: String(actor?._id ?? actor?.id ?? fallbackId),
    name: fullName || email || phone || "Unknown account",
    contact: email || phone,
    status: String(actor?.status ?? ""),
    lastLoginAt: serializeDate(actor?.lastLoginAt),
  }
}

async function listSessionsForConfig(params: {
  config: SessionConfig
  status: AdminSessionStatus
  limit: number
}) {
  const query = buildStatusQuery(params.status)
  const sessions = await params.config.model
    .find(query)
    .sort({ createdAt: -1 })
    .limit(params.limit)
    .lean()

  const actorIds = [
    ...new Set(
      sessions.map((session) => String(session[params.config.actorField] ?? "")).filter(Boolean)
    ),
  ]
  const actors = actorIds.length
    ? await params.config.actorModel
        .find({ _id: { $in: actorIds } })
        .select(params.config.actorSelect)
        .lean()
    : []
  const actorMap = new Map(actors.map((actor: any) => [String(actor._id), actor]))

  return sessions.map((session) => {
    const actorId = String(session[params.config.actorField] ?? "")
    const actor = mapActor(actorMap.get(actorId), actorId)

    return {
      id: String(session._id),
      role: params.config.role,
      status: sessionStatus(session),
      actor,
      tokenId: String(session.tokenId ?? ""),
      userAgent: String(session.userAgent ?? ""),
      ipAddress: String(session.ipAddress ?? ""),
      createdAt: serializeDate(session.createdAt),
      lastSeenAt: serializeDate(session.updatedAt ?? session.createdAt),
      expiresAt: serializeDate(session.expiresAt),
      revokedAt: serializeDate(session.revokedAt),
    }
  })
}

export async function listAdminSessions(params: SessionListParams) {
  const page = Math.max(1, Math.floor(Number(params.page ?? 1)) || 1)
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(params.pageSize ?? 50)) || 50))
  const roles =
    !params.role || params.role === "all"
      ? sessionConfigs
      : [getConfig(params.role)]
  const status = params.status ?? "active"
  const fetchLimit = page * pageSize
  const cacheKey = [roles.map((config) => config.role).join(","), status, page, pageSize].join("|")

  return adminSessionsCache.getOrSet(cacheKey, async () => {
    const [itemsByRole, counts] = await Promise.all([
      Promise.all(
        roles.map((config) =>
          listSessionsForConfig({
            config,
            status,
            limit: fetchLimit,
          })
        )
      ),
      Promise.all(
        roles.map((config) => config.model.countDocuments(buildStatusQuery(status)))
      ),
    ])

    const items = itemsByRole
      .flat()
      .sort(
        (left, right) =>
          new Date(right.createdAt ?? 0).getTime() -
          new Date(left.createdAt ?? 0).getTime()
      )
    const total = counts.reduce((sum, count) => sum + count, 0)
    const pagedItems = items.slice((page - 1) * pageSize, page * pageSize)

    return {
      items: pagedItems,
      total,
      page,
      pageSize,
      summary: await buildSessionSummary(),
    }
  })
}

export async function revokeAdminSession(params: {
  role: AdminSessionRole
  sessionId: string
}) {
  const config = getConfig(params.role)
  const session = await config.model.findOneAndUpdate(
    { _id: params.sessionId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  )

  if (!session) {
    throw new AppError(StatusCodes.NOT_FOUND, "SESSION_NOT_FOUND", "Valid session not found")
  }

  invalidateAdminSessionsCache()
  return { revoked: true }
}

export async function revokeAdminActorSessions(params: {
  role: AdminSessionRole
  actorId: string
}) {
  const config = getConfig(params.role)
  const result = await config.model.updateMany(
    {
      [config.actorField]: params.actorId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { revokedAt: new Date() } }
  )

  if (result.modifiedCount > 0) {
    invalidateAdminSessionsCache()
  }
  return { revoked: result.modifiedCount }
}
