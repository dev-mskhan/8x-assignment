# Phase 3 — Authentication & Users
## PLAN.md

**Status:** `ready-for-execution`
**Depends on:** Phase 2 (complete — all schema tables exist, migrations applied)
**Blocks:** Phase 4 (Cart, Checkout — requires authenticated user context)

---

## Mandatory Pre-Read

Before executing any chunk:

1. `AGENTS.md` — architectural contract
2. `.planning/PRODUCTION_CHECKLIST.md` — Tier 1 rules apply during every chunk; Tier 2 gate at phase end
3. `.planning/TESTING_CONTEXT.md` — integration tests via `buildApp()` + `app.inject()` + real PostgreSQL

---

## Phase Goal

Implement the complete customer identity boundary:

- Credential-based auth (register, login, refresh, logout, logout-all)
- Google OAuth 2.0 + PKCE (server-generates code_verifier; frontend receives token via URL fragment, calls `/verify` to exchange)
- Secure password hashing (bcrypt 12 rounds — already in `core/auth/password.ts`)
- Access token (15 min JWT cookie) + refresh token rotation (7 day httpOnly cookie)
- Session management (list active sessions, revoke individual session)
- Password reset flow (forgot → email token → reset)
- Rate limiting on all auth endpoints (AUTH_RATE_LIMIT_MAX/WINDOW already in env)
- User profile read + update (`/users/me`)
- Address CRUD + default address management
- RBAC enforced via existing `requireAuth` / `requireRole` hooks
- Redis: PKCE state/verifier TTL storage (5 min) + password reset token blacklist cache

---

## Repository State at Phase Start

```
core/auth/
  jwt.ts         ✓ signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken
  cookies.ts     ✓ setAccessTokenCookie, setRefreshTokenCookie, clearAuthCookies
  hooks.ts       ✓ requireAuth, requireRole
  password.ts    ✓ hashPassword, verifyPassword
  context.ts     ✓ AuthenticatedUser type, request.user augmentation

packages/database/src/schema/
  auth.schema.ts  ✓ users, sessions, password_reset_tokens, oauth_accounts
  users.schema.ts ✓ addresses

packages/env/src/server.ts
  ✓ JWT_SECRET, SESSION_SECRET, COOKIE_SECRET, SESSION_TTL_SECONDS
  ✓ AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS
  ✗ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI  ← add in Chunk A

modules/
  auth/   ✗ not created
  users/  ✗ not created
```

---

## Architecture Decisions

### Token Strategy

```
Login / Register / OAuth verify
        ↓
JWT access_token (15 min) → HttpOnly signed cookie (path=/)
JWT refresh_token (7 days) → HttpOnly signed cookie (path=/api/v1/auth/refresh)
        ↓
All subsequent requests use access_token cookie
        ↓
Client calls POST /auth/refresh when 401 to rotate tokens
        ↓
Logout clears both cookies + marks session revoked_at in PostgreSQL
```

Session row in PostgreSQL stores `refresh_token_hash` (bcrypt) — not the raw token. Verification compares hash.

### Google OAuth PKCE Flow (server-side code_verifier)

```
1. GET  /api/v1/auth/google
        ↓ Server generates:
          state         = crypto.randomUUID()
          code_verifier = crypto.randomBytes(32).toString("base64url")
          code_challenge = base64url(sha256(code_verifier))
        ↓ Server stores in Redis:
          key = auth:oauth:state:{state}
          value = { code_verifier }
          TTL = 300 seconds (5 min)
        ↓ Returns { authUrl: string } — client redirects browser

2. GET  /api/v1/auth/google/callback?code=...&state=...
        ↓ Server verifies state exists in Redis
        ↓ Retrieves code_verifier
        ↓ Deletes state from Redis (consumed — one-time use)
        ↓ Exchanges code + code_verifier with Google token endpoint
        ↓ Gets id_token → extracts email, name, googleUserId
        ↓ Upserts user + oauth_accounts row
        ↓ Creates session row
        ↓ Signs access_token + refresh_token
        ↓ Redirects browser to:
          {FRONTEND_URL}/auth/callback#access_token={token}&session_ok=true
          (token embedded in URL FRAGMENT — not query string — not logged by servers)
        ↓ Frontend JS reads fragment, stores token in memory, calls POST /auth/verify-token

3. POST /api/v1/auth/google/verify
        Body: { token: string }  ← the access_token from the fragment
        ↓ Server re-verifies the JWT (already signed by us, just re-validates)
        ↓ Sets HttpOnly cookie access_token + refresh_token
        ↓ Returns { success: true, data: { user } }
        ↓ Frontend clears the fragment from URL
```

Why fragment instead of query param: URL fragments are never sent to the server in HTTP requests, never appear in server access logs, and not cached by proxies. The frontend reads it purely client-side then immediately exchanges it for a proper cookie-based session.

### Password Reset Flow

```
POST /api/v1/auth/password/forgot  { email }
        ↓ Look up user by email
        ↓ Generate secure token = crypto.randomBytes(32).toString("hex")
        ↓ Hash token → tokenHash (sha256, not bcrypt — just for storage)
        ↓ Insert password_reset_tokens row (expires 1 hour)
        ↓ Enqueue PgBoss job: AUTH_JOBS.SEND_RESET_EMAIL { userId, token, email }
        ↓ Return 200 (same response whether email exists or not — no enumeration)

Worker: sends email with reset link: {FRONTEND_URL}/reset-password?token={raw_token}

POST /api/v1/auth/password/reset  { token, newPassword }
        ↓ Hash incoming token (sha256)
        ↓ Find matching password_reset_tokens row WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > NOW()
        ↓ Validate newPassword (Zod: min 8 chars)
        ↓ Transaction:
          UPDATE users SET passwordHash = newHash
          UPDATE password_reset_tokens SET usedAt = NOW()
          DELETE all sessions for user (force re-login everywhere)
        ↓ Clear any Redis rate-limit state for user
        ↓ Return 200
```

### Redis Usage (Tier 1 — keyed with scope)

| Key | Value | TTL | Purpose |
|-----|-------|-----|---------|
| `auth:oauth:state:{state}` | `{ code_verifier }` | 300s | PKCE verifier during OAuth flow |
| `auth:ratelimit:{ip}` | handled by @fastify/rate-limit plugin | window | Auth endpoint rate limiting |
| `auth:token:blocklist:{jti}` | `"1"` | remaining token lifetime | Blacklist revoked tokens (logout fast-path) — optional, implemented if needed |

No caching of user/session data in Redis — PostgreSQL is truth.

---

## Chunk Sequence

```
Chunk A — Env additions (Google OAuth vars) + auth module jobs file
Chunk B — Auth module: repository (users, sessions, password_reset_tokens, oauth_accounts)
Chunk C — Auth service: register, login, refresh, logout, logout-all
Chunk D — Auth service: password reset (forgot + reset)
Chunk E — Auth service: Google OAuth PKCE (initiate + callback + verify)
Chunk F — Auth controller + routes (all /auth/* endpoints)
Chunk G — Users module: repository + service (profile, addresses)
Chunk H — Users controller + routes (/users/me + /users/me/addresses + sessions)
Chunk I — Wire auth + users routes into app/routes.ts
Chunk J — Auth worker: register send-reset-email job handler
Chunk K — Shared Zod schemas for auth + users (packages/shared)
Chunk L — Tier 2 phase gate (typecheck + lint + build + integration tests)
```

---

## Chunk A — Env Additions + Job Constants

### `packages/env/src/server.ts` — ADD to schema:

```typescript
// ---- Google OAuth (optional — feature disabled if not set) ---------------
GOOGLE_CLIENT_ID:     z.string().optional(),
GOOGLE_CLIENT_SECRET: z.string().optional(),
GOOGLE_REDIRECT_URI:  z.string().url().optional(),
FRONTEND_URL:         z.string().url().default("http://localhost:3001"),
```

`FRONTEND_URL` is the base URL of the React frontend — used to construct the OAuth callback redirect with the token fragment.

### `.env.example` — ADD:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
FRONTEND_URL=http://localhost:3001
```

### `apps/server/src/modules/auth/auth.jobs.ts` — CREATE:

```typescript
export const AUTH_JOBS = {
  SEND_RESET_EMAIL: "auth.send-reset-email",
  SEND_WELCOME_EMAIL: "auth.send-welcome-email",
} as const;

export interface SendResetEmailPayload {
  userId: string;
  email: string;
  token: string;        // raw token (not hash) — included in reset URL
  expiresAt: string;    // ISO-8601
}

export interface SendWelcomeEmailPayload {
  userId: string;
  email: string;
  name: string;
}
```

### Tier 1
- ✅ OAuth vars optional — feature degrades gracefully if not configured (returns 501)
- ✅ `FRONTEND_URL` used for redirect — never trusted from client
- ✅ Job payload includes only what the worker needs — no sensitive data beyond necessary

---

## Chunk B — Auth Repository

**`apps/server/src/modules/auth/auth.repository.ts`** — CREATE

### Methods

**Users:**
```typescript
findUserByEmail(email: string): Promise<User | null>
findUserById(id: string): Promise<User | null>
createUser(data: { email, passwordHash, name, role? }): Promise<User>
updateUser(id: string, data: Partial<{ name, avatarUrl, status }>): Promise<User>
updateUserPassword(id: string, passwordHash: string): Promise<void>
```

**Sessions:**
```typescript
createSession(data: { userId, refreshTokenHash, userAgent?, ipAddress?, expiresAt }): Promise<Session>
findSessionById(id: string): Promise<Session | null>
findActiveSessionsByUserId(userId: string): Promise<Session[]>
  // WHERE revoked_at IS NULL AND expires_at > NOW()
revokeSession(id: string): Promise<void>
  // UPDATE sessions SET revoked_at = NOW() WHERE id = ?
revokeAllUserSessions(userId: string): Promise<void>
  // UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL
deleteExpiredSessions(): Promise<void>
  // DELETE WHERE expires_at < NOW() — called by cleanup job (Phase 10)
```

**Password Reset Tokens:**
```typescript
createPasswordResetToken(data: { userId, tokenHash, expiresAt }): Promise<PasswordResetToken>
findValidResetToken(tokenHash: string): Promise<PasswordResetToken | null>
  // WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
markResetTokenUsed(id: string): Promise<void>
deleteUserResetTokens(userId: string): Promise<void>
```

**OAuth Accounts:**
```typescript
findOauthAccount(provider: string, providerAccountId: string): Promise<OauthAccount | null>
upsertOauthAccount(data: { userId, provider, providerAccountId, accessToken?, refreshToken?, expiresAt? }): Promise<OauthAccount>
  // ON CONFLICT (provider, provider_account_id) DO UPDATE
```

### Key rules
- No business logic in repository
- Explicit column selection where full row not needed (e.g., `findActiveSessionsByUserId` selects `id, user_id, user_agent, ip_address, created_at, expires_at` — never `refresh_token_hash`)
- `passwordHash` and `refreshTokenHash` columns never returned in list/safe queries

---

## Chunk C — Auth Service: Core Auth

**`apps/server/src/modules/auth/auth.service.ts`** — CREATE

### `register(input)`

```typescript
Input: { email, password, name }

1. Zod validate (handled at route layer — service receives typed input)
2. Check user not already registered → ConflictError("Email already registered")
3. hashPassword(password)  — bcrypt 12 rounds
4. createUser({ email, passwordHash, name, role: "CUSTOMER" })
5. createSession({ userId, refreshTokenHash: hash(refreshToken), userAgent, ipAddress, expiresAt: +7d })
6. signAccessToken({ userId, role, sessionId })
7. signRefreshToken({ userId, role, sessionId })
8. Optionally: enqueue AUTH_JOBS.SEND_WELCOME_EMAIL (non-blocking)
9. Return { user: safeUser, accessToken, refreshToken }

safeUser = { id, email, name, role, status, avatarUrl, createdAt }
           — never includes passwordHash
```

### `login(input, context)`

```typescript
Input: { email, password }
Context: { userAgent?, ip? }

1. findUserByEmail(email) → null → UnauthorizedError("Invalid credentials")
   Note: same error message for wrong email AND wrong password — no enumeration
2. user.status === "SUSPENDED" | "BANNED" → ForbiddenError("Account suspended")
3. verifyPassword(password, user.passwordHash) → false → UnauthorizedError("Invalid credentials")
4. createSession(...)
5. signAccessToken + signRefreshToken
6. Return { user: safeUser, accessToken, refreshToken }
```

### `refresh(refreshToken, sessionId)`

```typescript
1. verifyRefreshToken(refreshToken) → UnauthorizedError on failure
2. Verify payload.sessionId === sessionId (defence against session fixation)
3. findSessionById(sessionId)
   → null → UnauthorizedError("Session not found")
   → revokedAt != null → UnauthorizedError("Session revoked")
   → expiresAt < now → UnauthorizedError("Session expired")
4. Hash incoming refresh token → compare with session.refreshTokenHash
   → mismatch → revokeSession(sessionId) + UnauthorizedError("Token mismatch")
   (detect refresh token theft — invalidate session immediately)
5. Rotate: generate new refreshToken
   UPDATE session: refreshTokenHash = hash(newRefreshToken)
6. Sign new accessToken + return
7. Return { accessToken, refreshToken: newRefreshToken }
```

Token rotation security: if an attacker uses a stolen refresh token after legitimate rotation, the mismatch triggers session revocation, protecting the user.

### `logout(sessionId)`

```typescript
1. revokeSession(sessionId)
2. Return void
```

### `logoutAll(userId)`

```typescript
1. revokeAllUserSessions(userId)
2. Return void
```

### `me(userId)`

```typescript
1. findUserById(userId) → NotFoundError if null
2. Return safeUser (no passwordHash)
```

---

## Chunk D — Auth Service: Password Reset

### `forgotPassword(email)`

```typescript
1. findUserByEmail(email)
   → NOT FOUND: return void (same response — no enumeration)
2. Generate raw token = crypto.randomBytes(32).toString("hex")
3. Hash token: tokenHash = crypto.createHash("sha256").update(raw).digest("hex")
   (sha256, not bcrypt — just for storage; brute-force not viable at 32 bytes entropy)
4. expiresAt = now + 1 hour
5. createPasswordResetToken({ userId, tokenHash, expiresAt })
6. sendJob(AUTH_JOBS.SEND_RESET_EMAIL, { userId, email, token: raw, expiresAt })
   (PgBoss — async, does not block HTTP response)
7. Return void
```

### `resetPassword(input)`

```typescript
Input: { token: string, newPassword: string }

1. tokenHash = sha256(token)
2. findValidResetToken(tokenHash) → null → ValidationError("Invalid or expired reset token")
3. hashPassword(newPassword) → newHash
4. DB transaction:
   a. updateUserPassword(userId, newHash)
   b. markResetTokenUsed(tokenId)
   c. revokeAllUserSessions(userId)  ← force re-login on all devices
5. Return void
```

### Tier 1 rules
- ✅ Same 200 response for found/not-found email (prevents user enumeration)
- ✅ sha256 token hash — high entropy (32 bytes = 256 bits), one-way
- ✅ Password reset atomically revokes all sessions
- ✅ Reset via PgBoss — email not blocking HTTP
- ✅ Reset token expires in 1 hour + single-use (usedAt marks it consumed)

---

## Chunk E — Auth Service: Google OAuth PKCE

### `initiateGoogleOAuth()`

```typescript
1. Check GOOGLE_CLIENT_ID configured → else throw new AppError("UNPROCESSABLE", "Google OAuth not configured", 501)
2. state = crypto.randomUUID()
3. codeVerifier = crypto.randomBytes(32).toString("base64url")
4. codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest())
5. Store in Redis:
   key: auth:oauth:state:{state}
   value: JSON.stringify({ codeVerifier })
   TTL: 300 seconds
6. Build Google authorization URL:
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id={GOOGLE_CLIENT_ID}
     &redirect_uri={GOOGLE_REDIRECT_URI}
     &response_type=code
     &scope=openid email profile
     &code_challenge={codeChallenge}
     &code_challenge_method=S256
     &state={state}
     &access_type=offline
     &prompt=consent
7. Return { authUrl }
```

### `handleGoogleCallback(code, state, context)`

```typescript
1. Retrieve from Redis: auth:oauth:state:{state}
   → null → UnauthorizedError("Invalid or expired OAuth state")
2. Delete key from Redis immediately (one-time use)
3. Parse { codeVerifier } from Redis value
4. POST to https://oauth2.googleapis.com/token:
   { code, client_id, client_secret, redirect_uri, code_verifier, grant_type: "authorization_code" }
   → Error → UnauthorizedError("OAuth token exchange failed")
5. Decode id_token (JWT — verify signature against Google JWKS in production; for now, decode without verify + validate iss/aud)
6. Extract: email, name, sub (= googleUserId)
7. Find or create user:
   a. findOauthAccount("google", googleUserId)
   b. If found: get userId → findUserById
   c. If not found: check user by email
      - exists + no OAuth account → create OAuth account link (account merge)
      - not found → createUser({ email, name, passwordHash: unusableHash, role: "CUSTOMER" })
                    + createOauthAccount(...)
8. DB transaction:
   a. upsertOauthAccount({ userId, provider: "google", providerAccountId: googleUserId, accessToken, refreshToken, expiresAt })
   b. createSession(...)
9. signAccessToken + signRefreshToken
10. Return { user: safeUser, accessToken, refreshToken }
```

The `unusableHash` for OAuth-only users is a bcrypt hash of a cryptographically random string they can never know — password login for this account will always fail until they explicitly set a password (Phase 9 feature).

### `verifyGoogleToken(token, context)`

```typescript
1. payload = verifyAccessToken(token) → UnauthorizedError on failure
   (This is our own JWT — already signed by us in step 9 of handleGoogleCallback)
2. findSessionById(payload.sessionId) → verify not revoked
3. Set HttpOnly cookies (done in controller)
4. Return { user: safeUser }
```

### Tier 1 rules
- ✅ state + code_verifier generated server-side, never client-supplied
- ✅ State stored in Redis with 5 min TTL — deleted on first use
- ✅ Token placed in URL fragment — not query param, not logged
- ✅ Frontend calls /verify to exchange fragment token for proper cookies
- ✅ OAuth-only users have unusable password hash (cannot brute-force a login path)
- ✅ Account merge by email is explicit and audited

---

## Chunk F — Auth Controller + Routes

**`apps/server/src/modules/auth/auth.controller.ts`** — CREATE

Thin — reads request, calls service, sets cookies via helpers, returns response.

Key patterns:
```typescript
// Login: set cookies after service call
setAccessTokenCookie(reply, accessToken);
setRefreshTokenCookie(reply, refreshToken);
return reply.status(200).send({ success: true, data: { user } });

// Logout: clear cookies before returning
clearAuthCookies(reply);
return reply.status(200).send({ success: true, data: null });

// Google callback: redirect with fragment
return reply.redirect(302, `${serverEnv.FRONTEND_URL}/auth/callback#access_token=${accessToken}`);

// Refresh: read refresh_token from cookie (not body)
const rawToken = request.cookies[REFRESH_TOKEN_COOKIE];
const unsigned = request.unsignCookie(rawToken);
// ... pass to service
```

**`apps/server/src/modules/auth/auth.routes.ts`** — CREATE

```
POST /auth/register           — public
POST /auth/login              — public
POST /auth/logout             — requireAuth
POST /auth/logout-all         — requireAuth
POST /auth/refresh            — public (reads cookie)
GET  /auth/me                 — requireAuth

POST /auth/password/forgot    — public
POST /auth/password/reset     — public

GET  /auth/google             — public
GET  /auth/google/callback    — public (query params from Google)
POST /auth/google/verify      — public (token from fragment)
```

Rate limiting: auth routes use a tighter rate limit plugin instance configured with `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS` from env. Applied as route-level preHandler or via Fastify plugin scoped to auth prefix.

```typescript
// Per-route rate limit using @fastify/rate-limit
app.post("/auth/login", {
  config: {
    rateLimit: {
      max: serverEnv.AUTH_RATE_LIMIT_MAX,
      timeWindow: serverEnv.AUTH_RATE_LIMIT_WINDOW_MS,
    },
  },
  ...
}, loginHandler);
```

---

## Chunk G — Users Module: Repository + Service

**`apps/server/src/modules/users/users.repository.ts`** — CREATE

```typescript
// Profile
findUserById(id: string): Promise<User | null>
updateUserProfile(id: string, data: { name?, avatarUrl? }): Promise<User>

// Addresses
findAddressesByUserId(userId: string): Promise<Address[]>
findAddressById(id: string): Promise<Address | null>
createAddress(data: NewAddress): Promise<Address>
updateAddress(id: string, userId: string, data: Partial<Address>): Promise<Address>
  // WHERE id = ? AND user_id = ? — ownership enforced at DB level
deleteAddress(id: string, userId: string): Promise<void>
  // WHERE id = ? AND user_id = ?
setDefaultAddress(id: string, userId: string): Promise<void>
  // Transaction:
  //   UPDATE addresses SET is_default = false WHERE user_id = ?
  //   UPDATE addresses SET is_default = true  WHERE id = ? AND user_id = ?
```

**`apps/server/src/modules/users/users.service.ts`** — CREATE

```typescript
getMyProfile(userId: string): Promise<SafeUser>
updateMyProfile(userId: string, input: { name?, avatarUrl? }): Promise<SafeUser>

getMyAddresses(userId: string): Promise<Address[]>
addAddress(userId: string, input: AddressInput): Promise<Address>
updateAddress(userId: string, addressId: string, input: Partial<AddressInput>): Promise<Address>
  // findAddressById first → NotFoundError if not found or userId mismatch
deleteAddress(userId: string, addressId: string): Promise<void>
setDefaultAddress(userId: string, addressId: string): Promise<Address[]>
  // Verify ownership → setDefaultAddress transaction → return all addresses

getMySessions(userId: string): Promise<SafeSession[]>
  // Returns active sessions with id, userAgent, ipAddress, createdAt, expiresAt
  // Never returns refreshTokenHash
revokeSession(userId: string, sessionId: string): Promise<void>
  // Verify session.userId === userId → revokeSession
  // NotFoundError if not found, ForbiddenError if wrong owner
```

### Ownership invariants
- `userId` always comes from `request.user.userId` (JWT) — never from body
- All address mutations verify `user_id = userId` at repository level — double protection
- Session revocation verifies ownership before revoking

---

## Chunk H — Users Controller + Routes

**`apps/server/src/modules/users/users.controller.ts`** — CREATE
**`apps/server/src/modules/users/users.routes.ts`** — CREATE

```
GET    /users/me                            — requireAuth
PATCH  /users/me                            — requireAuth

GET    /users/me/addresses                  — requireAuth
POST   /users/me/addresses                  — requireAuth
PATCH  /users/me/addresses/:addressId       — requireAuth
DELETE /users/me/addresses/:addressId       — requireAuth
POST   /users/me/addresses/:addressId/default — requireAuth

GET    /users/me/sessions                   — requireAuth
DELETE /users/me/sessions/:sessionId        — requireAuth
```

---

## Chunk I — Wire Routes

**`apps/server/src/app/routes.ts`** — ADD:

```typescript
import { authRoutes }  from "../modules/auth/auth.routes";
import { usersRoutes } from "../modules/users/users.routes";

await app.register(authRoutes,  { prefix: "/api/v1" });
await app.register(usersRoutes, { prefix: "/api/v1" });
```

---

## Chunk J — Auth Worker

**`apps/server/src/workers/register-workers.ts`** — ADD:

```typescript
registerWorker(
  boss,
  { queue: AUTH_JOBS.SEND_RESET_EMAIL, concurrency: 5 },
  async (job) => {
    await authService.sendResetEmail(job.data);
  },
);
```

For Phase 3, `sendResetEmail` logs the token link (no real email provider yet). The worker infrastructure is in place; real SMTP/SES integration is Phase 10.

```typescript
// In auth.service.ts — Phase 3 stub:
export async function sendResetEmail(payload: SendResetEmailPayload): Promise<void> {
  logger.info(
    { userId: payload.userId },
    `[DEV] Password reset link: ${serverEnv.FRONTEND_URL}/reset-password?token=${payload.token}`,
  );
  // Phase 10: replace with real email provider (SES/Resend/Postmark)
}
```

### Tier 1 rules
- ✅ Email not blocking HTTP response — sent via PgBoss job
- ✅ Worker delegates to service — no business logic in worker callback
- ✅ Job is idempotent (sending reset email twice is harmless — token is single-use)

---

## Chunk K — Shared Zod Schemas

**`packages/shared/src/schemas/auth.schemas.ts`** — CREATE

```typescript
// Request schemas
export const registerSchema = z.object({
  email:    z.string().email().max(255).toLowerCase(),
  password: z.string().min(8).max(128),
  name:     z.string().trim().min(1).max(255),
});

export const loginSchema = z.object({
  email:    z.string().email().max(255).toLowerCase(),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255).toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const verifyGoogleTokenSchema = z.object({
  token: z.string().min(1),
});

// Response schemas (safe — no passwordHash, no tokenHash)
export const safeUserSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string().email(),
  name:      z.string(),
  role:      z.enum(["CUSTOMER", "SELLER", "ADMIN"]),
  status:    z.enum(["ACTIVE", "SUSPENDED", "BANNED", "PENDING_VERIFICATION"]),
  avatarUrl: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

export const authResponseSchema = z.object({
  user: safeUserSchema,
});

export const safeSessionSchema = z.object({
  id:        z.string().uuid(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  expiresAt: z.string().or(z.date()),
  isCurrent: z.boolean(),  // true if this is the session making the request
});
```

**`packages/shared/src/schemas/users.schemas.ts`** — CREATE

```typescript
export const updateProfileSchema = z.object({
  name:      z.string().trim().min(1).max(255).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
});

export const addressSchema = z.object({
  id:           z.string().uuid(),
  userId:       z.string().uuid(),
  label:        z.string().nullable(),
  fullName:     z.string(),
  phone:        z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city:         z.string(),
  state:        z.string().nullable(),
  postalCode:   z.string(),
  country:      z.string(),
  isDefault:    z.boolean(),
  createdAt:    z.string().or(z.date()),
  updatedAt:    z.string().or(z.date()),
});

export const createAddressSchema = z.object({
  label:        z.string().max(50).optional(),
  fullName:     z.string().trim().min(1).max(255),
  phone:        z.string().trim().min(5).max(30),
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().max(255).optional(),
  city:         z.string().trim().min(1).max(100),
  state:        z.string().max(100).optional(),
  postalCode:   z.string().trim().min(1).max(20),
  country:      z.string().trim().min(2).max(100),
  isDefault:    z.boolean().default(false),
});

export const updateAddressSchema = createAddressSchema.partial();
```

Export both from `packages/shared/src/schemas/index.ts` re-export.

---

## Chunk L — Tier 2 Phase Gate

### 1. Build gate

```bash
pnpm typecheck   # zero errors
pnpm lint        # zero errors
pnpm build       # succeeds
```

### 2. Integration tests — `tests/integration/auth.test.ts`

```
Registration:
  POST /api/v1/auth/register → 201 { success: true, data: { user } }
  Duplicate email → 409 CONFLICT
  Weak password → 400 VALIDATION_ERROR
  Missing field → 400

Login:
  Correct credentials → 200 + access_token cookie set
  Wrong password → 401 UNAUTHORIZED (same message as wrong email)
  Wrong email → 401 UNAUTHORIZED
  Suspended user → 403 FORBIDDEN

Token / Session lifecycle:
  GET /api/v1/auth/me with valid token → 200 user
  GET /api/v1/auth/me without token → 401
  GET /api/v1/auth/me with expired token → 401
  POST /api/v1/auth/refresh with valid refresh → 200 + new cookies
  POST /api/v1/auth/refresh with revoked session → 401
  POST /api/v1/auth/logout → 200 + cookies cleared
  POST /api/v1/auth/logout-all → 200 → all sessions revoked
  GET /api/v1/auth/me after logout → 401

Password reset:
  POST /api/v1/auth/password/forgot { email: known } → 200
  POST /api/v1/auth/password/forgot { email: unknown } → 200 (same response)
  POST /api/v1/auth/password/reset { token: valid, newPassword } → 200
  POST /api/v1/auth/password/reset { token: already-used } → 400
  POST /api/v1/auth/password/reset { token: expired } → 400

RBAC:
  CUSTOMER accessing seller-only route → 403
  CUSTOMER accessing admin-only route → 403

User profile:
  GET  /api/v1/users/me → 200 user (no passwordHash in response)
  PATCH /api/v1/users/me { name: "New Name" } → 200 updated user

Addresses:
  GET   /api/v1/users/me/addresses → 200 []
  POST  /api/v1/users/me/addresses → 201 address
  PATCH /api/v1/users/me/addresses/:id → 200 updated
  DELETE /api/v1/users/me/addresses/:id → 200
  POST  /api/v1/users/me/addresses/:id/default → 200
  PATCH address belonging to other user → 404 (not 403 — no existence leak)

Sessions:
  GET  /api/v1/users/me/sessions → 200 [{ id, userAgent, isCurrent: true }]
  DELETE /api/v1/users/me/sessions/:id → 200
  DELETE session belonging to other user → 404

Security:
  No passwordHash in any response body
  No refreshTokenHash in any response body
  Rate limit: 11th request to /auth/login within window → 429
```

Tests use `runId`-scoped fixtures (per TESTING_CONTEXT.md §7).

### 3. Google OAuth — manual smoke test only (integration test requires live Google credentials)

```bash
curl http://localhost:3000/api/v1/auth/google
# Returns { success: true, data: { authUrl: "https://accounts.google.com/..." } }
# OR 501 if GOOGLE_CLIENT_ID not set
```

---

## File Creation Summary

| File | Action |
|------|--------|
| `packages/env/src/server.ts` | MODIFY (add Google OAuth vars + FRONTEND_URL) |
| `.env.example` | MODIFY (add Google + FRONTEND_URL vars) |
| `packages/shared/src/schemas/auth.schemas.ts` | CREATE |
| `packages/shared/src/schemas/users.schemas.ts` | CREATE |
| `packages/shared/src/schemas/index.ts` | MODIFY (export auth + users schemas) |
| `apps/server/src/modules/auth/auth.jobs.ts` | CREATE |
| `apps/server/src/modules/auth/auth.repository.ts` | CREATE |
| `apps/server/src/modules/auth/auth.service.ts` | CREATE |
| `apps/server/src/modules/auth/auth.controller.ts` | CREATE |
| `apps/server/src/modules/auth/auth.routes.ts` | CREATE |
| `apps/server/src/modules/users/users.repository.ts` | CREATE |
| `apps/server/src/modules/users/users.service.ts` | CREATE |
| `apps/server/src/modules/users/users.controller.ts` | CREATE |
| `apps/server/src/modules/users/users.routes.ts` | CREATE |
| `apps/server/src/app/routes.ts` | MODIFY (register auth + users routes) |
| `apps/server/src/workers/register-workers.ts` | MODIFY (add auth workers) |
| `tests/integration/auth.test.ts` | CREATE |

No new migrations required — all tables exist from Phase 2.

---

## Tier 1 Checklist (applied during every chunk)

| Category | Rule | Status |
|----------|------|--------|
| Auth identity | `userId` always from `request.user.userId` (JWT) | enforced in hooks |
| Auth identity | Never trust userId/role from request body | enforced in service |
| Password | bcrypt 12 rounds | ✅ existing password.ts |
| Password | Never returned in any DTO | enforced in safeUser schema |
| Tokens | refreshTokenHash stored (bcrypt), never raw token | enforced in service |
| Tokens | refreshTokenHash never returned in session list | enforced in repository |
| Sessions | Revocation sets revoked_at (soft delete) | enforced in repository |
| Sessions | Refresh token rotation + mismatch → revoke | enforced in service |
| OAuth | state + code_verifier server-generated | enforced in service |
| OAuth | state single-use (Redis DEL on use) | enforced in service |
| OAuth | Token in URL fragment (not query param) | enforced in controller redirect |
| Redis | Only ephemeral PKCE state (300s TTL) | enforced in service |
| Redis | Redis fail → OAuth flow fails gracefully with 500 | caught in service |
| Rate limit | Auth routes use tighter limit from env | enforced in routes |
| Zod | All request bodies validated | enforced in routes |
| DTOs | No passwordHash, no tokenHash in any response | enforced in safeUser / safeSession schemas |
| Concurrency | N/A — no inventory/payment mutations in Phase 3 | — |
| Background jobs | Reset email via PgBoss (non-blocking) | enforced in service |
| Idempotency | Reset token is single-use (usedAt) | enforced in repository |
| RBAC | requireAuth / requireRole hooks on all protected routes | enforced in routes |
| Observability | Auth events logged with userId (no passwords/tokens) | enforced in service |

---

## Phase Gate Exit Criteria

A phase is **COMPLETE** only when ALL pass:

- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm lint` — zero errors
- [ ] `pnpm build` — succeeds
- [ ] All auth integration tests pass
- [ ] All users integration tests pass
- [ ] Existing health/catalog tests still pass (no regression)
- [ ] No `passwordHash` in any response
- [ ] No `refreshTokenHash` in any response
- [ ] Unauthenticated access to protected routes → 401
- [ ] Revoked session → 401
- [ ] Expired session → 401
- [ ] CUSTOMER → seller route → 403
- [ ] CUSTOMER → admin route → 403
- [ ] Address ownership isolation passes
- [ ] Session ownership isolation passes
- [ ] Rate limit triggers correctly
- [ ] Google OAuth `/initiate` returns authUrl or 501
- [ ] Password reset flow works end-to-end (dev log confirms email sent)
- [ ] State.md updated

---

## What Phase 3 Does NOT Do

- Real email delivery (Phase 10 — Phase 3 logs reset link to console)
- Seller registration / seller profile creation (Phase 5)
- Admin user management (Phase 9)
- Avatar upload (Phase 5 storage integration)
- OAuth beyond Google (Phase 9)
- 2FA (Phase 9)
- Account deletion (Phase 9)
