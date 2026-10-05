/**
 * Users controller.
 *
 * HTTP boundary for user profile, addresses, and session management.
 * No business logic here (AGENTS.md §12).
 *
 * userId is ALWAYS taken from request.user.userId (JWT) — never from body.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  getMyProfile,
  updateMyProfile,
  getMyAddresses,
  addAddress,
  editAddress,
  removeAddress,
  makeDefaultAddress,
  getMySessions,
  revokeMySession,
} from "./users.service";
import {
  updateProfileSchema,
  createAddressSchema,
  updateAddressSchema,
} from "@marketplace/shared";
import { ValidationError } from "../../core/errors/app-error";

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────

export async function getProfileHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await getMyProfile(request.user.userId);
  await reply.status(200).send({ success: true, data: { user } });
}

export async function updateProfileHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = updateProfileSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  const user = await updateMyProfile(request.user.userId, input.data);
  await reply.status(200).send({ success: true, data: { user } });
}

// ─────────────────────────────────────────────
// ADDRESSES
// ─────────────────────────────────────────────

export async function listAddressesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const addresses = await getMyAddresses(request.user.userId);
  await reply.status(200).send({ success: true, data: { addresses } });
}

export async function createAddressHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = createAddressSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  const address = await addAddress(request.user.userId, {
    fullName:     input.data.fullName,
    phone:        input.data.phone,
    addressLine1: input.data.addressLine1,
    city:         input.data.city,
    postalCode:   input.data.postalCode,
    country:      input.data.country,
    isDefault:    input.data.isDefault,
    label:        input.data.label        ?? null,
    addressLine2: input.data.addressLine2 ?? null,
    state:        input.data.state        ?? null,
  });
  await reply.status(201).send({ success: true, data: { address } });
}

export async function updateAddressHandler(
  request: FastifyRequest<{ Params: { addressId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const input = updateAddressSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  const address = await editAddress(
    request.user.userId,
    request.params.addressId,
    {
      ...(input.data.fullName     !== undefined && { fullName:     input.data.fullName }),
      ...(input.data.phone        !== undefined && { phone:        input.data.phone }),
      ...(input.data.addressLine1 !== undefined && { addressLine1: input.data.addressLine1 }),
      ...(input.data.city         !== undefined && { city:         input.data.city }),
      ...(input.data.postalCode   !== undefined && { postalCode:   input.data.postalCode }),
      ...(input.data.country      !== undefined && { country:      input.data.country }),
      ...(input.data.isDefault    !== undefined && { isDefault:    input.data.isDefault }),
      ...(input.data.label        !== undefined && { label:        input.data.label        ?? null }),
      ...(input.data.addressLine2 !== undefined && { addressLine2: input.data.addressLine2 ?? null }),
      ...(input.data.state        !== undefined && { state:        input.data.state        ?? null }),
    },
  );
  await reply.status(200).send({ success: true, data: { address } });
}

export async function deleteAddressHandler(
  request: FastifyRequest<{ Params: { addressId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  await removeAddress(request.user.userId, request.params.addressId);
  await reply.status(200).send({ success: true, data: null });
}

export async function setDefaultAddressHandler(
  request: FastifyRequest<{ Params: { addressId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const addresses = await makeDefaultAddress(
    request.user.userId,
    request.params.addressId,
  );
  await reply.status(200).send({ success: true, data: { addresses } });
}

// ─────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────

export async function listSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessions = await getMySessions(request.user.userId, request.user.sessionId);
  await reply.status(200).send({ success: true, data: { sessions } });
}

export async function revokeSessionHandler(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  await revokeMySession(
    request.user.userId,
    request.params.sessionId,
    request.user.sessionId,
  );
  await reply.status(200).send({ success: true, data: null });
}
