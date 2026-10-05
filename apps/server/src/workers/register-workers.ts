/**
 * Worker process entry point.
 *
 * Responsible for (AGENTS.md §4):
 * - Starting PgBoss
 * - Registering all background workers (added per phase)
 * - Processing asynchronous jobs
 * - Graceful shutdown
 *
 * This runs as a SEPARATE process from the API.
 * Same Docker image, different CMD:
 *   API:    node dist/main.js
 *   Worker: node dist/workers/register-workers.js
 *
 * Workers are thin — business logic belongs in module services.
 */

// load-env MUST be first — populates process.env before @marketplace/env evaluates
import "../load-env";
import { parseServerEnv } from "@marketplace/env";
import { initLogger, createLogger } from "../core/logger/logger";
import { initDb, closeDb } from "../core/db/db";
import { initBoss, stopBoss, getBoss } from "../core/queue/boss";
import { createOutboxPublisher } from "../core/events/outbox";
import { registerWorker } from "../core/queue/worker";
import { AUTH_JOBS, type SendResetEmailPayload } from "../modules/auth/auth.jobs";
import { sendResetEmail } from "../modules/auth/auth.service";

// Phase 2+: import and register module workers here:
// import { registerNotificationWorkers } from "../modules/notifications/notifications.workers";
// import { registerCatalogWorkers } from "../modules/catalog/catalog.workers";

async function startWorker(): Promise<void> {
  // ---- 1. Validate environment -------------------------------------------
  const env = parseServerEnv();

  // ---- 2. Initialize logger -----------------------------------------------
  initLogger({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY, process: "worker" });
  const logger = createLogger("worker");

  logger.info({ env: env.NODE_ENV }, "Starting marketplace worker");

  // ---- 3. Initialize database ---------------------------------------------
  await initDb(env.DATABASE_URL);

  // ---- 4. Start PgBoss ----------------------------------------------------
  const bossUrl = env.PG_BOSS_DATABASE_URL ?? env.DATABASE_URL;
  await initBoss(bossUrl);

  // ---- 5. Register module workers -----------------------------------------
  const boss = getBoss();

  // Auth workers
  registerWorker<SendResetEmailPayload>(
    boss,
    { queue: AUTH_JOBS.SEND_RESET_EMAIL, concurrency: 5 },
    (job) => {
      sendResetEmail(job.data);
      return Promise.resolve();
    },
  );

  // Phase 4+: registerOrderWorkers(boss);
  // Phase 7+: registerNotificationWorkers(boss);

  // ---- 6. Start outbox publisher ------------------------------------------
  const outbox = createOutboxPublisher();
  outbox.start();

  logger.info("Worker process fully started — waiting for jobs");

  // ---- Graceful shutdown --------------------------------------------------
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Worker graceful shutdown initiated");

    try {
      outbox.stop();
      await stopBoss();
      await closeDb();

      logger.info("Worker graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

startWorker().catch((err) => {
  console.error("Fatal worker startup error:", err);
  process.exit(1);
});
