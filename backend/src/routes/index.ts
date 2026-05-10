import { Router } from "express";

import { adminAuthRouter } from "../modules/admin/admin.routes";
import { adminAccountRequestRouter } from "../modules/admin/account-request.routes";
import { adminCategoriesRouter } from "../modules/admin/categories.routes";
import { adminCustomerAnalyticsRouter } from "../modules/admin/customer-analytics.routes";
import { adminCustomersRouter } from "../modules/admin/customers.routes";
import { adminOrdersMonitorRouter } from "../modules/admin/orders-monitor.routes";
import { adminNotificationsRouter } from "../modules/admin/notifications.routes";
import { adminOperationsHealthRouter } from "../modules/admin/operations-health.routes";
import { adminPlatformContentRouter } from "../modules/admin/platform-content.routes";
import { adminReviewRouter } from "../modules/admin/review.routes";
import { adminReportsRouter } from "../modules/admin/reports.routes";
import { adminRestaurantsRouter } from "../modules/admin/restaurants.routes";
import { adminSupportRouter } from "../modules/admin/support.routes";
import { authRouter } from "../modules/auth/auth.routes";
import { customerRouter } from "../modules/customer/customer.routes";
import { healthRouter } from "../modules/health/health.routes";
import { mediaRouter } from "../modules/media/media.routes";
import { ownerRouter } from "../modules/owner/owner.routes";
import { publicRouter } from "../modules/public/public.routes";
import {
  adminPromotionsRouter,
  ownerPromotionsRouter,
} from "../modules/promotions/promotions.routes";
import { riderRouter } from "../modules/rider/rider.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/customer", customerRouter);
apiRouter.use("/rider", riderRouter);
apiRouter.use("/public", publicRouter);
apiRouter.use("/owner", ownerRouter);
apiRouter.use("/owner", ownerPromotionsRouter);
apiRouter.use("/admin/auth", adminAuthRouter);
apiRouter.use("/admin", adminAccountRequestRouter);
apiRouter.use("/admin", adminCategoriesRouter);
apiRouter.use("/admin", adminCustomerAnalyticsRouter);
apiRouter.use("/admin", adminCustomersRouter);
apiRouter.use("/admin", adminOrdersMonitorRouter);
apiRouter.use("/admin", adminNotificationsRouter);
apiRouter.use("/admin", adminOperationsHealthRouter);
apiRouter.use("/admin", adminPlatformContentRouter);
apiRouter.use("/admin", adminReviewRouter);
apiRouter.use("/admin", adminReportsRouter);
apiRouter.use("/admin", adminRestaurantsRouter);
apiRouter.use("/admin", adminSupportRouter);
apiRouter.use("/admin", adminPromotionsRouter);
apiRouter.use("/media", mediaRouter);
