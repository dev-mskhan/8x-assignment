/**
 * API process entry point.
 *
 * Startup order (AGENTS.md §47):
 * 1. Validate environment
 * 2. Initialize logger
 * 3. Initialize database
 * 4. Initialize Redis
 * 5. Create Fastify app
 * 6. Register plugins, routes, websocket
 * 7. await app.ready()
 * 8. Start HTTP server
 * 9. Start PgBoss
 * 10. (Phase 2+) Register workers
 * 11. Start outbox publisher
 *
 * Graceful shutdown on SIGTERM / SIGINT:
 * 1. Stop accepting requests (app.close)
 * 2. Stop outbox publisher
 * 3. Stop PgBoss
 * 4. Close Redis
 * 5. Close DB
 * 6. exit(0)
 */

// load-env MUST be first — populates process.env before @marketplace/env evaluates
import "./load-env";
import { parseServerEnv } from "@marketplace/env";
import { initLogger, createLogger } from "./core/logger/logger";
import { initDb, closeDb } from "./core/db/db";
import { initRedis, closeRedis } from "./core/redis/redis";
import { initBoss, stopBoss } from "./core/queue/boss";
import { createOutboxPublisher } from "./core/events/outbox";
import { buildApp } from "./app/app";

async function main(): Promise<void> {
  // ---- 1. Validate environment -------------------------------------------
  const env = parseServerEnv();

  // ---- 2. Initialize logger -----------------------------------------------
  initLogger({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY });
  const logger = createLogger("main");

  logger.info(
    { env: env.NODE_ENV, port: env.PORT },
    "Starting marketplace API",
  );

  // ---- 3. Initialize database ---------------------------------------------
  await initDb(env.DATABASE_URL);

  // ---- 4. Initialize Redis ------------------------------------------------
  await initRedis(env.REDIS_URL);

  // ---- 5-8. Build Fastify app and start HTTP server -----------------------
  const app = await buildApp();
  await app.ready();

  await app.listen({
    port: env.PORT,
    host: env.HOST,
  });

  logger.info({ port: env.PORT, host: env.HOST }, "HTTP server listening");

  // ---- 9. Start PgBoss ----------------------------------------------------
  const bossUrl = env.PG_BOSS_DATABASE_URL ?? env.DATABASE_URL;
  await initBoss(bossUrl);

  // ---- 11. Start outbox publisher -----------------------------------------
  const outbox = createOutboxPublisher();
  outbox.start();

  logger.info("Marketplace API fully started");

  // ---- Graceful shutdown --------------------------------------------------
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    try {
      // 1. Stop accepting new requests
      await app.close();
      logger.info("HTTP server closed");

      // 2. Stop outbox publisher
      outbox.stop();

      // 3. Stop PgBoss
      await stopBoss();

      // 4. Close Redis
      await closeRedis();

      // 5. Close database
      await closeDb();

      logger.info("Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
    void shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
}

main().catch((err) => {
  // Logger may not be initialized yet — use console as last resort
  console.error("Fatal startup error:", err);
  process.exit(1);
});
