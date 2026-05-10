import { StatusCodes } from "http-status-codes";

import { AppError } from "../../common/utils/app-error";
import { decorateTrackingSnapshot } from "../../common/utils/tracking-freshness";
import { AdminModel } from "./admin.model";
import { OwnerModel, RiderModel, RestaurantModel } from "../auth/auth.model";
import { LedgerEntryModel } from "../owner/finance.model";
import { NotificationModel, OrderModel } from "../owner/operational.model";
import { emitSocketEvent } from "../../config/socket";
import { sendPushToCustomer } from "../customer/push.service";
import { sendPushToRider } from "../rider/push.service";
import {
  getRiderAvailabilitySummary,
  syncRiderAvailabilitySession,
} from "../rider/availability-session.service";
import {
  getPlatformContent,
  updatePlatformContent,
} from "../public/content.service";
import { DispatchDecisionLogModel } from "./dispatch-log.model";
import { createAdminActivityLog } from "./activity-log.service";
import { RiderPayrollCycleModel } from "./rider-payroll.model";
import { createAdminOperationalAlert } from "./admin-alert.service";
import { recordBusinessEvent } from "./business-event.service";

const MAX_ORDER_HISTORY_ENTRIES = 100;

type DispatchAlgorithm = "nearest_eligible_balanced" | "least_loaded_first";
type DispatchMode = "fleet" | "primary_rider";
type RiderPayrollStatus = "draft" | "approved" | "paid";
type RiderPayrollAdjustmentType =
  | "bonus"
  | "tip"
  | "reimbursement"
  | "penalty"
  | "deduction";

type DispatchSettings = {
  autoAssignmentEnabled: boolean;
  autoReassignTimedOutOrders: boolean;
  dispatchMode: DispatchMode;
  primaryRiderId: string;
  primaryRiderFallbackEnabled: boolean;
  algorithm: DispatchAlgorithm;
  ownerAcceptanceTimeoutMinutes: number;
  maxActiveOrdersPerRider: number;
  staleLocationCutoffMinutes: number;
  assignmentTimeoutMinutes: number;
  prepStartGraceMinutes: number;
  prepLateGraceMinutes: number;
  pickupLateGraceMinutes: number;
  deliveryLateGraceMinutes: number;
  retryCooldownMinutes: number;
  surgeReadyOrderThreshold: number;
  surgeUnassignedOrderThreshold: number;
  autoCancelUnacceptedOrdersEnabled: boolean;
  autoCancelAfterMinutes: number;
  autoCancelNotifyBeforeMinutes: number;
};

type RiderAssignmentCandidate = {
  id: string;
  fullName: string;
  phone: string;
  vehicleType: string;
  isAvailableForAssignments: boolean;
  activeOrders: number;
  hasActiveTracking: boolean;
  distanceKm: number | null;
  hasFreshLocation: boolean;
};

type DispatchDecisionLogEntry = {
  id: string;
  orderId: string;
  orderNumber: string;
  restaurantName: string;
  algorithm: DispatchAlgorithm;
  assignmentSource: "manual_admin" | "auto_dispatch";
  outcome: "assigned" | "reassigned" | "no_match" | "skipped";
  selectedRiderName: string;
  reason: string;
  candidateCount: number;
  candidates: Array<{
    riderId: string;
    riderName: string;
    activeOrders: number;
    hasActiveTracking: boolean;
    hasFreshLocation: boolean;
    distanceKm: number | null;
    score: number | null;
    capacityState: string;
    locationState: string;
  }>;
  createdAt: string | null;
};

type AdminOrderNextStatus =
  | "Accepted"
  | "Rejected"
  | "Preparing"
  | "ReadyForPickup"
  | "Cancelled";

type AdminOrderListParams = {
  search?: string;
  preset?: string;
  from?: string;
  to?: string;
  status?:
    | "all"
    | "new"
    | "live"
    | "ready"
    | "pickedUp"
    | "delivered"
    | "cancelled"
    | "refund";
  paymentMethod?: "all" | "Cash" | "Bkash";
  paymentStatus?: "all" | "pending" | "paid" | "refund_pending" | "refunded";
  assignment?: "all" | "assigned" | "unassigned" | "stale";
  sortBy?: "newest" | "oldest" | "highestValue" | "recentlyUpdated";
  page?: number;
  pageSize?: number;
};

type AdminRiderListParams = {
  search?: string;
  status?: "all" | "active" | "suspended" | "locked";
  availability?: "all" | "available" | "unavailable";
  verification?: "all" | "pending" | "approved" | "rejected" | "missing";
  sortBy?: "newest" | "recentLogin" | "mostActive" | "mostDelivered";
  page?: number;
  pageSize?: number;
};

type AdminDispatchLogListParams = {
  search?: string;
  outcome?: "all" | "assigned" | "reassigned" | "no_match" | "skipped";
  source?: "all" | "manual_admin" | "auto_dispatch";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

type AdminPaymentListParams = {
  search?: string;
  preset?: string;
  from?: string;
  to?: string;
  paymentMethod?: "all" | "Cash" | "Bkash";
  paymentStatus?:
    | "all"
    | "pending"
    | "paid"
    | "refund_pending"
    | "refunded"
    | "refund_rejected";
  settlement?: "all" | "delivered" | "refund_queue" | "online" | "cod";
  sortBy?: "newest" | "oldest" | "highestValue" | "recentlyUpdated";
  page?: number;
  pageSize?: number;
};

type AdminRiderStatus = "active" | "suspended" | "locked";
type AdminRiderVerificationStatus = "pending" | "approved" | "rejected";

type AdminRiderOrderStats = {
  activeOrders: number;
  liveTrips: number;
  deliveredTrips: number;
  deliveredFees: number;
  cancelledTrips: number;
  totalAssignedTrips: number;
  totalDeliveryMinutes: number;
  deliveredWithDuration: number;
};

type AdminOrderRefundStatus = "refund_pending" | "refunded" | "refund_rejected";

const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  autoAssignmentEnabled: true,
  autoReassignTimedOutOrders: true,
  dispatchMode: "fleet",
  primaryRiderId: "",
  primaryRiderFallbackEnabled: true,
  algorithm: "nearest_eligible_balanced",
  ownerAcceptanceTimeoutMinutes: 5,
  maxActiveOrdersPerRider: 3,
  staleLocationCutoffMinutes: 20,
  assignmentTimeoutMinutes: 8,
  prepStartGraceMinutes: 8,
  prepLateGraceMinutes: 5,
  pickupLateGraceMinutes: 10,
  deliveryLateGraceMinutes: 10,
  retryCooldownMinutes: 3,
  surgeReadyOrderThreshold: 4,
  surgeUnassignedOrderThreshold: 2,
  autoCancelUnacceptedOrdersEnabled: false,
  autoCancelAfterMinutes: 12,
  autoCancelNotifyBeforeMinutes: 3,
};

const adminOrderTransitions: Record<string, AdminOrderNextStatus[]> = {
  New: ["Accepted", "Rejected", "Cancelled"],
  Accepted: ["Preparing", "Cancelled"],
  Preparing: ["ReadyForPickup", "Cancelled"],
  ReadyForPickup: ["Cancelled"],
};

const orderTimestampFieldByStatus: Partial<Record<string, string>> = {
  Accepted: "acceptedAt",
  Preparing: "preparingAt",
  ReadyForPickup: "readyForPickupAt",
  PickedUp: "pickedUpAt",
  Delivered: "deliveredAt",
  Rejected: "rejectedAt",
  Cancelled: "cancelledAt",
};

function getCustomerOrderStatusMessage(orderNumber: string, nextStatus: string) {
  switch (nextStatus) {
    case "Accepted":
      return {
        title: "Order accepted",
        body: `Good news. ${orderNumber} has been accepted and the kitchen will begin shortly.`,
      };
    case "Preparing":
      return {
        title: "Cooking has started",
        body: `${orderNumber} is now being prepared in the kitchen.`,
      };
    case "ReadyForPickup":
      return {
        title: "Ready for pickup",
        body: `${orderNumber} is packed and waiting for the rider.`,
      };
    case "Rejected":
      return {
        title: "Order was not accepted",
        body: `${orderNumber} could not be accepted. If you paid online, support will review the refund.`,
      };
    case "Cancelled":
      return {
        title: "Order cancelled",
        body: `${orderNumber} was cancelled. If you paid online, support will review the refund.`,
      };
    default:
      return {
        title: "Order updated",
        body: `There is a fresh update on ${orderNumber}.`,
      };
  }
}

function getOrderActionTitle(nextStatus: string) {
  switch (nextStatus) {
    case "Accepted":
      return "Order accepted";
    case "Preparing":
      return "Order is being prepared";
    case "ReadyForPickup":
      return "Order is ready for pickup";
    case "Rejected":
      return "Order rejected";
    case "Cancelled":
      return "Order cancelled";
    default:
      return "Order updated";
  }
}

async function safeSendCustomerOrderStatusPush(params: {
  customerId: string;
  orderId: string;
  orderNumber: string;
  nextStatus: string;
}) {
  const customerMessage = getCustomerOrderStatusMessage(
    params.orderNumber,
    params.nextStatus,
  );

  try {
    await sendPushToCustomer({
      customerId: params.customerId,
      payload: {
        title: customerMessage.title,
        body: customerMessage.body,
        data: {
          type: "order_status",
          orderId: params.orderId,
          path: `/orders/${params.orderId}`,
        },
      },
    });
  } catch {
    // Order/admin actions should not fail when external push delivery is unavailable.
  }
}

function applyOrderStatusTimestamp(
  timestamps: Record<string, unknown> | undefined,
  status: string,
  value: Date,
) {
  const nextTimestamps = {
    ...(timestamps ?? {}),
    [status]: value,
  } as Record<string, unknown>;
  const normalizedField = orderTimestampFieldByStatus[status];

  if (normalizedField) {
    nextTimestamps[normalizedField] = value;
  }

  return nextTimestamps;
}

function clampPage(value?: number) {
  if (!value || Number.isNaN(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function clampPageSize(value?: number) {
  if (!value || Number.isNaN(value)) return 20;
  return Math.min(100, Math.max(5, Math.floor(value)));
}

function serializeDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function currentPayrollMonth() {
  return new Date().toISOString().slice(0, 7);
}

function normalizePayrollMonth(value?: string) {
  const month = value?.trim();
  return month && /^\d{4}-\d{2}$/.test(month) ? month : currentPayrollMonth();
}

function getNextRiderPayoutDate(payoutDay: number, month = currentPayrollMonth()) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const safeDay = Math.min(28, Math.max(1, Math.floor(payoutDay || 1)));
  return new Date(Date.UTC(year, monthIndex + 1, safeDay, 0, 0, 0, 0));
}

function monthKeysBetween(start: Date, end: Date) {
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function monthKeysFromDateMatch(match: Record<string, Date> | null) {
  const now = new Date();
  const start = match?.$gte ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const end = match?.$lte ?? now;
  return monthKeysBetween(start, end);
}

function summarizePayrollCycle(
  rider: Record<string, any>,
  cycle?: Record<string, any> | null,
  month = currentPayrollMonth(),
) {
  const payroll = (rider.payroll ?? {}) as Record<string, any>;
  const baseSalary = numberValue(cycle?.baseSalary, numberValue(payroll.monthlySalary));
  const adjustments = Array.isArray(cycle?.adjustments) ? cycle.adjustments : [];
  const platformBonus = adjustments.reduce((total: number, adjustment: Record<string, any>) => {
    const type = stringValue(adjustment.type);
    return ["bonus", "tip", "reimbursement"].includes(type)
      ? total + numberValue(adjustment.amount)
      : total;
  }, 0);
  const penalties = adjustments.reduce((total: number, adjustment: Record<string, any>) => {
    const type = stringValue(adjustment.type);
    return ["penalty", "deduction"].includes(type)
      ? total + numberValue(adjustment.amount)
      : total;
  }, 0);
  const netPayable = Math.max(baseSalary + platformBonus - penalties, 0);

  return {
    month,
    cycleId: stringValue(cycle?._id),
    isPayrollEnabled: payroll.isPayrollEnabled !== false,
    monthlySalary: numberValue(payroll.monthlySalary),
    payoutDay: numberValue(payroll.payoutDay, 1),
    nextPayoutDate: serializeDate(
      getNextRiderPayoutDate(numberValue(payroll.payoutDay, 1), month),
    ),
    baseSalary,
    platformBonus,
    penalties,
    netPayable,
    paidAmount: cycle?.status === "paid" ? netPayable : 0,
    pendingAmount: cycle?.status === "paid" ? 0 : netPayable,
    paidOut: cycle?.status === "paid" ? netPayable : 0,
    pending: cycle?.status === "paid" ? 0 : netPayable,
    estimatedPayable: netPayable,
    lifetimeEarnings: netPayable,
    status: stringValue(cycle?.status, "draft"),
    approvedAt: serializeDate(cycle?.approvedAt),
    paidAt: serializeDate(cycle?.paidAt),
    paymentReference: stringValue(cycle?.paymentReference),
    note: stringValue(cycle?.note ?? payroll.note),
    adjustments: adjustments.map((adjustment: Record<string, any>) => ({
      id: stringValue(adjustment._id),
      type: stringValue(adjustment.type),
      amount: numberValue(adjustment.amount),
      note: stringValue(adjustment.note),
      createdAt: serializeDate(adjustment.createdAt),
      createdByAdminId: stringValue(adjustment.createdByAdminId),
    })),
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeRiderLocation(location: Record<string, any> | null | undefined) {
  if (!location) return null;

  const latitude = numberValue(location.latitude, Number.NaN);
  const longitude = numberValue(location.longitude, Number.NaN);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    heading: Number.isFinite(Number(location.heading))
      ? Number(location.heading)
      : null,
    accuracyMeters: Number.isFinite(Number(location.accuracyMeters))
      ? Number(location.accuracyMeters)
      : null,
    lastUpdatedAt: serializeDate(location.updatedAt ?? location.lastUpdatedAt),
    speedKmph: Number.isFinite(Number(location.speedKmph))
      ? Number(location.speedKmph)
      : 0,
  };
}

function emptyRiderStats(): AdminRiderOrderStats {
  return {
    activeOrders: 0,
    liveTrips: 0,
    deliveredTrips: 0,
    deliveredFees: 0,
    cancelledTrips: 0,
    totalAssignedTrips: 0,
    totalDeliveryMinutes: 0,
    deliveredWithDuration: 0,
  };
}

function getRiderVerification(rider: Record<string, any>) {
  const verification =
    rider.verification && typeof rider.verification === "object"
      ? rider.verification
      : {};
  const status =
    verification.status === "approved" || verification.status === "rejected"
      ? verification.status
      : "pending";
  const documentFrontUrl = stringValue(verification.documentFront?.url);
  const documentBackUrl = stringValue(verification.documentBack?.url);
  const selfieUrl = stringValue(verification.selfie?.url);
  const hasDocuments = Boolean(
    documentFrontUrl || documentBackUrl || selfieUrl || verification.nationalIdNumber,
  );

  return {
    status,
    nationalIdNumber: stringValue(verification.nationalIdNumber),
    documentFrontUrl,
    documentBackUrl,
    selfieUrl,
    hasDocuments,
    reviewNote: stringValue(verification.reviewNote),
    submittedAt: serializeDate(verification.submittedAt),
    reviewedAt: serializeDate(verification.reviewedAt),
    reviewedByAdminId: stringValue(verification.reviewedByAdminId),
  };
}

function isRiderVerificationApproved(rider: Record<string, any>) {
  return getRiderVerification(rider).status === "approved";
}

function getOrderDeliveryMinutes(order: Record<string, any>) {
  const readyAt = getOrderTimestamp(order, "ReadyForPickup");
  const deliveredAt = getOrderTimestamp(order, "Delivered");
  return minutesBetween(readyAt, deliveredAt) ?? 0;
}

async function getRiderOrderStatsMap(riderIds: string[]) {
  if (!riderIds.length) return new Map<string, AdminRiderOrderStats>();

  const rows = await OrderModel.aggregate<
    AdminRiderOrderStats & { _id: string }
  >([
    {
      $match: {
        riderId: { $in: riderIds },
      },
    },
    {
      $group: {
        _id: "$riderId",
        activeOrders: {
          $sum: {
            $cond: [
              { $in: ["$status", ["ReadyForPickup", "PickedUp"]] },
              1,
              0,
            ],
          },
        },
        liveTrips: {
          $sum: { $cond: [{ $eq: ["$status", "PickedUp"] }, 1, 0] },
        },
        deliveredTrips: {
          $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] },
        },
        deliveredFees: {
          $sum: {
            $cond: [
              { $eq: ["$status", "Delivered"] },
              { $ifNull: ["$pricing.deliveryFee", 0] },
              0,
            ],
          },
        },
        cancelledTrips: {
          $sum: {
            $cond: [{ $in: ["$status", ["Cancelled", "Rejected"]] }, 1, 0],
          },
        },
        totalAssignedTrips: { $sum: 1 },
        totalDeliveryMinutes: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "Delivered"] },
                  { $ne: ["$timestamps.ReadyForPickup", null] },
                  { $ne: ["$timestamps.Delivered", null] },
                ],
              },
              {
                $divide: [
                  {
                    $subtract: [
                      "$timestamps.Delivered",
                      "$timestamps.ReadyForPickup",
                    ],
                  },
                  60000,
                ],
              },
              0,
            ],
          },
        },
        deliveredWithDuration: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "Delivered"] },
                  { $ne: ["$timestamps.ReadyForPickup", null] },
                  { $ne: ["$timestamps.Delivered", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return new Map(rows.map((row) => [row._id, row]));
}

function mapAdminRiderSummary(
  rider: Record<string, any>,
  stats: AdminRiderOrderStats = emptyRiderStats(),
  payrollCycle?: Record<string, any> | null,
  payrollMonth = currentPayrollMonth(),
) {
  const verification = getRiderVerification(rider);
  const completionRate =
    stats.totalAssignedTrips > 0
      ? (stats.deliveredTrips / stats.totalAssignedTrips) * 100
      : 0;
  const averageDeliveryMinutes =
    stats.deliveredWithDuration > 0
      ? stats.totalDeliveryMinutes / stats.deliveredWithDuration
      : 0;

  return {
    id: String(rider._id ?? rider.id ?? ""),
    fullName: stringValue(rider.fullName),
    phone: stringValue(rider.phone),
    status: stringValue(rider.status, "active"),
    vehicleType: stringValue(rider.vehicleType, "cycle"),
    isAvailableForAssignments: rider.isAvailableForAssignments !== false,
    activeTrackingOrderId: stringValue(rider.activeTrackingOrderId),
    lastLoginAt: serializeDate(rider.lastLoginAt),
    lastKnownLocation: serializeRiderLocation(rider.lastKnownLocation),
    activeOrders: stats.activeOrders,
    liveTrips: stats.liveTrips,
    deliveredTrips: stats.deliveredTrips,
    deliveredFees: stats.deliveredFees,
    cancelledTrips: stats.cancelledTrips,
    totalAssignedTrips: stats.totalAssignedTrips,
    completionRate,
    averageDeliveryMinutes,
    payroll: summarizePayrollCycle(rider, payrollCycle, payrollMonth),
    payout: summarizePayrollCycle(rider, payrollCycle, payrollMonth),
    verification,
    createdAt: serializeDate(rider.createdAt),
    updatedAt: serializeDate(rider.updatedAt),
  };
}

function buildDateMatch(params?: { preset?: string; from?: string; to?: string }) {
  const now = new Date();
  let from: Date | null = null;
  let to: Date | null = null;

  if (params?.preset === "today") {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    to = new Date(now);
    to.setHours(23, 59, 59, 999);
  } else if (params?.preset === "yesterday") {
    from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setHours(23, 59, 59, 999);
  } else if (params?.preset === "last30Days") {
    from = new Date(now);
    from.setDate(from.getDate() - 30);
  } else if (params?.preset === "thisMonth") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (params?.preset === "custom") {
    from = params.from ? new Date(params.from) : null;
    to = params.to ? new Date(params.to) : null;
  } else {
    from = new Date(now);
    from.setDate(from.getDate() - 7);
  }

  const match: Record<string, Date> = {};
  if (from && !Number.isNaN(from.getTime())) match.$gte = from;
  if (to && !Number.isNaN(to.getTime())) match.$lte = to;

  return Object.keys(match).length ? match : null;
}

function getOrderTimestamp(order: Record<string, any>, status: string): Date | null {
  const timestamps = (order.timestamps ?? {}) as Record<string, unknown>;
  const normalizedField = orderTimestampFieldByStatus[status];
  const value =
    timestamps[status] ??
    (normalizedField ? timestamps[normalizedField] : null) ??
    (status === "New" ? order.createdAt : null);

  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

function getAdminOrderDelayState(
  order: Record<string, any>,
  settings: DispatchSettings = DEFAULT_DISPATCH_SETTINGS,
  restaurant?: Record<string, any> | null,
) {
  if (order.status === "New") {
    const createdAt = getOrderTimestamp(order, "New");
    if (!createdAt) return null;
    const minutes = minutesSince(createdAt);
    if (
      settings.autoCancelUnacceptedOrdersEnabled &&
      minutes >= settings.autoCancelAfterMinutes
    ) {
      return { label: "Auto-cancel overdue", minutes, tone: "critical" };
    }
    const notifyAt = settings.autoCancelUnacceptedOrdersEnabled
      ? Math.max(
          1,
          settings.autoCancelAfterMinutes - settings.autoCancelNotifyBeforeMinutes,
        )
      : Number.POSITIVE_INFINITY;
    if (minutes >= notifyAt) return { label: "Auto-cancel soon", minutes, tone: "critical" };
    if (minutes >= settings.ownerAcceptanceTimeoutMinutes) {
      return { label: "Acceptance delayed", minutes, tone: "warning" };
    }
  }

  if (order.status === "Accepted") {
    const acceptedAt = getOrderTimestamp(order, "Accepted");
    const acceptedMinutes = minutesSince(acceptedAt);
    const lateByMinutes = Math.max(
      0,
      acceptedMinutes - settings.prepStartGraceMinutes,
    );
    if (lateByMinutes > 0) {
      return {
        label: "Prep start late",
        minutes: lateByMinutes,
        tone: lateByMinutes >= 10 ? "critical" : "warning",
      };
    }
  }

  if (order.status === "Preparing") {
    const preparingAt = getOrderTimestamp(order, "Preparing");
    const prepElapsedMinutes = minutesSince(preparingAt);
    const expectedPrepMinutes = getRestaurantPrepMinutes(restaurant);
    const lateByMinutes = Math.max(0, prepElapsedMinutes - expectedPrepMinutes);
    if (lateByMinutes >= settings.prepLateGraceMinutes) {
      return {
        label: "Food prep late",
        minutes: lateByMinutes,
        tone: lateByMinutes >= 15 ? "critical" : "warning",
      };
    }
  }

  if (order.status === "ReadyForPickup") {
    const readyAt = getOrderTimestamp(order, "ReadyForPickup");
    const readyMinutes = minutesSince(readyAt);

    if (!order.riderId) {
      const lateByMinutes = Math.max(
        0,
        readyMinutes - settings.assignmentTimeoutMinutes,
      );
      if (lateByMinutes > 0) {
        return {
          label: "Rider assignment late",
          minutes: lateByMinutes,
          tone: lateByMinutes >= 10 ? "critical" : "warning",
        };
      }
    }

    if (getAssignmentAcknowledgementState(order, settings) === "timed_out") {
      const dispatchMeta = getDispatchMeta(order);
      const assignedAt = dispatchMeta.assignedAt ?? readyAt;
      const assignedMinutes = minutesSince(assignedAt);
      const lateByMinutes = Math.max(
        0,
        assignedMinutes - settings.assignmentTimeoutMinutes,
      );
      return {
        label: "Rider response late",
        minutes: lateByMinutes || assignedMinutes,
        tone: "warning",
      };
    }

    if (order.riderId) {
      const lateByMinutes = Math.max(
        0,
        readyMinutes - settings.pickupLateGraceMinutes,
      );
      if (lateByMinutes > 0) {
        return {
          label: "Pickup late",
          minutes: lateByMinutes,
          tone: lateByMinutes >= 10 ? "critical" : "warning",
        };
      }
    }
  }

  if (order.status === "PickedUp") {
    const freshness = decorateTrackingSnapshot(
      order.riderTracking ?? {},
      order.status,
    ).freshness;
    if (freshness?.state === "stale") {
      return {
        label: "Tracking stale",
        minutes: Math.round((freshness.ageSeconds ?? 0) / 60),
        tone: "critical",
      };
    }

    const remainingMinutes = Number(
      (order.riderTracking as Record<string, any> | undefined)
        ?.remainingDurationMinutes ?? 0,
    );
    const pickedUpAt = getOrderTimestamp(order, "PickedUp");
    const pickupMinutes = minutesSince(pickedUpAt);
    if (
      remainingMinutes > 0 &&
      pickupMinutes > remainingMinutes + settings.deliveryLateGraceMinutes
    ) {
      const lateByMinutes = Math.max(0, pickupMinutes - remainingMinutes);
      return {
        label: "Delivery ETA exceeded",
        minutes: lateByMinutes,
        tone: "critical",
      };
    }
  }

  return null;
}

function buildOrderSort(sortBy?: AdminOrderListParams["sortBy"]): Record<string, 1 | -1> {
  if (sortBy === "oldest") return { createdAt: 1 };
  if (sortBy === "highestValue") return { "pricing.total": -1, createdAt: -1 };
  if (sortBy === "recentlyUpdated") return { updatedAt: -1, createdAt: -1 };
  return { createdAt: -1 };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(latitudeB - latitudeA);
  const deltaLng = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function getDispatchSettingsFromContent(
  content: Awaited<ReturnType<typeof getPlatformContent>>,
): DispatchSettings {
  const dispatch = content.operations?.dispatch ?? {};

  return {
    autoAssignmentEnabled:
      typeof dispatch.autoAssignmentEnabled === "boolean"
        ? dispatch.autoAssignmentEnabled
        : DEFAULT_DISPATCH_SETTINGS.autoAssignmentEnabled,
    autoReassignTimedOutOrders:
      typeof dispatch.autoReassignTimedOutOrders === "boolean"
        ? dispatch.autoReassignTimedOutOrders
        : DEFAULT_DISPATCH_SETTINGS.autoReassignTimedOutOrders,
    dispatchMode:
      dispatch.dispatchMode === "primary_rider"
        ? "primary_rider"
        : DEFAULT_DISPATCH_SETTINGS.dispatchMode,
    primaryRiderId:
      typeof dispatch.primaryRiderId === "string"
        ? dispatch.primaryRiderId
        : DEFAULT_DISPATCH_SETTINGS.primaryRiderId,
    primaryRiderFallbackEnabled:
      typeof dispatch.primaryRiderFallbackEnabled === "boolean"
        ? dispatch.primaryRiderFallbackEnabled
        : DEFAULT_DISPATCH_SETTINGS.primaryRiderFallbackEnabled,
    algorithm:
      dispatch.algorithm === "least_loaded_first"
        ? "least_loaded_first"
        : DEFAULT_DISPATCH_SETTINGS.algorithm,
    ownerAcceptanceTimeoutMinutes:
      typeof dispatch.ownerAcceptanceTimeoutMinutes === "number"
        ? dispatch.ownerAcceptanceTimeoutMinutes
        : DEFAULT_DISPATCH_SETTINGS.ownerAcceptanceTimeoutMinutes,
    maxActiveOrdersPerRider:
      typeof dispatch.maxActiveOrdersPerRider === "number"
        ? dispatch.maxActiveOrdersPerRider
        : DEFAULT_DISPATCH_SETTINGS.maxActiveOrdersPerRider,
    staleLocationCutoffMinutes:
      typeof dispatch.staleLocationCutoffMinutes === "number"
        ? dispatch.staleLocationCutoffMinutes
        : DEFAULT_DISPATCH_SETTINGS.staleLocationCutoffMinutes,
    assignmentTimeoutMinutes:
      typeof dispatch.assignmentTimeoutMinutes === "number"
        ? dispatch.assignmentTimeoutMinutes
        : DEFAULT_DISPATCH_SETTINGS.assignmentTimeoutMinutes,
    prepStartGraceMinutes:
      typeof dispatch.prepStartGraceMinutes === "number"
        ? dispatch.prepStartGraceMinutes
        : DEFAULT_DISPATCH_SETTINGS.prepStartGraceMinutes,
    prepLateGraceMinutes:
      typeof dispatch.prepLateGraceMinutes === "number"
        ? dispatch.prepLateGraceMinutes
        : DEFAULT_DISPATCH_SETTINGS.prepLateGraceMinutes,
    pickupLateGraceMinutes:
      typeof dispatch.pickupLateGraceMinutes === "number"
        ? dispatch.pickupLateGraceMinutes
        : DEFAULT_DISPATCH_SETTINGS.pickupLateGraceMinutes,
    deliveryLateGraceMinutes:
      typeof dispatch.deliveryLateGraceMinutes === "number"
        ? dispatch.deliveryLateGraceMinutes
        : DEFAULT_DISPATCH_SETTINGS.deliveryLateGraceMinutes,
    retryCooldownMinutes:
      typeof dispatch.retryCooldownMinutes === "number"
        ? dispatch.retryCooldownMinutes
        : DEFAULT_DISPATCH_SETTINGS.retryCooldownMinutes,
    surgeReadyOrderThreshold:
      typeof dispatch.surgeReadyOrderThreshold === "number"
        ? dispatch.surgeReadyOrderThreshold
        : DEFAULT_DISPATCH_SETTINGS.surgeReadyOrderThreshold,
    surgeUnassignedOrderThreshold:
      typeof dispatch.surgeUnassignedOrderThreshold === "number"
        ? dispatch.surgeUnassignedOrderThreshold
        : DEFAULT_DISPATCH_SETTINGS.surgeUnassignedOrderThreshold,
    autoCancelUnacceptedOrdersEnabled:
      typeof dispatch.autoCancelUnacceptedOrdersEnabled === "boolean"
        ? dispatch.autoCancelUnacceptedOrdersEnabled
        : DEFAULT_DISPATCH_SETTINGS.autoCancelUnacceptedOrdersEnabled,
    autoCancelAfterMinutes:
      typeof dispatch.autoCancelAfterMinutes === "number"
        ? dispatch.autoCancelAfterMinutes
        : DEFAULT_DISPATCH_SETTINGS.autoCancelAfterMinutes,
    autoCancelNotifyBeforeMinutes:
      typeof dispatch.autoCancelNotifyBeforeMinutes === "number"
        ? dispatch.autoCancelNotifyBeforeMinutes
        : DEFAULT_DISPATCH_SETTINGS.autoCancelNotifyBeforeMinutes,
  };
}

function getLocationAgeMinutes(updatedAt?: Date | string | null) {
  if (!updatedAt) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(updatedAt).getTime();
  if (Number.isNaN(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60));
}

async function listDispatchEligibleRiders(params: {
  restaurant: Record<string, any> | null;
  settings: DispatchSettings;
  excludeRiderIds?: string[];
}) {
  const riders = await RiderModel.find({
    status: "active",
    isAvailableForAssignments: true,
    "verification.status": "approved",
  })
    .sort({ createdAt: -1 })
    .lean();

  const riderIds = riders.map((rider) => rider._id.toString());
  const activeCounts = riderIds.length
    ? await OrderModel.aggregate<{
        _id: string;
        activeOrders: number;
        liveTrips: number;
      }>([
        {
          $match: {
            riderId: { $in: riderIds },
            status: { $in: ["ReadyForPickup", "PickedUp"] },
          },
        },
        {
          $group: {
            _id: "$riderId",
            activeOrders: { $sum: 1 },
            liveTrips: {
              $sum: {
                $cond: [{ $eq: ["$status", "PickedUp"] }, 1, 0],
              },
            },
          },
        },
      ])
    : [];

  const countMap = new Map(activeCounts.map((entry) => [entry._id, entry]));

  return riders
    .map((rider) => {
      const riderId = rider._id.toString();
      const countEntry = countMap.get(riderId);
      const latitude = rider.lastKnownLocation?.latitude;
      const longitude = rider.lastKnownLocation?.longitude;
      const hasCoordinates =
        typeof latitude === "number" && typeof longitude === "number";
      const hasRestaurantCoordinates =
        typeof params.restaurant?.location?.latitude === "number" &&
        typeof params.restaurant?.location?.longitude === "number";
      const distanceKm =
        hasCoordinates && hasRestaurantCoordinates
          ? haversineDistanceKm(
              latitude,
              longitude,
              params.restaurant!.location.latitude,
              params.restaurant!.location.longitude,
            )
          : null;
      const locationAgeMinutes = getLocationAgeMinutes(
        rider.lastKnownLocation?.updatedAt,
      );

      return {
        id: riderId,
        fullName: rider.fullName,
        phone: rider.phone,
        vehicleType: rider.vehicleType ?? "cycle",
        isAvailableForAssignments: rider.isAvailableForAssignments ?? true,
        activeOrders: countEntry?.activeOrders ?? 0,
        hasActiveTracking: Boolean(rider.activeTrackingOrderId),
        distanceKm,
        hasFreshLocation:
          locationAgeMinutes <= params.settings.staleLocationCutoffMinutes,
      } satisfies RiderAssignmentCandidate;
    })
    .filter(
      (candidate) => !(params.excludeRiderIds ?? []).includes(candidate.id),
    );
}

function pickBestRiderForOrder(params: {
  candidates: RiderAssignmentCandidate[];
  settings: DispatchSettings;
}) {
  const { candidates, settings } = params;
  if (!candidates.length) return null;

  const withinCapacity = candidates.filter(
    (candidate) => candidate.activeOrders < settings.maxActiveOrdersPerRider,
  );

  if (!withinCapacity.length) return null;

  if (settings.dispatchMode === "primary_rider") {
    if (!settings.primaryRiderId) return null;

    const primaryRider = withinCapacity.find(
      (candidate) => candidate.id === settings.primaryRiderId,
    );

    if (primaryRider) return primaryRider;
    if (!settings.primaryRiderFallbackEnabled) return null;
  }

  const withFreshLocation = withinCapacity.filter(
    (candidate) => candidate.hasFreshLocation,
  );
  const filteredCandidates = withFreshLocation.length
    ? withFreshLocation
    : withinCapacity;

  const ranked = [...filteredCandidates].sort((left, right) => {
    if (settings.algorithm === "least_loaded_first") {
      if (left.activeOrders !== right.activeOrders) {
        return left.activeOrders - right.activeOrders;
      }
      if (Number(left.hasActiveTracking) !== Number(right.hasActiveTracking)) {
        return Number(left.hasActiveTracking) - Number(right.hasActiveTracking);
      }
      if (Number(left.hasFreshLocation) !== Number(right.hasFreshLocation)) {
        return Number(right.hasFreshLocation) - Number(left.hasFreshLocation);
      }
      return (
        (left.distanceKm ?? Number.POSITIVE_INFINITY) -
        (right.distanceKm ?? Number.POSITIVE_INFINITY)
      );
    }

    const leftScore =
      left.activeOrders * 100 +
      (left.hasActiveTracking ? 40 : 0) +
      (left.hasFreshLocation ? 0 : 50) +
      (left.distanceKm ?? 10) * 12;
    const rightScore =
      right.activeOrders * 100 +
      (right.hasActiveTracking ? 40 : 0) +
      (right.hasFreshLocation ? 0 : 50) +
      (right.distanceKm ?? 10) * 12;

    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.fullName.localeCompare(right.fullName);
  });

  return ranked[0] ?? null;
}

function getDispatchCandidateScore(
  candidate: RiderAssignmentCandidate,
  settings: DispatchSettings,
) {
  if (settings.algorithm === "least_loaded_first") {
    return (
      candidate.activeOrders * 100 +
      (candidate.hasActiveTracking ? 25 : 0) +
      (candidate.hasFreshLocation ? 0 : 35) +
      (candidate.distanceKm ?? 10) * 4
    );
  }

  return (
    candidate.activeOrders * 100 +
    (candidate.hasActiveTracking ? 40 : 0) +
    (candidate.hasFreshLocation ? 0 : 50) +
    (candidate.distanceKm ?? 10) * 12
  );
}

function getDispatchMeta(order: Record<string, any>) {
  const meta = (order.dispatchMeta ?? {}) as Record<string, any>;
  return {
    assignedAt: meta.assignedAt ? new Date(meta.assignedAt) : null,
    acknowledgedAt: meta.acknowledgedAt ? new Date(meta.acknowledgedAt) : null,
    lastDispatchAttemptAt: meta.lastDispatchAttemptAt
      ? new Date(meta.lastDispatchAttemptAt)
      : null,
    lastAssignedRiderId:
      typeof meta.lastAssignedRiderId === "string"
        ? meta.lastAssignedRiderId
        : "",
  };
}

function getReadyForPickupAt(order: Record<string, any>) {
  if (order.timestamps?.ReadyForPickup) {
    return new Date(order.timestamps.ReadyForPickup);
  }

  return order.createdAt ? new Date(order.createdAt) : null;
}

function isAssignmentTimedOut(
  order: Record<string, any>,
  settings: DispatchSettings,
) {
  const dispatchMeta = getDispatchMeta(order);
  const assignedAt = dispatchMeta.assignedAt ?? getReadyForPickupAt(order);
  if (!assignedAt) return false;

  return (
    Date.now() - assignedAt.getTime() >=
    settings.assignmentTimeoutMinutes * 60 * 1000
  );
}

function isRetryCoolingDown(
  order: Record<string, any>,
  settings: DispatchSettings,
) {
  const dispatchMeta = getDispatchMeta(order);
  if (!dispatchMeta.lastDispatchAttemptAt) return false;

  return (
    Date.now() - dispatchMeta.lastDispatchAttemptAt.getTime() <
    settings.retryCooldownMinutes * 60 * 1000
  );
}

function getAssignmentAcknowledgementState(
  order: Record<string, any>,
  settings: DispatchSettings,
) {
  if (order.status !== "ReadyForPickup") return "not_applicable" as const;
  if (!order.riderId) return "not_assigned" as const;

  const dispatchMeta = getDispatchMeta(order);
  if (dispatchMeta.acknowledgedAt) return "acknowledged" as const;

  const assignedAt = dispatchMeta.assignedAt ?? getReadyForPickupAt(order);
  if (!assignedAt) return "awaiting" as const;

  const ageMs = Date.now() - assignedAt.getTime();
  if (ageMs >= settings.assignmentTimeoutMinutes * 60 * 1000) {
    return "timed_out" as const;
  }

  return "awaiting" as const;
}

function getOwnerAcceptanceState(
  order: Record<string, any>,
  settings: DispatchSettings,
) {
  if (order.status !== "New") return "not_applicable" as const;
  const createdAt = order.createdAt ? new Date(order.createdAt) : null;
  if (!createdAt) return "awaiting" as const;

  const ageMs = Date.now() - createdAt.getTime();
  if (ageMs >= settings.ownerAcceptanceTimeoutMinutes * 60 * 1000) {
    return "timed_out" as const;
  }

  return "awaiting" as const;
}

async function createDispatchDecisionLog(params: {
  orderId: string;
  orderNumber: string;
  restaurantId?: string;
  restaurantName?: string;
  algorithm: DispatchAlgorithm;
  assignmentSource: "manual_admin" | "auto_dispatch";
  outcome: "assigned" | "reassigned" | "no_match" | "skipped";
  selectedRiderId?: string;
  selectedRiderName?: string;
  reason: string;
  candidates: RiderAssignmentCandidate[];
}) {
  await DispatchDecisionLogModel.create({
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    restaurantId: params.restaurantId ?? "",
    restaurantName: params.restaurantName ?? "",
    algorithm: params.algorithm,
    assignmentSource: params.assignmentSource,
    outcome: params.outcome,
    selectedRiderId: params.selectedRiderId ?? "",
    selectedRiderName: params.selectedRiderName ?? "",
    reason: params.reason,
    candidateCount: params.candidates.length,
    candidates: params.candidates.slice(0, 6).map((candidate) => ({
      riderId: candidate.id,
      riderName: candidate.fullName,
      activeOrders: candidate.activeOrders,
      hasActiveTracking: candidate.hasActiveTracking,
      hasFreshLocation: candidate.hasFreshLocation,
      distanceKm: candidate.distanceKm,
      score: getDispatchCandidateScore(candidate, {
        ...DEFAULT_DISPATCH_SETTINGS,
        algorithm: params.algorithm,
      }),
      capacityState:
        candidate.activeOrders === 0
          ? "idle"
          : candidate.hasActiveTracking
            ? "live_trip"
            : "carrying_orders",
      locationState: candidate.hasFreshLocation ? "fresh" : "stale_or_missing",
    })),
  });
}

async function listRecentDispatchDecisionLogs(
  limit = 12,
): Promise<DispatchDecisionLogEntry[]> {
  const logs = await DispatchDecisionLogModel.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return logs.map(mapDispatchDecisionLog);
}

function mapDispatchDecisionLog(log: Record<string, any>): DispatchDecisionLogEntry {
  return {
    id: String(log._id ?? ""),
    orderId: log.orderId ?? "",
    orderNumber: log.orderNumber ?? "",
    restaurantName: log.restaurantName ?? "",
    algorithm:
      (log.algorithm as DispatchAlgorithm) ?? "nearest_eligible_balanced",
    assignmentSource:
      (log.assignmentSource as "manual_admin" | "auto_dispatch") ??
      "auto_dispatch",
    outcome:
      (log.outcome as "assigned" | "reassigned" | "no_match" | "skipped") ??
      "skipped",
    selectedRiderName: log.selectedRiderName ?? "",
    reason: log.reason ?? "",
    candidateCount: log.candidateCount ?? 0,
    candidates: Array.isArray(log.candidates)
      ? log.candidates.map((candidate: Record<string, any>) => ({
          riderId: candidate.riderId ?? "",
          riderName: candidate.riderName ?? "",
          activeOrders: candidate.activeOrders ?? 0,
          hasActiveTracking: Boolean(candidate.hasActiveTracking),
          hasFreshLocation: Boolean(candidate.hasFreshLocation),
          distanceKm:
            typeof candidate.distanceKm === "number"
              ? candidate.distanceKm
              : null,
          score: typeof candidate.score === "number" ? candidate.score : null,
          capacityState: candidate.capacityState ?? "",
          locationState: candidate.locationState ?? "",
        }))
      : [],
    createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null,
  };
}

export async function listAdminDispatchDecisionLogs(
  params: AdminDispatchLogListParams = {},
) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const query: Record<string, any> = {};

  if (params.outcome && params.outcome !== "all") {
    query.outcome = params.outcome;
  }

  if (params.source && params.source !== "all") {
    query.assignmentSource = params.source;
  }

  const dateMatch: Record<string, Date> = {};
  if (params.from) {
    const fromDate = new Date(params.from);
    if (!Number.isNaN(fromDate.getTime())) dateMatch.$gte = fromDate;
  }
  if (params.to) {
    const toDate = new Date(params.to);
    if (!Number.isNaN(toDate.getTime())) dateMatch.$lte = toDate;
  }
  if (Object.keys(dateMatch).length) {
    query.createdAt = dateMatch;
  }

  const search = params.search?.trim();
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { orderNumber: pattern },
      { restaurantName: pattern },
      { selectedRiderName: pattern },
      { reason: pattern },
    ];
  }

  const [items, total, summaryRows] = await Promise.all([
    DispatchDecisionLogModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    DispatchDecisionLogModel.countDocuments(query),
    DispatchDecisionLogModel.aggregate<{
      _id: string;
      count: number;
    }>([
      { $match: query },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
    ]),
  ]);

  const summary = summaryRows.reduce<Record<string, number>>(
    (accumulator, row) => {
      accumulator[row._id || "unknown"] = row.count;
      return accumulator;
    },
    {
      assigned: 0,
      reassigned: 0,
      no_match: 0,
      skipped: 0,
    },
  );

  return {
    items: items.map(mapDispatchDecisionLog),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary,
    retentionDays: 90,
  };
}

async function assignOrderToRider(params: {
  order: any;
  riderId: string;
  assignmentSource: "manual_admin" | "auto_dispatch";
  algorithm?: DispatchAlgorithm;
  candidateSnapshot?: RiderAssignmentCandidate[];
}) {
  const rider = await RiderModel.findById(params.riderId);

  if (!rider) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RIDER_NOT_FOUND",
      "Rider not found",
    );
  }

  if (rider.status !== "active") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_ACCOUNT_UNAVAILABLE",
      "This rider account is not active",
    );
  }

  if (!isRiderVerificationApproved(rider.toObject())) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_KYC_NOT_APPROVED",
      "This rider is not KYC approved",
    );
  }

  if (!rider.isAvailableForAssignments) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_NOT_AVAILABLE",
      "This rider is currently unavailable for new assignments",
    );
  }

  const order = params.order;
  if (!order) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  if (order.status !== "ReadyForPickup") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_ASSIGNABLE",
      "Only ready-for-pickup orders can be assigned to a rider",
    );
  }

  const previousRiderId =
    typeof order.riderId === "string" ? order.riderId : "";
  order.riderId = rider.id;
  order.riderSnapshot = {
    ...(order.riderSnapshot ?? {}),
    name: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType,
  };
  order.set("dispatchMeta", {
    ...(order.get("dispatchMeta") ?? {}),
    assignedAt: new Date(),
    acknowledgedAt: null,
    lastDispatchAttemptAt: new Date(),
    lastAssignedRiderId: rider.id,
    lastAssignedRiderName: rider.fullName,
    lastAssignmentSource: params.assignmentSource,
    lastDispatchAlgorithm: params.algorithm ?? "nearest_eligible_balanced",
    reassignmentCount:
      ((order.get("dispatchMeta") as Record<string, any> | null)
        ?.reassignmentCount ?? 0) +
      (previousRiderId && previousRiderId !== rider.id ? 1 : 0),
  });
  order.history.push({
    status: order.status,
    actor: params.assignmentSource === "auto_dispatch" ? "system" : "admin",
    note:
      params.assignmentSource === "auto_dispatch"
        ? `Auto-assigned to ${rider.fullName}`
        : `Assigned to ${rider.fullName} by admin`,
    createdAt: new Date(),
  } as any);
  order.history = order.history.slice(-MAX_ORDER_HISTORY_ENTRIES);
  await order.save();

  if (previousRiderId && previousRiderId !== rider.id) {
    emitSocketEvent(`rider:${previousRiderId}`, "rider.assignment.updated", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      message: `Order ${order.orderNumber} has been reassigned to another rider.`,
      assignmentAction: "unassigned",
    });
    emitSocketEvent(
      `rider:${previousRiderId}`,
      "rider.order.updated",
      order.toObject(),
    );
    try {
      await sendPushToRider({
        riderId: previousRiderId,
        payload: {
          title: "Assignment updated",
          body: `Order ${order.orderNumber} has been reassigned to another rider.`,
          data: {
            type: "rider_assignment",
            orderId: order.id,
            path: "/(app)/available",
          },
        },
      });
    } catch {
      // Assignment is already saved; external push delivery should not fail it.
    }
  }

  emitSocketEvent(`rider:${rider.id}`, "rider.assignment.updated", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    message:
      previousRiderId && previousRiderId !== rider.id
        ? `Order ${order.orderNumber} has been reassigned to you.`
        : `Order ${order.orderNumber} has been assigned to you.`,
    assignmentAction:
      previousRiderId && previousRiderId !== rider.id
        ? "reassigned"
        : "assigned",
  });
  emitSocketEvent(`rider:${rider.id}`, "rider.order.updated", order.toObject());
  emitSocketEvent(
    `customer:${order.customerId}`,
    "customer.order.updated",
    order.toObject(),
  );
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.assignment",
    orderId: order.id,
    riderId: rider.id,
    assignmentSource: params.assignmentSource,
  });

  try {
    await sendPushToRider({
      riderId: rider.id,
      payload: {
        title:
          params.assignmentSource === "auto_dispatch"
            ? "Auto-assigned delivery"
            : previousRiderId && previousRiderId !== rider.id
              ? "Order reassigned"
              : "New delivery assignment",
        body: `Order ${order.orderNumber} is ready for pickup.`,
        data: {
          type: "rider_assignment",
          orderId: order.id,
          path: "/(app)/available",
        },
      },
    });
  } catch {
    // Assignment is already saved; external push delivery should not fail it.
  }

  await createDispatchDecisionLog({
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId: String(order.restaurantId ?? ""),
    restaurantName: "",
    algorithm: params.algorithm ?? "nearest_eligible_balanced",
    assignmentSource: params.assignmentSource,
    outcome:
      previousRiderId && previousRiderId !== rider.id
        ? "reassigned"
        : "assigned",
    selectedRiderId: rider.id,
    selectedRiderName: rider.fullName,
    reason:
      params.assignmentSource === "auto_dispatch"
        ? "Best eligible rider selected by dispatch rules."
        : "Admin manually assigned this rider.",
    candidates: params.candidateSnapshot ?? [],
  });

  await recordBusinessEvent({
    event:
      previousRiderId && previousRiderId !== rider.id
        ? "dispatch.rider_reassigned"
        : "dispatch.rider_assigned",
    category: "dispatch",
    severity: "info",
    title:
      previousRiderId && previousRiderId !== rider.id
        ? "Order reassigned to rider"
        : "Order assigned to rider",
    description: `${order.orderNumber} assigned to ${rider.fullName}`,
    entityType: "order",
    entityId: order.id,
    actorType: params.assignmentSource === "auto_dispatch" ? "system" : "admin",
    metadata: {
      orderNumber: order.orderNumber,
      riderId: rider.id,
      riderName: rider.fullName,
      previousRiderId,
      assignmentSource: params.assignmentSource,
      algorithm: params.algorithm ?? "nearest_eligible_balanced",
    },
  });

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    riderId: rider.id,
    riderName: rider.fullName,
    assignmentSource: params.assignmentSource,
  };
}

export async function getAdminDispatchSettings() {
  const content = await getPlatformContent();
  const settings = getDispatchSettingsFromContent(content);
  const [
    readyOrders,
    unassignedReadyOrders,
    totalRiders,
    activeRiders,
    eligibleRiders,
    unavailableRiders,
    pendingKycRiders,
    rejectedKycRiders,
    suspendedRiders,
    lockedRiders,
  ] = await Promise.all([
    OrderModel.countDocuments({
      status: "ReadyForPickup",
    }),
    OrderModel.countDocuments({
      status: "ReadyForPickup",
      $or: [{ riderId: "" }, { riderId: { $exists: false } }],
    }),
    RiderModel.countDocuments(),
    RiderModel.countDocuments({ status: "active" }),
    RiderModel.countDocuments({
      status: "active",
      isAvailableForAssignments: true,
      "verification.status": "approved",
    }),
    RiderModel.countDocuments({
      status: "active",
      isAvailableForAssignments: { $ne: true },
    }),
    RiderModel.countDocuments({
      $or: [
        { "verification.status": "pending" },
        { "verification.status": { $exists: false } },
      ],
    }),
    RiderModel.countDocuments({ "verification.status": "rejected" }),
    RiderModel.countDocuments({ status: "suspended" }),
    RiderModel.countDocuments({ status: "locked" }),
  ]);
  const blockedRiders = Math.max(0, totalRiders - eligibleRiders);
  const primaryRider = settings.primaryRiderId
    ? await RiderModel.findById(settings.primaryRiderId).lean()
    : null;
  const primaryRiderActiveOrders = settings.primaryRiderId
    ? await OrderModel.countDocuments({
        riderId: settings.primaryRiderId,
        status: { $in: ["ReadyForPickup", "PickedUp"] },
      })
    : 0;

  const surgeActive =
    readyOrders >= settings.surgeReadyOrderThreshold ||
    unassignedReadyOrders >= settings.surgeUnassignedOrderThreshold;

  return {
    ...settings,
    metrics: {
      onlineRiders: eligibleRiders,
      eligibleRiders,
      blockedRiders,
      totalRiders,
      activeRiders,
      unavailableRiders,
      pendingKycRiders,
      rejectedKycRiders,
      suspendedRiders,
      lockedRiders,
      singleRiderModeRecommended: eligibleRiders <= 1,
      primaryRiderName: primaryRider?.fullName ?? "",
      primaryRiderActiveOrders,
      primaryRiderAtCapacity:
        primaryRiderActiveOrders >= settings.maxActiveOrdersPerRider,
      readyOrders,
      unassignedReadyOrders,
      surgeActive,
      surgeMessage: surgeActive
        ? `Dispatch pressure is high: ${readyOrders} ready orders and ${unassignedReadyOrders} waiting for assignment.`
        : "",
    },
    recentLogs: await listRecentDispatchDecisionLogs(),
  };
}

export async function updateAdminDispatchSettings(params: {
  adminId: string;
  settings: DispatchSettings;
}) {
  const content = await getPlatformContent();
  const nextContent = {
    ...content,
    operations: {
      ...content.operations,
      dispatch: {
        autoAssignmentEnabled: params.settings.autoAssignmentEnabled,
        autoReassignTimedOutOrders: params.settings.autoReassignTimedOutOrders,
        dispatchMode: params.settings.dispatchMode,
        primaryRiderId: params.settings.primaryRiderId,
        primaryRiderFallbackEnabled:
          params.settings.primaryRiderFallbackEnabled,
        algorithm: params.settings.algorithm,
        ownerAcceptanceTimeoutMinutes:
          params.settings.ownerAcceptanceTimeoutMinutes,
        maxActiveOrdersPerRider: params.settings.maxActiveOrdersPerRider,
        staleLocationCutoffMinutes: params.settings.staleLocationCutoffMinutes,
        assignmentTimeoutMinutes: params.settings.assignmentTimeoutMinutes,
        prepStartGraceMinutes: params.settings.prepStartGraceMinutes,
        prepLateGraceMinutes: params.settings.prepLateGraceMinutes,
        pickupLateGraceMinutes: params.settings.pickupLateGraceMinutes,
        deliveryLateGraceMinutes: params.settings.deliveryLateGraceMinutes,
        retryCooldownMinutes: params.settings.retryCooldownMinutes,
        surgeReadyOrderThreshold: params.settings.surgeReadyOrderThreshold,
        surgeUnassignedOrderThreshold:
          params.settings.surgeUnassignedOrderThreshold,
        autoCancelUnacceptedOrdersEnabled:
          params.settings.autoCancelUnacceptedOrdersEnabled,
        autoCancelAfterMinutes: params.settings.autoCancelAfterMinutes,
        autoCancelNotifyBeforeMinutes:
          params.settings.autoCancelNotifyBeforeMinutes,
      },
    },
  };

  await updatePlatformContent({
    adminId: params.adminId,
    content: nextContent,
  });

  return getAdminDispatchSettings();
}

export async function runAutoDispatchForReadyOrders() {
  if (activeAutoDispatchRun) {
    rerunAutoDispatchRequested = true;
    return activeAutoDispatchRun;
  }

  activeAutoDispatchRun = executeAutoDispatchForReadyOrders()
    .finally(() => {
      activeAutoDispatchRun = null;
    });

  return activeAutoDispatchRun;
}

type AutoDispatchRunResult = {
  assigned: number;
  scanned: number;
  skipped: number;
  reason: string;
};

let activeAutoDispatchRun: Promise<AutoDispatchRunResult> | null = null;
let rerunAutoDispatchRequested = false;

async function executeAutoDispatchForReadyOrders(): Promise<AutoDispatchRunResult> {
  rerunAutoDispatchRequested = false;
  const content = await getPlatformContent();
  const settings = getDispatchSettingsFromContent(content);
  if (!settings.autoAssignmentEnabled) {
    return {
      assigned: 0,
      scanned: 0,
      skipped: 0,
      reason: "disabled",
    };
  }

  const readyOrders = await OrderModel.find({
    status: "ReadyForPickup",
  })
    .sort({ createdAt: 1 })
    .lean();

  let assigned = 0;
  let skipped = 0;

  for (const readyOrder of readyOrders) {
    const currentRiderId =
      typeof readyOrder.riderId === "string" ? readyOrder.riderId.trim() : "";
    const isAssigned = currentRiderId.length > 0;
    const timedOut =
      isAssigned &&
      settings.autoReassignTimedOutOrders &&
      isAssignmentTimedOut(readyOrder, settings);

    if (isAssigned && !timedOut) {
      continue;
    }

    if (isAssigned && isRetryCoolingDown(readyOrder, settings)) {
      skipped += 1;
      continue;
    }

    const restaurant = await RestaurantModel.findById(
      readyOrder.restaurantId,
    ).lean();
    const candidates = await listDispatchEligibleRiders({
      restaurant,
      settings,
      excludeRiderIds: timedOut ? [currentRiderId] : [],
    });
    const selectedRider = pickBestRiderForOrder({
      candidates,
      settings,
    });

    if (!selectedRider) {
      await createDispatchDecisionLog({
        orderId: String(readyOrder._id ?? ""),
        orderNumber: readyOrder.orderNumber ?? "",
        restaurantId: String(readyOrder.restaurantId ?? ""),
        restaurantName: restaurant?.name ?? "",
        algorithm: settings.algorithm,
        assignmentSource: "auto_dispatch",
        outcome: "no_match",
        reason: timedOut
          ? "Assigned rider timed out and no better eligible rider was available."
          : "No eligible online rider matched the current dispatch rules.",
        candidates,
      });
      skipped += 1;
      continue;
    }

    const liveOrder = await OrderModel.findById(readyOrder._id);
    if (
      !liveOrder ||
      liveOrder.status !== "ReadyForPickup" ||
      liveOrder.riderId
    ) {
      if (liveOrder) {
        liveOrder.set("dispatchMeta", {
          ...(liveOrder.get("dispatchMeta") ?? {}),
          lastDispatchAttemptAt: new Date(),
        });
        await liveOrder.save();
      }
      await createDispatchDecisionLog({
        orderId: String(readyOrder._id ?? ""),
        orderNumber: readyOrder.orderNumber ?? "",
        restaurantId: String(readyOrder.restaurantId ?? ""),
        restaurantName: restaurant?.name ?? "",
        algorithm: settings.algorithm,
        assignmentSource: "auto_dispatch",
        outcome: "skipped",
        selectedRiderId: selectedRider.id,
        selectedRiderName: selectedRider.fullName,
        reason: "Order state changed before dispatch could complete.",
        candidates,
      });
      skipped += 1;
      continue;
    }

    await assignOrderToRider({
      order: liveOrder,
      riderId: selectedRider.id,
      assignmentSource: "auto_dispatch",
      algorithm: settings.algorithm,
      candidateSnapshot: candidates,
    });
    assigned += 1;
  }

  const result = {
    assigned,
    scanned: readyOrders.length,
    skipped,
    reason: assigned > 0 ? "completed" : "no_match",
  };

  if (rerunAutoDispatchRequested) {
    const rerunResult = await executeAutoDispatchForReadyOrders();
    return {
      assigned: result.assigned + rerunResult.assigned,
      scanned: Math.max(result.scanned, rerunResult.scanned),
      skipped: result.skipped + rerunResult.skipped,
      reason:
        rerunResult.reason !== "no_match" ? rerunResult.reason : result.reason,
    };
  }

  return result;
}

async function buildAdminOrderQuery(params: AdminOrderListParams = {}) {
  const query: Record<string, any> = {};
  const dateMatch = buildDateMatch(params);

  if (dateMatch) query.createdAt = dateMatch;

  if (params.status === "new") query.status = "New";
  if (params.status === "live") {
    query.status = {
      $in: ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"],
    };
  }
  if (params.status === "ready") query.status = "ReadyForPickup";
  if (params.status === "pickedUp") query.status = "PickedUp";
  if (params.status === "delivered") query.status = "Delivered";
  if (params.status === "cancelled") {
    query.status = { $in: ["Cancelled", "Rejected"] };
  }
  if (params.status === "refund") {
    query.status = { $in: ["Cancelled", "Rejected"] };
    query.paymentMethod = "Bkash";
    query.paymentStatus = { $in: ["paid", "refund_pending"] };
  }

  if (params.paymentMethod && params.paymentMethod !== "all") {
    query.paymentMethod = params.paymentMethod;
  }

  if (params.paymentStatus && params.paymentStatus !== "all") {
    query.paymentStatus = params.paymentStatus;
  }

  if (params.assignment === "unassigned") {
    query.status = "ReadyForPickup";
    query.$and = [
      ...(Array.isArray(query.$and) ? query.$and : []),
      { $or: [{ riderId: "" }, { riderId: { $exists: false } }] },
    ];
  }

  if (params.assignment === "assigned") {
    query.riderId = { $exists: true, $ne: "" };
  }

  if (params.assignment === "stale") {
    query.status = "PickedUp";
    query.$and = [
      ...(Array.isArray(query.$and) ? query.$and : []),
      {
        $or: [
          {
            "riderTracking.lastUpdatedAt": {
              $lt: new Date(Date.now() - 2 * 60 * 1000),
            },
          },
          { "riderTracking.lastUpdatedAt": { $exists: false } },
          { "riderTracking.lastUpdatedAt": null },
        ],
      },
    ];
  }

  if (params.search?.trim()) {
    const search = params.search.trim();
    const restaurants = await RestaurantModel.find({
      name: { $regex: search, $options: "i" },
    })
      .select("_id")
      .lean();
    const restaurantIds = restaurants.map((restaurant) => restaurant._id);

    query.$or = [
      { orderNumber: { $regex: search, $options: "i" } },
      { "customerSnapshot.fullName": { $regex: search, $options: "i" } },
      { "customerSnapshot.name": { $regex: search, $options: "i" } },
      { "customerSnapshot.phone": { $regex: search, $options: "i" } },
      { "riderSnapshot.name": { $regex: search, $options: "i" } },
      { "riderSnapshot.phone": { $regex: search, $options: "i" } },
      ...(restaurantIds.length
        ? [{ restaurantId: { $in: restaurantIds } }]
        : []),
    ];
  }

  return query;
}

async function buildAdminPaymentQuery(params: AdminPaymentListParams = {}) {
  const query: Record<string, any> = {};
  const dateMatch = buildDateMatch(params);

  if (dateMatch) query.createdAt = dateMatch;

  if (params.paymentMethod && params.paymentMethod !== "all") {
    query.paymentMethod = params.paymentMethod;
  }

  if (params.paymentStatus && params.paymentStatus !== "all") {
    query.paymentStatus = params.paymentStatus;
  }

  if (params.settlement === "delivered") {
    query.status = "Delivered";
  }

  if (params.settlement === "refund_queue") {
    query.status = { $in: ["Cancelled", "Rejected"] };
    query.paymentMethod = "Bkash";
    query.paymentStatus = { $in: ["paid", "refund_pending"] };
  }

  if (params.settlement === "online") {
    query.paymentMethod = "Bkash";
  }

  if (params.settlement === "cod") {
    query.paymentMethod = "Cash";
  }

  const search = params.search?.trim();
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    const restaurants = await RestaurantModel.find({ name: pattern })
      .select({ _id: 1 })
      .lean();
    query.$or = [
      { orderNumber: pattern },
      { customerId: pattern },
      { "customerSnapshot.fullName": pattern },
      { "customerSnapshot.name": pattern },
      { "customerSnapshot.phone": pattern },
      { "paymentSnapshot.transactionId": pattern },
      { "paymentSnapshot.trxID": pattern },
      ...(restaurants.length
        ? [{ restaurantId: { $in: restaurants.map((restaurant) => restaurant._id) } }]
        : []),
    ];
  }

  return query;
}

function mapAdminPaymentTransaction(
  order: Record<string, any>,
  restaurant: Record<string, any> | undefined,
) {
  const status = stringValue(order.status);
  const paymentMethod = stringValue(order.paymentMethod, "Cash");
  const paymentStatus = stringValue(order.paymentStatus, "pending");
  const paymentSnapshot = (order.paymentSnapshot ?? {}) as Record<string, any>;

  return {
    id: String(order._id ?? ""),
    orderId: String(order._id ?? ""),
    orderNumber: stringValue(order.orderNumber),
    status,
    restaurantId: String(order.restaurantId ?? ""),
    restaurantName: stringValue(restaurant?.name, "Restaurant"),
    customerName: stringValue(
      order.customerSnapshot?.fullName ?? order.customerSnapshot?.name,
      "Customer",
    ),
    customerPhone: stringValue(order.customerSnapshot?.phone),
    paymentMethod,
    paymentStatus,
    provider: stringValue(paymentSnapshot.provider, paymentMethod),
    transactionId: stringValue(
      paymentSnapshot.transactionId ?? paymentSnapshot.trxID,
    ),
    amount: numberValue(order.pricing?.total),
    subtotal: numberValue(order.pricing?.subtotal),
    deliveryFee: numberValue(order.pricing?.deliveryFee),
    discount: numberValue(
      order.pricing?.discountAmount,
      numberValue(order.pricing?.discount),
    ),
    refundStatus: stringValue(paymentSnapshot.refundStatus, paymentStatus),
    refundNote: stringValue(paymentSnapshot.refundNote),
    refundRequestedAt: serializeDate(paymentSnapshot.refundRequestedAt),
    refundReviewedAt: serializeDate(paymentSnapshot.refundReviewedAt),
    createdAt: serializeDate(order.createdAt),
    updatedAt: serializeDate(order.updatedAt),
    deliveredAt: serializeDate(getOrderTimestamp(order, "Delivered")),
    cancelledAt: serializeDate(
      getOrderTimestamp(order, "Cancelled") ??
        getOrderTimestamp(order, "Rejected"),
    ),
    isRefundCandidate:
      ["Cancelled", "Rejected"].includes(status) &&
      paymentMethod === "Bkash" &&
      ["paid", "refund_pending"].includes(paymentStatus),
  };
}

function mapAdminOrderListItem(
  order: Record<string, any>,
  restaurant: Record<string, any> | undefined,
  dispatchState: Awaited<ReturnType<typeof getAdminDispatchSettings>>,
) {
  const createdAt = getOrderTimestamp(order, "New");
  const acceptedAt = getOrderTimestamp(order, "Accepted");
  const preparingAt = getOrderTimestamp(order, "Preparing");
  const readyAt = getOrderTimestamp(order, "ReadyForPickup");
  const pickedUpAt = getOrderTimestamp(order, "PickedUp");
  const deliveredAt = getOrderTimestamp(order, "Delivered");
  const cancelledAt =
    getOrderTimestamp(order, "Cancelled") ??
    getOrderTimestamp(order, "Rejected");
  const riderTracking = decorateTrackingSnapshot(
    order.riderTracking ?? {},
    order.status ?? "",
  );
  const delayState = getAdminOrderDelayState(order);
  const status = stringValue(order.status);
  const paymentStatus = stringValue(order.paymentStatus);

  return {
    id: String(order._id ?? ""),
    orderNumber: stringValue(order.orderNumber),
    status,
    restaurantId: String(order.restaurantId ?? ""),
    restaurantName: stringValue(restaurant?.name, "Restaurant"),
    customerId: stringValue(order.customerId),
    customerName: stringValue(
      order.customerSnapshot?.fullName ?? order.customerSnapshot?.name,
      "Customer",
    ),
    customerPhone: stringValue(order.customerSnapshot?.phone),
    riderId: stringValue(order.riderId),
    riderName: stringValue(order.riderSnapshot?.name),
    riderPhone: stringValue(order.riderSnapshot?.phone),
    assignmentState:
      status === "New"
        ? "awaiting_owner"
        : status === "ReadyForPickup"
          ? order.riderId
            ? "assigned"
            : "unassigned"
          : status === "PickedUp"
            ? "picked_up"
            : "completed",
    assignmentAcknowledgementState: getAssignmentAcknowledgementState(
      order,
      dispatchState,
    ),
    ownerAcceptanceState: getOwnerAcceptanceState(order, dispatchState),
    paymentMethod: stringValue(order.paymentMethod),
    paymentStatus,
    total: numberValue(order.pricing?.total),
    subtotal: numberValue(order.pricing?.subtotal),
    deliveryFee: numberValue(order.pricing?.deliveryFee),
    discount: numberValue(
      order.pricing?.discountAmount,
      numberValue(order.pricing?.discount),
    ),
    createdAt: serializeDate(createdAt),
    updatedAt: serializeDate(order.updatedAt),
    acceptedAt: serializeDate(acceptedAt),
    preparingAt: serializeDate(preparingAt),
    readyAt: serializeDate(readyAt),
    pickedUpAt: serializeDate(pickedUpAt),
    deliveredAt: serializeDate(deliveredAt),
    cancelledAt: serializeDate(cancelledAt),
    terminalReason: stringValue(order.terminalReason),
    cancelledBy: stringValue(order.cancelledBy),
    rejectionReason: stringValue(order.rejectionReason),
    isRefundCandidate:
      ["Cancelled", "Rejected"].includes(status) &&
      stringValue(order.paymentMethod) === "Bkash" &&
      ["paid", "refund_pending"].includes(paymentStatus),
    isLate: Boolean(delayState),
    lateReason: delayState?.label ?? "",
    lateMinutes: delayState?.minutes ?? 0,
    lateTone: delayState?.tone ?? "none",
    riderTracking,
  };
}

export async function listAdminOrders(params: AdminOrderListParams = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const query = await buildAdminOrderQuery(params);
  const sort = buildOrderSort(params.sortBy);
  const [orders, total, summaryRows, dispatchState] = await Promise.all([
    OrderModel.find(query)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    OrderModel.countDocuments(query),
    OrderModel.aggregate<{
      _id: null;
      total: number;
      newOrders: number;
      liveOrders: number;
      readyForPickup: number;
      pickedUp: number;
      deliveredOrders: number;
      cancelledOrders: number;
      refundPending: number;
      deliveredRevenue: number;
    }>([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          newOrders: { $sum: { $cond: [{ $eq: ["$status", "New"] }, 1, 0] } },
          liveOrders: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    [
                      "New",
                      "Accepted",
                      "Preparing",
                      "ReadyForPickup",
                      "PickedUp",
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
          readyForPickup: {
            $sum: { $cond: [{ $eq: ["$status", "ReadyForPickup"] }, 1, 0] },
          },
          pickedUp: {
            $sum: { $cond: [{ $eq: ["$status", "PickedUp"] }, 1, 0] },
          },
          deliveredOrders: {
            $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] },
          },
          cancelledOrders: {
            $sum: {
              $cond: [{ $in: ["$status", ["Cancelled", "Rejected"]] }, 1, 0],
            },
          },
          refundPending: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ["$status", ["Cancelled", "Rejected"]] },
                    { $eq: ["$paymentMethod", "Bkash"] },
                    { $in: ["$paymentStatus", ["paid", "refund_pending"]] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          deliveredRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Delivered"] },
                { $ifNull: ["$pricing.total", 0] },
                0,
              ],
            },
          },
        },
      },
    ]),
    getAdminDispatchSettings(),
  ]);
  const restaurantIds = [
    ...new Set(
      orders.map((order) => String(order.restaurantId ?? "")).filter(Boolean),
    ),
  ];
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
    : [];
  const restaurantMap = new Map(
    restaurants.map((restaurant) => [restaurant._id.toString(), restaurant]),
  );
  const summary = summaryRows[0] ?? {
    total: 0,
    newOrders: 0,
    liveOrders: 0,
    readyForPickup: 0,
    pickedUp: 0,
    deliveredOrders: 0,
    cancelledOrders: 0,
    refundPending: 0,
    deliveredRevenue: 0,
  };

  return {
    items: orders.map((order) =>
      mapAdminOrderListItem(
        order,
        restaurantMap.get(String(order.restaurantId ?? "")),
        dispatchState,
      ),
    ),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      ...summary,
      onlineRiders: dispatchState.metrics.onlineRiders,
      unassignedReadyOrders: dispatchState.metrics.unassignedReadyOrders,
      staleTracking: 0,
    },
  };
}

export async function listAdminPayments(params: AdminPaymentListParams = {}) {
  const page = clampPage(params.page);
  const pageSize =
    params.pageSize && params.pageSize > 100
      ? Math.min(5000, Math.max(100, Math.floor(params.pageSize)))
      : clampPageSize(params.pageSize);
  const query = await buildAdminPaymentQuery(params);
  const sort = buildOrderSort(params.sortBy);
  const ledgerDateMatch = buildDateMatch(params);
  const ledgerMatch: Record<string, any> = {
    entryType: { $in: ["earning", "refund", "adjustment"] },
  };
  if (ledgerDateMatch) ledgerMatch.createdAt = ledgerDateMatch;

  await LedgerEntryModel.updateMany(
    {
      entryType: { $in: ["earning", "refund", "adjustment"] },
      settlementStatus: "pending",
      availableAt: { $lte: new Date() },
    },
    { $set: { settlementStatus: "available" } },
  );

  const payrollMonths = monthKeysFromDateMatch(ledgerDateMatch);
  const [orders, total, summaryRows, settlementRows, nextPayoutRows, riderPayrollSummary] =
    await Promise.all([
    OrderModel.find(query)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    OrderModel.countDocuments(query),
      OrderModel.aggregate<{
      _id: null;
      transactionCount: number;
      deliveredRevenue: number;
      onlineCollected: number;
      codDelivered: number;
      pendingCod: number;
      refundPendingCount: number;
      refundPendingAmount: number;
      refundedCount: number;
      refundedAmount: number;
      failedOrRejectedRefunds: number;
      }>([
        { $match: query },
        {
          $group: {
            _id: null,
            transactionCount: { $sum: 1 },
            deliveredRevenue: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "Delivered"] },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            onlineCollected: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentMethod", "Bkash"] },
                      { $eq: ["$paymentStatus", "paid"] },
                    ],
                  },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            codDelivered: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentMethod", "Cash"] },
                      { $eq: ["$status", "Delivered"] },
                    ],
                  },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            pendingCod: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentMethod", "Cash"] },
                      {
                        $in: [
                          "$status",
                          [
                            "New",
                            "Accepted",
                            "Preparing",
                            "ReadyForPickup",
                            "PickedUp",
                          ],
                        ],
                      },
                    ],
                  },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            refundPendingCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ["$status", ["Cancelled", "Rejected"]] },
                      { $eq: ["$paymentMethod", "Bkash"] },
                      { $in: ["$paymentStatus", ["paid", "refund_pending"]] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            refundPendingAmount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ["$status", ["Cancelled", "Rejected"]] },
                      { $eq: ["$paymentMethod", "Bkash"] },
                      { $in: ["$paymentStatus", ["paid", "refund_pending"]] },
                    ],
                  },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            refundedCount: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, 1, 0] },
            },
            refundedAmount: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "refunded"] },
                  { $ifNull: ["$pricing.total", 0] },
                  0,
                ],
              },
            },
            failedOrRejectedRefunds: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "refund_rejected"] }, 1, 0],
              },
            },
          },
        },
      ]),
      LedgerEntryModel.aggregate<{
        _id: null;
        grossAmount: number;
        commissionBase: number;
        commission: number;
        discountCost: number;
        platformDiscountCost: number;
        deliveryCost: number;
        netAmount: number;
        availableBalance: number;
        pendingBalance: number;
        paidOutBalance: number;
      }>([
        { $match: ledgerMatch },
        {
          $group: {
            _id: null,
            grossAmount: { $sum: { $ifNull: ["$grossAmount", 0] } },
            commissionBase: { $sum: { $ifNull: ["$commissionBase", "$grossAmount"] } },
            commission: { $sum: { $ifNull: ["$commission", 0] } },
            discountCost: { $sum: { $ifNull: ["$discountCost", 0] } },
            platformDiscountCost: { $sum: { $ifNull: ["$platformDiscountCost", 0] } },
            deliveryCost: { $sum: { $ifNull: ["$deliveryCost", 0] } },
            netAmount: { $sum: { $ifNull: ["$netAmount", 0] } },
            availableBalance: {
              $sum: {
                $cond: [
                  { $eq: ["$settlementStatus", "available"] },
                  { $ifNull: ["$netAmount", 0] },
                  0,
                ],
              },
            },
            pendingBalance: {
              $sum: {
                $cond: [
                  { $eq: ["$settlementStatus", "pending"] },
                  { $ifNull: ["$netAmount", 0] },
                  0,
                ],
              },
            },
            paidOutBalance: {
              $sum: {
                $cond: [
                  { $eq: ["$settlementStatus", "paid_out"] },
                  { $ifNull: ["$netAmount", 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      LedgerEntryModel.aggregate<{ _id: null; nextPayoutDate: Date }>([
        {
          $match: {
            ...ledgerMatch,
            settlementStatus: "pending",
            availableAt: { $ne: null },
          },
        },
        { $group: { _id: null, nextPayoutDate: { $min: "$availableAt" } } },
      ]),
      getRiderPayrollFinanceSummary(payrollMonths),
    ]);
  const restaurantIds = [
    ...new Set(
      orders.map((order) => String(order.restaurantId ?? "")).filter(Boolean),
    ),
  ];
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
    : [];
  const restaurantMap = new Map(
    restaurants.map((restaurant) => [restaurant._id.toString(), restaurant]),
  );

  const settlementSummary = settlementRows[0] ?? {
    grossAmount: 0,
    commissionBase: 0,
    commission: 0,
    discountCost: 0,
    platformDiscountCost: 0,
    deliveryCost: 0,
    netAmount: 0,
    availableBalance: 0,
    pendingBalance: 0,
    paidOutBalance: 0,
  };
  const platformGrossIncome =
    numberValue(settlementSummary.commission) + numberValue(settlementSummary.deliveryCost);
  const platformOperatingExpense =
    numberValue(settlementSummary.platformDiscountCost) + riderPayrollSummary.netPayable;
  const estimatedPlatformMargin = platformGrossIncome - platformOperatingExpense;

  return {
    items: orders.map((order) =>
      mapAdminPaymentTransaction(
        order,
        restaurantMap.get(String(order.restaurantId ?? "")),
      ),
    ),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      ...(summaryRows[0] ?? {
        transactionCount: 0,
        deliveredRevenue: 0,
        onlineCollected: 0,
        codDelivered: 0,
        pendingCod: 0,
        refundPendingCount: 0,
        refundPendingAmount: 0,
        refundedCount: 0,
        refundedAmount: 0,
        failedOrRejectedRefunds: 0,
      }),
      settlementGrossAmount: settlementSummary.grossAmount,
      settlementCommissionBase: settlementSummary.commissionBase,
      platformCommission: settlementSummary.commission,
      restaurantPayable: settlementSummary.netAmount,
      discountCost: settlementSummary.discountCost,
      platformDiscountCost: settlementSummary.platformDiscountCost,
      deliveryCost: settlementSummary.deliveryCost,
      payoutReadyAmount: settlementSummary.availableBalance,
      payoutPendingAmount: settlementSummary.pendingBalance,
      paidOutAmount: Math.abs(settlementSummary.paidOutBalance),
      riderPayrollBaseSalary: riderPayrollSummary.baseSalary,
      riderPayrollBonus: riderPayrollSummary.platformBonus,
      riderPayrollPenalties: riderPayrollSummary.penalties,
      riderPayrollExpense: riderPayrollSummary.netPayable,
      riderPayrollPending: riderPayrollSummary.pending,
      riderPayrollPaid: riderPayrollSummary.paid,
      riderPayrollMonths: payrollMonths,
      platformGrossIncome,
      platformOperatingExpense,
      estimatedPlatformMargin,
      nextPayoutDate: serializeDate(nextPayoutRows[0]?.nextPayoutDate),
    },
  };
}

export async function listAdminOrdersMonitor(params?: {
  scope?: "all" | "live" | "stale";
}) {
  const scope = params?.scope ?? "all";
  const dispatchState = await getAdminDispatchSettings();

  const orders = await OrderModel.find({
    status: {
      $in: ["New", "ReadyForPickup", "PickedUp", "Delivered", "Cancelled"],
    },
  })
    .sort({ updatedAt: -1 })
    .limit(60)
    .lean();

  const restaurantIds = [
    ...new Set(
      orders.map((order) => String(order.restaurantId ?? "")).filter(Boolean),
    ),
  ];
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
    : [];
  const restaurantMap = new Map(
    restaurants.map((restaurant) => [restaurant._id.toString(), restaurant]),
  );

  const items = orders
    .map((order) => {
      const restaurant = restaurantMap.get(String(order.restaurantId ?? ""));
      const riderTracking = decorateTrackingSnapshot(
        order.riderTracking ?? {},
        order.status ?? "",
      );
      const assignmentAcknowledgementState = getAssignmentAcknowledgementState(
        order,
        dispatchState,
      );
      const ownerAcceptanceState = getOwnerAcceptanceState(
        order,
        dispatchState,
      );

      return {
        id: String(order._id ?? ""),
        orderNumber: order.orderNumber ?? "",
        status: order.status ?? "",
        restaurantName: restaurant?.name ?? "Restaurant",
        customerName:
          order.customerSnapshot?.name ??
          order.customerSnapshot?.fullName ??
          "Customer",
        riderName: order.riderSnapshot?.name ?? "",
        riderPhone: order.riderSnapshot?.phone ?? "",
        assignmentState:
          order.status === "New"
            ? "awaiting_owner"
            : order.status === "ReadyForPickup"
              ? order.riderId
                ? "assigned"
                : "unassigned"
              : order.status === "PickedUp"
                ? "picked_up"
                : "completed",
        assignmentAcknowledgementState,
        ownerAcceptanceState,
        updatedAt: order.updatedAt
          ? new Date(order.updatedAt).toISOString()
          : null,
        createdAt: order.createdAt
          ? new Date(order.createdAt).toISOString()
          : null,
        riderTracking,
      };
    })
    .filter((item) => {
      if (scope === "live") {
        return (
          item.status === "PickedUp" &&
          item.riderTracking?.freshness?.state === "live"
        );
      }

      if (scope === "stale") {
        return (
          item.status === "PickedUp" &&
          item.riderTracking?.freshness?.state === "stale"
        );
      }

      return true;
    });

  return {
    summary: {
      total: items.length,
      newOrders: items.filter((item) => item.status === "New").length,
      delayedOwnerAcceptance: items.filter(
        (item) => item.ownerAcceptanceState === "timed_out",
      ).length,
      pickedUp: items.filter((item) => item.status === "PickedUp").length,
      staleTracking: items.filter(
        (item) => item.riderTracking?.freshness?.state === "stale",
      ).length,
      readyForPickup: items.filter((item) => item.status === "ReadyForPickup")
        .length,
      unassignedReady: items.filter(
        (item) =>
          item.status === "ReadyForPickup" &&
          item.assignmentState === "unassigned",
      ).length,
      unacknowledgedAssignments: items.filter(
        (item) => item.assignmentAcknowledgementState === "timed_out",
      ).length,
      onlineRiders: dispatchState.metrics.onlineRiders,
      surgeActive: dispatchState.metrics.surgeActive ? 1 : 0,
    },
    dispatch: dispatchState,
    items,
  };
}

export async function getAdminOrderMonitorDetails(orderId: string) {
  const order = await OrderModel.findById(orderId).lean();

  if (!order) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  const [restaurant, restaurantOwner, content] = await Promise.all([
    RestaurantModel.findById(order.restaurantId).lean(),
    OwnerModel.findOne({ activeRestaurantId: order.restaurantId }).lean(),
    getPlatformContent(),
  ]);
  const dispatchSettings = getDispatchSettingsFromContent(content);
  const riderTracking = decorateTrackingSnapshot(
    order.riderTracking ?? {},
    order.status ?? "",
  );
  const operationalTiming = buildAdminOrderOperationalTiming(
    order,
    restaurant,
    dispatchSettings,
    riderTracking,
  );

  return {
    id: String(order._id ?? ""),
    orderNumber: order.orderNumber ?? "",
    status: order.status ?? "",
    restaurantId: String(order.restaurantId ?? ""),
    restaurantName: restaurant?.name ?? "Restaurant",
    restaurantOwnerName: restaurantOwner?.fullName ?? "",
    restaurantOwnerPhone: restaurantOwner?.phone ?? restaurant?.contact?.phone ?? "",
    customerId: order.customerId ?? "",
    customerName:
      order.customerSnapshot?.name ??
      order.customerSnapshot?.fullName ??
      "Customer",
    customerPhone: order.customerSnapshot?.phone ?? "",
    riderId: order.riderId ?? "",
    riderName: order.riderSnapshot?.name ?? "",
    riderPhone: order.riderSnapshot?.phone ?? "",
    terminalReason: order.terminalReason ?? "",
    cancelledBy: order.cancelledBy ?? "",
    rejectionReason: order.rejectionReason ?? "",
    deliveryAddress: order.customerSnapshot?.deliveryAddress?.addressLine ?? "",
    paymentMethod: order.paymentMethod ?? "",
    paymentStatus: order.paymentStatus ?? "",
    paymentSnapshot:
      order.paymentSnapshot && typeof order.paymentSnapshot === "object"
        ? order.paymentSnapshot
        : {},
    pricing: {
      subtotal: order.pricing?.subtotal ?? 0,
      deliveryFee: order.pricing?.deliveryFee ?? 0,
      discount: order.pricing?.discount ?? 0,
      total: order.pricing?.total ?? 0,
    },
    items: Array.isArray(order.itemsSnapshot)
      ? order.itemsSnapshot.map((item: Record<string, any>, index: number) => ({
          id: String(item.id ?? item.menuItemId ?? index),
          name: item.name ?? "",
          quantity: item.quantity ?? 0,
          lineTotal: item.totalPrice ?? item.lineTotal ?? 0,
        }))
      : [],
    timestamps: {
      createdAt: order.createdAt
        ? new Date(order.createdAt).toISOString()
        : null,
      acceptedAt: order.timestamps?.Accepted
        ? new Date(order.timestamps.Accepted).toISOString()
        : null,
      preparingAt: order.timestamps?.Preparing
        ? new Date(order.timestamps.Preparing).toISOString()
        : null,
      readyAt: order.timestamps?.ReadyForPickup
        ? new Date(order.timestamps.ReadyForPickup).toISOString()
        : null,
      pickedUpAt: order.timestamps?.PickedUp
        ? new Date(order.timestamps.PickedUp).toISOString()
        : null,
      deliveredAt: order.timestamps?.Delivered
        ? new Date(order.timestamps.Delivered).toISOString()
        : null,
      cancelledAt: order.timestamps?.Cancelled
        ? new Date(order.timestamps.Cancelled).toISOString()
        : null,
    },
    autoCancel: buildOrderAutoCancelSnapshot(order, dispatchSettings),
    operationalTiming,
    riderTracking,
    history: Array.isArray(order.history)
      ? order.history.map((entry: Record<string, any>) => ({
          status: entry.status ?? "",
          actor: entry.actor ?? "",
          note: entry.note ?? "",
          createdAt: entry.createdAt
            ? new Date(entry.createdAt).toISOString()
            : null,
        }))
      : [],
  };
}

export async function listAdminRiders(params: AdminRiderListParams = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const query: Record<string, unknown> = {};

  if (params.status && params.status !== "all") {
    query.status = params.status;
  }

  if (params.availability === "available") {
    query.isAvailableForAssignments = true;
  } else if (params.availability === "unavailable") {
    query.isAvailableForAssignments = false;
  }

  if (params.verification && params.verification !== "all") {
    if (params.verification === "missing") {
      query.$and = [
        {
          $or: [
            { "verification.documentFront.url": { $in: ["", null] } },
            { "verification.documentFront": { $exists: false } },
          ],
        },
        {
          $or: [
            { "verification.documentBack.url": { $in: ["", null] } },
            { "verification.documentBack": { $exists: false } },
          ],
        },
        {
          $or: [
            { "verification.selfie.url": { $in: ["", null] } },
            { "verification.selfie": { $exists: false } },
          ],
        },
        {
          $or: [
            { "verification.nationalIdNumber": { $in: ["", null] } },
            { verification: { $exists: false } },
          ],
        },
      ];
    } else {
      query["verification.status"] = params.verification;
    }
  }

  const search = params.search?.trim();
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    query.$or = [{ fullName: regex }, { phone: regex }];
  }

  const [riders, total, summaryRows] = await Promise.all([
    RiderModel.find(query).lean(),
    RiderModel.countDocuments(query),
    RiderModel.aggregate<{
      _id: null;
      total: number;
      activeRiders: number;
      suspendedRiders: number;
      lockedRiders: number;
      availableRiders: number;
      pendingVerification: number;
      approvedVerification: number;
      rejectedVerification: number;
      missingDocuments: number;
    }>([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          activeRiders: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          suspendedRiders: {
            $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] },
          },
          lockedRiders: {
            $sum: { $cond: [{ $eq: ["$status", "locked"] }, 1, 0] },
          },
          availableRiders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "active"] },
                    { $ne: ["$isAvailableForAssignments", false] },
                    { $eq: ["$verification.status", "approved"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pendingVerification: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$verification.status", "pending"] },
                    { $eq: [{ $type: "$verification.status" }, "missing"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          approvedVerification: {
            $sum: {
              $cond: [{ $eq: ["$verification.status", "approved"] }, 1, 0],
            },
          },
          rejectedVerification: {
            $sum: {
              $cond: [{ $eq: ["$verification.status", "rejected"] }, 1, 0],
            },
          },
          missingDocuments: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $or: [
                        { $eq: ["$verification.documentFront.url", ""] },
                        {
                          $eq: [
                            { $type: "$verification.documentFront.url" },
                            "missing",
                          ],
                        },
                      ],
                    },
                    {
                      $or: [
                        { $eq: ["$verification.documentBack.url", ""] },
                        {
                          $eq: [
                            { $type: "$verification.documentBack.url" },
                            "missing",
                          ],
                        },
                      ],
                    },
                    {
                      $or: [
                        { $eq: ["$verification.selfie.url", ""] },
                        {
                          $eq: [
                            { $type: "$verification.selfie.url" },
                            "missing",
                          ],
                        },
                      ],
                    },
                    {
                      $or: [
                        { $eq: ["$verification.nationalIdNumber", ""] },
                        {
                          $eq: [
                            { $type: "$verification.nationalIdNumber" },
                            "missing",
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const riderIds = riders.map((rider) => String(rider._id ?? ""));
  const payrollMonth = normalizePayrollMonth();
  const [statsMap, payrollCycles] = await Promise.all([
    getRiderOrderStatsMap(riderIds),
    riderIds.length
      ? RiderPayrollCycleModel.find({
          riderId: { $in: riderIds },
          month: payrollMonth,
        }).lean()
      : [],
  ]);
  const payrollCycleMap = new Map(
    payrollCycles.map((cycle) => [String(cycle.riderId ?? ""), cycle]),
  );
  const mapped = riders.map((rider) =>
    mapAdminRiderSummary(
      rider,
      statsMap.get(String(rider._id ?? "")) ?? emptyRiderStats(),
      payrollCycleMap.get(String(rider._id ?? "")),
      payrollMonth,
    ),
  );

  const sorted = [...mapped].sort((left, right) => {
    if (params.sortBy === "recentLogin") {
      return (
        new Date(right.lastLoginAt ?? 0).getTime() -
        new Date(left.lastLoginAt ?? 0).getTime()
      );
    }
    if (params.sortBy === "mostActive") {
      return right.activeOrders - left.activeOrders;
    }
    if (params.sortBy === "mostDelivered") {
      return right.deliveredTrips - left.deliveredTrips;
    }

    return (
      new Date(right.createdAt ?? 0).getTime() -
      new Date(left.createdAt ?? 0).getTime()
    );
  });
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);
  const summary = summaryRows[0] ?? {
    total: 0,
    activeRiders: 0,
    suspendedRiders: 0,
    lockedRiders: 0,
    availableRiders: 0,
    pendingVerification: 0,
    approvedVerification: 0,
    rejectedVerification: 0,
    missingDocuments: 0,
  };
  const totals = mapped.reduce(
    (current, rider) => ({
      activeOrders: current.activeOrders + rider.activeOrders,
      liveTrips: current.liveTrips + rider.liveTrips,
      deliveredTrips: current.deliveredTrips + rider.deliveredTrips,
      deliveredFees: current.deliveredFees + rider.deliveredFees,
      cancelledTrips: current.cancelledTrips + rider.cancelledTrips,
      totalAssignedTrips: current.totalAssignedTrips + rider.totalAssignedTrips,
      totalDeliveryMinutes:
        current.totalDeliveryMinutes +
        rider.averageDeliveryMinutes *
          (rider.deliveredTrips > 0 ? rider.deliveredTrips : 0),
      deliveredWithDuration:
        current.deliveredWithDuration +
        (rider.averageDeliveryMinutes > 0 ? rider.deliveredTrips : 0),
      payrollBaseSalary:
        current.payrollBaseSalary + rider.payroll.baseSalary,
      payrollBonus: current.payrollBonus + rider.payroll.platformBonus,
      payrollPenalties: current.payrollPenalties + rider.payroll.penalties,
      payrollNetPayable: current.payrollNetPayable + rider.payroll.netPayable,
      payrollPending: current.payrollPending + rider.payroll.pendingAmount,
      payrollPaid: current.payrollPaid + rider.payroll.paidAmount,
    }),
    {
      ...emptyRiderStats(),
      payrollBaseSalary: 0,
      payrollBonus: 0,
      payrollPenalties: 0,
      payrollNetPayable: 0,
      payrollPending: 0,
      payrollPaid: 0,
    },
  );
  const averageDeliveryMinutes =
    totals.deliveredWithDuration > 0
      ? totals.totalDeliveryMinutes / totals.deliveredWithDuration
      : 0;
  const completionRate =
    totals.totalAssignedTrips > 0
      ? (totals.deliveredTrips / totals.totalAssignedTrips) * 100
      : 0;

  return {
    items: pageItems,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      ...summary,
      ...totals,
      averageDeliveryMinutes,
      completionRate,
    },
  };
}

export async function createAdminRider(params: {
  fullName: string;
  phone: string;
  status?: AdminRiderStatus;
  isAvailableForAssignments?: boolean;
  verificationStatus?: AdminRiderVerificationStatus;
  nationalIdNumber?: string;
  monthlySalary?: number;
  payoutDay?: number;
}) {
  const fullName = params.fullName.trim();
  const phone = params.phone.trim();

  if (!fullName || !phone) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_REQUIRED_FIELDS",
      "Rider name and phone are required",
    );
  }

  const existing = await RiderModel.findOne({ phone }).lean();
  if (existing) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "RIDER_PHONE_EXISTS",
      "A rider with this phone already exists",
    );
  }

  const status = params.status ?? "active";
  const verificationStatus = params.verificationStatus ?? "pending";
  const rider = await RiderModel.create({
    fullName,
    phone,
    vehicleType: "cycle",
    status,
    isPhoneVerified: true,
    isAvailableForAssignments:
      status === "active" && verificationStatus === "approved"
        ? params.isAvailableForAssignments !== false
        : false,
    verification: {
      status: verificationStatus,
      nationalIdNumber: params.nationalIdNumber?.trim() ?? "",
      submittedAt: new Date(),
      reviewedAt: verificationStatus === "approved" ? new Date() : null,
    },
    payroll: {
      isPayrollEnabled: true,
      monthlySalary: Math.max(0, numberValue(params.monthlySalary)),
      payoutDay: Math.min(28, Math.max(1, Math.floor(numberValue(params.payoutDay, 1)))),
      updatedAt: new Date(),
    },
  });

  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.created",
    riderId: rider.id,
  });

  return mapAdminRiderSummary(rider.toObject(), emptyRiderStats());
}

export async function getAdminLiveMap() {
  const liveRestaurantOrderStatuses = ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"];
  const dispatchSettings = getDispatchSettingsFromContent(await getPlatformContent());
  const [orders, activeRidersCount, availableRidersCount, riders, allRestaurants, restaurantLiveOrders] =
    await Promise.all([
      OrderModel.find({ status: { $in: liveRestaurantOrderStatuses } })
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean(),
      RiderModel.countDocuments({ status: "active" }),
      RiderModel.countDocuments({
        status: "active",
        isAvailableForAssignments: { $ne: false },
        "verification.status": "approved",
      }),
      RiderModel.find({ status: "active" })
        .sort({ "lastKnownLocation.updatedAt": -1, lastLoginAt: -1 })
        .limit(100)
        .lean(),
      RestaurantModel.find({})
        .sort({ "runtime.isOnline": -1, name: 1 })
        .limit(250)
        .lean(),
      OrderModel.find({ status: { $in: liveRestaurantOrderStatuses } })
        .sort({ updatedAt: -1 })
        .limit(500)
        .lean(),
    ]);

  const restaurantIds = [
    ...new Set(
      [
        ...orders.map((order) => String(order.restaurantId ?? "")),
        ...allRestaurants.map((restaurant) => String(restaurant._id ?? "")),
      ].filter(Boolean),
    ),
  ];
  const riderIds = [
    ...new Set(
      [
        ...orders.map((order) => String(order.riderId ?? "")),
        ...riders.map((rider) => String(rider._id ?? "")),
      ].filter(Boolean),
    ),
  ];

  const [restaurants, assignedRiders] = await Promise.all([
    restaurantIds.length
      ? RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
      : [],
    riderIds.length ? RiderModel.find({ _id: { $in: riderIds } }).lean() : [],
  ]);

  const restaurantMap = new Map(
    restaurants.map((restaurant) => [String(restaurant._id ?? ""), restaurant]),
  );
  const riderMap = new Map(
    assignedRiders.map((rider) => [String(rider._id ?? ""), rider]),
  );
  const liveOrderByRiderId = new Map(
    orders
      .filter((order) => order.status === "PickedUp" && order.riderId)
      .map((order) => [
        String(order.riderId ?? ""),
        {
          id: String(order._id ?? ""),
          orderNumber: stringValue(order.orderNumber),
        },
      ]),
  );
  const restaurantLiveStats = new Map<
    string,
    {
      activeOrders: number;
      delayedOrders: number;
      readyForPickup: number;
      pickedUp: number;
      statusCounts: Record<string, number>;
      latestOrder: { id: string; orderNumber: string; status: string; updatedAt: string | null } | null;
    }
  >();

  restaurantLiveOrders.forEach((order) => {
    const restaurantId = String(order.restaurantId ?? "");
    if (!restaurantId) return;
    const current = restaurantLiveStats.get(restaurantId) ?? {
      activeOrders: 0,
      delayedOrders: 0,
      readyForPickup: 0,
      pickedUp: 0,
      statusCounts: {},
      latestOrder: null,
    };
    const status = stringValue(order.status, "New");
    current.activeOrders += 1;
    current.statusCounts[status] = (current.statusCounts[status] ?? 0) + 1;
    if (status === "ReadyForPickup") current.readyForPickup += 1;
    if (status === "PickedUp") current.pickedUp += 1;
    if (getAdminOrderDelayState(order, dispatchSettings, restaurantMap.get(restaurantId))) {
      current.delayedOrders += 1;
    }
    if (!current.latestOrder) {
      current.latestOrder = {
        id: String(order._id ?? ""),
        orderNumber: stringValue(order.orderNumber),
        status,
        updatedAt: serializeDate(order.updatedAt ?? order.createdAt),
      };
    }
    restaurantLiveStats.set(restaurantId, current);
  });

  const deliveries = orders.map((order) => {
    const restaurant = restaurantMap.get(String(order.restaurantId ?? ""));
    const rider = riderMap.get(String(order.riderId ?? ""));
    const trackingSource = (order.riderTracking ?? {}) as Record<string, any>;
    const tracking = decorateTrackingSnapshot(
      trackingSource,
      order.status ?? "",
    ) as Record<string, any>;
    const delayState = getAdminOrderDelayState(order, dispatchSettings, restaurant);
    const readyAt = getOrderTimestamp(order, "ReadyForPickup");
    const pickedUpAt = getOrderTimestamp(order, "PickedUp");
    const now = new Date();

    return {
      id: String(order._id ?? ""),
      orderNumber: stringValue(order.orderNumber),
      status: stringValue(order.status, "New"),
      paymentMethod: stringValue(order.paymentMethod, "Cash"),
      total: numberValue(order.pricing?.total),
      createdAt: serializeDate(order.createdAt),
      readyAt: serializeDate(readyAt),
      pickedUpAt: serializeDate(pickedUpAt),
      readyWaitMinutes: minutesBetween(readyAt, now) ?? 0,
      pickedUpMinutes: minutesBetween(pickedUpAt, now) ?? 0,
      isTrackingActive: Boolean(order.riderTracking?.isActive),
      isNearCustomer:
        numberValue(tracking.remainingDistanceKm, Number.POSITIVE_INFINITY) <=
        0.5,
      isDelayed: Boolean(delayState),
      delaySeverity:
        delayState?.tone === "critical"
          ? "critical"
          : delayState?.tone === "warning"
            ? "warning"
            : "none",
      delayReason: delayState?.label ?? "",
      rider: rider
        ? {
            id: String(rider._id ?? ""),
            fullName: stringValue(rider.fullName),
            phone: stringValue(rider.phone),
            status: stringValue(rider.status, "active"),
            vehicleType: stringValue(rider.vehicleType, "cycle"),
            isAvailableForAssignments:
              rider.isAvailableForAssignments !== false,
            activeTrackingOrderId: stringValue(rider.activeTrackingOrderId),
            lastLoginAt: serializeDate(rider.lastLoginAt),
            location: serializeRiderLocation(rider.lastKnownLocation),
          }
        : null,
      restaurant: {
        id: String(restaurant?._id ?? ""),
        name: stringValue(restaurant?.name, "Restaurant"),
        latitude: numberValue(restaurant?.location?.latitude, Number.NaN),
        longitude: numberValue(restaurant?.location?.longitude, Number.NaN),
        address: stringValue(restaurant?.address?.address),
        city: stringValue(restaurant?.address?.city),
        phone: stringValue(restaurant?.contact?.phone),
        isOnline: restaurant?.runtime?.isOnline === true,
      },
      customer: {
        id: stringValue(order.customerId),
        name:
          stringValue(order.customerSnapshot?.name) ||
          stringValue(order.customerSnapshot?.fullName, "Customer"),
        phone: stringValue(order.customerSnapshot?.phone),
        deliveryAddress: {
          label: stringValue(order.customerSnapshot?.deliveryAddress?.label),
          addressLine: stringValue(
            order.customerSnapshot?.deliveryAddress?.addressLine,
          ),
          latitude: numberValue(
            order.customerSnapshot?.deliveryAddress?.latitude,
            Number.NaN,
          ),
          longitude: numberValue(
            order.customerSnapshot?.deliveryAddress?.longitude,
            Number.NaN,
          ),
        },
      },
      tracking: {
        remainingDistanceKm: numberValue(tracking.remainingDistanceKm),
        remainingDurationMinutes: numberValue(
          tracking.remainingDurationMinutes,
        ),
        speedKmph: numberValue(tracking.speedKmph ?? trackingSource.speedKmph),
        lastUpdatedAt: serializeDate(
          tracking.lastUpdatedAt ?? trackingSource.lastUpdatedAt,
        ),
      },
    };
  });

  const liveRiders = riders.map((rider) => {
    const liveOrder = liveOrderByRiderId.get(String(rider._id ?? ""));

    return {
      id: String(rider._id ?? ""),
      fullName: stringValue(rider.fullName),
      phone: stringValue(rider.phone),
      status: stringValue(rider.status, "active"),
      vehicleType: stringValue(rider.vehicleType, "cycle"),
      isAvailableForAssignments: rider.isAvailableForAssignments !== false,
      activeTrackingOrderId: stringValue(rider.activeTrackingOrderId),
      lastLoginAt: serializeDate(rider.lastLoginAt),
      liveOrderId: liveOrder?.id ?? "",
      liveOrderNumber: liveOrder?.orderNumber ?? "",
      currentLocation: serializeRiderLocation(rider.lastKnownLocation),
    };
  });
  const restaurantLayer = allRestaurants
    .map((restaurant) => {
      const restaurantId = String(restaurant._id ?? "");
      const stats = restaurantLiveStats.get(restaurantId) ?? {
        activeOrders: 0,
        delayedOrders: 0,
        readyForPickup: 0,
        pickedUp: 0,
        statusCounts: {},
        latestOrder: null,
      };

      return {
        id: restaurantId,
        name: stringValue(restaurant.name, "Restaurant"),
        latitude: numberValue(restaurant.location?.latitude, Number.NaN),
        longitude: numberValue(restaurant.location?.longitude, Number.NaN),
        address: stringValue(restaurant.address?.address),
        city: stringValue(restaurant.address?.city),
        phone: stringValue(restaurant.contact?.phone),
        isOnline: restaurant.runtime?.isOnline === true,
        isVisible: restaurant.runtime?.isVisible !== false,
        activeOrders: stats.activeOrders,
        delayedOrders: stats.delayedOrders,
        readyForPickup: stats.readyForPickup,
        pickedUp: stats.pickedUp,
        statusCounts: stats.statusCounts,
        latestOrder: stats.latestOrder,
      };
    })
    .filter(
      (restaurant) =>
        Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude),
    );

  return {
    summary: {
      activeRiders: activeRidersCount,
      availableRiders: availableRidersCount,
      liveTrips: deliveries.filter((delivery) => delivery.status === "PickedUp")
        .length,
      readyForPickup: deliveries.filter(
        (delivery) => delivery.status === "ReadyForPickup",
      ).length,
      nearCustomer: deliveries.filter((delivery) => delivery.isNearCustomer)
        .length,
      delayedTrips: deliveries.filter((delivery) => delivery.isDelayed).length,
      warningDelays: deliveries.filter(
        (delivery) => delivery.delaySeverity === "warning",
      ).length,
      criticalDelays: deliveries.filter(
        (delivery) => delivery.delaySeverity === "critical",
      ).length,
      unassignedReady: deliveries.filter(
        (delivery) =>
          delivery.status === "ReadyForPickup" && delivery.rider === null,
      ).length,
      restaurants: restaurantLayer.length,
      onlineRestaurants: restaurantLayer.filter((restaurant) => restaurant.isOnline).length,
      restaurantsWithLiveOrders: restaurantLayer.filter((restaurant) => restaurant.activeOrders > 0).length,
    },
    deliveries,
    riders: liveRiders,
    restaurants: restaurantLayer,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export async function getAdminRiderDetails(riderId: string) {
  const rider = await RiderModel.findById(riderId).lean();

  if (!rider) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RIDER_NOT_FOUND",
      "Rider not found",
    );
  }

  const payrollMonth = currentPayrollMonth();
  const [statsMap, activeOrders, recentTrips, payrollCycle, availability] = await Promise.all([
    getRiderOrderStatsMap([String(rider._id ?? "")]),
    OrderModel.find({
      riderId: String(rider._id ?? ""),
      status: { $in: ["ReadyForPickup", "PickedUp"] },
    })
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean(),
    OrderModel.find({
      riderId: String(rider._id ?? ""),
      status: { $in: ["Delivered", "Cancelled", "Rejected"] },
    })
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean(),
    RiderPayrollCycleModel.findOne({
      riderId: String(rider._id ?? ""),
      month: payrollMonth,
    }).lean(),
    getRiderAvailabilitySummary(String(rider._id ?? "")),
  ]);

  const restaurantIds = [
    ...new Set(
      [...activeOrders, ...recentTrips]
        .map((order) => String(order.restaurantId ?? ""))
        .filter(Boolean),
    ),
  ];
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
    : [];
  const restaurantMap = new Map(
    restaurants.map((restaurant) => [String(restaurant._id ?? ""), restaurant]),
  );
  const stats =
    statsMap.get(String(rider._id ?? "")) ?? emptyRiderStats();

  return {
    ...mapAdminRiderSummary(rider, stats, payrollCycle, payrollMonth),
    pushTokens: Array.isArray(rider.pushTokens)
      ? rider.pushTokens.map((token: Record<string, any>) => ({
          platform: stringValue(token.platform),
          appVersion: stringValue(token.appVersion),
          deviceId: stringValue(token.deviceId),
          lastSeenAt: serializeDate(token.lastSeenAt),
          disabledAt: serializeDate(token.disabledAt),
        }))
      : [],
    summary: stats,
    availability: {
      ...availability,
      isOnline: rider.isAvailableForAssignments !== false,
    },
    activeOrders: activeOrders.map((order) => {
      const restaurant = restaurantMap.get(String(order.restaurantId ?? ""));
      const dispatchMeta = getDispatchMeta(order);
      const readyAt = getOrderTimestamp(order, "ReadyForPickup");
      const pickedUpAt = getOrderTimestamp(order, "PickedUp");
      const trackingSource = (order.riderTracking ?? {}) as Record<string, any>;
      const tracking = decorateTrackingSnapshot(
        trackingSource,
        order.status ?? "",
      ) as Record<string, any>;

      return {
        id: String(order._id ?? ""),
        orderNumber: stringValue(order.orderNumber),
        restaurantName: stringValue(restaurant?.name, "Restaurant"),
        customerName:
          stringValue(order.customerSnapshot?.name) ||
          stringValue(order.customerSnapshot?.fullName, "Customer"),
        status: stringValue(order.status),
        total: numberValue(order.pricing?.total),
        createdAt: serializeDate(order.createdAt),
        assignedAt: serializeDate(dispatchMeta.assignedAt),
        acknowledgedAt: serializeDate(dispatchMeta.acknowledgedAt),
        readyAt: serializeDate(readyAt),
        pickedUpAt: serializeDate(pickedUpAt),
        isTrackingActive: Boolean(order.riderTracking?.isActive),
        trackingFreshness: stringValue(tracking.freshness?.state, "unavailable"),
        trackingLastUpdatedAt: serializeDate(
          tracking.lastUpdatedAt ?? trackingSource.lastUpdatedAt,
        ),
        remainingDistanceKm: numberValue(tracking.remainingDistanceKm),
        remainingDurationMinutes: numberValue(tracking.remainingDurationMinutes),
        speedKmph: numberValue(tracking.speedKmph ?? trackingSource.speedKmph),
      };
    }),
    recentTrips: recentTrips.map((order) => {
      const restaurant = restaurantMap.get(String(order.restaurantId ?? ""));

      return {
        id: String(order._id ?? ""),
        orderNumber: stringValue(order.orderNumber),
        restaurantName: stringValue(restaurant?.name, "Restaurant"),
        customerName:
          stringValue(order.customerSnapshot?.name) ||
          stringValue(order.customerSnapshot?.fullName, "Customer"),
        status: stringValue(order.status),
        total: numberValue(order.pricing?.total),
        deliveryFee: numberValue(order.pricing?.deliveryFee),
        createdAt: serializeDate(order.createdAt),
        deliveredAt: serializeDate(getOrderTimestamp(order, "Delivered")),
      };
    }),
  };
}

export async function listAdminRiderPayroll(params: { month?: string } = {}) {
  const month = normalizePayrollMonth(params.month);
  const [riders, cycles] = await Promise.all([
    RiderModel.find().sort({ fullName: 1 }).lean(),
    RiderPayrollCycleModel.find({ month }).lean(),
  ]);
  const cycleMap = new Map(cycles.map((cycle) => [String(cycle.riderId ?? ""), cycle]));
  const items = riders.map((rider) => {
    const payroll = summarizePayrollCycle(
      rider,
      cycleMap.get(String(rider._id ?? "")),
      month,
    );

    return {
      riderId: String(rider._id ?? ""),
      riderName: stringValue(rider.fullName),
      phone: stringValue(rider.phone),
      status: stringValue(rider.status, "active"),
      verificationStatus: stringValue(rider.verification?.status, "pending"),
      payroll,
    };
  });

  const summary = items.reduce(
    (total, item) => ({
      riders: total.riders + 1,
      baseSalary: total.baseSalary + item.payroll.baseSalary,
      platformBonus: total.platformBonus + item.payroll.platformBonus,
      penalties: total.penalties + item.payroll.penalties,
      netPayable: total.netPayable + item.payroll.netPayable,
      pending: total.pending + item.payroll.pendingAmount,
      paid: total.paid + item.payroll.paidAmount,
      approved: total.approved + (item.payroll.status === "approved" ? 1 : 0),
      draft: total.draft + (item.payroll.status === "draft" ? 1 : 0),
      paidCycles: total.paidCycles + (item.payroll.status === "paid" ? 1 : 0),
    }),
    {
      riders: 0,
      baseSalary: 0,
      platformBonus: 0,
      penalties: 0,
      netPayable: 0,
      pending: 0,
      paid: 0,
      approved: 0,
      draft: 0,
      paidCycles: 0,
    },
  );

  return { month, summary, items };
}

async function getRiderPayrollFinanceSummary(months: string[]) {
  const safeMonths = months.length ? months : [currentPayrollMonth()];
  const [riders, cycles] = await Promise.all([
    RiderModel.find({
      $or: [
        { "payroll.isPayrollEnabled": { $ne: false } },
        { payroll: { $exists: false } },
      ],
    }).lean(),
    RiderPayrollCycleModel.find({ month: { $in: safeMonths } }).lean(),
  ]);
  const cycleMap = new Map(
    cycles.map((cycle) => [`${String(cycle.riderId ?? "")}:${cycle.month}`, cycle]),
  );

  return safeMonths.reduce(
    (total, month) => {
      const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 23, 59, 59, 999);
      const monthTotal = riders.reduce(
        (riderTotal, rider) => {
          const createdAt = rider.createdAt ? new Date(rider.createdAt) : null;
          if (createdAt && createdAt > monthEnd) return riderTotal;
          const payroll = summarizePayrollCycle(
            rider,
            cycleMap.get(`${String(rider._id ?? "")}:${month}`),
            month,
          );
          return {
            baseSalary: riderTotal.baseSalary + payroll.baseSalary,
            platformBonus: riderTotal.platformBonus + payroll.platformBonus,
            penalties: riderTotal.penalties + payroll.penalties,
            netPayable: riderTotal.netPayable + payroll.netPayable,
            pending: riderTotal.pending + payroll.pendingAmount,
            paid: riderTotal.paid + payroll.paidAmount,
          };
        },
        { baseSalary: 0, platformBonus: 0, penalties: 0, netPayable: 0, pending: 0, paid: 0 },
      );
      return {
        months: total.months + 1,
        baseSalary: total.baseSalary + monthTotal.baseSalary,
        platformBonus: total.platformBonus + monthTotal.platformBonus,
        penalties: total.penalties + monthTotal.penalties,
        netPayable: total.netPayable + monthTotal.netPayable,
        pending: total.pending + monthTotal.pending,
        paid: total.paid + monthTotal.paid,
      };
    },
    { months: 0, baseSalary: 0, platformBonus: 0, penalties: 0, netPayable: 0, pending: 0, paid: 0 },
  );
}

export async function updateAdminRiderPayrollSettings(params: {
  riderId: string;
  monthlySalary: number;
  payoutDay: number;
  isPayrollEnabled?: boolean;
  note?: string;
  adminId?: string;
}) {
  const rider = await RiderModel.findById(params.riderId);
  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found");
  }

  rider.set("payroll", {
    ...(rider.toObject().payroll ?? {}),
    isPayrollEnabled: params.isPayrollEnabled !== false,
    monthlySalary: Math.max(0, numberValue(params.monthlySalary)),
    payoutDay: Math.min(28, Math.max(1, Math.floor(numberValue(params.payoutDay, 1)))),
    note: params.note?.trim() ?? "",
    updatedByAdminId: params.adminId ?? "",
    updatedAt: new Date(),
  });
  await rider.save();

  return mapAdminRiderSummary(rider.toObject(), emptyRiderStats());
}

export async function addAdminRiderPayrollAdjustment(params: {
  riderId: string;
  month?: string;
  type: RiderPayrollAdjustmentType;
  amount: number;
  note?: string;
  adminId?: string;
}) {
  const rider = await RiderModel.findById(params.riderId).lean();
  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found");
  }
  if (params.amount <= 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "PAYROLL_AMOUNT_INVALID",
      "Payroll adjustment amount must be greater than zero",
    );
  }

  const month = normalizePayrollMonth(params.month);
  const baseSalary = numberValue(rider.payroll?.monthlySalary);
  const cycle = await RiderPayrollCycleModel.findOneAndUpdate(
    { riderId: rider._id, month },
    {
      $setOnInsert: {
        riderId: rider._id,
        month,
        baseSalary,
        status: "draft",
      },
      $push: {
        adjustments: {
          type: params.type,
          amount: Math.round(params.amount),
          note: params.note?.trim() ?? "",
          createdByAdminId: params.adminId ?? "",
          createdAt: new Date(),
        },
      },
    },
    { upsert: true, new: true },
  ).lean();

  return summarizePayrollCycle(rider, cycle, month);
}

export async function updateAdminRiderPayrollStatus(params: {
  riderId: string;
  month?: string;
  status: RiderPayrollStatus;
  paymentReference?: string;
  note?: string;
  adminId?: string;
}) {
  const rider = await RiderModel.findById(params.riderId).lean();
  if (!rider) {
    throw new AppError(StatusCodes.NOT_FOUND, "RIDER_NOT_FOUND", "Rider not found");
  }

  const month = normalizePayrollMonth(params.month);
  const now = new Date();
  const payload: Record<string, unknown> = {
    riderId: rider._id,
    month,
    baseSalary: numberValue(rider.payroll?.monthlySalary),
    status: params.status,
    note: params.note?.trim() ?? "",
  };
  if (params.status === "approved") {
    payload.approvedAt = now;
    payload.approvedByAdminId = params.adminId ?? "";
  }
  if (params.status === "paid") {
    payload.approvedAt = now;
    payload.approvedByAdminId = params.adminId ?? "";
    payload.paidAt = now;
    payload.paidByAdminId = params.adminId ?? "";
    payload.paymentReference = params.paymentReference?.trim() ?? "";
  }

  const cycle = await RiderPayrollCycleModel.findOneAndUpdate(
    { riderId: rider._id, month },
    { $set: payload, $setOnInsert: { adjustments: [] } },
    { upsert: true, new: true },
  ).lean();

  return summarizePayrollCycle(rider, cycle, month);
}

export async function listAdminRiderAssignmentCandidates() {
  const orders = await OrderModel.find({
    status: "ReadyForPickup",
    $or: [{ riderId: "" }, { riderId: { $exists: false } }],
  })
    .sort({ updatedAt: 1 })
    .limit(100)
    .lean();

  const restaurantIds = [
    ...new Set(
      orders.map((order) => String(order.restaurantId ?? "")).filter(Boolean),
    ),
  ];
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
    : [];
  const restaurantMap = new Map(
    restaurants.map((restaurant) => [String(restaurant._id ?? ""), restaurant]),
  );

  return orders.map((order) => {
    const restaurant = restaurantMap.get(String(order.restaurantId ?? ""));

    return {
      id: String(order._id ?? ""),
      orderNumber: stringValue(order.orderNumber),
      restaurantId: String(order.restaurantId ?? ""),
      riderId: "",
      restaurantName: stringValue(restaurant?.name, "Restaurant"),
      customerName:
        stringValue(order.customerSnapshot?.name) ||
        stringValue(order.customerSnapshot?.fullName, "Customer"),
      customerPhone: stringValue(order.customerSnapshot?.phone),
      deliveryAddress: stringValue(
        order.customerSnapshot?.deliveryAddress?.addressLine,
      ),
      total: numberValue(order.pricing?.total),
      createdAt: serializeDate(order.createdAt),
    };
  });
}

export async function updateAdminRiderAvailability(params: {
  riderId: string;
  isAvailableForAssignments: boolean;
}) {
  const rider = await RiderModel.findById(params.riderId);

  if (!rider) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RIDER_NOT_FOUND",
      "Rider not found",
    );
  }

  if (params.isAvailableForAssignments && rider.status !== "active") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_NOT_ACTIVE",
      "Only active riders can be marked available",
    );
  }

  if (params.isAvailableForAssignments && !isRiderVerificationApproved(rider.toObject())) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "RIDER_KYC_NOT_APPROVED",
      "Only KYC approved riders can be marked available",
    );
  }

  if (!params.isAvailableForAssignments) {
    const activeAssignedOrdersCount = await OrderModel.countDocuments({
      riderId: rider.id,
      status: { $in: ["ReadyForPickup", "PickedUp"] },
    });

    if (
      activeAssignedOrdersCount > 0 ||
      (rider.activeTrackingOrderId ?? "").trim().length > 0
    ) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "RIDER_HAS_ACTIVE_ORDERS",
        "Rider has active orders and cannot be marked unavailable",
      );
    }
  }

  rider.isAvailableForAssignments = params.isAvailableForAssignments;
  await rider.save();
  await syncRiderAvailabilitySession({
    riderId: rider.id,
    isAvailableForAssignments: params.isAvailableForAssignments,
    source: "admin",
    endReason: "admin_offline",
  });

  emitSocketEvent(`rider:${rider.id}`, "rider.profile.updated", rider.toObject());
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.availability",
    riderId: rider.id,
  });

  return {
    id: rider.id,
    isAvailableForAssignments: rider.isAvailableForAssignments,
  };
}

export async function updateAdminRiderStatus(params: {
  riderId: string;
  expectedStatus?: string;
  status: AdminRiderStatus;
}) {
  const currentRider = await RiderModel.findById(params.riderId).lean();

  if (!currentRider) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RIDER_NOT_FOUND",
      "Rider not found",
    );
  }

  if (params.expectedStatus && currentRider.status !== params.expectedStatus) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "RIDER_STATUS_CHANGED",
      `Rider status is already ${currentRider.status}`,
    );
  }

  if (params.status !== "active") {
    const activeAssignedOrdersCount = await OrderModel.countDocuments({
      riderId: String(currentRider._id ?? ""),
      status: { $in: ["ReadyForPickup", "PickedUp"] },
    });

    if (
      activeAssignedOrdersCount > 0 ||
      stringValue(currentRider.activeTrackingOrderId).length > 0
    ) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "RIDER_HAS_ACTIVE_ORDERS",
        "Rider has active orders and cannot be suspended or locked",
      );
    }
  }

  const updatedRider = await RiderModel.findOneAndUpdate(
    { _id: currentRider._id, status: currentRider.status },
    {
      $set: {
        status: params.status,
        isAvailableForAssignments:
          params.status === "active" &&
          getRiderVerification(currentRider).status === "approved"
            ? currentRider.isAvailableForAssignments !== false
            : false,
      },
    },
    { new: true },
  );

  if (!updatedRider) {
    const latestRider = await RiderModel.findById(params.riderId).lean();
    throw new AppError(
      StatusCodes.CONFLICT,
      "RIDER_STATUS_CHANGED",
      `Rider status is already ${latestRider?.status ?? "updated"}`,
    );
  }

  await syncRiderAvailabilitySession({
    riderId: updatedRider.id,
    isAvailableForAssignments: updatedRider.isAvailableForAssignments !== false,
    source: "admin",
    endReason: "status_changed",
  });

  emitSocketEvent(
    `rider:${updatedRider.id}`,
    "rider.profile.updated",
    updatedRider.toObject(),
  );
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.status",
    riderId: updatedRider.id,
  });

  return {
    id: updatedRider.id,
    previousStatus: currentRider.status,
    status: updatedRider.status,
    isAvailableForAssignments: updatedRider.isAvailableForAssignments,
  };
}

export async function updateAdminRiderVerification(params: {
  riderId: string;
  expectedStatus?: string;
  status: AdminRiderVerificationStatus;
  note?: string;
  adminId?: string;
}) {
  const currentRider = await RiderModel.findById(params.riderId).lean();

  if (!currentRider) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "RIDER_NOT_FOUND",
      "Rider not found",
    );
  }

  const currentVerificationStatus = getRiderVerification(currentRider).status;
  if (
    params.expectedStatus &&
    currentVerificationStatus !== params.expectedStatus
  ) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "RIDER_KYC_STATUS_CHANGED",
      `Rider KYC status is already ${currentVerificationStatus}`,
    );
  }

  if (params.status === "rejected") {
    const activeAssignedOrdersCount = await OrderModel.countDocuments({
      riderId: String(currentRider._id ?? ""),
      status: { $in: ["ReadyForPickup", "PickedUp"] },
    });

    if (activeAssignedOrdersCount > 0) {
      throw new AppError(
        StatusCodes.CONFLICT,
        "RIDER_HAS_ACTIVE_ORDERS",
        "Rider has active orders and cannot be rejected now",
      );
    }
  }

  const now = new Date();
  const updatedRider = await RiderModel.findOneAndUpdate(
    {
      _id: currentRider._id,
      $or: [
        { "verification.status": currentVerificationStatus },
        ...(currentVerificationStatus === "pending"
          ? [{ "verification.status": { $exists: false } }]
          : []),
      ],
    },
    {
      $set: {
        "verification.status": params.status,
        "verification.reviewNote": params.note?.trim() ?? "",
        "verification.reviewedAt": now,
        "verification.reviewedByAdminId": params.adminId ?? "",
        "verification.submittedAt": currentRider.verification?.submittedAt ?? now,
        status: params.status === "approved" ? "active" : currentRider.status,
        isAvailableForAssignments:
          params.status === "approved"
            ? currentRider.status === "active" || currentRider.status === "suspended"
              ? true
              : currentRider.isAvailableForAssignments !== false
            : false,
      },
    },
    { new: true },
  );

  if (!updatedRider) {
    const latestRider = await RiderModel.findById(params.riderId).lean();
    throw new AppError(
      StatusCodes.CONFLICT,
      "RIDER_KYC_STATUS_CHANGED",
      `Rider KYC status is already ${
        latestRider ? getRiderVerification(latestRider).status : "updated"
      }`,
    );
  }

  await syncRiderAvailabilitySession({
    riderId: updatedRider.id,
    isAvailableForAssignments: updatedRider.isAvailableForAssignments !== false,
    source: "admin",
    endReason: "kyc_changed",
  });

  emitSocketEvent(
    `rider:${updatedRider.id}`,
    "rider.profile.updated",
    updatedRider.toObject(),
  );
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "rider.verification",
    riderId: updatedRider.id,
    status: params.status,
  });

  return mapAdminRiderSummary(updatedRider.toObject(), emptyRiderStats());
}

export async function bulkAssignAdminRidersToOrders(params: {
  orderIds: string[];
}) {
  const content = await getPlatformContent();
  const settings = getDispatchSettingsFromContent(content);
  const uniqueOrderIds = [...new Set(params.orderIds.filter(Boolean))].slice(0, 50);

  let assigned = 0;
  let skipped = 0;
  const results: Array<{
    orderId: string;
    orderNumber: string;
    outcome: "assigned" | "skipped" | "no_match";
    riderName: string;
    reason: string;
  }> = [];

  for (const orderId of uniqueOrderIds) {
    const readyOrder = await OrderModel.findById(orderId).lean();

    if (!readyOrder || readyOrder.status !== "ReadyForPickup" || readyOrder.riderId) {
      skipped += 1;
      results.push({
        orderId,
        orderNumber: readyOrder?.orderNumber ?? "",
        outcome: "skipped",
        riderName: "",
        reason: "Order state changed before assignment.",
      });
      continue;
    }

    const restaurant = await RestaurantModel.findById(
      readyOrder.restaurantId,
    ).lean();
    const candidates = await listDispatchEligibleRiders({
      restaurant,
      settings,
    });
    const selectedRider = pickBestRiderForOrder({ candidates, settings });

    if (!selectedRider) {
      await createDispatchDecisionLog({
        orderId: String(readyOrder._id ?? ""),
        orderNumber: readyOrder.orderNumber ?? "",
        restaurantId: String(readyOrder.restaurantId ?? ""),
        restaurantName: restaurant?.name ?? "",
        algorithm: settings.algorithm,
        assignmentSource: "manual_admin",
        outcome: "no_match",
        reason: "No eligible KYC-approved rider matched the current rules.",
        candidates,
      });
      skipped += 1;
      results.push({
        orderId,
        orderNumber: readyOrder.orderNumber ?? "",
        outcome: "no_match",
        riderName: "",
        reason: "No eligible KYC-approved rider matched the current rules.",
      });
      continue;
    }

    const liveOrder = await OrderModel.findById(readyOrder._id);
    if (!liveOrder || liveOrder.status !== "ReadyForPickup" || liveOrder.riderId) {
      skipped += 1;
      results.push({
        orderId,
        orderNumber: readyOrder.orderNumber ?? "",
        outcome: "skipped",
        riderName: selectedRider.fullName,
        reason: "Order state changed before assignment.",
      });
      continue;
    }

    await assignOrderToRider({
      order: liveOrder,
      riderId: selectedRider.id,
      assignmentSource: "manual_admin",
      algorithm: settings.algorithm,
      candidateSnapshot: candidates,
    });
    assigned += 1;
    results.push({
      orderId,
      orderNumber: readyOrder.orderNumber ?? "",
      outcome: "assigned",
      riderName: selectedRider.fullName,
      reason: "Assigned by bulk dispatch.",
    });
  }

  return {
    assigned,
    scanned: uniqueOrderIds.length,
    skipped,
    results,
  };
}

export async function listAdminRidersForAssignment() {
  const riders = await RiderModel.find({
    status: "active",
    "verification.status": "approved",
  })
    .sort({ createdAt: -1 })
    .lean();
  const riderIds = riders.map((rider) => rider._id.toString());
  const activeCounts = riderIds.length
    ? await OrderModel.aggregate<{ _id: string; activeOrders: number }>([
        {
          $match: {
            riderId: { $in: riderIds },
            status: { $in: ["ReadyForPickup", "PickedUp"] },
          },
        },
        {
          $group: {
            _id: "$riderId",
            activeOrders: { $sum: 1 },
          },
        },
      ])
    : [];

  const countMap = new Map(
    activeCounts.map((entry) => [entry._id, entry.activeOrders]),
  );

  return riders.map((rider) => ({
    id: rider._id.toString(),
    fullName: rider.fullName,
    phone: rider.phone,
    vehicleType: rider.vehicleType ?? "cycle",
    isAvailableForAssignments: rider.isAvailableForAssignments ?? true,
    activeOrders: countMap.get(rider._id.toString()) ?? 0,
  }));
}

export async function assignAdminRiderToOrder(params: {
  orderId: string;
  riderId: string;
}) {
  const order = await OrderModel.findById(params.orderId);
  const settings = getDispatchSettingsFromContent(await getPlatformContent());
  return assignOrderToRider({
    order,
    riderId: params.riderId,
    assignmentSource: "manual_admin",
    algorithm: settings.algorithm,
  });
}

export async function updateAdminOrderStatus(params: {
  orderId: string;
  expectedStatus?: string;
  nextStatus: AdminOrderNextStatus;
  note?: string;
  adminId?: string;
}) {
  const currentOrder = await OrderModel.findById(params.orderId).lean();

  if (!currentOrder) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  if (params.expectedStatus && currentOrder.status !== params.expectedStatus) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_STATUS_CHANGED",
      `Order status is already ${currentOrder.status}`,
    );
  }

  const allowedNextStatuses = adminOrderTransitions[currentOrder.status] ?? [];
  if (!allowedNextStatuses.includes(params.nextStatus)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "INVALID_ORDER_TRANSITION",
      `Order cannot move from ${currentOrder.status} to ${params.nextStatus}`,
    );
  }

  const now = new Date();
  const admin =
    params.adminId && params.adminId.trim().length > 0
      ? await AdminModel.findById(params.adminId).lean()
      : null;
  const setPayload: Record<string, unknown> = {
    status: params.nextStatus,
    timestamps: applyOrderStatusTimestamp(
      currentOrder.timestamps as Record<string, unknown> | undefined,
      params.nextStatus,
      now,
    ),
  };

  if (params.nextStatus === "Rejected") {
    setPayload.rejectionReason = params.note ?? "";
    setPayload.terminalReason = "admin_rejected";
  }

  if (params.nextStatus === "Cancelled") {
    setPayload.cancelledBy = "admin";
    setPayload.terminalReason = params.note ?? "admin_cancelled";
    setPayload["riderTracking.isActive"] = false;
    setPayload["riderTracking.completedAt"] = now;
    setPayload["riderTracking.endedAt"] = now;
  }

  if (
    ["Rejected", "Cancelled"].includes(params.nextStatus) &&
    currentOrder.paymentMethod === "Bkash" &&
    currentOrder.paymentStatus === "paid"
  ) {
    setPayload.paymentStatus = "refund_pending";
    setPayload["paymentSnapshot.refundStatus"] = "pending";
    setPayload["paymentSnapshot.refundRequestedAt"] = now;
  }

  const updatedOrder = await OrderModel.findOneAndUpdate(
    { _id: currentOrder._id, status: currentOrder.status },
    {
      $set: setPayload,
      $push: {
        history: {
          status: params.nextStatus,
          actor: "admin",
          note:
            params.note ??
            `Admin moved order from ${currentOrder.status} to ${params.nextStatus}`,
          createdAt: now,
        },
      },
    },
    { new: true },
  );

  if (!updatedOrder) {
    const latestOrder = await OrderModel.findById(params.orderId).lean();
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_STATUS_CHANGED",
      `Order status is already ${latestOrder?.status ?? "updated"}`,
    );
  }

  const updatedOrderObject = updatedOrder.toObject();
  await emitOrderRealtimeUpdates(updatedOrderObject);
  try {
    await createOwnerSystemNotification({
      restaurantId: String(updatedOrder.restaurantId ?? ""),
      entityId: updatedOrder.id,
      title: getOrderActionTitle(params.nextStatus),
      description:
        params.note?.trim() ||
        `${updatedOrder.orderNumber} was moved to ${params.nextStatus} by admin.`,
      actionPath: `/orders?orderId=${updatedOrder.id}`,
    });
  } catch {
    // The admin transition already succeeded; owner notification persistence is best-effort.
  }
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "order.transition",
    orderId: updatedOrder.id,
    status: updatedOrder.status,
  });

  await safeSendCustomerOrderStatusPush({
    customerId: updatedOrder.customerId,
    orderId: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    nextStatus: params.nextStatus,
  });

  if (params.nextStatus === "ReadyForPickup") {
    void runAutoDispatchForReadyOrders().catch(() => undefined);
  }

  await createAdminActivityLog({
    action: "order_status_updated",
    entityType: "order",
    entityId: updatedOrder.id,
    title: `${updatedOrder.orderNumber} moved to ${params.nextStatus}`,
    description:
      params.note?.trim() ||
      `Admin moved this order from ${currentOrder.status} to ${params.nextStatus}.`,
    adminId: params.adminId ?? "",
    adminName: admin?.fullName ?? "Support Team",
    metadata: {
      orderNumber: updatedOrder.orderNumber,
      previousStatus: currentOrder.status,
      nextStatus: params.nextStatus,
      restaurantId: updatedOrder.restaurantId?.toString?.() ?? "",
      customerId: updatedOrder.customerId?.toString?.() ?? updatedOrder.customerId ?? "",
    },
  });

  return {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    previousStatus: currentOrder.status,
    status: updatedOrder.status,
    paymentStatus: updatedOrder.paymentStatus,
    updatedAt: updatedOrder.updatedAt
      ? new Date(updatedOrder.updatedAt).toISOString()
      : null,
  };
}

export async function updateAdminOrderRefundStatus(params: {
  orderId: string;
  expectedPaymentStatus?: string;
  paymentStatus: AdminOrderRefundStatus;
  note?: string;
  adminId?: string;
}) {
  const currentOrder = await OrderModel.findById(params.orderId).lean();

  if (!currentOrder) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  if (!["Cancelled", "Rejected"].includes(currentOrder.status)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_REFUNDABLE",
      "Only cancelled or rejected orders can be reviewed for refund",
    );
  }

  if (currentOrder.paymentMethod !== "Bkash") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_PAYMENT_NOT_REFUNDABLE",
      "Only online paid orders need refund review",
    );
  }

  if (
    params.expectedPaymentStatus &&
    currentOrder.paymentStatus !== params.expectedPaymentStatus
  ) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_PAYMENT_STATUS_CHANGED",
      `Order payment status is already ${currentOrder.paymentStatus}`,
    );
  }

  const now = new Date();
  const updatedOrder = await OrderModel.findOneAndUpdate(
    { _id: currentOrder._id, paymentStatus: currentOrder.paymentStatus },
    {
      $set: {
        paymentStatus: params.paymentStatus,
        "paymentSnapshot.refundStatus": params.paymentStatus,
        "paymentSnapshot.refundReviewedAt": now,
        "paymentSnapshot.refundReviewedByAdminId": params.adminId ?? "",
        "paymentSnapshot.refundNote": params.note?.trim() ?? "",
      },
      $push: {
        history: {
          status: currentOrder.status,
          actor: "admin",
          note:
            params.note?.trim() ||
            `Refund status changed to ${params.paymentStatus}`,
          createdAt: now,
        },
      },
    },
    { new: true },
  );

  if (!updatedOrder) {
    const latestOrder = await OrderModel.findById(params.orderId).lean();
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_PAYMENT_STATUS_CHANGED",
      `Order payment status is already ${latestOrder?.paymentStatus ?? "updated"}`,
    );
  }

  emitSocketEvent(
    `customer:${updatedOrder.customerId}`,
    "customer.order.updated",
    updatedOrder.toObject(),
  );
  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "order.refund",
    orderId: updatedOrder.id,
    paymentStatus: updatedOrder.paymentStatus,
  });

  return {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    previousPaymentStatus: currentOrder.paymentStatus,
    paymentStatus: updatedOrder.paymentStatus,
    updatedAt: updatedOrder.updatedAt
      ? new Date(updatedOrder.updatedAt).toISOString()
      : null,
  };
}

export async function updateAdminOrderCodCollection(params: {
  orderId: string;
  expectedPaymentStatus?: string;
  note?: string;
  adminId?: string;
}) {
  const currentOrder = await OrderModel.findById(params.orderId).lean();

  if (!currentOrder) {
    throw new AppError(
      StatusCodes.NOT_FOUND,
      "ORDER_NOT_FOUND",
      "Order not found",
    );
  }

  if (currentOrder.paymentMethod !== "Cash") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_COD",
      "Only cash on delivery orders can be marked as collected",
    );
  }

  if (currentOrder.status !== "Delivered") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "ORDER_NOT_DELIVERED",
      "Only delivered COD orders can be marked as collected",
    );
  }

  if (
    params.expectedPaymentStatus &&
    currentOrder.paymentStatus !== params.expectedPaymentStatus
  ) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_PAYMENT_STATUS_CHANGED",
      `Order payment status is already ${currentOrder.paymentStatus}`,
    );
  }

  const now = new Date();
  const updatedOrder = await OrderModel.findOneAndUpdate(
    { _id: currentOrder._id, paymentStatus: currentOrder.paymentStatus },
    {
      $set: {
        paymentStatus: "paid",
        "paymentSnapshot.cashCollected": true,
        "paymentSnapshot.cashCollectedAt": now,
        "paymentSnapshot.cashCollectedByAdminId": params.adminId ?? "",
        "paymentSnapshot.cashCollectionNote": params.note?.trim() ?? "",
      },
      $push: {
        history: {
          status: currentOrder.status,
          actor: "admin",
          note:
            params.note?.trim() ||
            "COD payment marked as collected by admin",
          createdAt: now,
        },
      },
    },
    { new: true },
  );

  if (!updatedOrder) {
    const latestOrder = await OrderModel.findById(params.orderId).lean();
    throw new AppError(
      StatusCodes.CONFLICT,
      "ORDER_PAYMENT_STATUS_CHANGED",
      `Order payment status is already ${latestOrder?.paymentStatus ?? "updated"}`,
    );
  }

  emitSocketEvent("admin:live-map", "admin.live-map.updated", {
    type: "order.cod_collected",
    orderId: updatedOrder.id,
    paymentStatus: updatedOrder.paymentStatus,
  });

  return {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    previousPaymentStatus: currentOrder.paymentStatus,
    paymentStatus: updatedOrder.paymentStatus,
    updatedAt: updatedOrder.updatedAt
      ? new Date(updatedOrder.updatedAt).toISOString()
      : null,
  };
}

function orderAgeMinutes(order: Record<string, any>) {
  const createdAt = order.createdAt ? new Date(order.createdAt).getTime() : 0;
  if (!createdAt || Number.isNaN(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
}

function minutesSince(value: Date | string | null | undefined) {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!timestamp || Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
}

function getRestaurantPrepMinutes(restaurant?: Record<string, any> | null) {
  const value = Number(restaurant?.preparationTimeMinutes);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 20;
}

function buildAdminOrderOperationalTiming(
  order: Record<string, any>,
  restaurant: Record<string, any> | null,
  settings: DispatchSettings,
  riderTracking?: Record<string, any> | null,
) {
  const createdAt = getOrderTimestamp(order, "New");
  const acceptedAt = getOrderTimestamp(order, "Accepted");
  const preparingAt = getOrderTimestamp(order, "Preparing");
  const readyAt = getOrderTimestamp(order, "ReadyForPickup");
  const pickedUpAt = getOrderTimestamp(order, "PickedUp");
  const deliveredAt = getOrderTimestamp(order, "Delivered");
  const averagePreparationMinutes = getRestaurantPrepMinutes(restaurant);
  const status = String(order.status ?? "");

  const base = {
    averagePreparationMinutes,
    currentPhaseLabel: "Order placed",
    primaryLabel: "Waiting for the next status",
    secondaryLabel: "No live timing is available yet.",
    lateByMinutes: 0,
    remainingMinutes: null as number | null,
    targetMinutes: null as number | null,
    targetAt: null as string | null,
  };

  if (status === "New") {
    const orderAgeMinutes = minutesSince(createdAt);
    const remainingMinutes = settings.autoCancelUnacceptedOrdersEnabled
      ? Math.max(0, settings.autoCancelAfterMinutes - orderAgeMinutes)
      : null;
    return {
      ...base,
      currentPhaseLabel: "Awaiting restaurant response",
      primaryLabel:
        orderAgeMinutes > 0
          ? `${orderAgeMinutes} min since order placed`
          : "Placed just now",
      secondaryLabel:
        remainingMinutes !== null
          ? `${remainingMinutes} min until auto-cancel`
          : "Waiting for restaurant acceptance.",
      remainingMinutes,
      targetMinutes: settings.autoCancelAfterMinutes,
      targetAt:
        createdAt && settings.autoCancelUnacceptedOrdersEnabled
          ? new Date(
              createdAt.getTime() + settings.autoCancelAfterMinutes * 60_000,
            ).toISOString()
          : null,
    };
  }

  if (status === "Accepted") {
    const acceptedMinutes = minutesSince(acceptedAt);
    const lateByMinutes = Math.max(
      0,
      acceptedMinutes - settings.prepStartGraceMinutes,
    );
    const remainingMinutes = Math.max(
      0,
      settings.prepStartGraceMinutes - acceptedMinutes,
    );
    return {
      ...base,
      currentPhaseLabel: "Prep not started",
      primaryLabel:
        lateByMinutes > 0
          ? `${lateByMinutes} min late to start prep`
          : `${remainingMinutes} min left to start prep`,
      secondaryLabel: `${acceptedMinutes} min since acceptance`,
      lateByMinutes,
      remainingMinutes,
      targetMinutes: settings.prepStartGraceMinutes,
      targetAt: acceptedAt
        ? new Date(
            acceptedAt.getTime() + settings.prepStartGraceMinutes * 60_000,
          ).toISOString()
        : null,
    };
  }

  if (status === "Preparing") {
    const prepElapsedMinutes = minutesSince(preparingAt);
    const lateByMinutes = Math.max(
      0,
      prepElapsedMinutes - averagePreparationMinutes,
    );
    const remainingMinutes = Math.max(
      0,
      averagePreparationMinutes - prepElapsedMinutes,
    );
    return {
      ...base,
      currentPhaseLabel: "Preparing",
      primaryLabel:
        lateByMinutes > 0
          ? `${lateByMinutes} min behind average prep`
          : `${remainingMinutes} min left by average prep`,
      secondaryLabel: `${prepElapsedMinutes} min already in kitchen`,
      lateByMinutes,
      remainingMinutes,
      targetMinutes: averagePreparationMinutes,
      targetAt: preparingAt
        ? new Date(
            preparingAt.getTime() + averagePreparationMinutes * 60_000,
          ).toISOString()
        : null,
    };
  }

  if (status === "ReadyForPickup") {
    const readyMinutes = minutesSince(readyAt);
    const pickupTargetMinutes = order.riderId
      ? settings.pickupLateGraceMinutes
      : settings.assignmentTimeoutMinutes;
    const lateByMinutes = Math.max(0, readyMinutes - pickupTargetMinutes);
    const remainingMinutes = Math.max(0, pickupTargetMinutes - readyMinutes);
    return {
      ...base,
      currentPhaseLabel: order.riderId
        ? "Waiting for rider pickup"
        : "Waiting for rider assignment",
      primaryLabel:
        lateByMinutes > 0
          ? `${lateByMinutes} min past pickup target`
          : `${remainingMinutes} min before pickup target`,
      secondaryLabel: `${readyMinutes} min since marked ready`,
      lateByMinutes,
      remainingMinutes,
      targetMinutes: pickupTargetMinutes,
      targetAt: readyAt
        ? new Date(readyAt.getTime() + pickupTargetMinutes * 60_000).toISOString()
        : null,
    };
  }

  if (status === "PickedUp") {
    const pickedUpMinutes = minutesSince(pickedUpAt);
    const travelTargetMinutes = settings.deliveryLateGraceMinutes;
    const lateByMinutes = Math.max(0, pickedUpMinutes - travelTargetMinutes);
    const remainingMinutes =
      typeof riderTracking?.remainingDurationMinutes === "number"
        ? Math.max(0, Math.round(riderTracking.remainingDurationMinutes))
        : Math.max(0, travelTargetMinutes - pickedUpMinutes);
    return {
      ...base,
      currentPhaseLabel: "On the way to customer",
      primaryLabel:
        lateByMinutes > 0
          ? `${lateByMinutes} min beyond delivery target`
          : `${remainingMinutes} min left on the road`,
      secondaryLabel: `${pickedUpMinutes} min since pickup`,
      lateByMinutes,
      remainingMinutes,
      targetMinutes: travelTargetMinutes,
      targetAt: pickedUpAt
        ? new Date(
            pickedUpAt.getTime() + travelTargetMinutes * 60_000,
          ).toISOString()
        : null,
    };
  }

  if (status === "Delivered") {
    const preparationMinutes = minutesBetween(preparingAt ?? acceptedAt, readyAt);
    const deliveryMinutes = minutesBetween(pickedUpAt ?? readyAt, deliveredAt);
    return {
      ...base,
      currentPhaseLabel: "Delivered",
      primaryLabel:
        deliveryMinutes !== null
          ? `Delivered in ${deliveryMinutes} min after dispatch`
          : "Order completed",
      secondaryLabel:
        preparationMinutes !== null
          ? `${preparationMinutes} min kitchen time`
          : "Completed successfully",
      lateByMinutes: 0,
      remainingMinutes: 0,
      targetMinutes: averagePreparationMinutes,
      targetAt: deliveredAt ? new Date(deliveredAt).toISOString() : null,
    };
  }

  return base;
}

function buildOrderAutoCancelSnapshot(
  order: Record<string, any>,
  settings: DispatchSettings,
) {
  const createdAt = order.createdAt ? new Date(order.createdAt).getTime() : 0;
  const applies =
    Boolean(settings.autoCancelUnacceptedOrdersEnabled) &&
    order.status === "New" &&
    createdAt > 0 &&
    !Number.isNaN(createdAt);
  const autoCancelAt = applies
    ? new Date(createdAt + settings.autoCancelAfterMinutes * 60_000)
    : null;

  return {
    enabled: settings.autoCancelUnacceptedOrdersEnabled,
    applies,
    autoCancelAfterMinutes: settings.autoCancelAfterMinutes,
    notifyBeforeMinutes: settings.autoCancelNotifyBeforeMinutes,
    autoCancelAt: autoCancelAt ? autoCancelAt.toISOString() : null,
    remainingSeconds: autoCancelAt
      ? Math.max(0, Math.ceil((autoCancelAt.getTime() - Date.now()) / 1000))
      : null,
  };
}

async function emitOrderRealtimeUpdates(order: Record<string, any>) {
  const restaurantId = String(order.restaurantId ?? "");
  const owner = restaurantId
    ? await OwnerModel.findOne({ activeRestaurantId: restaurantId }, { _id: 1 }).lean()
    : null;

  if (owner?._id) emitSocketEvent(`owner:${owner._id.toString()}`, "order.updated", order);
  if (restaurantId) emitSocketEvent(`restaurant:${restaurantId}`, "order.updated", order);
  if (order.customerId) emitSocketEvent(`customer:${order.customerId}`, "customer.order.updated", order);
  if (order.riderId) emitSocketEvent(`rider:${order.riderId}`, "rider.order.updated", order);
  emitSocketEvent("admin:ops", "admin.order.updated", {
    orderId: String(order._id ?? ""),
    orderNumber: String(order.orderNumber ?? ""),
    status: String(order.status ?? ""),
    path: `/orders?orderId=${String(order._id ?? "")}`,
  });
}

async function createOwnerSystemNotification(params: {
  restaurantId: string;
  entityId: string;
  title: string;
  description: string;
  actionPath: string;
}) {
  const owner = await OwnerModel.findOne(
    { activeRestaurantId: params.restaurantId },
    { _id: 1 },
  ).lean();

  if (!owner?._id) {
    return;
  }

  const notification = await NotificationModel.create({
    ownerId: owner._id,
    restaurantId: params.restaurantId,
    type: "order",
    eventType: "order.auto_cancelled",
    entityType: "order",
    entityId: params.entityId,
    title: params.title,
    description: params.description,
    actionPath: params.actionPath,
  });

  emitSocketEvent(`owner:${owner._id.toString()}`, "notification.created", notification.toObject());
}

export async function processAdminOperationalAlerts() {
  const settings = getDispatchSettingsFromContent(await getPlatformContent());
  const liveOrders = await OrderModel.find({
    status: { $in: ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"] },
  })
    .sort({ createdAt: 1 })
    .limit(250)
    .lean();
  const restaurantIds = [
    ...new Set(
      liveOrders
        .map((order) => String(order.restaurantId ?? ""))
        .filter(Boolean),
    ),
  ];
  const restaurants = restaurantIds.length
    ? await RestaurantModel.find({ _id: { $in: restaurantIds } }).lean()
    : [];
  const restaurantById = new Map(
    restaurants.map((restaurant) => [String(restaurant._id ?? ""), restaurant]),
  );

  for (const order of liveOrders) {
    const orderId = String(order._id ?? "");
    const orderNumber = String(order.orderNumber ?? "Order");
    const ageMinutes = orderAgeMinutes(order);
    const restaurant = restaurantById.get(String(order.restaurantId ?? ""));
    const restaurantName = String(restaurant?.name ?? "Restaurant");
    const path = `/orders?orderId=${orderId}`;

    if (order.status === "New") {
      const notifyAt = Math.max(
        1,
        settings.autoCancelAfterMinutes - settings.autoCancelNotifyBeforeMinutes,
      );

      if (
        settings.autoCancelUnacceptedOrdersEnabled &&
        ageMinutes >= settings.autoCancelAfterMinutes
      ) {
        const cancelledAt = new Date();
        const result = await OrderModel.updateOne(
          { _id: order._id, status: "New" },
          {
            $set: {
              status: "Cancelled",
              cancelledBy: "system",
              terminalReason: "system_auto_cancel_unaccepted",
              timestamps: applyOrderStatusTimestamp(
                order.timestamps as Record<string, unknown> | undefined,
                "Cancelled",
                cancelledAt,
              ),
            },
            $push: {
              history: {
                status: "Cancelled",
                actor: "system",
                note: "Auto-cancelled because the restaurant did not accept in time.",
                createdAt: cancelledAt,
              },
            },
          },
        );

        if (result.modifiedCount > 0) {
          const cancelledOrder = await OrderModel.findById(order._id).lean();
          if (cancelledOrder) {
            await emitOrderRealtimeUpdates(cancelledOrder);
            try {
              await createOwnerSystemNotification({
                restaurantId: String(cancelledOrder.restaurantId ?? ""),
                entityId: orderId,
                title: "Order auto-cancelled",
                description: `${orderNumber} was auto-cancelled because it was not accepted in time.`,
                actionPath: `/orders?order=${orderId}`,
              });
            } catch {
              // Auto-cancel state is already committed; notification persistence is best-effort.
            }
            if (cancelledOrder.customerId) {
              await safeSendCustomerOrderStatusPush({
                customerId: String(cancelledOrder.customerId),
                orderId,
                orderNumber,
                nextStatus: "Cancelled",
              });
            }
          }
          await createAdminOperationalAlert({
            alertType: "order_auto_cancelled",
            severity: "critical",
            title: `${orderNumber} auto-cancelled`,
            description: "Restaurant did not accept the order before the configured auto-cancel window.",
            source: "Orders",
            entityType: "order",
            entityId: orderId,
            path,
            iconKey: "x-circle",
            dedupeKey: `order:${orderId}:auto_cancelled`,
            metadata: { orderId, orderNumber, ageMinutes },
          });
          await recordBusinessEvent({
            event: "order.auto_cancelled",
            category: "orders",
            severity: "critical",
            title: "Order auto-cancelled",
            description: `${orderNumber} was cancelled because the restaurant did not accept in time.`,
            entityType: "order",
            entityId: orderId,
            metadata: {
              orderNumber,
              restaurantId: String(order.restaurantId ?? ""),
              customerId: String(order.customerId ?? ""),
              ageMinutes,
              autoCancelAfterMinutes: settings.autoCancelAfterMinutes,
            },
          });
        }
        continue;
      }

      if (settings.autoCancelUnacceptedOrdersEnabled && ageMinutes >= notifyAt) {
        await createAdminOperationalAlert({
          alertType: "order_auto_cancel_warning",
          severity: "critical",
          title: `${orderNumber} will auto-cancel soon`,
          description: `Restaurant has not accepted this order. Auto-cancel is configured at ${settings.autoCancelAfterMinutes} minutes.`,
          source: "Orders",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "timer",
          dedupeKey: `order:${orderId}:auto_cancel_warning`,
          metadata: { orderId, orderNumber, ageMinutes },
        });
      } else if (ageMinutes >= settings.ownerAcceptanceTimeoutMinutes) {
        await createAdminOperationalAlert({
          alertType: "owner_response_late",
          severity: "warning",
          title: `${orderNumber} waiting for restaurant`,
          description: `Restaurant has not accepted after ${ageMinutes} minutes.`,
          source: "Orders",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "store",
          dedupeKey: `order:${orderId}:owner_response_late`,
          metadata: { orderId, orderNumber, ageMinutes },
        });
      }
    }

    if (order.status === "Accepted") {
      const acceptedAt = getOrderTimestamp(order, "Accepted");
      const acceptedMinutes = minutesSince(acceptedAt);
      const lateByMinutes = Math.max(0, acceptedMinutes - settings.prepStartGraceMinutes);
      if (lateByMinutes > 0) {
        await createAdminOperationalAlert({
          alertType: "prep_start_late",
          severity: lateByMinutes >= 10 ? "critical" : "warning",
          title: `${orderNumber} prep has not started`,
          description: `${restaurantName} accepted this order ${acceptedMinutes} minutes ago. Prep start is ${lateByMinutes} minutes late against the ${settings.prepStartGraceMinutes}-minute grace window.`,
          source: "Orders",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "clock",
          dedupeKey: `order:${orderId}:prep_start_late`,
          metadata: {
            orderId,
            orderNumber,
            restaurantName,
            acceptedMinutes,
            expectedStartMinutes: settings.prepStartGraceMinutes,
            lateByMinutes,
          },
        });
      }
    }

    if (order.status === "Preparing") {
      const preparingAt = getOrderTimestamp(order, "Preparing");
      const prepElapsedMinutes = minutesSince(preparingAt);
      const expectedPrepMinutes = getRestaurantPrepMinutes(restaurant);
      const lateByMinutes = Math.max(0, prepElapsedMinutes - expectedPrepMinutes);
      if (lateByMinutes >= settings.prepLateGraceMinutes) {
        await createAdminOperationalAlert({
          alertType: "food_prepare_late",
          severity: lateByMinutes >= 15 ? "critical" : "warning",
          title: `${orderNumber} food prep late`,
          description: `${restaurantName} has been preparing for ${prepElapsedMinutes} minutes. Expected prep time is ${expectedPrepMinutes} minutes, so it is ${lateByMinutes} minutes late.`,
          source: "Orders",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "utensils",
          dedupeKey: `order:${orderId}:food_prepare_late`,
          metadata: {
            orderId,
            orderNumber,
            restaurantName,
            prepElapsedMinutes,
            expectedPrepMinutes,
            prepLateGraceMinutes: settings.prepLateGraceMinutes,
            lateByMinutes,
          },
        });
      }
    }

    if (order.status === "ReadyForPickup" && !order.riderId) {
      const readyAt = getOrderTimestamp(order, "ReadyForPickup");
      const readyMinutes = minutesSince(readyAt);
      const lateByMinutes = Math.max(0, readyMinutes - settings.assignmentTimeoutMinutes);
      if (lateByMinutes > 0) {
        await createAdminOperationalAlert({
          alertType: "rider_assignment_late",
          severity: lateByMinutes >= 10 ? "critical" : "warning",
          title: `${orderNumber} rider not assigned`,
          description: `Order has been ready for ${readyMinutes} minutes. Rider assignment is ${lateByMinutes} minutes late against the ${settings.assignmentTimeoutMinutes}-minute assignment timeout.`,
          source: "Delivery",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "truck",
          dedupeKey: `order:${orderId}:rider_assignment_late`,
          metadata: {
            orderId,
            orderNumber,
            readyMinutes,
            assignmentTimeoutMinutes: settings.assignmentTimeoutMinutes,
            lateByMinutes,
          },
        });
      }
    }

    if (
      order.status === "ReadyForPickup" &&
      getAssignmentAcknowledgementState(order, settings) === "timed_out"
    ) {
      const dispatchMeta = getDispatchMeta(order);
      const assignedAt = dispatchMeta.assignedAt ?? getReadyForPickupAt(order);
      const assignedMinutes = minutesSince(assignedAt);
      const lateByMinutes = Math.max(0, assignedMinutes - settings.assignmentTimeoutMinutes);
      await createAdminOperationalAlert({
        alertType: "rider_response_late",
        severity: "warning",
        title: `${orderNumber} rider response late`,
        description: `Assigned rider has not acknowledged pickup for ${assignedMinutes} minutes. Response is ${lateByMinutes} minutes late against the ${settings.assignmentTimeoutMinutes}-minute timeout.`,
        source: "Delivery",
        entityType: "order",
        entityId: orderId,
        path,
        iconKey: "truck",
        dedupeKey: `order:${orderId}:rider_response_late`,
        metadata: {
          orderId,
          orderNumber,
          assignedMinutes,
          assignmentTimeoutMinutes: settings.assignmentTimeoutMinutes,
          lateByMinutes,
        },
      });
    }

    if (order.status === "ReadyForPickup" && order.riderId) {
      const readyAt = getOrderTimestamp(order, "ReadyForPickup");
      const readyMinutes = minutesSince(readyAt);
      const lateByMinutes = Math.max(0, readyMinutes - settings.pickupLateGraceMinutes);
      if (lateByMinutes > 0) {
        await createAdminOperationalAlert({
          alertType: "rider_pickup_late",
          severity: lateByMinutes >= 10 ? "critical" : "warning",
          title: `${orderNumber} pickup late`,
          description: `Rider has not picked up this ready order for ${readyMinutes} minutes. Pickup is ${lateByMinutes} minutes late against the ${settings.pickupLateGraceMinutes}-minute pickup window.`,
          source: "Delivery",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "truck",
          dedupeKey: `order:${orderId}:rider_pickup_late`,
          metadata: {
            orderId,
            orderNumber,
            readyMinutes,
            pickupLateGraceMinutes: settings.pickupLateGraceMinutes,
            lateByMinutes,
          },
        });
      }
    }

    if (order.status === "PickedUp") {
      const tracking = decorateTrackingSnapshot(order.riderTracking ?? {}, order.status ?? "");
      if (tracking.freshness?.state === "stale") {
        await createAdminOperationalAlert({
          alertType: "rider_tracking_stale",
          severity: "warning",
          title: `${orderNumber} rider tracking stale`,
          description: "Rider location has not updated within the configured freshness window.",
          source: "Delivery",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "map-pin",
          dedupeKey: `order:${orderId}:rider_tracking_stale`,
          metadata: { orderId, orderNumber },
        });
      }

      const remainingMinutes = Number((order.riderTracking as Record<string, any> | undefined)?.remainingDurationMinutes ?? 0);
      const pickedUpAt = order.timestamps?.PickedUp || order.timestamps?.pickedUpAt;
      const pickupMinutes = pickedUpAt
        ? Math.floor((Date.now() - new Date(pickedUpAt).getTime()) / 60000)
        : 0;
      if (remainingMinutes > 0 && pickupMinutes > remainingMinutes + settings.deliveryLateGraceMinutes) {
        const lateByMinutes = Math.max(0, pickupMinutes - remainingMinutes);
        await createAdminOperationalAlert({
          alertType: "delivery_eta_exceeded",
          severity: "critical",
          title: `${orderNumber} delivery ETA exceeded`,
          description: `Rider has been out for ${pickupMinutes} minutes. Current ETA is ${remainingMinutes} minutes, so delivery is ${lateByMinutes} minutes beyond the ETA baseline.`,
          source: "Delivery",
          entityType: "order",
          entityId: orderId,
          path,
          iconKey: "clock",
          dedupeKey: `order:${orderId}:delivery_eta_exceeded`,
          metadata: {
            orderId,
            orderNumber,
            pickupMinutes,
            remainingMinutes,
            deliveryLateGraceMinutes: settings.deliveryLateGraceMinutes,
            lateByMinutes,
          },
        });
      }
    }
  }
}
