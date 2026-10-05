/**
 * Catalog service.
 *
 * Business logic layer for the public catalog (AGENTS.md §13).
 * Orchestrates repository calls, validates filter inputs, nests
 * categories into a hierarchy, and applies any business transforms.
 *
 * Rules:
 *  - Only ACTIVE products and ACTIVE sellers are visible publicly.
 *  - DRAFT/ARCHIVED/OUT_OF_STOCK products → 404 on detail endpoints.
 *  - Embedding field is never returned to callers.
 *  - Cursor must decode to a valid payload or be rejected.
 */
import { NotFoundError, ValidationError } from "../../core/errors/app-error";
import { createLogger } from "../../core/logger/logger";
import {
  findAllActiveCategories,
  findCategoryBySlug,
  findSubCategories,
  findProductById,
  findProductBySlug,
  findProductVariants,
  findSellerById,
  listProducts,
  listSellerProducts,
  type ProductListFilters,
  type ProductListItem,
  type ProductDetail,
  type SellerPublicProfile,
} from "./catalog.repository";
import type { Category } from "@marketplace/database";
import { decodeCursor } from "@marketplace/shared";

const logger = createLogger("catalog.service");

const MAX_SEARCH_LENGTH = 200;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// ─────────────────────────────────────────────
// CATEGORY TYPES
// ─────────────────────────────────────────────

export interface CategoryWithChildren extends Category {
  children: Category[];
}

// ─────────────────────────────────────────────
// CATEGORY SERVICE METHODS
// ─────────────────────────────────────────────

/**
 * Returns all active top-level categories with their children nested.
 * Two queries — no N+1.
 */
export async function listCategories(): Promise<CategoryWithChildren[]> {
  const all = await findAllActiveCategories();
  const topLevel = all.filter((c) => c.parentId === null);
  const byParent = new Map<string, Category[]>();

  for (const cat of all) {
    if (cat.parentId) {
      const existing = byParent.get(cat.parentId) ?? [];
      existing.push(cat);
      byParent.set(cat.parentId, existing);
    }
  }

  return topLevel.map((cat) => ({
    ...cat,
    children: byParent.get(cat.id) ?? [],
  }));
}

/**
 * Get a single category with its children.
 * Throws NotFoundError if not found or inactive.
 */
export async function getCategoryBySlug(slug: string): Promise<CategoryWithChildren> {
  const category = await findCategoryBySlug(slug);
  if (!category) {
    logger.debug({ slug }, "Category not found");
    throw new NotFoundError(`Category '${slug}' not found`);
  }
  const children = await findSubCategories(category.id);
  return { ...category, children };
}

// ─────────────────────────────────────────────
// PRODUCT SERVICE METHODS
// ─────────────────────────────────────────────

export interface ProductListInput {
  cursor?: string | undefined;
  limit?: number | undefined;
  categoryId?: string | undefined;
  categorySlug?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  brand?: string | undefined;
  inStock?: boolean | undefined;
  q?: string | undefined;
  sellerId?: string | undefined;
}

export interface ProductListResult {
  items: ProductListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * List active products with validation of input filters.
 */
export async function listProductsPublic(input: ProductListInput): Promise<ProductListResult> {
  // Validate limit
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Validate cursor if provided
  if (input.cursor) {
    const decoded = decodeCursor<{ createdAt: string; id: string }>(input.cursor);
    if (!decoded || !decoded.createdAt || !decoded.id) {
      throw new ValidationError("Invalid pagination cursor");
    }
  }

  // Validate search input length
  if (input.q && input.q.length > MAX_SEARCH_LENGTH) {
    throw new ValidationError(`Search query must be at most ${MAX_SEARCH_LENGTH} characters`);
  }

  // Resolve categorySlug → categoryId if needed
  let categoryId = input.categoryId;
  if (!categoryId && input.categorySlug) {
    const cat = await findCategoryBySlug(input.categorySlug);
    if (!cat) {
      // Unknown category slug → return empty result (not an error)
      return { items: [], nextCursor: null, hasMore: false };
    }
    categoryId = cat.id;
  }

  const filters: ProductListFilters = {
    cursor:     input.cursor ?? undefined,
    limit,
    categoryId: categoryId ?? undefined,
    sellerId:   input.sellerId ?? undefined,
    brand:      input.brand ?? undefined,
    minPrice:   input.minPrice ?? undefined,
    maxPrice:   input.maxPrice ?? undefined,
    inStock:    input.inStock ?? undefined,
    q:          input.q ?? undefined,
  };

  return listProducts(filters);
}

/**
 * Get full product detail.
 * Throws NotFoundError for non-existent or non-ACTIVE products.
 * Strips the embedding vector before returning (never exposed in API).
 */
export async function getProductDetail(productId: string): Promise<Omit<ProductDetail, "embedding">> {
  const product = await findProductById(productId);
  if (!product) {
    throw new NotFoundError("Product not found");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding: _embedding, ...safeProduct } = product;
  return safeProduct;
}

/**
 * Get product detail by slug.
 */
export async function getProductDetailBySlug(slug: string): Promise<Omit<ProductDetail, "embedding">> {
  const product = await findProductBySlug(slug);
  if (!product) {
    throw new NotFoundError("Product not found");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding: _embedding, ...safeProduct } = product;
  return safeProduct;
}

/**
 * Get active variants for a product.
 * Validates product exists first.
 */
export async function getProductVariants(productId: string): Promise<import("@marketplace/database").ProductVariant[]> {
  const product = await findProductById(productId);
  if (!product) {
    throw new NotFoundError("Product not found");
  }
  return findProductVariants(productId);
}

// ─────────────────────────────────────────────
// SELLER SERVICE METHODS
// ─────────────────────────────────────────────

/**
 * Get public seller profile.
 * Throws NotFoundError for non-existent or suspended sellers.
 */
export async function getSellerPublicProfile(sellerId: string): Promise<SellerPublicProfile> {
  const seller = await findSellerById(sellerId);
  if (!seller) {
    throw new NotFoundError("Seller not found");
  }
  return seller;
}

/**
 * Get active products for a seller's public page.
 */
export async function getSellerProducts(
  sellerId: string,
  input: Pick<ProductListInput, "cursor" | "limit">,
): Promise<ProductListResult> {
  // Verify seller exists and is active
  const seller = await findSellerById(sellerId);
  if (!seller) {
    throw new NotFoundError("Seller not found");
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  if (input.cursor) {
    const decoded = decodeCursor<{ createdAt: string; id: string }>(input.cursor);
    if (!decoded || !decoded.createdAt || !decoded.id) {
      throw new ValidationError("Invalid pagination cursor");
    }
  }

  return listSellerProducts(sellerId, { cursor: input.cursor ?? undefined, limit });
}
