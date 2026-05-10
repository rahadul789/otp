import { Router } from "express";

import { requireAuth, requireRole } from "../../common/middleware/auth";
import {
  getAdminCustomer,
  getAdminCustomerOrders,
  getAdminCustomers,
  patchAdminCustomerStatus,
} from "./customers.controller";

export const adminCustomersRouter = Router();

adminCustomersRouter.use(requireAuth, requireRole("admin"));

adminCustomersRouter.get("/customers", getAdminCustomers);
adminCustomersRouter.get("/customers/:customerId", getAdminCustomer);
adminCustomersRouter.get("/customers/:customerId/orders", getAdminCustomerOrders);
adminCustomersRouter.patch("/customers/:customerId/status", patchAdminCustomerStatus);
