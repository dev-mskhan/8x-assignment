# Phase 0 — Capture & Repository Baseline: PLAN

**Phase:** 0  
**Name:** Capture & Repository Baseline  
**Status:** in_progress  
**Depends on:** nothing  
**Blocks:** Phase 1

---

## Goal

Scaffold the complete monorepo skeleton as defined in `AGENTS.md` Section 3. No business logic, no working code — only directory structure, placeholder files with correct module shapes, and root workspace configuration. The agent log capture workflow (`.kiro/hooks/` + `.kiro/scripts/`) must not be disturbed.

---

## Constraint: Agent Log Workflow

The following must remain untouched and fully functional:

| File | Role |
|------|------|
| `.kiro/hooks/capture-prompt.json` | UserPromptSubmit hook → runs capture-prompt.ps1 |
| `.kiro/hooks/capture-response.json` | Stop hook → runs capture-response.ps1 |
| `.kiro/scripts/capture-prompt.ps1` | Records prompt to state; writes + stages `.agent-logs/` |
| `.kiro/scripts/capture-response.ps1` | Pairs response; writes + stages `.agent-logs/` |
| `.agent-logs/` | Session log files (must be committed, must NOT be gitignored) |

**Critical rule from the scripts:** `$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)` — the scripts locate the repo root as two levels above `$scriptDir`. As long as `.kiro/scripts/` stays at `<repo>/.kiro/scripts/`, this resolves correctly. Do not move it.

**Also critical:** The scripts explicitly check `git check-ignore --no-index -q -- $logPath` and will throw an error if `.agent-logs/` is gitignored. Ensure `.gitignore` does NOT contain `.agent-logs/` at any point.

---

## Tasks

### Task 1 — Root workspace configuration

**Files to create:**

| File | Content |
|------|---------|
| `package.json` | Root workspace package — no deps, scripts: build, dev, lint, typecheck, test |
| `pnpm-workspace.yaml` | `packages: ["apps/*", "packages/*"]` |
| `turbo.json` | Turborepo pipeline: build, dev, lint, typecheck, test |
| `.env.example` | All required env vars (values empty or safe placeholder) |
| `docker-compose.yml` | PostgreSQL + Redis services for local dev |

### Task 2 — `apps/server/` scaffold

**Directory tree:**
```
apps/server/
├── package.json          ← name: @marketplace/server, deps listed but not installed yet
├── Dockerfile            ← Node 20 alpine, production build
├── tsconfig.json         ← extends ../../packages/typescript-config/base.json
└── src/
    ├── main.ts           ← API entry point stub
    ├── app/
    │   ├── app.ts        ← buildApp() stub
    │   ├── plugins.ts    ← registerPlugins() stub
    │   ├── routes.ts     ← registerRoutes() stub
    │   └── websocket.ts  ← registerWebSocket() stub
    ├── config/
    │   └── env.ts        ← re-exports serverEnv from packages/env
    ├── core/
    │   ├── db/
    │   │   └── db.ts     ← getDb() stub
    │   ├── redis/
    │   │   ├── redis.ts  ← getRedis() stub
    │   │   └── pubsub.ts ← publish/subscribe stubs
    │   ├── queue/
    │   │   ├── boss.ts   ← getBoss() stub
    │   │   ├── jobs.ts   ← sendJob() stub
    │   │   └── worker.ts ← registerWorker() stub
    │   ├── events/
    │   │   ├── event-bus.ts ← EventBus stub
    │   │   └── outbox.ts    ← OutboxPublisher stub
    │   ├── errors/
    │   │   ├── app-error.ts    ← AppError + typed error classes
    │   │   └── error-handler.ts ← Fastify error handler stub
    │   └── logger/
    │       └── logger.ts ← createLogger() with redaction stub
    ├── modules/
    │   └── .gitkeep      ← modules added per phase, not pre-created empty
    └── workers/
        └── register-workers.ts ← worker entry point stub
```

**Rules:**
- Every `.ts` file has a real module shape (exports the function/class it will eventually implement) but the body is a stub (`// TODO: implement in Phase 1`)
- Do NOT create empty module directories (`auth/`, `catalog/` etc.) — AGENTS.md rule: no empty boilerplate
- Do NOT add `.gitkeep` inside core subdirectories — they already have files

### Task 3 — `packages/database/` scaffold

```
packages/database/
├── package.json          ← name: @marketplace/database
├── tsconfig.json
└── src/
    ├── client.ts         ← getDrizzleClient() stub
    ├── index.ts          ← re-exports
    └── schema/
        ├── index.ts      ← re-exports all schemas (empty for now)
        └── .gitkeep      ← placeholder until schemas created in Phase 2
```

### Task 4 — `packages/env/` scaffold

```
packages/env/
├── package.json          ← name: @marketplace/env
├── tsconfig.json
└── src/
    └── server.ts         ← serverEnv stub with all required variable names listed as z.string()
```

### Task 5 — `packages/shared/` scaffold

```
packages/shared/
├── package.json          ← name: @marketplace/shared
├── tsconfig.json
└── src/
    ├── types/
    │   └── index.ts      ← common type re-exports stub
    ├── constants/
    │   └── index.ts      ← empty constants stub
    ├── schemas/
    │   └── index.ts      ← empty shared Zod schemas stub
    └── utils/
        └── index.ts      ← empty utils stub
```

### Task 6 — `packages/typescript-config/` scaffold

```
packages/typescript-config/
├── package.json
└── base.json             ← strict TypeScript config base
```

### Task 7 — `packages/eslint-config/` scaffold

```
packages/eslint-config/
├── package.json
└── index.js              ← base ESLint config
```

### Task 8 — `infra/docker/` scaffold

```
infra/
└── docker/
    ├── postgres/
    │   └── init.sql      ← CREATE EXTENSION IF NOT EXISTS vector; (pgvector)
    └── redis/
        └── redis.conf    ← minimal Redis config
```

### Task 9 — `tests/` scaffold

```
tests/
├── unit/
│   └── .gitkeep
└── integration/
    └── .gitkeep
```

### Task 10 — `.gitignore` verification

Confirm `.gitignore` contains:
```
.env
node_modules/
.kiro/
```

Confirm `.gitignore` does NOT contain:
```
.agent-logs/
```

If `.kiro/` is in `.gitignore`, that is correct (hooks/scripts should not be committed per the current setup where they are already committed and then ignored). Wait — the current `.gitignore` already has `.kiro/` added, and the `.kiro/hooks/` files are already committed (they were staged before the `.kiro/` ignore line was added). This is fine as long as the hooks remain tracked. Verify `git ls-files .kiro/` still shows the hook files.

---

## Exit Criteria

- [ ] `pnpm-workspace.yaml` declares `apps/*` and `packages/*`
- [ ] `turbo.json` defines build pipeline
- [ ] `docker-compose.yml` defines postgres + redis services
- [ ] `.env.example` lists all required variables
- [ ] `apps/server/src/main.ts` exists with API entry stub
- [ ] `apps/server/src/workers/register-workers.ts` exists with worker entry stub
- [ ] All `core/` subdirectories have stub files with correct export shapes
- [ ] `packages/database/src/schema/index.ts` exists
- [ ] `packages/env/src/server.ts` exports `serverEnv` stub
- [ ] `packages/shared/src/` has types, constants, schemas, utils stubs
- [ ] `packages/typescript-config/base.json` exists
- [ ] `infra/docker/postgres/init.sql` enables pgvector extension
- [ ] `tests/unit/` and `tests/integration/` directories exist
- [ ] `.gitignore` does NOT contain `.agent-logs/`
- [ ] `git ls-files .agent-logs/` still shows session log files
- [ ] `git ls-files .kiro/` still shows hook files
- [ ] No module directories created under `src/modules/` (added per phase)
- [ ] `.planning/STATE.md` updated
- [ ] Phase committed

---

## What This Phase Does NOT Do

- Does not install dependencies (`pnpm install` happens in Phase 1)
- Does not implement any business logic
- Does not create module directories under `src/modules/` (they are created per phase)
- Does not create database schemas (Phase 2)
- Does not configure ESLint/TypeScript tooling fully (Phase 1)
- Does not run any build or test commands
