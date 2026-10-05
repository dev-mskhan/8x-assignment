/**
 * Catalog routes.
 *
 * All public read-only endpoints — no authentication required.
 *
 * Validation: Zod schemas from @marketplace/shared are the source of truth.
 * The same schemas are available to frontend clients for type-safe API usage.
 *
 * Routes registered (prefix: /api/v1):
 *   GET /categories
 *   GET /categories/:slug
 *   GET /products
 *   GET /products/:productId
 *   GET /products/:productId/variants
 *   GET /sellers/:sellerId
 *   GET /sellers/:sellerId/products
 *
 * AGENTS.md §11: No SQL, business logic, or direct Redis/PgBoss calls here.
 */
import type { FastifyInstance } from "fastify";
import {
  getCategoryParamsSchema,
  listProductsQuerySchema,
  getProductParamsSchema,
  getSellerParamsSchema,
  getSellerProductsQuerySchema,
  type GetCategoryParams,
  type ListProductsQuery,
  type GetProductParams,
  type GetSellerParams,
  type GetSellerProductsQuery,
} from "@marketplace/shared";
import {
  getCategories,
  getCategoryHandler,
  listProductsHandler,
  getProductHandler,
  getProductVariantsHandler,
  getSellerHandler,
  getSellerProductsHandler,
} from "./catalog.controller";

// Re-export param/query types so the controller can import them from here
// (avoids a circular dep and keeps the controller's imports stable).
export type {
  GetCategoryParams,
  ListProductsQuery,
  GetProductParams,
  GetSellerParams,
  GetSellerProductsQuery,
};

// ─────────────────────────────────────────────
// Shared Fastify JSON Schema fragments
// (Fastify validates with AJV; Zod is used for runtime parse in controllers)
// ─────────────────────────────────────────────

const successShape = {
  type: "object" as const,
  properties: {
    success: { type: "boolean" as const },
    data: {},
  },
};

const errorShape = {
  type: "object" as const,
  properties: {
    success: { type: "boolean" as const, enum: [false] },
    error: {
      type: "object" as const,
      properties: {
        code:    { type: "string" as const },
        message: { type: "string" as const },
      },
    },
  },
};

// ─────────────────────────────────────────────
// ROUTE REGISTRATION
// ─────────────────────────────────────────────

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // ── Categories ────────────────────────────────────────────────────────────

  app.get(
    "/categories",
    {
      schema: {
        tags: ["catalog"],
        summary: "List all active categories",
        description:
          "Returns all active top-level categories with sub-categories nested as children.",
        response: { 200: successShape },
      },
    },
    getCategories,
  );

  app.get<{ Params: GetCategoryParams }>(
    "/categories/:slug",
    {
      schema: {
        tags: ["catalog"],
        summary: "Get category by slug",
        params: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string", minLength: 1, maxLength: 100 } },
        },
        response: { 200: successShape, 404: errorShape },
      },
    },
    getCategoryHandler,
  );

  // ── Products ──────────────────────────────────────────────────────────────

  app.get<{ Querystring: ListProductsQuery }>(
    "/products",
    {
      schema: {
        tags: ["catalog"],
        summary: "List products (paginated)",
        description:
          "Cursor-based paginated list of ACTIVE products. " +
          "Supports filtering by category, price, brand, stock, and text search.",
        querystring: {
          type: "object",
          properties: {
            cursor:       { type: "string" },
            limit:        { type: "integer", minimum: 1, maximum: 100, default: 20 },
            categoryId:   { type: "string", format: "uuid" },
            categorySlug: { type: "string", minLength: 1, maxLength: 100 },
            minPrice:     { type: "number", minimum: 0 },
            maxPrice:     { type: "number", minimum: 0 },
            brand:        { type: "string", minLength: 1, maxLength: 100 },
            inStock:      { type: "boolean" },
            q:            { type: "string", maxLength: 200 },
          },
          additionalProperties: false,
        },
        response: { 200: successShape, 400: errorShape },
      },
    },
    listProductsHandler,
  );

  app.get<{ Params: GetProductParams }>(
    "/products/:productId",
    {
      schema: {
        tags: ["catalog"],
        summary: "Get product detail",
        description:
          "Full product detail with variants, category, and seller info. " +
          "Returns 404 for DRAFT/ARCHIVED/suspended products.",
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        response: { 200: successShape, 404: errorShape },
      },
    },
    getProductHandler,
  );

  app.get<{ Params: GetProductParams }>(
    "/products/:productId/variants",
    {
      schema: {
        tags: ["catalog"],
        summary: "Get product variants",
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        response: { 200: successShape, 404: errorShape },
      },
    },
    getProductVariantsHandler,
  );

  // ── Sellers ───────────────────────────────────────────────────────────────

  app.get<{ Params: GetSellerParams }>(
    "/sellers/:sellerId",
    {
      schema: {
        tags: ["catalog"],
        summary: "Get seller public profile",
        description: "Returns 404 for suspended or non-existent sellers.",
        params: {
          type: "object",
          required: ["sellerId"],
          properties: { sellerId: { type: "string", format: "uuid" } },
        },
        response: { 200: successShape, 404: errorShape },
      },
    },
    getSellerHandler,
  );

  app.get<{ Params: GetSellerParams; Querystring: GetSellerProductsQuery }>(
    "/sellers/:sellerId/products",
    {
      schema: {
        tags: ["catalog"],
        summary: "List seller products",
        description: "Paginated ACTIVE products for a seller's public store page.",
        params: {
          type: "object",
          required: ["sellerId"],
          properties: { sellerId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string" },
            limit:  { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          additionalProperties: false,
        },
        response: { 200: successShape, 404: errorShape },
      },
    },
    getSellerProductsHandler,
  );
}

// Export the Zod schemas so the server can use them for manual parse() calls
export {
  getCategoryParamsSchema,
  listProductsQuerySchema,
  getProductParamsSchema,
  getSellerParamsSchema,
  getSellerProductsQuerySchema,
};
