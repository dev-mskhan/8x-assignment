/**
 * Centralized Pino logger with secret redaction.
 *
 * Usage:
 *   import { createLogger } from "@/core/logger/logger";
 *   const logger = createLogger("orders");
 *   logger.info({ orderId }, "Order created");
 *
 * Redacted fields (never appear in logs, AGENTS.md §40):
 *   password, passwordHash, token, accessToken, refreshToken,
 *   sessionSecret, jwtSecret, cookieSecret, authorization,
 *   cookie, apiKey, paymentSecret, webhookSecret, cardNumber, cvv
 *
 * Implemented in Phase 1.
 */
import type { Logger } from "pino";

/** Fields that must never appear in log output */
export const REDACTED_FIELDS = [
  "password",
  "passwordHash",
  "hashedPassword",
  "token",
  "accessToken",
  "refreshToken",
  "sessionSecret",
  "jwtSecret",
  "cookieSecret",
  "authorization",
  "cookie",
  "apiKey",
  "openaiApiKey",
  "paymentSecret",
  "webhookSecret",
  "secretKey",
  "cardNumber",
  "cvv",
  "cvc",
];

let _rootLogger: Logger | null = null;

/**
 * Returns a child logger scoped to the given module name.
 * Must call initLogger() during startup before using.
 *
 * TODO: Phase 1 — implement with Pino
 */
export function createLogger(module: string): Logger {
  if (!_rootLogger) {
    throw new Error("Logger not initialized. Call initLogger() during startup.");
  }
  return _rootLogger.child({ module });
}

/**
 * Initializes the root Pino logger.
 * Called once during startup before any other initialization.
 *
 * TODO: Phase 1 — implement
 */
export function initLogger(_options?: { level?: string; pretty?: boolean }): void {
  // TODO: Phase 1
}
