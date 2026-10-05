# Phase 1 — Foundation: PLAN

**Phase:** 1  
**Name:** Foundation  
**Status:** completed  
**Depends on:** Phase 0  
**Blocks:** Phase 2

---

## Goal

Get the server fully running: real Fastify app, wired infrastructure (DB + Redis + PgBoss), operational HTTP endpoints with Swagger docs, structured Pino logging with redaction, graceful startup/shutdown, and auth primitives (JWT + signed cookies + `requireAuth` hook). Everything must compile, lint, and pass a smoke test.

---

## Auth Strategy (locked for this phase)

| Concern             | Decision                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Access token        | Short-lived JWT (15 min), signed with `JWT_SECRET`                                         |
| Refresh token       | Long-lived JWT (7 days), signed with `SESSION_SECRET`                                      |
| Production delivery | `accessToken` in `HttpOnly; Secure; SameSite=Strict` signed cookie                         |
| Testing delivery    | `Authorization: Bearer <accessToken>` also accepted (env-gated: `NODE_ENV !== production`) |
| Refresh cookie      | `refreshToken` in a separate `HttpOnly` signed cookie                                      |
| Session storage     | Refresh token hash stored in `sessions` table for revocation                               |
| Identity source     | **Always from verified JWT payload** — never from request body                             |

---

## Exit Criteria — Final Status

- [x] `pnpm install` — no errors, lockfile consistent
- [x] `GET /health` returns `200 { status: "ok" }`
- [x] `GET /ready` returns `200` or `503` with structured check results
- [x] `GET /api/v1/meta` returns `200` with API metadata
- [x] `GET /docs` serves Swagger UI (registered via `@fastify/swagger-ui`)
- [x] `/api/v1/openapi.json` returns valid OpenAPI 3.0 spec
- [x] All four routes documented in Swagger
- [x] `requireAuth` hook reads from signed cookie; falls back to Bearer in non-production
- [x] `requireRole()` factory rejects unauthorized roles with 403
- [x] DB pool connects and `getDb()` works
- [x] Redis connects and `getRedis()` works (fail-open — logs warning if unavailable)
- [x] PgBoss starts and stops gracefully
- [x] Outbox publisher starts and stops gracefully
- [x] Startup logs are structured JSON (or pretty in dev)
- [x] No secrets appear in logs (REDACTED_FIELDS list enforced)
- [x] `SIGTERM` triggers graceful shutdown (no hung process)
- [x] `pnpm typecheck` — zero errors
- [x] `pnpm lint` — zero errors
- [x] `pnpm test` — smoke test passes (4/4)
- [x] `pnpm build` — `dist/` produced without errors

**Note on build output path:** Due to `rootDirs` (plural, no single `rootDir`) being required to allow
workspace package source resolution via `paths`, the compiled output lands at
`dist/apps/server/src/main.js` rather than `dist/main.js`. The `package.json` `main` and `start`
scripts have been updated to match. This is a known TypeScript monorepo trade-off with the
`CommonJS + node` module resolution strategy.

---

## Implementation Notes

### TS Module System Change

The base tsconfig was changed from `module: NodeNext / moduleResolution: NodeNext` to
`module: CommonJS / moduleResolution: node`. `NodeNext` requires explicit `.js` file extensions on
all relative imports in ESM packages, which conflicted with the workspace path-alias pattern.
`CommonJS + node` is the correct choice for a pnpm monorepo using `tsx` as the dev runner.

### `rootDirs` vs `rootDir`

`rootDir: "src"` is incompatible with `paths` aliases that resolve to workspace package source files
outside `apps/server/src/`. The fix: use `rootDirs` (plural) listing all source roots — this tells
TypeScript that multiple directories collectively form the root without enforcing a single-file-tree
constraint.

### `preHandlerAsyncHookHandler`

Fastify exports both `preHandlerHookHandler` (sync) and `preHandlerAsyncHookHandler` (async).
`requireAuth` and `requireRole` are typed as `preHandlerAsyncHookHandler` to avoid
`no-misused-promises` lint errors when returning `Promise<void>`.

### Outbox Phase 1 behavior

The outbox publisher starts but is a safe no-op: it checks whether `outbox_events` table exists
before querying, and skips silently if not. The real table and full wiring come in Phase 2.

---

## What This Phase Does NOT Do

- Does not implement `POST /auth/register`, `POST /auth/login` (Phase 3)
- Does not create database migrations (Phase 2)
- Does not seed data (Phase 2)
- Does not implement any business module (Phase 2+)
- Does not implement WebSocket handlers (Phase 7)
- Does not implement full Redis Pub/Sub (Phase 7)
