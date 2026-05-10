import { Router } from "express";

import { requireAuth, requireRole } from "../../common/middleware/auth";
import {
  getAdminOperationalHealth,
  patchAdminOperationalAlertResolve,
  patchAdminOperationalAlertSnooze,
} from "./operations-health.controller";

export const adminOperationsHealthRouter = Router();

adminOperationsHealthRouter.use(requireAuth, requireRole("admin"));
adminOperationsHealthRouter.get("/operations/health", getAdminOperationalHealth);
adminOperationsHealthRouter.patch(
  "/operations/alerts/:alertId/resolve",
  patchAdminOperationalAlertResolve,
);
adminOperationsHealthRouter.patch(
  "/operations/alerts/:alertId/snooze",
  patchAdminOperationalAlertSnooze,
);
