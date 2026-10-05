/**
 * Zod-validated server environment.
 *
 * All environment variables are validated at startup.
 * Business modules must import from here — never use process.env directly
 * (AGENTS.md §41).
 *
 * Usage:
 *   import { serverEnv } from "@marketplace/env";
 *   const db = initDb(serverEnv.DATABASE_URL);
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  // ---- Runtime -----------------------------------------------------------
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  // ---- Database ----------------------------------------------------------
  DATABASE_URL: z.string().url(),
  PG_BOSS_DATABASE_URL: z.string().url().optional(),

  // ---- Redis -------------------------------------------------------------
  REDIS_URL: z.string().url(),

  // ---- Authentication ----------------------------------------------------
  JWT_SECRET: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  // ---- AI / OpenAI -------------------------------------------------------
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  // ---- Payments ----------------------------------------------------------
  PAYMENT_PROVIDER: z
    .enum(["cod", "stripe", "paystack"])
    .default("cod"),
  PAYMENT_SECRET_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),

  // ---- Object Storage (S3-compatible) ------------------------------------
  // Provider: "minio" for local dev, "r2" for Cloudflare R2 in production.
  // Both use AWS SDK v3 S3 client — only the endpoint/credentials differ.
  STORAGE_PROVIDER: z.enum(["minio", "r2", "s3"]).default("minio"),
  STORAGE_ENDPOINT: z.string().url().default("http://localhost:9000"),
  STORAGE_BUCKET: z.string().default("marketplace"),
  STORAGE_REGION: z.string().default("us-east-1"),      // R2 uses "auto", S3 uses real region
  STORAGE_ACCESS_KEY: z.string().default("minioadmin"),
  STORAGE_SECRET_KEY: z.string().default("minioadmin"),
  // Public CDN base URL for constructing file URLs returned to clients.
  // MinIO local: http://localhost:9000/marketplace
  // R2 production: https://<account>.r2.cloudflarestorage.com/marketplace  (or custom domain)
  STORAGE_PUBLIC_URL: z.string().url().default("http://localhost:9000/marketplace"),
  // Max upload size in bytes (default 10 MB)
  STORAGE_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  // ---- Logging -----------------------------------------------------------
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  LOG_PRETTY: z.coerce.boolean().default(false),

  // ---- Rate Limiting -----------------------------------------------------
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

  // ---- Google OAuth (optional — OAuth disabled if not set) ---------------
  GOOGLE_CLIENT_ID:     z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI:  z.string().url().optional(),
  // Base URL of the React frontend — used to construct OAuth callback redirects
  FRONTEND_URL:         z.string().url().default("http://localhost:3001"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates and returns the server environment.
 * Throws a descriptive error if any required variable is missing or invalid.
 */
export function parseServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${issues}\n\nCheck your .env file against .env.example`,
    );
  }
  return result.data;
}

export { serverEnvSchema };

/**
 * Validated server environment — parsed once at module load time.
 * All variables are available immediately after import.
 */
export const serverEnv: ServerEnv = parseServerEnv();
