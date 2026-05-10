import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/async-handler";
import { sendSuccess } from "../../common/utils/api-response";
import {
  getAdminCustomerDetails,
  listAdminCustomerOrders,
  listAdminCustomers,
  updateAdminCustomerStatus,
} from "./customers.service";

const listCustomersQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["all", "active", "suspended", "locked"]).optional(),
  requestStatus: z
    .enum(["all", "pending", "cancelled", "reviewed", "completed", "none"])
    .optional(),
  sortBy: z.enum(["newest", "recentLogin", "mostOrders", "highestSpend"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const detailsQuerySchema = z.object({
  preset: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const listCustomerOrdersQuerySchema = detailsQuerySchema.extend({
  restaurantId: z.string().optional(),
  status: z.enum(["all", "live", "delivered", "cancelled"]).optional(),
  search: z.string().optional(),
  sortBy: z.enum(["newest", "oldest", "highestValue"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const statusSchema = z.object({
  status: z.enum(["active", "suspended", "locked"]),
  note: z.string().trim().optional(),
});

function getStringParam(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getAdminId(req: AuthenticatedRequest) {
  return req.user?.id ?? "";
}

export const getAdminCustomers = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = listCustomersQuerySchema.parse(req.query);
    const data = await listAdminCustomers(query);

    return sendSuccess(res, { data });
  },
);

export const getAdminCustomer = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = detailsQuerySchema.parse(req.query);
    const data = await getAdminCustomerDetails(
      getStringParam(req.params.customerId),
      query,
    );

    return sendSuccess(res, { data });
  },
);

export const getAdminCustomerOrders = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = listCustomerOrdersQuerySchema.parse(req.query);
    const data = await listAdminCustomerOrders(
      getStringParam(req.params.customerId),
      query,
    );

    return sendSuccess(res, { data });
  },
);

export const patchAdminCustomerStatus = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = statusSchema.parse(req.body);
    const data = await updateAdminCustomerStatus({
      customerId: getStringParam(req.params.customerId),
      status: payload.status,
      note: payload.note,
      adminId: getAdminId(req),
    });

    return sendSuccess(res, {
      message: "Customer status updated",
      data,
    });
  },
);
