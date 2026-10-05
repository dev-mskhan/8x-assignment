/**
 * Catalog controller.
 *
 * HTTP boundary — reads request params, calls service, returns responses.
 * No business logic here (AGENTS.md §12).
 * All response DTOs strip the embedding field (never exposed in API).
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  listCategories,
  getCategoryBySlug,
  listProductsPublic,
  getProductDetail,
  getProductVariants,
  getSellerPublicProfile,
  getSellerProducts,
} from "./catalog.service";
import type {
  GetCategoryParams,
  GetProductParams,
  ListProductsQuery,
  GetSellerParams,
  GetSellerProductsQuery,
} from "./catalog.routes.js";

// ─────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────

export async function getCategories(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const data = await listCategories();
  await reply.status(200).send({ success: true, data });
}

export async function getCategoryHandler(
  request: FastifyRequest<{ Params: GetCategoryParams }>,
  reply: FastifyReply,
): Promise<void> {
  const data = await getCategoryBySlug(request.params.slug);
  await reply.status(200).send({ success: true, data });
}

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

export async function listProductsHandler(
  request: FastifyRequest<{ Querystring: ListProductsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const q = request.query;
  const data = await listProductsPublic({
    ...(q.cursor       !== undefined && { cursor:       q.cursor }),
    ...(q.limit        !== undefined && { limit:        q.limit }),
    ...(q.categoryId   !== undefined && { categoryId:   q.categoryId }),
    ...(q.categorySlug !== undefined && { categorySlug: q.categorySlug }),
    ...(q.brand        !== undefined && { brand:        q.brand }),
    ...(q.minPrice     !== undefined && { minPrice:     q.minPrice }),
    ...(q.maxPrice     !== undefined && { maxPrice:     q.maxPrice }),
    ...(q.inStock      !== undefined && { inStock:      q.inStock }),
    ...(q.q            !== undefined && { q:            q.q }),
  });
  await reply.status(200).send({ success: true, data });
}

export async function getProductHandler(
  request: FastifyRequest<{ Params: GetProductParams }>,
  reply: FastifyReply,
): Promise<void> {
  const data = await getProductDetail(request.params.productId);
  await reply.status(200).send({ success: true, data });
}

export async function getProductVariantsHandler(
  request: FastifyRequest<{ Params: GetProductParams }>,
  reply: FastifyReply,
): Promise<void> {
  const data = await getProductVariants(request.params.productId);
  await reply.status(200).send({ success: true, data });
}

// ─────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────

export async function getSellerHandler(
  request: FastifyRequest<{ Params: GetSellerParams }>,
  reply: FastifyReply,
): Promise<void> {
  const data = await getSellerPublicProfile(request.params.sellerId);
  await reply.status(200).send({ success: true, data });
}

export async function getSellerProductsHandler(
  request: FastifyRequest<{ Params: GetSellerParams; Querystring: GetSellerProductsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const q = request.query;
  const data = await getSellerProducts(request.params.sellerId, {
    ...(q.cursor !== undefined && { cursor: q.cursor }),
    ...(q.limit  !== undefined && { limit:  q.limit }),
  });
  await reply.status(200).send({ success: true, data });
}
