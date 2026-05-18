import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../common/middleware/auth";
import { sendSuccess } from "../../common/utils/api-response";
import { asyncHandler } from "../../common/utils/async-handler";
import {
  getCustomerAnalyticsActorDetail,
  getCustomerAnalyticsSummary,
} from "./customer-analytics.service";

const analyticsQuerySchema = z.object({
  preset: z
    .enum([
      "today",
      "yesterday",
      "last7Days",
      "last30Days",
      "last90Days",
      "thisMonth",
      "lastMonth",
      "lifetime",
      "custom",
    ])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(5).max(100).optional(),
  detail: z.enum(["summary", "full"]).optional(),
  section: z
    .enum([
      "overview",
      "graphs",
      "funnels",
      "customers",
      "abandoned",
      "payments",
      "events",
      "all",
    ])
    .optional(),
});

const analyticsActorDetailQuerySchema = analyticsQuerySchema
  .pick({
    preset: true,
    from: true,
    to: true,
    limit: true,
  })
  .extend({
    customerId: z.string().optional(),
    anonymousId: z.string().optional(),
  })
  .refine((query) => query.customerId || query.anonymousId, {
    message: "customerId or anonymousId is required",
  });

function getStringParam(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return "";
}

function getOptionalStringParam(value: unknown) {
  const normalized = getStringParam(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

export const getCustomerAnalyticsSummaryController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = analyticsQuerySchema.parse({
      preset: getOptionalStringParam(req.query.preset),
      from: getOptionalStringParam(req.query.from),
      to: getOptionalStringParam(req.query.to),
      limit: getOptionalStringParam(req.query.limit),
      detail: getOptionalStringParam(req.query.detail),
      section: getOptionalStringParam(req.query.section),
    });
    const data = await getCustomerAnalyticsSummary(query);

    return sendSuccess(res, { data });
  }
);

export const getCustomerAnalyticsActorDetailController = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = analyticsActorDetailQuerySchema.parse({
      preset: getOptionalStringParam(req.query.preset),
      from: getOptionalStringParam(req.query.from),
      to: getOptionalStringParam(req.query.to),
      limit: getOptionalStringParam(req.query.limit),
      customerId: getOptionalStringParam(req.query.customerId),
      anonymousId: getOptionalStringParam(req.query.anonymousId),
    });
    const data = await getCustomerAnalyticsActorDetail(query);

    return sendSuccess(res, { data });
  }
);
