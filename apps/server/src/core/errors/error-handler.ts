/**
 * Global Fastify error handler.
 *
 * Converts typed errors to the standard API error response shape (AGENTS.md §39):
 *   { "success": false, "error": { "code": "...", "message": "..." } }
 *
 * Never exposes stack traces, SQL errors, or secrets in responses.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./app-error";
import { createLogger } from "../logger/logger";

const logger = createLogger("error-handler");

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation errors → 400
  if (error instanceof ZodError) {
    const details = error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    void reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details,
      },
    });
    return;
  }

  // Typed application errors
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(
        { err: error, requestId: request.id, path: request.url },
        "Application error",
      );
    }
    void reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  // Fastify HTTP errors (from @fastify/sensible)
  if ("statusCode" in error && typeof error.statusCode === "number") {
    void reply.status(error.statusCode).send({
      success: false,
      error: {
        code: "HTTP_ERROR",
        message: error.message,
      },
    });
    return;
  }

  // Fastify validation errors (JSON schema)
  if (error.validation) {
    void reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.validation,
      },
    });
    return;
  }

  // Unknown errors → 500 (never expose internals)
  logger.error(
    { err: error, requestId: request.id, path: request.url },
    "Unhandled error",
  );
  void reply.status(500).send({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
