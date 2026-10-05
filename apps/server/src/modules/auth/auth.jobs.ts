/**
 * Auth background job names and payload types.
 *
 * Job names follow the convention: <module>.<action>
 * Use sendJob() from core/queue/jobs.ts — never call PgBoss directly (AGENTS.md §18).
 */

export const AUTH_JOBS = {
  SEND_RESET_EMAIL:   "auth.send-reset-email",
  SEND_WELCOME_EMAIL: "auth.send-welcome-email",
} as const;

export interface SendResetEmailPayload {
  userId:    string;
  email:     string;
  token:     string;     // raw token (not hash) — embedded in reset URL
  expiresAt: string;     // ISO-8601 string
}

export interface SendWelcomeEmailPayload {
  userId: string;
  email:  string;
  name:   string;
}
