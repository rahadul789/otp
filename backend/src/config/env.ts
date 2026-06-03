import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default("/api/v1"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(50),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).default(5),
  DB_STARTUP_MAINTENANCE_ENABLED: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? process.env.NODE_ENV !== "production"
        : value !== "false",
    ),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  CUSTOMER_APP: z.string().default("http://192.168.1.2:8081"),
  DELIVERY_APP: z.string().default("http://192.168.1.2:8082"),
  RESTAURANT_APP: z.string().default("http://192.168.1.2:8083"),
  ADMIN_PANEL_ORIGIN: z.string().default("http://localhost:5174"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("3650d"),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default("admin@foodbela.com"),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(6).default("Admin@123456"),
  ADMIN_BOOTSTRAP_NAME: z.string().default("Foodbela Admin"),
  ADMIN_BOOTSTRAP_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_AUTH_COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  OWNER_AUTH_COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  OWNER_AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),
  BACKEND_PUBLIC_URL: z.string().url().default("http://localhost:5000"),
  BKASH_BASE_URL: z.string().optional(),
  BKASH_USERNAME: z.string().optional(),
  BKASH_PASSWORD: z.string().optional(),
  BKASH_APP_KEY: z.string().optional(),
  BKASH_APP_SECRET: z.string().optional(),
  METRICS_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  METRICS_PATH: z.string().default("/metrics"),
  METRICS_AUTH_TOKEN: z.string().optional(),
  RATE_LIMIT_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  SERVICE_AREAS_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  MOCK_OTP_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  MOCK_OTP_CODE: z
    .string()
    .regex(/^\d{4,6}$/)
    .default("123456"),
  OTP_EXPIRY_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
  SMS_API_URL: z.string().url().default("https://api.sms.net.bd/sendsms"),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Environment validation failed:\n${issues}`);
}

export const env = parsed.data;
