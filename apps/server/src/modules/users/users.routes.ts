/**
 * Users routes.
 *
 * All routes require authentication (requireAuth preHandler).
 * userId is ALWAYS derived from the verified JWT — never from body or params.
 *
 * Registered at prefix /api/v1 (see app/routes.ts).
 *
 * AGENTS.md §11: No SQL, business logic, or direct Redis/PgBoss here.
 */
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../core/auth/hooks";
import {
  getProfileHandler,
  updateProfileHandler,
  listAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
  setDefaultAddressHandler,
  listSessionsHandler,
  revokeSessionHandler,
} from "./users.controller";

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // All users routes require auth
  app.addHook("preHandler", requireAuth);

  // ── Profile ───────────────────────────────────────────────────────────────
  app.get(
    "/users/me",
    { schema: { tags: ["users"], summary: "Get my profile" } },
    getProfileHandler,
  );

  app.patch(
    "/users/me",
    {
      schema: {
        tags: ["users"],
        summary: "Update my profile",
        body: {
          type: "object",
          properties: {
            name:      { type: "string", minLength: 1, maxLength: 255 },
            avatarUrl: { type: "string", format: "uri", nullable: true },
          },
          additionalProperties: false,
        },
      },
    },
    updateProfileHandler,
  );

  // ── Addresses ─────────────────────────────────────────────────────────────
  app.get(
    "/users/me/addresses",
    { schema: { tags: ["users"], summary: "List my addresses" } },
    listAddressesHandler,
  );

  app.post(
    "/users/me/addresses",
    {
      schema: {
        tags: ["users"],
        summary: "Add a new address",
        body: {
          type: "object",
          required: ["fullName", "phone", "addressLine1", "city", "postalCode", "country"],
          properties: {
            label:        { type: "string", maxLength: 50 },
            fullName:     { type: "string", minLength: 1, maxLength: 255 },
            phone:        { type: "string", minLength: 5, maxLength: 30 },
            addressLine1: { type: "string", minLength: 1, maxLength: 255 },
            addressLine2: { type: "string", maxLength: 255 },
            city:         { type: "string", minLength: 1, maxLength: 100 },
            state:        { type: "string", maxLength: 100 },
            postalCode:   { type: "string", minLength: 1, maxLength: 20 },
            country:      { type: "string", minLength: 2, maxLength: 100 },
            isDefault:    { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    createAddressHandler,
  );

  app.patch(
    "/users/me/addresses/:addressId",
    {
      schema: {
        tags: ["users"],
        summary: "Update an address",
        params: {
          type: "object",
          required: ["addressId"],
          properties: { addressId: { type: "string", format: "uuid" } },
        },
      },
    },
    updateAddressHandler,
  );

  app.delete(
    "/users/me/addresses/:addressId",
    {
      schema: {
        tags: ["users"],
        summary: "Delete an address",
        params: {
          type: "object",
          required: ["addressId"],
          properties: { addressId: { type: "string", format: "uuid" } },
        },
      },
    },
    deleteAddressHandler,
  );

  app.post(
    "/users/me/addresses/:addressId/default",
    {
      schema: {
        tags: ["users"],
        summary: "Set address as default",
        params: {
          type: "object",
          required: ["addressId"],
          properties: { addressId: { type: "string", format: "uuid" } },
        },
      },
    },
    setDefaultAddressHandler,
  );

  // ── Sessions ──────────────────────────────────────────────────────────────
  app.get(
    "/users/me/sessions",
    { schema: { tags: ["users"], summary: "List my active sessions" } },
    listSessionsHandler,
  );

  app.delete(
    "/users/me/sessions/:sessionId",
    {
      schema: {
        tags: ["users"],
        summary: "Revoke a session",
        params: {
          type: "object",
          required: ["sessionId"],
          properties: { sessionId: { type: "string", format: "uuid" } },
        },
      },
    },
    revokeSessionHandler,
  );
}
