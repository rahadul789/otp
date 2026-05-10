import { Router } from "express"

import { requireAuth, requireRole } from "../../common/middleware/auth"
import { deleteMediaAsset, postMediaUploadSignature } from "../owner/business.controller"

export const mediaRouter = Router()

mediaRouter.use(requireAuth, requireRole("owner", "admin", "customer"))

mediaRouter.post("/upload-signature", postMediaUploadSignature)
mediaRouter.post("/delete", deleteMediaAsset)
