/**
 * Centralized application error types.
 *
 * Services throw typed errors. The global Fastify error handler
 * (error-handler.ts) converts them to HTTP responses.
 * Controllers do not manually translate errors (AGENTS.md §38).
 *
 * Error code → HTTP status mapping:
 *   VALIDATION_ERROR       → 400
 *   UNAUTHORIZED           → 401
 *   FORBIDDEN              → 403
 *   NOT_FOUND              → 404
 *   CONFLICT               → 409
 *   TOO_MANY_REQUESTS      → 429
 *   INTERNAL_ERROR         → 500
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION_ERROR", message, 400, details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super("CONFLICT", message, 409, details);
    this.name = "ConflictError";
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super("TOO_MANY_REQUESTS", message, 429);
    this.name = "TooManyRequestsError";
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error") {
    super("INTERNAL_ERROR", message, 500);
    this.name = "InternalError";
  }
}
