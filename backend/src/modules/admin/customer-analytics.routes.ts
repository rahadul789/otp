import { Router } from "express";

import { requireAuth, requireRole } from "../../common/middleware/auth";
import { getCustomerAnalyticsSummaryController } from "./customer-analytics.controller";

export const adminCustomerAnalyticsRouter = Router();

adminCustomerAnalyticsRouter.use(requireAuth, requireRole("admin"));
adminCustomerAnalyticsRouter.get(
  "/customer-analytics",
  getCustomerAnalyticsSummaryController
);
