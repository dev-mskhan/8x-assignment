/**
 * Auth context types and Fastify type augmentation.
 *
 * Adds `request.user` to every Fastify request after `requireAuth` runs.
 * Identity is ALWAYS derived from the verified JWT — never from request body.
 */
import type { UserRole } from "@marketplace/shared";
import "fastify";

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}
