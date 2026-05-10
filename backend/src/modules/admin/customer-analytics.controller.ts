import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../common/middleware/auth";
import { sendSuccess } from "../../common/utils/api-response";
import { asyncHandler } from "../../common/utils/async-handler";
import { getCustomerAnalyticsSummary } from "./customer-analytics.service";

const analyticsQuerySchema = z.object({
  preset: z
    .enum(["today", "yesterday", "last7Days", "last30Days", "last90Days", "custom"])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(5).max(100).optional(),
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
    });
    const data = await getCustomerAnalyticsSummary(query);

    return sendSuccess(res, { data });
  }
);
