import { StatusCodes } from "http-status-codes"

import { AppError } from "../../common/utils/app-error"
import { env } from "../../config/env"
import { ServiceZoneModel } from "./service-area.model"

type ServiceZoneRecord = Record<string, any>

export type ServiceAreaSnapshot = {
  districtId: string
  districtName: string
  zoneId: string
  zoneName: string
  center: {
    latitude: number
    longitude: number
  }
  radiusKm: number
  distanceFromCenterKm?: number | null
  delivery?: Record<string, unknown>
}

const SERVICE_ZONE_CACHE_TTL_MS = 30_000

let activeZonesCache:
  | {
      expiresAt: number
      value?: ServiceZoneRecord[]
      promise?: Promise<ServiceZoneRecord[]>
    }
  | null = null

export function isServiceAreaModeEnabled() {
  return env.SERVICE_AREAS_ENABLED === true
}

export function invalidateServiceAreaCache() {
  activeZonesCache = null
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

export function calculateServiceDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  const earthRadiusKm = 6371
  const deltaLat = toRadians(latitudeB - latitudeA)
  const deltaLng = toRadians(longitudeB - longitudeA)
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Number((earthRadiusKm * c).toFixed(3))
}

function getCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
}

async function fetchActiveServiceZones() {
  return ServiceZoneModel.find({ status: "active" })
    .sort({ priority: -1, displayOrder: 1, name: 1 })
    .lean<ServiceZoneRecord[]>()
}

export async function listActiveServiceZones() {
  if (!isServiceAreaModeEnabled()) return []

  const now = Date.now()
  if (activeZonesCache?.value && activeZonesCache.expiresAt > now) {
    return activeZonesCache.value
  }

  if (activeZonesCache?.promise) {
    return activeZonesCache.promise
  }

  const promise = fetchActiveServiceZones()
  activeZonesCache = {
    expiresAt: now + SERVICE_ZONE_CACHE_TTL_MS,
    promise
  }

  try {
    const value = await promise
    activeZonesCache = {
      expiresAt: Date.now() + SERVICE_ZONE_CACHE_TTL_MS,
      value
    }
    return value
  } catch (error) {
    activeZonesCache = null
    throw error
  }
}

export function buildServiceAreaSnapshot(
  zone: ServiceZoneRecord,
  distanceFromCenterKm?: number | null
): ServiceAreaSnapshot {
  return {
    districtId: String(zone.districtId ?? ""),
    districtName: String(zone.districtName ?? ""),
    zoneId: String(zone._id ?? zone.id ?? ""),
    zoneName: String(zone.name ?? ""),
    center: {
      latitude: Number(zone.center?.latitude ?? 0),
      longitude: Number(zone.center?.longitude ?? 0)
    },
    radiusKm: Number(zone.radiusKm ?? 0),
    distanceFromCenterKm: distanceFromCenterKm ?? null,
    delivery: zone.delivery ?? {}
  }
}

export async function resolveServiceZoneForCoordinates(params: {
  latitude?: number | null
  longitude?: number | null
}) {
  if (!isServiceAreaModeEnabled()) return null

  const latitude = getCoordinate(params.latitude)
  const longitude = getCoordinate(params.longitude)
  if (latitude === null || longitude === null) {
    return null
  }

  const zones = await listActiveServiceZones()
  const matches = zones
    .map((zone) => {
      const zoneLatitude = getCoordinate(zone.center?.latitude)
      const zoneLongitude = getCoordinate(zone.center?.longitude)
      const radiusKm = getCoordinate(zone.radiusKm) ?? 0
      if (zoneLatitude === null || zoneLongitude === null || radiusKm <= 0) {
        return null
      }
      const distanceFromCenterKm = calculateServiceDistanceKm(
        latitude,
        longitude,
        zoneLatitude,
        zoneLongitude
      )
      if (distanceFromCenterKm > radiusKm) return null
      return {
        zone,
        distanceFromCenterKm,
        remainingCoverageKm: radiusKm - distanceFromCenterKm
      }
    })
    .filter(Boolean) as Array<{
    zone: ServiceZoneRecord
    distanceFromCenterKm: number
    remainingCoverageKm: number
  }>

  matches.sort((left, right) => {
    const priorityDiff = Number(right.zone.priority ?? 0) - Number(left.zone.priority ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    const radiusDiff = Number(left.zone.radiusKm ?? 0) - Number(right.zone.radiusKm ?? 0)
    if (radiusDiff !== 0) return radiusDiff
    return left.distanceFromCenterKm - right.distanceFromCenterKm
  })

  const match = matches[0]
  if (!match) return null

  return {
    zone: match.zone,
    snapshot: buildServiceAreaSnapshot(match.zone, match.distanceFromCenterKm),
    distanceFromCenterKm: match.distanceFromCenterKm
  }
}

export async function assertLocationInsideServiceArea(params: {
  latitude?: number | null
  longitude?: number | null
  required?: boolean
}) {
  if (!isServiceAreaModeEnabled()) return null

  const resolved = await resolveServiceZoneForCoordinates(params)
  if (resolved) return resolved

  if (params.required === false) return null

  throw new AppError(
    StatusCodes.BAD_REQUEST,
    "SERVICE_AREA_UNAVAILABLE",
    "Foodbela is not available at this location yet. Please choose an address inside an active service area."
  )
}

export function getRestaurantServiceAreaSnapshot(
  restaurant: Record<string, any> | null | undefined
): ServiceAreaSnapshot | null {
  const serviceArea = restaurant?.serviceArea
  const zoneId = typeof serviceArea?.zoneId === "string" ? serviceArea.zoneId.trim() : ""
  if (!zoneId) return null
  return {
    districtId: String(serviceArea.districtId ?? ""),
    districtName: String(serviceArea.districtName ?? ""),
    zoneId,
    zoneName: String(serviceArea.zoneName ?? ""),
    center: {
      latitude: Number(serviceArea.center?.latitude ?? 0),
      longitude: Number(serviceArea.center?.longitude ?? 0)
    },
    radiusKm: Number(serviceArea.radiusKm ?? 0)
  }
}

export async function resolveRestaurantServiceAreaSnapshot(
  restaurant: Record<string, any> | null | undefined
) {
  const existingSnapshot = getRestaurantServiceAreaSnapshot(restaurant)
  if (existingSnapshot) return existingSnapshot

  if (!isServiceAreaModeEnabled()) return null

  const latitude = getCoordinate(restaurant?.location?.latitude)
  const longitude = getCoordinate(restaurant?.location?.longitude)
  if (latitude === null || longitude === null) return null

  const resolved = await resolveServiceZoneForCoordinates({ latitude, longitude })
  return resolved?.snapshot ?? null
}

export function assertRestaurantMatchesDeliveryServiceArea(params: {
  restaurantServiceArea?: ServiceAreaSnapshot | null
  deliveryServiceArea?: ServiceAreaSnapshot | null
}) {
  if (!isServiceAreaModeEnabled()) return
  const restaurantZoneId = params.restaurantServiceArea?.zoneId ?? ""
  const deliveryZoneId = params.deliveryServiceArea?.zoneId ?? ""
  if (!deliveryZoneId || restaurantZoneId === deliveryZoneId) {
    return
  }

  throw new AppError(
    StatusCodes.BAD_REQUEST,
    "RESTAURANT_OUT_OF_SERVICE_AREA",
    "This restaurant is not available for the selected service area."
  )
}

export function applyServiceAreaDeliveryPricing<
  T extends {
    baseFeeTaka: number
    distanceSurchargeEnabled: boolean
    surchargeStartsAfterKm: number
    surchargeStepMeters: number
    surchargeAmountTaka: number
  }
>(pricing: T, serviceArea?: ServiceAreaSnapshot | null): T {
  if (!isServiceAreaModeEnabled() || !serviceArea?.delivery) return pricing
  const delivery = serviceArea.delivery as Record<string, unknown>
  return {
    ...pricing,
    baseFeeTaka:
      typeof delivery.baseFeeTaka === "number" ? delivery.baseFeeTaka : pricing.baseFeeTaka,
    distanceSurchargeEnabled:
      typeof delivery.distanceSurchargeEnabled === "boolean"
        ? delivery.distanceSurchargeEnabled
        : pricing.distanceSurchargeEnabled,
    surchargeStartsAfterKm:
      typeof delivery.surchargeStartsAfterKm === "number"
        ? delivery.surchargeStartsAfterKm
        : pricing.surchargeStartsAfterKm,
    surchargeStepMeters:
      typeof delivery.surchargeStepMeters === "number"
        ? delivery.surchargeStepMeters
        : pricing.surchargeStepMeters,
    surchargeAmountTaka:
      typeof delivery.surchargeAmountTaka === "number"
        ? delivery.surchargeAmountTaka
        : pricing.surchargeAmountTaka
  }
}

export function getRiderAssignedZoneIds(rider: Record<string, any> | null | undefined) {
  const assignedZoneIds = normalizeStringArray(rider?.serviceArea?.assignedZoneIds)
  const primaryZoneId =
    typeof rider?.serviceArea?.primaryZoneId === "string"
      ? rider.serviceArea.primaryZoneId.trim()
      : ""
  return [...new Set([primaryZoneId, ...assignedZoneIds].filter(Boolean))]
}

export function isRiderAllowedForServiceArea(params: {
  rider: Record<string, any> | null | undefined
  serviceAreaSnapshot?: Record<string, any> | null
}) {
  if (!isServiceAreaModeEnabled()) return true

  const orderZoneId =
    typeof params.serviceAreaSnapshot?.zoneId === "string"
      ? params.serviceAreaSnapshot.zoneId.trim()
      : ""
  if (!orderZoneId) return true

  const assignedZoneIds = getRiderAssignedZoneIds(params.rider)
  if (!assignedZoneIds.length) return false
  return assignedZoneIds.includes(orderZoneId)
}

export function assertRiderAllowedForServiceArea(params: {
  rider: Record<string, any> | null | undefined
  serviceAreaSnapshot?: Record<string, any> | null
}) {
  if (isRiderAllowedForServiceArea(params)) return

  throw new AppError(
    StatusCodes.BAD_REQUEST,
    "RIDER_OUTSIDE_SERVICE_AREA",
    "This rider is not assigned to the order service area."
  )
}

export function buildServiceAreaOrderFilterForRider(
  rider: Record<string, any> | null | undefined
) {
  if (!isServiceAreaModeEnabled()) return {}
  const assignedZoneIds = getRiderAssignedZoneIds(rider)
  if (!assignedZoneIds.length) {
    return { "serviceAreaSnapshot.zoneId": { $in: [] } }
  }
  return { "serviceAreaSnapshot.zoneId": { $in: assignedZoneIds } }
}

function normalizeScopeId(value?: string | null) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized && normalized !== "all" ? normalized : ""
}

export function buildOrderServiceAreaScopeFilter(params?: {
  zoneId?: string | null
  districtId?: string | null
}) {
  if (!isServiceAreaModeEnabled()) return {}
  const zoneId = normalizeScopeId(params?.zoneId)
  const districtId = normalizeScopeId(params?.districtId)
  if (zoneId) return { "serviceAreaSnapshot.zoneId": zoneId }
  if (districtId) return { "serviceAreaSnapshot.districtId": districtId }
  return {}
}

export function buildRestaurantServiceAreaScopeFilter(params?: {
  zoneId?: string | null
  districtId?: string | null
}) {
  if (!isServiceAreaModeEnabled()) return {}
  const zoneId = normalizeScopeId(params?.zoneId)
  const districtId = normalizeScopeId(params?.districtId)
  if (zoneId) return { "serviceArea.zoneId": zoneId }
  if (districtId) return { "serviceArea.districtId": districtId }
  return {}
}

export function buildRiderServiceAreaScopeFilter(params?: {
  zoneId?: string | null
  districtId?: string | null
}) {
  if (!isServiceAreaModeEnabled()) return {}
  const zoneId = normalizeScopeId(params?.zoneId)
  const districtId = normalizeScopeId(params?.districtId)
  if (zoneId) {
    return { "serviceArea.assignedZoneIds": zoneId }
  }
  if (districtId) return { "serviceArea.districtIds": districtId }
  return {}
}

export async function getServiceAreaDispatchOverrides(
  serviceAreaSnapshot?: Record<string, any> | null
) {
  if (!isServiceAreaModeEnabled()) return null
  const zoneId = normalizeScopeId(serviceAreaSnapshot?.zoneId)
  if (!zoneId) return null
  const zone = await ServiceZoneModel.findById(zoneId)
    .select({ dispatch: 1 })
    .lean<ServiceZoneRecord | null>()
  return zone?.dispatch ?? null
}
