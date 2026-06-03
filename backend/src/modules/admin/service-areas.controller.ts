import type { Response } from "express"
import { StatusCodes } from "http-status-codes"
import { z } from "zod"

import type { AuthenticatedRequest } from "../../common/middleware/auth"
import { sendSuccess } from "../../common/utils/api-response"
import { AppError } from "../../common/utils/app-error"
import { asyncHandler } from "../../common/utils/async-handler"
import { slugify } from "../../common/utils/slugify"
import { invalidateServiceAreaCache } from "../service-area/service-area.service"
import {
  ServiceDistrictModel,
  ServiceZoneModel
} from "../service-area/service-area.model"
import {
  invalidateAdminDispatchSettingsCache,
  invalidateAdminMonitoringCaches,
} from "./orders-monitor.service"
import { invalidateAdminPlatformSettingsCache } from "./settings.service"

function invalidateAdminServiceAreaCaches() {
  invalidateServiceAreaCache()
  invalidateAdminPlatformSettingsCache()
  invalidateAdminDispatchSettingsCache()
  invalidateAdminMonitoringCaches()
}

const districtPayloadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().max(100).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  country: z.string().trim().max(80).optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  notes: z.string().trim().max(1000).optional()
})

const zonePayloadSchema = z.object({
  districtId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(120).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  center: z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180)
  }),
  radiusKm: z.coerce.number().min(0.1).max(80),
  priority: z.coerce.number().int().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  delivery: z
    .object({
      baseFeeTaka: z.coerce.number().min(0).nullable().optional(),
      distanceSurchargeEnabled: z.boolean().nullable().optional(),
      surchargeStartsAfterKm: z.coerce.number().min(0).nullable().optional(),
      surchargeStepMeters: z.coerce.number().int().min(1).nullable().optional(),
      surchargeAmountTaka: z.coerce.number().min(0).nullable().optional(),
      maxRestaurantDistanceKm: z.coerce.number().min(0).nullable().optional(),
      rainSurchargeEnabled: z.boolean().optional(),
      rainSurchargeTaka: z.coerce.number().min(0).optional()
    })
    .optional(),
  dispatch: z
    .object({
      autoAssignEnabled: z.boolean().optional(),
      autoReassignTimedOutOrders: z.boolean().nullable().optional(),
      dispatchMode: z.enum(["fleet", "primary_rider"]).nullable().optional(),
      primaryRiderId: z.string().trim().optional(),
      primaryRiderFallbackEnabled: z.boolean().nullable().optional(),
      algorithm: z
        .enum(["nearest_eligible_balanced", "least_loaded_first"])
        .nullable()
        .optional(),
      maxActiveOrdersPerRiderOverride: z.coerce.number().int().min(1).nullable().optional(),
      staleLocationCutoffMinutes: z.coerce.number().int().min(1).nullable().optional(),
      assignmentTimeoutMinutes: z.coerce.number().int().min(1).nullable().optional(),
      ownerAcceptanceTimeoutMinutes: z.coerce.number().int().min(1).nullable().optional(),
      prepStartGraceMinutes: z.coerce.number().int().min(1).nullable().optional(),
      preparationMaxExtraMinutes: z.coerce.number().int().min(0).nullable().optional(),
      prepLateGraceMinutes: z.coerce.number().int().min(0).nullable().optional(),
      pickupLateGraceMinutes: z.coerce.number().int().min(1).nullable().optional(),
      deliveryLateGraceMinutes: z.coerce.number().int().min(1).nullable().optional(),
      deliveryWatchAfterPickupMinutes: z.coerce.number().int().min(1).nullable().optional(),
      deliveryLateAfterPickupMinutes: z.coerce.number().int().min(1).nullable().optional(),
      deliveryCriticalAfterPickupMinutes: z.coerce.number().int().min(1).nullable().optional(),
      retryCooldownMinutes: z.coerce.number().int().min(1).nullable().optional(),
      surgeReadyOrderThreshold: z.coerce.number().int().min(1).nullable().optional(),
      surgeUnassignedOrderThreshold: z.coerce.number().int().min(1).nullable().optional(),
      autoCancelUnacceptedOrdersEnabled: z.boolean().nullable().optional(),
      autoCancelAfterMinutes: z.coerce.number().int().min(2).nullable().optional(),
      autoCancelNotifyBeforeMinutes: z.coerce.number().int().min(1).nullable().optional()
    })
    .optional(),
  notes: z.string().trim().max(1000).optional()
})

function normalizeSlug(name: string, fallback?: string) {
  const slug = slugify(fallback?.trim() || name)
  return slug || slugify(name)
}

function mapDistrict(district: Record<string, any>, zones: Record<string, any>[]) {
  return {
    id: String(district._id ?? ""),
    name: district.name ?? "",
    slug: district.slug ?? "",
    status: district.status ?? "active",
    country: district.country ?? "Bangladesh",
    displayOrder: district.displayOrder ?? 0,
    notes: district.notes ?? "",
    createdAt: district.createdAt,
    updatedAt: district.updatedAt,
    zones: zones
      .filter((zone) => String(zone.districtId ?? "") === String(district._id ?? ""))
      .map(mapZone)
  }
}

function mapZone(zone: Record<string, any>) {
  return {
    id: String(zone._id ?? ""),
    districtId: String(zone.districtId ?? ""),
    districtName: zone.districtName ?? "",
    name: zone.name ?? "",
    slug: zone.slug ?? "",
    status: zone.status ?? "active",
    center: zone.center ?? null,
    radiusKm: zone.radiusKm ?? 0,
    priority: zone.priority ?? 0,
    displayOrder: zone.displayOrder ?? 0,
    delivery: zone.delivery ?? {},
    dispatch: zone.dispatch ?? {},
    notes: zone.notes ?? "",
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt
  }
}

export const listAdminServiceAreasController = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    const [districts, zones] = await Promise.all([
      ServiceDistrictModel.find({ status: { $ne: "archived" } })
        .sort({ displayOrder: 1, name: 1 })
        .lean(),
      ServiceZoneModel.find({ status: { $ne: "archived" } })
        .sort({ priority: -1, displayOrder: 1, name: 1 })
        .lean()
    ])

    return sendSuccess(res, {
      data: {
        districts: districts.map((district) => mapDistrict(district, zones)),
        zones: zones.map(mapZone)
      }
    })
  }
)

export const createAdminServiceDistrictController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = districtPayloadSchema.parse(req.body)
    const district = await ServiceDistrictModel.create({
      name: payload.name,
      slug: normalizeSlug(payload.name, payload.slug),
      status: payload.status ?? "active",
      country: payload.country ?? "Bangladesh",
      displayOrder: payload.displayOrder ?? 0,
      notes: payload.notes ?? ""
    })
    invalidateAdminServiceAreaCaches()

    return sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      message: "Service district created",
      data: mapDistrict(district.toObject(), [])
    })
  }
)

export const updateAdminServiceDistrictController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = districtPayloadSchema.partial().parse(req.body)
    const district = await ServiceDistrictModel.findById(req.params.districtId)
    if (!district) {
      throw new AppError(StatusCodes.NOT_FOUND, "SERVICE_DISTRICT_NOT_FOUND", "Service district not found")
    }

    if (payload.name !== undefined) district.name = payload.name
    if (payload.slug !== undefined || payload.name !== undefined) {
      district.slug = normalizeSlug(payload.name ?? district.name, payload.slug)
    }
    if (payload.status !== undefined) district.status = payload.status
    if (payload.country !== undefined) district.country = payload.country
    if (payload.displayOrder !== undefined) district.displayOrder = payload.displayOrder
    if (payload.notes !== undefined) district.notes = payload.notes
    await district.save()

    await ServiceZoneModel.updateMany(
      { districtId: district._id },
      { $set: { districtName: district.name } }
    )
    invalidateAdminServiceAreaCaches()

    const zones = await ServiceZoneModel.find({ districtId: district._id }).lean()
    return sendSuccess(res, {
      message: "Service district updated",
      data: mapDistrict(district.toObject(), zones)
    })
  }
)

export const createAdminServiceZoneController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = zonePayloadSchema.parse(req.body)
    const district = await ServiceDistrictModel.findById(payload.districtId)
    if (!district || district.status === "archived") {
      throw new AppError(StatusCodes.NOT_FOUND, "SERVICE_DISTRICT_NOT_FOUND", "Service district not found")
    }

    const zone = await ServiceZoneModel.create({
      districtId: district._id,
      districtName: district.name,
      name: payload.name,
      slug: normalizeSlug(payload.name, payload.slug),
      status: payload.status ?? "active",
      center: payload.center,
      radiusKm: payload.radiusKm,
      priority: payload.priority ?? 0,
      displayOrder: payload.displayOrder ?? 0,
      delivery: payload.delivery ?? {},
      dispatch: payload.dispatch ?? {},
      notes: payload.notes ?? ""
    })
    invalidateAdminServiceAreaCaches()

    return sendSuccess(res, {
      statusCode: StatusCodes.CREATED,
      message: "Service zone created",
      data: mapZone(zone.toObject())
    })
  }
)

export const updateAdminServiceZoneController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = zonePayloadSchema.partial().parse(req.body)
    const zone = await ServiceZoneModel.findById(req.params.zoneId)
    if (!zone) {
      throw new AppError(StatusCodes.NOT_FOUND, "SERVICE_ZONE_NOT_FOUND", "Service zone not found")
    }

    if (payload.districtId !== undefined) {
      const district = await ServiceDistrictModel.findById(payload.districtId)
      if (!district || district.status === "archived") {
        throw new AppError(StatusCodes.NOT_FOUND, "SERVICE_DISTRICT_NOT_FOUND", "Service district not found")
      }
      zone.districtId = district._id
      zone.districtName = district.name
    }
    if (payload.name !== undefined) zone.name = payload.name
    if (payload.slug !== undefined || payload.name !== undefined) {
      zone.slug = normalizeSlug(payload.name ?? zone.name, payload.slug)
    }
    if (payload.status !== undefined) zone.status = payload.status
    if (payload.center !== undefined) zone.center = payload.center
    if (payload.radiusKm !== undefined) zone.radiusKm = payload.radiusKm
    if (payload.priority !== undefined) zone.priority = payload.priority
    if (payload.displayOrder !== undefined) zone.displayOrder = payload.displayOrder
    if (payload.delivery !== undefined) zone.set("delivery", payload.delivery)
    if (payload.dispatch !== undefined) zone.set("dispatch", payload.dispatch)
    if (payload.notes !== undefined) zone.notes = payload.notes
    await zone.save()
    invalidateAdminServiceAreaCaches()

    return sendSuccess(res, {
      message: "Service zone updated",
      data: mapZone(zone.toObject())
    })
  }
)

export const archiveAdminServiceZoneController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const zone = await ServiceZoneModel.findByIdAndUpdate(
      req.params.zoneId,
      { $set: { status: "archived" } },
      { new: true }
    )
    if (!zone) {
      throw new AppError(StatusCodes.NOT_FOUND, "SERVICE_ZONE_NOT_FOUND", "Service zone not found")
    }
    invalidateAdminServiceAreaCaches()

    return sendSuccess(res, {
      message: "Service zone archived",
      data: mapZone(zone.toObject())
    })
  }
)
