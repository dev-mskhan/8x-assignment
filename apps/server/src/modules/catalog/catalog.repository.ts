/**
 * Catalog repository.
 *
 * Persistence logic only — no business rules (AGENTS.md §14).
 * All queries are bounded, paginated, and use explicit column selection.
 *
 * Public catalog visibility rule:
 *   - Products: status = 'ACTIVE' only
 *   - Sellers: status = 'ACTIVE' only
 *   - Categories: is_active = true only
 * These visibility filters are always applied here; the service layer must not
 * bypass them for public-facing endpoints.
 */
import { eq, and, gte, lte, ilike, lt, or, asc, desc, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../core/db/db";
import {
  products,
  productVariants,
  sellers,
  categories,
  type Product,
  type Category,
  type Seller,
  type ProductVariant,
} from "@marketplace/database";
import { decodeCursor, encodeCursor } from "@marketplace/shared";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface ProductListFilters {
  categoryId?: string | undefined;
  sellerId?: string | undefined;
  brand?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  inStock?: boolean | undefined;
  q?: string | undefined;       // text search on title/brand — max 200 chars (enforced in route schema)
  cursor?: string | undefined;
  limit?: number | undefined;   // default 20, max 100
}

export interface ProductListItem {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  categoryId: string;
  ratingAverage: string;
  reviewCount: number;
  status: string;
  images: unknown;
  sellerId: string;
  sellerName: string;
  storeSlug: string;
  minPrice: string | null;
  maxPrice: string | null;
  createdAt: Date;
}

export interface ProductDetail extends Product {
  category: Pick<Category, "id" | "name" | "slug"> | null;
  seller: Pick<Seller, "id" | "storeName" | "storeSlug" | "rating" | "logoUrl"> | null;
  variants: ProductVariant[];
}

export interface SellerPublicProfile extends Pick<Seller,
  "id" | "storeName" | "storeSlug" | "description" | "logoUrl" | "bannerUrl" | "rating" | "reviewCount" | "createdAt"
> {
  productCount: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────

export async function findAllActiveCategories(): Promise<Category[]> {
  const db = getDb();
  return db
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function findCategoryBySlug(slug: string): Promise<Category | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.isActive, true)));
  return row ?? null;
}

export async function findCategoryById(id: string): Promise<Category | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.isActive, true)));
  return row ?? null;
}

export async function findSubCategories(parentId: string): Promise<Category[]> {
  const db = getDb();
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.parentId, parentId), eq(categories.isActive, true)))
    .orderBy(asc(categories.sortOrder));
}

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

/**
 * List active products with cursor pagination.
 * Fetches limit+1 to detect hasNextPage without a COUNT(*) query.
 * Joins sellers for display name — no N+1.
 * Min/max price via subquery — no per-product variant loop.
 */
export async function listProducts(filters: ProductListFilters): Promise<{
  items: ProductListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const db = getDb();
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Decode cursor
  type CursorPayload = { createdAt: string; id: string };
  const cursorData = filters.cursor ? decodeCursor<CursorPayload>(filters.cursor) : null;

  // Build WHERE conditions
  const conditions = [eq(products.status, "ACTIVE")];

  if (filters.categoryId) {
    conditions.push(eq(products.categoryId, filters.categoryId));
  }
  if (filters.sellerId) {
    conditions.push(eq(products.sellerId, filters.sellerId));
  }
  if (filters.brand) {
    conditions.push(ilike(products.brand, filters.brand));
  }
  if (filters.q) {
    // Simple trigram-friendly ILIKE search on title and brand
    const pattern = `%${filters.q}%`;
    conditions.push(
      or(ilike(products.title, pattern), ilike(products.brand, pattern)) as SQL,
    );
  }

  // Price filters applied via variant subquery condition
  const priceConditions: ReturnType<typeof gte>[] = [];
  if (filters.minPrice !== undefined) {
    priceConditions.push(gte(productVariants.price, String(filters.minPrice)));
  }
  if (filters.maxPrice !== undefined) {
    priceConditions.push(lte(productVariants.price, String(filters.maxPrice)));
  }

  // Cursor condition: (created_at, id) < (cursor_created_at, cursor_id)
  if (cursorData) {
    const tieBreak = and(
      eq(products.createdAt, new Date(cursorData.createdAt)),
      lt(products.id, cursorData.id),
    ) as SQL;
    const cursorCondition = or(
      lt(products.createdAt, new Date(cursorData.createdAt)),
      tieBreak,
    ) as SQL;
    conditions.push(cursorCondition);
  }

  // Min/max price subquery — avoids N+1
  const priceSubquery = db
    .select({
      productId:  productVariants.productId,
      minPrice:   sql<string>`MIN(${productVariants.price})`.as("min_price"),
      maxPrice:   sql<string>`MAX(${productVariants.price})`.as("max_price"),
      hasStock:   sql<boolean>`MAX(${productVariants.stock} - ${productVariants.reservedStock}) > 0`.as("has_stock"),
    })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.isActive, true),
        ...priceConditions,
      ),
    )
    .groupBy(productVariants.productId)
    .as("pv");

  const rows = await db
    .select({
      id:            products.id,
      slug:          products.slug,
      title:         products.title,
      brand:         products.brand,
      categoryId:    products.categoryId,
      ratingAverage: products.ratingAverage,
      reviewCount:   products.reviewCount,
      status:        products.status,
      images:        products.images,
      sellerId:      products.sellerId,
      sellerName:    sellers.storeName,
      storeSlug:     sellers.storeSlug,
      minPrice:      priceSubquery.minPrice,
      maxPrice:      priceSubquery.maxPrice,
      createdAt:     products.createdAt,
    })
    .from(products)
    .innerJoin(sellers, and(eq(products.sellerId, sellers.id), eq(sellers.status, "ACTIVE")))
    .innerJoin(priceSubquery, eq(products.id, priceSubquery.productId))
    .where(
      and(
        ...conditions,
        // Apply inStock filter via the price subquery result
        filters.inStock ? eq(priceSubquery.hasStock, true) : undefined,
      ),
    )
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem
    ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
    : null;

  return { items: items as ProductListItem[], nextCursor, hasMore };
}

/**
 * Get a single active product with full detail.
 * Returns null for non-ACTIVE products (public endpoint treats them as not found).
 */
export async function findProductById(id: string): Promise<ProductDetail | null> {
  const db = getDb();

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.status, "ACTIVE")));

  if (!product) return null;

  const [category] = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, product.categoryId));

  const [seller] = await db
    .select({
      id:         sellers.id,
      storeName:  sellers.storeName,
      storeSlug:  sellers.storeSlug,
      rating:     sellers.rating,
      logoUrl:    sellers.logoUrl,
    })
    .from(sellers)
    .where(and(eq(sellers.id, product.sellerId), eq(sellers.status, "ACTIVE")));

  const variants = await db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, id), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.price));

  return {
    ...product,
    category: category ?? null,
    seller: seller ?? null,
    variants,
  };
}

/**
 * Get a product by slug (active only).
 */
export async function findProductBySlug(slug: string): Promise<ProductDetail | null> {
  const db = getDb();
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.status, "ACTIVE")));
  if (!product) return null;
  return findProductById(product.id);
}

/**
 * Get active variants for a product.
 */
export async function findProductVariants(productId: string): Promise<ProductVariant[]> {
  const db = getDb();
  return db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.price));
}

// ─────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────

export async function findSellerById(id: string): Promise<SellerPublicProfile | null> {
  const db = getDb();

  const [seller] = await db
    .select({
      id:          sellers.id,
      storeName:   sellers.storeName,
      storeSlug:   sellers.storeSlug,
      description: sellers.description,
      logoUrl:     sellers.logoUrl,
      bannerUrl:   sellers.bannerUrl,
      rating:      sellers.rating,
      reviewCount: sellers.reviewCount,
      createdAt:   sellers.createdAt,
    })
    .from(sellers)
    .where(and(eq(sellers.id, id), eq(sellers.status, "ACTIVE")));

  if (!seller) return null;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.sellerId, id), eq(products.status, "ACTIVE")));

  return { ...seller, productCount: countRow?.count ?? 0 };
}

export async function findSellerBySlug(slug: string): Promise<SellerPublicProfile | null> {
  const db = getDb();
  const [seller] = await db
    .select({ id: sellers.id })
    .from(sellers)
    .where(and(eq(sellers.storeSlug, slug), eq(sellers.status, "ACTIVE")));
  if (!seller) return null;
  return findSellerById(seller.id);
}

/**
 * List active products for a seller — used by the public seller page.
 */
export async function listSellerProducts(
  sellerId: string,
  filters: Pick<ProductListFilters, "cursor" | "limit">,
): Promise<{ items: ProductListItem[]; nextCursor: string | null; hasMore: boolean }> {
  return listProducts({ ...filters, sellerId });
}
