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
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  CUSTOMER_APP: z.string().default("http://192.168.1.11:8081"),
  DELIVERY_APP: z.string().default("http://192.168.1.11:8082"),
  ADMIN_PANEL_ORIGIN: z.string().default("http://localhost:5174"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default("admin@foodbela.com"),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(6).default("Admin@123456"),
  ADMIN_BOOTSTRAP_NAME: z.string().default("Foodbela Admin"),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),
  BACKEND_PUBLIC_URL: z.string().url().default("http://localhost:5000"),
  BKASH_BASE_URL: z.string().optional(),
  BKASH_USERNAME: z.string().optional(),
  BKASH_PASSWORD: z.string().optional(),
  BKASH_APP_KEY: z.string().optional(),
  BKASH_APP_SECRET: z.string().optional(),
  MOCK_OTP_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  MOCK_OTP_CODE: z.string().length(6).default("123456"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Environment validation failed:\n${issues}`);
}

export const env = parsed.data;
