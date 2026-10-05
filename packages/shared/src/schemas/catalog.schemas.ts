/**
 * Catalog Zod schemas.
 *
 * Source of truth for catalog API validation — shared between server routes
 * and any future frontend (tRPC client, form validation, etc.).
 *
 * Validation rules:
 *  - All UUID params validated as uuid
 *  - q (text search) capped at 200 chars (prevent abuse)
 *  - limit: 1–100, default 20
 *  - price filters: non-negative numbers
 *  - embedding is never in any response schema
 *  - passwordHash is never in any response schema
 */
import { z } from "zod";
import { uuidSchema } from "./index";

// ─────────────────────────────────────────────
// QUERY PARAM SCHEMAS
// ─────────────────────────────────────────────

/** GET /categories/:slug */
export const getCategoryParamsSchema = z.object({
  slug: z.string().min(1).max(100),
});

/** GET /products — query string */
export const listProductsQuerySchema = z.object({
  cursor:       z.string().optional(),
  limit:        z.coerce.number().int().min(1).max(100).default(20),
  categoryId:   uuidSchema.optional(),
  categorySlug: z.string().min(1).max(100).optional(),
  minPrice:     z.coerce.number().min(0).optional(),
  maxPrice:     z.coerce.number().min(0).optional(),
  brand:        z.string().min(1).max(100).optional(),
  inStock:      z.coerce.boolean().optional(),
  q:            z.string().max(200, "Search query must be at most 200 characters").optional(),
});

/** GET /products/:productId and GET /products/:productId/variants */
export const getProductParamsSchema = z.object({
  productId: uuidSchema,
});

/** GET /sellers/:sellerId and GET /sellers/:sellerId/products */
export const getSellerParamsSchema = z.object({
  sellerId: uuidSchema,
});

/** GET /sellers/:sellerId/products — query string */
export const getSellerProductsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

// ─────────────────────────────────────────────
// RESPONSE DTO SCHEMAS
// (usable by frontend for type-safe API client validation)
// ─────────────────────────────────────────────

/** Category (flat, as stored) */
export const categorySchema = z.object({
  id:          uuidSchema,
  name:        z.string(),
  slug:        z.string(),
  description: z.string().nullable(),
  imageUrl:    z.string().nullable(),
  parentId:    uuidSchema.nullable(),
  sortOrder:   z.number().int(),
  isActive:    z.boolean(),
  createdAt:   z.string().or(z.date()),
});

/** Category with nested children */
export const categoryWithChildrenSchema = categorySchema.extend({
  children: z.array(categorySchema),
});

/** Seller summary (used inside product list item) */
export const sellerSummarySchema = z.object({
  id:        uuidSchema,
  storeName: z.string(),
  storeSlug: z.string(),
  rating:    z.string().or(z.number()),
  logoUrl:   z.string().nullable(),
});

/** Product variant (returned in detail view) */
export const productVariantSchema = z.object({
  id:             uuidSchema,
  productId:      uuidSchema,
  sku:            z.string(),
  attributes:     z.unknown().nullable(),
  price:          z.string(),
  compareAtPrice: z.string().nullable(),
  stock:          z.number().int(),
  reservedStock:  z.number().int(),
  weightGrams:    z.number().int().nullable(),
  imageUrl:       z.string().nullable(),
  isActive:       z.boolean(),
  createdAt:      z.string().or(z.date()),
  updatedAt:      z.string().or(z.date()),
  // embedding is intentionally absent — never exposed in API
});

/** Product list item (lean — used in listing pages) */
export const productListItemSchema = z.object({
  id:            uuidSchema,
  slug:          z.string(),
  title:         z.string(),
  brand:         z.string().nullable(),
  categoryId:    uuidSchema,
  ratingAverage: z.string().or(z.number()),
  reviewCount:   z.number().int(),
  status:        z.string(),
  images:        z.unknown(),
  sellerId:      uuidSchema,
  sellerName:    z.string(),
  storeSlug:     z.string(),
  minPrice:      z.string().nullable(),
  maxPrice:      z.string().nullable(),
  createdAt:     z.string().or(z.date()),
});

/** Product detail (full — used on product page) */
export const productDetailSchema = z.object({
  id:             uuidSchema,
  sellerId:       uuidSchema,
  categoryId:     uuidSchema,
  title:          z.string(),
  slug:           z.string(),
  description:    z.string().nullable(),
  brand:          z.string().nullable(),
  images:         z.unknown(),
  specifications: z.unknown().nullable(),
  ratingAverage:  z.string().or(z.number()),
  reviewCount:    z.number().int(),
  status:         z.string(),
  createdAt:      z.string().or(z.date()),
  updatedAt:      z.string().or(z.date()),
  // embedding intentionally absent
  category:       z.object({
    id:   uuidSchema,
    name: z.string(),
    slug: z.string(),
  }).nullable(),
  seller: z.object({
    id:        uuidSchema,
    storeName: z.string(),
    storeSlug: z.string(),
    rating:    z.string().or(z.number()),
    logoUrl:   z.string().nullable(),
  }).nullable(),
  variants: z.array(productVariantSchema),
});

/** Public seller profile */
export const sellerProfileSchema = z.object({
  id:           uuidSchema,
  storeName:    z.string(),
  storeSlug:    z.string(),
  description:  z.string().nullable(),
  logoUrl:      z.string().nullable(),
  bannerUrl:    z.string().nullable(),
  rating:       z.string().or(z.number()),
  reviewCount:  z.number().int(),
  createdAt:    z.string().or(z.date()),
  productCount: z.number().int(),
});

/** Paginated product list response */
export const productListResponseSchema = z.object({
  items:      z.array(productListItemSchema),
  nextCursor: z.string().nullable(),
  hasMore:    z.boolean(),
});

// ─────────────────────────────────────────────
// INFERRED TYPES
// ─────────────────────────────────────────────

export type GetCategoryParams       = z.infer<typeof getCategoryParamsSchema>;
export type ListProductsQuery       = z.infer<typeof listProductsQuerySchema>;
export type GetProductParams        = z.infer<typeof getProductParamsSchema>;
export type GetSellerParams         = z.infer<typeof getSellerParamsSchema>;
export type GetSellerProductsQuery  = z.infer<typeof getSellerProductsQuerySchema>;

export type CategoryDto             = z.infer<typeof categorySchema>;
export type CategoryWithChildrenDto = z.infer<typeof categoryWithChildrenSchema>;
export type ProductListItemDto      = z.infer<typeof productListItemSchema>;
export type ProductDetailDto        = z.infer<typeof productDetailSchema>;
export type ProductVariantDto       = z.infer<typeof productVariantSchema>;
export type SellerProfileDto        = z.infer<typeof sellerProfileSchema>;
export type ProductListResponseDto  = z.infer<typeof productListResponseSchema>;
