import type { NextFunction, Request, Response } from "express"
import { StatusCodes } from "http-status-codes"
import { ZodError } from "zod"

import { logger } from "../../config/logger"
import { AppError } from "../utils/app-error"

export function errorHandlerMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "Validation failed",
      error: {
        code: "VALIDATION_ERROR",
        fields: Object.fromEntries(
          error.issues.map((issue) => [issue.path.join("."), issue.message])
        )
      }
    })
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: {
        code: error.code,
        details: error.details
      }
    })
  }

  logger.error(error)

  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: "Internal server error",
    error: {
      code: "INTERNAL_SERVER_ERROR"
    }
  })
}
