/**
 * Global Fastify error handler.
 *
 * Converts AppError subclasses and Zod/validation errors into the
 * standard API error response shape (AGENTS.md §39):
 *
 *   { "success": false, "error": { "code": "...", "message": "..." } }
 *
 * Never exposes stack traces, SQL errors, or internal details in responses.
 * Errors are logged with full context server-side.
 *
 * Implemented in Phase 1.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

// TODO: Phase 1 — implement full error handler
export function errorHandler(
  _error: FastifyError,
  _request: FastifyRequest,
  _reply: FastifyReply,
): void {
  // TODO: Phase 1
}
