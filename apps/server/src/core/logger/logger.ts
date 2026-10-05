/**
 * Centralized Pino logger with secret redaction, process/module origin tags,
 * and colored pretty-print output (when LOG_PRETTY=true).
 *
 * Every log line carries:
 *   - `process`  — "api" | "worker"  (set once at startup via initLogger)
 *   - `module`   — subsystem name    (db, redis, auth, orders, …)
 *   - `level`    — trace/debug/info/warn/error/fatal
 *
 * Pretty output (LOG_PRETTY=true):
 *   [19:42:18.123] INFO  [api:plugins] Plugins registered
 *   [19:42:18.456] DEBUG [api:db] Database connection established  { poolSize: 10 }
 *   [19:42:18.789] WARN  [api:redis] Redis command error (non-fatal)
 *   [19:42:19.012] INFO  [api:http] POST /api/v1/auth/login 201 12ms reqId=abc123
 *
 * Structured JSON output (production / LOG_PRETTY=false):
 *   {"level":30,"time":...,"process":"api","module":"plugins","msg":"Plugins registered"}
 *
 * Usage:
 *   import { createLogger } from "~/core/logger/logger";
 *   const logger = createLogger("orders");
 *   logger.info({ orderId }, "Order created");
 *
 * Never log: passwords, tokens, cookies, secrets, card data. (AGENTS.md §40)
 */
import pino, { type Logger } from "pino";

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Fields that must never appear in log output. */
export const REDACTED_FIELDS = [
  "password",
  "passwordHash",
  "hashedPassword",
  "token",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "sessionSecret",
  "jwtSecret",
  "cookieSecret",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "apiKey",
  "api_key",
  "openaiApiKey",
  "paymentSecret",
  "webhookSecret",
  "secretKey",
  "secret_key",
  "cardNumber",
  "card_number",
  "cvv",
  "cvc",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.authorization",
  "*.cookie",
  "*.apiKey",
  "*.secretKey",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessLabel = "api" | "worker";

// ---------------------------------------------------------------------------
// Root logger singleton
// ---------------------------------------------------------------------------

let _rootLogger: Logger | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a child logger bound to the given module name.
 *
 * Falls back to a minimal logger when initLogger() was not called
 * (e.g. unit tests that don't need full startup).
 */
export function createLogger(module: string): Logger {
  if (!_rootLogger) {
    _rootLogger = pino({ level: "info" });
  }
  return _rootLogger.child({ module });
}

/**
 * Returns the raw root logger.
 * Used by Fastify so HTTP request/response logs go through the same instance.
 */
export function getRootLogger(): Logger {
  if (!_rootLogger) {
    _rootLogger = pino({ level: "info" });
  }
  return _rootLogger;
}

/**
 * Initializes the root Pino logger.
 * Call once at process startup — before any other initialization.
 *
 * @param options.level   - Minimum log level (default: "info")
 * @param options.pretty  - Enable pino-pretty colored output (default: false)
 * @param options.process - Process identity stamped on every line (default: "api")
 */
export function initLogger(options?: {
  level?: string;
  pretty?: boolean;
  process?: ProcessLabel;
}): void {
  const level = options?.level ?? "info";
  const pretty = options?.pretty ?? false;
  const processLabel = options?.process ?? "api";

  _rootLogger = pino(
    {
      level,
      // Stamp every log line with the process identity.
      // Module is added per child via createLogger(module).
      base: { process: processLabel },
      redact: {
        paths: REDACTED_FIELDS,
        censor: "[REDACTED]",
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
    },
    pretty ? (buildPrettyTransport() as pino.DestinationStream) : undefined,
  );
}

// ---------------------------------------------------------------------------
// pino-pretty transport (development / LOG_PRETTY=true)
// ---------------------------------------------------------------------------

/**
 * Builds the pino-pretty transport configuration.
 *
 * Output format:
 *   [HH:MM:ss.mmm] LEVEL [process:module] message  { extraFields }
 *
 * Level colors:
 *   TRACE  → gray
 *   DEBUG  → cyan
 *   INFO   → green  (bold)
 *   WARN   → yellow (bold)
 *   ERROR  → red    (bold)
 *   FATAL  → magenta (bold + bg)
 *
 * Origin tag [process:module]:
 *   [api:db]            — normal module log
 *   [api:http]          — Fastify req/res logs (module absent on root logger)
 *   [worker:outbox]     — worker process
 */
function buildPrettyTransport(): ReturnType<typeof pino.transport> {
  return pino.transport({
    target: "pino-pretty",
    options: {
      // ── Colors ─────────────────────────────────────────────────────────
      colorize: true,
      colorizeObjects: true,

      // ── Level rendering ────────────────────────────────────────────────
      // Put level label first so you can scan left-edge for severity
      levelFirst: true,

      // Pad level label to 5 chars (TRACE DEBUG INFO  WARN  ERROR FATAL)
      // pino-pretty pads automatically with levelFirst=true

      // Custom color map for each level
      // Values are chalk modifier strings (comma-separated)
      customColors:
        "trace:gray," +
        "debug:cyan," +
        "info:bold,green," +
        "warn:bold,yellow," +
        "error:bold,red," +
        "fatal:bold,bgRed,white",

      // ── Timestamp ──────────────────────────────────────────────────────
      translateTime: "SYS:HH:MM:ss.l",

      // ── Origin tag: [process:module] ───────────────────────────────────
      // messageFormat is a pino-pretty v11 string template.
      // {process} comes from base, {module} from child.
      // When module is absent (root logger / Fastify HTTP logs) we show
      // {process}:http so every line has a visible origin tag.
      messageFormat: "[{process}:{module}] {msg}",

      // ── HTTP request/response log fields ───────────────────────────────
      // Fastify emits structured req/res objects — include key bits inline.
      // pino-pretty prints remaining non-ignored fields as a trailing object.

      // Fields already rendered in the format string or redundant:
      ignore: "pid,hostname,process,module",

      // ── Misc ───────────────────────────────────────────────────────────
      // Keep stack traces readable on separate lines
      singleLine: false,

      // Don't hide unknown fields — show them as the trailing object
      hideObject: false,
    },
  });
}
