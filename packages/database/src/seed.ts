/**
 * Database seed script.
 *
 * Creates realistic demo data for the marketplace.
 * Idempotent: uses ON CONFLICT DO NOTHING / upsert — safe to re-run.
 *
 * Execution order (respects FK constraints):
 *   1. Upload placeholder images to MinIO
 *   2. Users (5)
 *   3. Sellers (2)
 *   4. Categories (11: 6 top-level + 5 sub)
 *   5. Products (33) + Variants
 *   6. Addresses (4)
 *   7. Coupons (2)
 *   8. Orders (4) + OrderItems + Payments + Shipments
 *   9. Reviews (2 published)
 *  10. Returns (1 requested)
 *
 * Image strategy:
 *   9 generic placeholder images are programmatically generated (tiny colored JPEGs)
 *   and uploaded to MinIO. The same image is reused across multiple products.
 *   Real images are uploaded by sellers in Phase 5.
 *
 * Usage:
 *   pnpm db:seed
 *   DATABASE_URL=... tsx src/seed.ts
 */
import "dotenv/config";
import { config } from "dotenv";
import { resolve } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";

// Load root .env
config({ path: resolve(__dirname, "../../../.env") });

import * as schema from "./schema/index";

const {
  users, sessions, addresses,
  sellers, categories, products, productVariants,
  orders, orderItems, payments, shipments, shipmentTracking,
  returns: returnsTable, returnItems,
  reviews, coupons,
  wishlists, carts,
} = schema;

// ─────────────────────────────────────────────
// DB + STORAGE CONFIG
// ─────────────────────────────────────────────

const DATABASE_URL = process.env["DATABASE_URL"]!;
const STORAGE_ENDPOINT = process.env["STORAGE_ENDPOINT"] ?? "http://localhost:9000";
const STORAGE_ACCESS_KEY = process.env["STORAGE_ACCESS_KEY"] ?? "minioadmin";
const STORAGE_SECRET_KEY = process.env["STORAGE_SECRET_KEY"] ?? "minioadmin";
const STORAGE_BUCKET = process.env["STORAGE_BUCKET"] ?? "marketplace";
const STORAGE_PUBLIC_URL = (process.env["STORAGE_PUBLIC_URL"] ?? "http://localhost:9000/marketplace").replace(/\/$/, "");

// ─────────────────────────────────────────────
// PLACEHOLDER IMAGE GENERATOR
// Creates a tiny valid JPEG in-memory for each image type.
// A minimal JPEG: SOI + APP0 + DQT + SOF + DHT + SOS + EOI
// Using a pre-encoded 8x8 solid-color JPEG block (smallest valid JPEG).
// ─────────────────────────────────────────────

// Minimal valid 1×1 JPEG (gray, ~200 bytes) — used as placeholder
// Source: generated from a known-good minimal JPEG byte sequence
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
  "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
  "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIhAAAQQC" +
  "AgMAAAAAAAAAAAAAAQIDBAUREiFBUf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAA" +
  "AAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Amk2pa1NaeyFZEqOyXhtHJJJJAA7CSSSSf//Z",
  "base64",
);

// Image slot → key mapping. 9 images reused across all products/categories.
const IMAGE_SLOTS = {
  laptop:     "seed/generic-laptop.jpg",
  phone:      "seed/generic-phone.jpg",
  headphones: "seed/generic-headphones.jpg",
  peripheral: "seed/generic-peripheral.jpg",
  book:       "seed/generic-book.jpg",
  home:       "seed/generic-home.jpg",
  fashion:    "seed/generic-fashion.jpg",
  sports:     "seed/generic-sports.jpg",
  category:   "seed/generic-category.jpg",
} as const;

type ImageSlot = keyof typeof IMAGE_SLOTS;

async function ensureBucket(s3: S3Client): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: STORAGE_BUCKET }));
    console.log(`  bucket '${STORAGE_BUCKET}' already exists`);
  } catch {
    console.log(`  creating bucket '${STORAGE_BUCKET}'...`);
    await s3.send(new CreateBucketCommand({ Bucket: STORAGE_BUCKET }));
    // Set public read policy so seed image URLs work without auth
    const policy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${STORAGE_BUCKET}/*`],
      }],
    });
    await s3.send(new PutBucketPolicyCommand({
      Bucket: STORAGE_BUCKET,
      Policy: policy,
    }));
    console.log(`  bucket '${STORAGE_BUCKET}' created with public read policy`);
  }
}

async function uploadSeedImages(s3: S3Client): Promise<Record<ImageSlot, string>> {
  console.log("Uploading seed images to MinIO...");
  await ensureBucket(s3);

  const urls: Partial<Record<ImageSlot, string>> = {};

  for (const [slot, key] of Object.entries(IMAGE_SLOTS) as [ImageSlot, string][]) {
    await s3.send(new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      Body: MINIMAL_JPEG,
      ContentType: "image/jpeg",
    }));
    urls[slot] = `${STORAGE_PUBLIC_URL}/${key}`;
    console.log(`  ✓ ${slot} → ${urls[slot]}`);
  }

  console.log("Seed images uploaded.");
  return urls as Record<ImageSlot, string>;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

function zeroEmbedding(): number[] {
  return new Array(1536).fill(0);
}

/** Placeholder embedding for the ASUS ROG G16 — deterministic non-zero pattern
 * for Phase 8 AI search demo. Not a real OpenAI embedding. */
function rogG16Embedding(): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01) * 0.1);
}

function orderNumber(n: number): string {
  return `ORD-DEMO-${String(n).padStart(3, "0")}`;
}

function returnNumber(n: number): string {
  return `RET-DEMO-${String(n).padStart(3, "0")}`;
}

const DEMO_PASSWORD = "Demo@1234";
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

// ─────────────────────────────────────────────
// MAIN SEED
// ─────────────────────────────────────────────

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  // MinIO S3 client (only for seed image upload)
  const s3 = new S3Client({
    endpoint: STORAGE_ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: STORAGE_ACCESS_KEY, secretAccessKey: STORAGE_SECRET_KEY },
    forcePathStyle: true,
  });

  try {
    // ── 1. Upload images ────────────────────────────────────────────────────
    let img: Record<ImageSlot, string>;
    try {
      img = await uploadSeedImages(s3);
    } catch (err) {
      console.warn("WARNING: MinIO not available — using placeholder image paths.", (err as Error).message);
      // Fall back to relative paths — seed still works, images just won't load
      img = Object.fromEntries(
        Object.entries(IMAGE_SLOTS).map(([k, v]) => [k, `http://localhost:9000/marketplace/${v}`])
      ) as Record<ImageSlot, string>;
    }

    // ── 2. Users ────────────────────────────────────────────────────────────
    console.log("\nSeeding users...");
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    const [customer1] = await db.insert(users).values({
      email: "customer@demo.com",
      passwordHash,
      name: "Alice Chen",
      role: "CUSTOMER",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: "Alice Chen", role: "CUSTOMER", status: "ACTIVE" },
    }).returning();

    const [customer2] = await db.insert(users).values({
      email: "customer2@demo.com",
      passwordHash,
      name: "Bob Martinez",
      role: "CUSTOMER",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: "Bob Martinez", role: "CUSTOMER", status: "ACTIVE" },
    }).returning();

    const [sellerUser1] = await db.insert(users).values({
      email: "seller@demo.com",
      passwordHash,
      name: "TechVault Store",
      role: "SELLER",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: "TechVault Store", role: "SELLER", status: "ACTIVE" },
    }).returning();

    const [sellerUser2] = await db.insert(users).values({
      email: "seller2@demo.com",
      passwordHash,
      name: "GreenLeaf Market",
      role: "SELLER",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: "GreenLeaf Market", role: "SELLER", status: "ACTIVE" },
    }).returning();

    const [adminUser] = await db.insert(users).values({
      email: "admin@demo.com",
      passwordHash,
      name: "Platform Admin",
      role: "ADMIN",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: "Platform Admin", role: "ADMIN", status: "ACTIVE" },
    }).returning();

    console.log(`  ✓ Users: ${[customer1, customer2, sellerUser1, sellerUser2, adminUser].map(u => u!.email).join(", ")}`);

    // ── 3. Sellers ──────────────────────────────────────────────────────────
    console.log("\nSeeding sellers...");

    const [seller1] = await db.insert(sellers).values({
      userId: sellerUser1!.id,
      storeName: "TechVault",
      storeSlug: "techvault",
      description: "Your one-stop shop for premium electronics, gaming gear, and cutting-edge tech. We source directly from manufacturers to bring you the best prices.",
      logoUrl: img.category,
      bannerUrl: img.laptop,
      businessInfo: { gst: "27AABCT1234A1Z5", pan: "AABCT1234A", bank: "HDFC Bank" },
      rating: "4.7",
      reviewCount: 1284,
      commissionRate: "5.00",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: sellers.storeSlug,
      set: { storeName: "TechVault", status: "ACTIVE", rating: "4.7" },
    }).returning();

    const [seller2] = await db.insert(sellers).values({
      userId: sellerUser2!.id,
      storeName: "GreenLeaf Market",
      storeSlug: "greenleaf",
      description: "Curated books, home essentials, fitness gear, and sustainable fashion. We believe great products don't have to cost the earth.",
      logoUrl: img.category,
      bannerUrl: img.home,
      businessInfo: { gst: "06AABCG5678B1Z2", pan: "AABCG5678B", bank: "ICICI Bank" },
      rating: "4.5",
      reviewCount: 876,
      commissionRate: "5.00",
      status: "ACTIVE",
    }).onConflictDoUpdate({
      target: sellers.storeSlug,
      set: { storeName: "GreenLeaf Market", status: "ACTIVE", rating: "4.5" },
    }).returning();

    console.log(`  ✓ Sellers: ${seller1!.storeName}, ${seller2!.storeName}`);

    // ── 4. Categories ───────────────────────────────────────────────────────
    console.log("\nSeeding categories...");

    const upsertCategory = async (data: typeof categories.$inferInsert) => {
      const [row] = await db.insert(categories).values(data)
        .onConflictDoUpdate({ target: categories.slug, set: { name: data.name, isActive: true } })
        .returning();
      return row!;
    };

    const catElectronics  = await upsertCategory({ name: "Electronics",      slug: "electronics",    description: "Gadgets, devices & tech accessories", imageUrl: img.category, sortOrder: 1 });
    const catGaming       = await upsertCategory({ name: "Gaming",           slug: "gaming",         description: "Gaming laptops, consoles & peripherals", imageUrl: img.category, sortOrder: 2 });
    const catBooks        = await upsertCategory({ name: "Books",            slug: "books",          description: "Programming, design & self-improvement", imageUrl: img.book,     sortOrder: 3 });
    const catHome         = await upsertCategory({ name: "Home & Kitchen",   slug: "home-kitchen",   description: "Appliances, cookware & home essentials", imageUrl: img.home,     sortOrder: 4 });
    const catFashion      = await upsertCategory({ name: "Fashion",          slug: "fashion",        description: "Clothing, footwear & accessories", imageUrl: img.fashion,  sortOrder: 5 });
    const catSports       = await upsertCategory({ name: "Sports & Outdoors",slug: "sports-outdoors",description: "Fitness gear, camping & outdoor essentials", imageUrl: img.sports, sortOrder: 6 });

    // Sub-categories
    const catLaptops      = await upsertCategory({ name: "Laptops",          slug: "laptops",           imageUrl: img.laptop,     parentId: catElectronics.id, sortOrder: 1 });
    const catPhones       = await upsertCategory({ name: "Smartphones",      slug: "smartphones",       imageUrl: img.phone,      parentId: catElectronics.id, sortOrder: 2 });
    const catHeadphones   = await upsertCategory({ name: "Headphones",       slug: "headphones",        imageUrl: img.headphones, parentId: catElectronics.id, sortOrder: 3 });
    const catGamingLaptops = await upsertCategory({ name: "Gaming Laptops",  slug: "gaming-laptops",    imageUrl: img.laptop,     parentId: catGaming.id,      sortOrder: 1 });
    const catPeripherals  = await upsertCategory({ name: "Gaming Peripherals",slug: "gaming-peripherals",imageUrl: img.peripheral, parentId: catGaming.id,     sortOrder: 2 });

    console.log("  ✓ 11 categories created");

    // ── 5. Products + Variants ──────────────────────────────────────────────
    console.log("\nSeeding products...");

    type ProductInsert = typeof products.$inferInsert;
    // Variants passed without productId — it's injected inside upsertProduct
    type VariantData = Omit<typeof productVariants.$inferInsert, "productId">;

    const upsertProduct = async (data: ProductInsert, variantList: VariantData[]) => {
      const [prod] = await db.insert(products).values(data)
        .onConflictDoUpdate({
          target: products.slug,
          set: {
            title:         data.title,
            status:        data.status ?? "DRAFT",
            ratingAverage: data.ratingAverage ?? "0",
          },
        })
        .returning();

      for (const v of variantList) {
        await db.insert(productVariants).values({ ...v, productId: prod!.id })
          .onConflictDoUpdate({
            target: productVariants.sku,
            set: {
              price:    v.price,
              stock:    v.stock ?? 0,
              isActive: v.isActive ?? true,
            },
          });
      }
      return prod!;
    };

    // ── Gaming Laptops ──────────────────────────────────────────────────────

    // 1. ASUS ROG Strix G16 — AI demo target (non-zero embedding)
    const rogG16 = await upsertProduct({
      sellerId:      seller1!.id,
      categoryId:    catGamingLaptops.id,
      title:         "ASUS ROG Strix G16 Gaming Laptop",
      slug:          "asus-rog-strix-g16",
      description:   "Dominate every game with the ROG Strix G16 powered by the latest Intel Core i7 processor and NVIDIA GeForce RTX 4060. Features a 165Hz FHD IPS display, 16GB DDR5 RAM, and 512GB NVMe SSD for lightning-fast performance.",
      brand:         "ASUS",
      images:        [img.laptop, img.laptop],
      specifications: { GPU: "NVIDIA RTX 4060 8GB", CPU: "Intel Core i7-13650HX", RAM: "16GB DDR5 4800MHz", Storage: "512GB PCIe 4.0 NVMe SSD", Display: "16\" 165Hz FHD IPS", OS: "Windows 11 Home", Weight: "2.5kg", Battery: "90Wh" },
      ratingAverage: "4.6",
      reviewCount:   48,
      status:        "ACTIVE",
      embedding:     rogG16Embedding(),
    }, [
      { sku: "ROG-G16-16-512-BLK", attributes: { Color: "Eclipse Black", RAM: "16GB", Storage: "512GB" }, price: "145000.00", compareAtPrice: "165000.00", stock: 15, reservedStock: 0 },
      { sku: "ROG-G16-32-1TB-BLK", attributes: { Color: "Eclipse Black", RAM: "32GB", Storage: "1TB"   }, price: "185000.00", compareAtPrice: "210000.00", stock: 8,  reservedStock: 0 },
    ]);

    // 2. MSI Titan GT77
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catGamingLaptops.id,
      title: "MSI Titan GT77 Gaming Laptop", slug: "msi-titan-gt77",
      description: "Ultimate gaming powerhouse with RTX 4080 and Intel Core i9. Cherry MX mechanical keyboard, 4K mini-LED display, and 32GB DDR5 RAM.",
      brand: "MSI", images: [img.laptop],
      specifications: { GPU: "NVIDIA RTX 4080 12GB", CPU: "Intel Core i9-13980HX", RAM: "32GB DDR5", Storage: "2TB NVMe SSD", Display: "17.3\" 4K mini-LED 144Hz" },
      ratingAverage: "4.8", reviewCount: 22, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "MSI-GT77-32-2TB", attributes: { Color: "Titan Gray" }, price: "225000.00", compareAtPrice: "260000.00", stock: 5, reservedStock: 0 },
    ]);

    // 3. Lenovo LOQ Gaming Laptop
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catGamingLaptops.id,
      title: "Lenovo LOQ 15 Gaming Laptop", slug: "lenovo-loq-15",
      description: "Affordable gaming powerhouse with AMD Ryzen 5 and RTX 4050. 144Hz display and fast SSD make it ideal for casual to mid-level gaming.",
      brand: "Lenovo", images: [img.laptop],
      specifications: { GPU: "NVIDIA RTX 4050 6GB", CPU: "AMD Ryzen 5 7640HS", RAM: "16GB DDR5", Storage: "512GB NVMe SSD", Display: "15.6\" FHD 144Hz" },
      ratingAverage: "4.3", reviewCount: 67, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "LOQ-15-16-512-GRY", attributes: { Color: "Luna Grey" },   price: "89000.00",  compareAtPrice: "99000.00", stock: 20, reservedStock: 0 },
      { sku: "LOQ-15-16-512-STO", attributes: { Color: "Storm Grey" },  price: "91000.00",  compareAtPrice: "99000.00", stock: 12, reservedStock: 0 },
    ]);

    // 4. Razer Blade 14
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catGamingLaptops.id,
      title: "Razer Blade 14 Gaming Laptop", slug: "razer-blade-14",
      description: "Sleek and powerful with AMD Ryzen 9 and RTX 4070. Premium CNC aluminum chassis with per-key RGB. The thinnest and lightest 14-inch gaming laptop.",
      brand: "Razer", images: [img.laptop],
      specifications: { GPU: "NVIDIA RTX 4070 8GB", CPU: "AMD Ryzen 9 7940HX", RAM: "16GB DDR5", Storage: "1TB NVMe SSD", Display: "14\" 165Hz QHD IPS" },
      ratingAverage: "4.7", reviewCount: 33, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "RAZER-B14-16-1TB-BLK", attributes: { Color: "Stealth Black" }, price: "195000.00", compareAtPrice: "220000.00", stock: 6, reservedStock: 0 },
    ]);

    // 5. ASUS TUF Gaming A15 — one variant out of stock for demo
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catGamingLaptops.id,
      title: "ASUS TUF Gaming A15", slug: "asus-tuf-gaming-a15",
      description: "Military-grade durability meets gaming performance. Ryzen 7 and RTX 4060 in a rugged chassis with fast charging and long battery life.",
      brand: "ASUS", images: [img.laptop],
      specifications: { GPU: "NVIDIA RTX 4060 8GB", CPU: "AMD Ryzen 7 7745HX", RAM: "16GB DDR5", Storage: "512GB NVMe SSD", Display: "15.6\" FHD 144Hz" },
      ratingAverage: "4.4", reviewCount: 91, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "TUF-A15-8-512",   attributes: { Color: "Jaeger Gray", RAM: "8GB"  }, price: "78000.00", stock: 0,  reservedStock: 0, isActive: true },  // OUT OF STOCK demo
      { sku: "TUF-A15-16-512",  attributes: { Color: "Jaeger Gray", RAM: "16GB" }, price: "89000.00", stock: 18, reservedStock: 0 },
    ]);

    // ── Electronics / Laptops ───────────────────────────────────────────────

    // 6. MacBook Air M3
    const macbookAirM3 = await upsertProduct({
      sellerId: seller1!.id, categoryId: catLaptops.id,
      title: "Apple MacBook Air M3", slug: "apple-macbook-air-m3",
      description: "Supercharged by M3 chip for all-day battery life and blazing performance. Fanless design, stunning 13.6\" Liquid Retina display, and up to 18 hours of battery.",
      brand: "Apple", images: [img.laptop],
      specifications: { Chip: "Apple M3 8-core CPU", RAM: "8GB Unified Memory", Storage: "256GB SSD", Display: "13.6\" Liquid Retina", Battery: "Up to 18 hours", Weight: "1.24kg" },
      ratingAverage: "4.9", reviewCount: 215, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "MBA-M3-8-256-MNL",  attributes: { Color: "Midnight",  RAM: "8GB",  Storage: "256GB" }, price: "114900.00", stock: 30, reservedStock: 0 },
      { sku: "MBA-M3-16-512-SLV", attributes: { Color: "Silver",    RAM: "16GB", Storage: "512GB" }, price: "149900.00", stock: 20, reservedStock: 0 },
    ]);

    // 7. Dell XPS 15
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catLaptops.id,
      title: "Dell XPS 15 Laptop", slug: "dell-xps-15",
      description: "Premium productivity laptop with InfinityEdge OLED display, Intel Core i7 and NVIDIA RTX graphics. Built for creators and professionals.",
      brand: "Dell", images: [img.laptop],
      specifications: { CPU: "Intel Core i7-13700H", GPU: "NVIDIA RTX 4060 8GB", RAM: "16GB DDR5", Storage: "512GB NVMe SSD", Display: "15.6\" 3.5K OLED Touch" },
      ratingAverage: "4.6", reviewCount: 78, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "XPS15-I7-16-512-PLT", attributes: { Color: "Platinum Silver" }, price: "165000.00", stock: 12, reservedStock: 0 },
      { sku: "XPS15-I7-32-1TB-PLT", attributes: { Color: "Platinum Silver", RAM: "32GB" }, price: "205000.00", stock: 7, reservedStock: 0 },
    ]);

    // 8. HP Spectre x360
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catLaptops.id,
      title: "HP Spectre x360 14", slug: "hp-spectre-x360-14",
      description: "2-in-1 convertible powerhouse with Intel Evo platform. OLED touch display, 360-degree hinge, and premium gem-cut design.",
      brand: "HP", images: [img.laptop],
      specifications: { CPU: "Intel Core i7-1355U", RAM: "16GB LPDDR5", Storage: "512GB SSD", Display: "13.5\" 2.8K OLED Touch", Battery: "Up to 17 hours" },
      ratingAverage: "4.5", reviewCount: 45, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "SPECTRE-X360-16-512-NTB", attributes: { Color: "Nightfall Black" }, price: "145000.00", stock: 9, reservedStock: 0 },
      { sku: "SPECTRE-X360-16-512-SLV", attributes: { Color: "Natural Silver" },  price: "148000.00", stock: 6, reservedStock: 0 },
    ]);

    // ── Smartphones ─────────────────────────────────────────────────────────

    // 9. Samsung Galaxy S25 Ultra
    const galaxyS25 = await upsertProduct({
      sellerId: seller1!.id, categoryId: catPhones.id,
      title: "Samsung Galaxy S25 Ultra", slug: "samsung-galaxy-s25-ultra",
      description: "The ultimate Galaxy with integrated S Pen, 200MP camera, Snapdragon 8 Elite, and 6.9\" Dynamic AMOLED 2X display. AI-powered photography and productivity.",
      brand: "Samsung", images: [img.phone],
      specifications: { CPU: "Snapdragon 8 Elite", RAM: "12GB", Display: "6.9\" Dynamic AMOLED 2X 120Hz", Camera: "200MP+12MP+50MP+10MP", Battery: "5000mAh 45W", Storage: "256GB" },
      ratingAverage: "4.8", reviewCount: 342, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "S25U-12-128-TIT", attributes: { Color: "Titanium Black",  Storage: "128GB" }, price: "124999.00", stock: 25, reservedStock: 0 },
      { sku: "S25U-12-256-TIT", attributes: { Color: "Titanium Gray",   Storage: "256GB" }, price: "134999.00", stock: 18, reservedStock: 0 },
      { sku: "S25U-12-512-TIT", attributes: { Color: "Titanium Silver", Storage: "512GB" }, price: "154999.00", stock: 10, reservedStock: 0 },
    ]);

    // 10. Apple iPhone 16 Pro Max
    const iphone16ProMax = await upsertProduct({
      sellerId: seller1!.id, categoryId: catPhones.id,
      title: "Apple iPhone 16 Pro Max", slug: "apple-iphone-16-pro-max",
      description: "The most powerful iPhone ever. A18 Pro chip, 6.9\" Super Retina XDR ProMotion, 48MP Fusion camera with 5x optical zoom, and titanium design.",
      brand: "Apple", images: [img.phone],
      specifications: { Chip: "A18 Pro", Display: "6.9\" Super Retina XDR 120Hz", Camera: "48MP+48MP+12MP", Battery: "Up to 33 hours video", Storage: "256GB" },
      ratingAverage: "4.9", reviewCount: 567, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "IP16PM-256-BLK", attributes: { Color: "Black Titanium",   Storage: "256GB" }, price: "134900.00", stock: 22, reservedStock: 0 },
      { sku: "IP16PM-512-WHT", attributes: { Color: "White Titanium",   Storage: "512GB" }, price: "154900.00", stock: 15, reservedStock: 0 },
      { sku: "IP16PM-1TB-DST", attributes: { Color: "Desert Titanium",  Storage: "1TB"   }, price: "184900.00", stock: 8,  reservedStock: 0 },
    ]);

    // 11. Google Pixel 9 Pro
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catPhones.id,
      title: "Google Pixel 9 Pro", slug: "google-pixel-9-pro",
      description: "Google's most advanced Pixel with Tensor G4 chip, triple camera system with 50MP main, and 7 years of OS updates. Best-in-class AI features.",
      brand: "Google", images: [img.phone],
      specifications: { Chip: "Google Tensor G4", RAM: "16GB", Display: "6.3\" LTPO OLED 120Hz", Camera: "50MP+48MP+48MP", Battery: "4700mAh" },
      ratingAverage: "4.6", reviewCount: 128, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "PIX9P-16-128-OBS", attributes: { Color: "Obsidian",  Storage: "128GB" }, price: "89999.00", stock: 14, reservedStock: 0 },
      { sku: "PIX9P-16-256-PRC", attributes: { Color: "Porcelain", Storage: "256GB" }, price: "99999.00", stock: 9,  reservedStock: 0 },
    ]);

    // 12. OnePlus 13
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catPhones.id,
      title: "OnePlus 13", slug: "oneplus-13",
      description: "Flagship performance at mid-range price. Snapdragon 8 Elite, 50MP triple Hasselblad camera, 100W SuperVOOC charging, and 6000mAh battery.",
      brand: "OnePlus", images: [img.phone],
      specifications: { CPU: "Snapdragon 8 Elite", RAM: "12GB", Display: "6.82\" LTPO AMOLED 120Hz", Camera: "50MP+50MP+50MP Hasselblad", Battery: "6000mAh 100W" },
      ratingAverage: "4.5", reviewCount: 89, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "OP13-12-256-BLK", attributes: { Color: "Midnight Ocean", Storage: "256GB" }, price: "69999.00", stock: 20, reservedStock: 0 },
      { sku: "OP13-16-512-WHT", attributes: { Color: "Arctic Dawn",    Storage: "512GB" }, price: "79999.00", stock: 15, reservedStock: 0 },
    ]);

    // ── Headphones ──────────────────────────────────────────────────────────

    // 13. Sony WH-1000XM5
    const sonyXM5 = await upsertProduct({
      sellerId: seller1!.id, categoryId: catHeadphones.id,
      title: "Sony WH-1000XM5 Wireless Headphones", slug: "sony-wh-1000xm5",
      description: "Industry-leading noise canceling with 8 microphones and Auto NC Optimizer. Up to 30 hours battery, multipoint connection, and crystal clear call quality.",
      brand: "Sony", images: [img.headphones],
      specifications: { Type: "Over-ear", ANC: "Yes - Industry leading", Battery: "30 hours", Connectivity: "Bluetooth 5.2", Driver: "30mm", Weight: "250g" },
      ratingAverage: "4.8", reviewCount: 1203, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "XM5-BLK", attributes: { Color: "Black" },       price: "29990.00", compareAtPrice: "34990.00", stock: 35, reservedStock: 0 },
      { sku: "XM5-SLV", attributes: { Color: "Silver" },      price: "29990.00", compareAtPrice: "34990.00", stock: 22, reservedStock: 0 },
    ]);

    // 14. Apple AirPods Pro 3
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catHeadphones.id,
      title: "Apple AirPods Pro (3rd Gen)", slug: "apple-airpods-pro-3",
      description: "Up to 2x more Active Noise Cancellation. Adaptive Audio, Personalized Spatial Audio, and the H2 chip for intelligent sound. 30 hours total battery with case.",
      brand: "Apple", images: [img.headphones],
      specifications: { Type: "In-ear", ANC: "Adaptive ANC", Battery: "6h + 24h case", Connectivity: "Bluetooth 5.3", Chip: "H2", IPX: "IP54" },
      ratingAverage: "4.7", reviewCount: 892, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "APP3-WHT", attributes: { Color: "White" }, price: "24900.00", compareAtPrice: "26900.00", stock: 40, reservedStock: 0 },
    ]);

    // 15. Jabra Evolve2 85
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catHeadphones.id,
      title: "Jabra Evolve2 85 Professional Headset", slug: "jabra-evolve2-85",
      description: "Professional UC headset with best-in-class ANC and 10-mic technology. 37 hours battery, FlexBoom microphone, and compatibility with all major UC platforms.",
      brand: "Jabra", images: [img.headphones],
      specifications: { Type: "Over-ear", ANC: "ANC with HearThrough", Battery: "37 hours", Microphones: "10 mics", Connectivity: "Bluetooth 5.0 + USB" },
      ratingAverage: "4.5", reviewCount: 234, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "JBR-E85-BLK-MS",  attributes: { Color: "Black",  Platform: "MS Teams"  }, price: "32999.00", stock: 8, reservedStock: 0 },
      { sku: "JBR-E85-BLK-UC",  attributes: { Color: "Black",  Platform: "UC"        }, price: "32999.00", stock: 5, reservedStock: 0 },
    ]);

    // ── Gaming Peripherals ──────────────────────────────────────────────────

    // 16. Logitech G Pro X Superlight 2
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catPeripherals.id,
      title: "Logitech G Pro X Superlight 2 Gaming Mouse", slug: "logitech-g-pro-x-superlight-2",
      description: "Ultra-lightweight gaming mouse at 60g with HERO 2 sensor for precision up to 32,000 DPI. LIGHTSPEED wireless with 95 hours battery life.",
      brand: "Logitech", images: [img.peripheral],
      specifications: { Sensor: "HERO 2 32K DPI", Weight: "60g", Connectivity: "LIGHTSPEED Wireless", Battery: "95 hours", Buttons: "5 programmable" },
      ratingAverage: "4.9", reviewCount: 567, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "GPX2-BLK", attributes: { Color: "Black" }, price: "12999.00", compareAtPrice: "14999.00", stock: 25, reservedStock: 0 },
      { sku: "GPX2-WHT", attributes: { Color: "White" }, price: "12999.00", compareAtPrice: "14999.00", stock: 18, reservedStock: 0 },
    ]);

    // 17. Corsair K100 RGB Keyboard
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catPeripherals.id,
      title: "Corsair K100 RGB Mechanical Gaming Keyboard", slug: "corsair-k100-rgb",
      description: "The pinnacle of mechanical gaming keyboards. OPX optical-mechanical switches, per-key RGB, iCUE Control Wheel, and aircraft-grade aluminum frame.",
      brand: "Corsair", images: [img.peripheral],
      specifications: { Switch: "Corsair OPX Optical-Mechanical", Backlighting: "Per-key RGB", Form: "Full-size", Connection: "USB Type-C detachable" },
      ratingAverage: "4.7", reviewCount: 312, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "K100-OPX-BLK", attributes: { Color: "Black", Switch: "OPX" }, price: "17999.00", compareAtPrice: "19999.00", stock: 12, reservedStock: 0 },
    ]);

    // 18. HyperX Cloud Alpha
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catPeripherals.id,
      title: "HyperX Cloud Alpha Wireless Gaming Headset", slug: "hyperx-cloud-alpha-wireless",
      description: "300 hours battery life. Dual chamber drivers for reduced distortion, Discord certified microphone, and DTS Headphone:X Spatial Audio.",
      brand: "HyperX", images: [img.peripheral, img.headphones],
      specifications: { Driver: "50mm dual chamber", Battery: "300 hours", Connectivity: "2.4GHz wireless", Microphone: "Detachable noise-cancelling", Frequency: "13Hz–27,000Hz" },
      ratingAverage: "4.6", reviewCount: 445, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "HXCA-RED-BLK",  attributes: { Color: "Black/Red" }, price: "14999.00", compareAtPrice: "16999.00", stock: 20, reservedStock: 0 },
      { sku: "HXCA-BLU-BLK",  attributes: { Color: "Black/Blue"}, price: "14999.00", compareAtPrice: "16999.00", stock: 14, reservedStock: 0 },
    ]);

    // ── Books (seller2) ─────────────────────────────────────────────────────

    // 19. Clean Code
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catBooks.id,
      title: "Clean Code: A Handbook of Agile Software Craftsmanship", slug: "clean-code-robert-martin",
      description: "Robert C. Martin's seminal guide to writing clean, maintainable code. Essential reading for every professional programmer.",
      brand: "Pearson", images: [img.book],
      specifications: { Author: "Robert C. Martin", Pages: "464", Publisher: "Prentice Hall", ISBN: "978-0132350884", Language: "English" },
      ratingAverage: "4.8", reviewCount: 2341, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "BOOK-CLEANCODE-PB", attributes: { Format: "Paperback" }, price: "2499.00", compareAtPrice: "2999.00", stock: 50, reservedStock: 0 },
    ]);

    // 20. Designing Data-Intensive Applications
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catBooks.id,
      title: "Designing Data-Intensive Applications", slug: "designing-data-intensive-applications",
      description: "Martin Kleppmann's definitive guide to the principles behind reliable, scalable, and maintainable systems. A must-read for backend engineers.",
      brand: "O'Reilly", images: [img.book],
      specifications: { Author: "Martin Kleppmann", Pages: "590", Publisher: "O'Reilly Media", ISBN: "978-1449373320" },
      ratingAverage: "4.9", reviewCount: 1876, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "BOOK-DDIA-PB", attributes: { Format: "Paperback" }, price: "3299.00", stock: 35, reservedStock: 0 },
    ]);

    // 21. The Pragmatic Programmer
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catBooks.id,
      title: "The Pragmatic Programmer: 20th Anniversary Edition", slug: "pragmatic-programmer-20th",
      description: "Your journey to mastery. Updated for the modern era with new tips, exercises, and examples. The classic guide to developing software professionally.",
      brand: "Addison-Wesley", images: [img.book],
      specifications: { Author: "David Thomas, Andrew Hunt", Pages: "352", Publisher: "Addison-Wesley", Edition: "20th Anniversary" },
      ratingAverage: "4.7", reviewCount: 987, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "BOOK-PRAGPROG-PB", attributes: { Format: "Paperback" }, price: "2799.00", stock: 28, reservedStock: 0 },
    ]);

    // 22. System Design Interview (Vol 1 + 2)
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catBooks.id,
      title: "System Design Interview", slug: "system-design-interview",
      description: "Alex Xu's insider guide to cracking system design interviews at top tech companies. Covers real-world architecture for URL shorteners, Twitter, YouTube, and more.",
      brand: "ByteByteGo", images: [img.book],
      specifications: { Author: "Alex Xu", Publisher: "ByteByteGo Press" },
      ratingAverage: "4.6", reviewCount: 1234, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "BOOK-SDI-VOL1", attributes: { Volume: "Volume 1" }, price: "1999.00", stock: 45, reservedStock: 0 },
      { sku: "BOOK-SDI-VOL2", attributes: { Volume: "Volume 2" }, price: "1999.00", stock: 40, reservedStock: 0 },
    ]);

    // 23. You Don't Know JS
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catBooks.id,
      title: "You Don't Know JS Yet: Scope & Closures", slug: "you-dont-know-js-scope-closures",
      description: "Kyle Simpson's deep dive into JavaScript's scoping mechanisms, closures, and the module pattern. Essential for any serious JS developer.",
      brand: "O'Reilly", images: [img.book],
      specifications: { Author: "Kyle Simpson", Pages: "278", Publisher: "O'Reilly Media", Edition: "2nd Edition" },
      ratingAverage: "4.5", reviewCount: 567, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "BOOK-YDKJS-PB", attributes: { Format: "Paperback" }, price: "1799.00", stock: 30, reservedStock: 0 },
    ]);

    // ── Home & Kitchen (seller2) ─────────────────────────────────────────────

    // 24. Instant Pot Duo 7-in-1
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catHome.id,
      title: "Instant Pot Duo 7-in-1 Electric Pressure Cooker", slug: "instant-pot-duo-7-in-1",
      description: "Replace 7 kitchen appliances: pressure cooker, slow cooker, rice cooker, steamer, sauté, yogurt maker, and warmer. 14 built-in programs.",
      brand: "Instant Pot", images: [img.home],
      specifications: { Capacity: "6 quart", Functions: "7-in-1", Programs: "14 built-in", Material: "Stainless Steel", Wattage: "1000W" },
      ratingAverage: "4.7", reviewCount: 8934, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "IP-DUO-3QT", attributes: { Size: "3 Quart" }, price: "6999.00",  compareAtPrice: "8499.00", stock: 25, reservedStock: 0 },
      { sku: "IP-DUO-6QT", attributes: { Size: "6 Quart" }, price: "8999.00",  compareAtPrice: "10499.00",stock: 30, reservedStock: 0 },
    ]);

    // 25. Dyson V15 Detect
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catHome.id,
      title: "Dyson V15 Detect Cordless Vacuum", slug: "dyson-v15-detect",
      description: "Laser detects invisible dust. HEPA filtration, 60 min runtime, and automatically adapts suction for different floor types. Particle count LCD screen.",
      brand: "Dyson", images: [img.home],
      specifications: { Runtime: "60 minutes", Suction: "230 AW", Filter: "HEPA whole-machine filtration", Bin: "0.76L" },
      ratingAverage: "4.6", reviewCount: 2341, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "DYS-V15-YEL", attributes: { Color: "Yellow/Nickel" }, price: "52900.00", compareAtPrice: "59900.00", stock: 8, reservedStock: 0 },
    ]);

    // 26. Philips Air Fryer XXL
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catHome.id,
      title: "Philips Air Fryer XXL HD9650", slug: "philips-air-fryer-xxl",
      description: "7L family-size air fryer with Fat Removal Technology. Cooks 1.4kg whole chicken. NutriU app with 200+ recipes. Twin TurboStar technology.",
      brand: "Philips", images: [img.home],
      specifications: { Capacity: "7 liters", Technology: "Twin TurboStar", Temperature: "80-200°C", Wattage: "2225W" },
      ratingAverage: "4.5", reviewCount: 1678, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "PHI-AF-XXL-BLK", attributes: { Color: "Black" }, price: "14999.00", compareAtPrice: "17999.00", stock: 15, reservedStock: 0 },
    ]);

    // 27. Nespresso Vertuo Next
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catHome.id,
      title: "Nespresso Vertuo Next Coffee Machine", slug: "nespresso-vertuo-next",
      description: "Smart coffee machine with WiFi connectivity. Brew 5 cup sizes with Centrifusion technology. Connects to Nespresso app for personalized coffee journeys.",
      brand: "Nespresso", images: [img.home],
      specifications: { Technology: "Centrifusion", CupSizes: "5 (Espresso to Alto)", Pressure: "19 bar", WaterTank: "1.1L", WiFi: "Yes" },
      ratingAverage: "4.4", reviewCount: 891, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "NEX-BLK", attributes: { Color: "Matte Black" }, price: "11999.00", stock: 20, reservedStock: 0 },
      { sku: "NEX-WHT", attributes: { Color: "White"       }, price: "11999.00", stock: 18, reservedStock: 0 },
    ]);

    // ── Fashion (mixed sellers) ─────────────────────────────────────────────

    // 28. Nike Air Max 270
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catFashion.id,
      title: "Nike Air Max 270 Running Shoes", slug: "nike-air-max-270",
      description: "Nike's first lifestyle Air Max shoe with the largest heel Air unit yet for all-day cushioning. Mesh upper for breathability.",
      brand: "Nike", images: [img.fashion],
      specifications: { Type: "Running/Lifestyle", Sole: "Air Max 270", Upper: "Mesh", Closure: "Lace-up" },
      ratingAverage: "4.6", reviewCount: 3421, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "NIKE-AM270-BLK-7",  attributes: { Color: "Black/White", Size: "UK 7"  }, price: "10995.00", stock: 12, reservedStock: 0 },
      { sku: "NIKE-AM270-BLK-8",  attributes: { Color: "Black/White", Size: "UK 8"  }, price: "10995.00", stock: 15, reservedStock: 0 },
      { sku: "NIKE-AM270-BLK-9",  attributes: { Color: "Black/White", Size: "UK 9"  }, price: "10995.00", stock: 10, reservedStock: 0 },
    ]);

    // 29. Levi's 511 Slim Fit Jeans
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catFashion.id,
      title: "Levi's 511 Slim Fit Jeans", slug: "levis-511-slim-fit-jeans",
      description: "Slim fit through the hip and thigh with a straight leg. Classic 5-pocket styling in stretch denim for all-day comfort.",
      brand: "Levi's", images: [img.fashion],
      specifications: { Fit: "Slim", Rise: "Mid-rise", Material: "98% Cotton 2% Elastane", Closure: "Button + zip" },
      ratingAverage: "4.4", reviewCount: 1876, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "LEV-511-IND-30x32", attributes: { Color: "Indigo", Size: "30x32" }, price: "3999.00", stock: 20, reservedStock: 0 },
      { sku: "LEV-511-IND-32x32", attributes: { Color: "Indigo", Size: "32x32" }, price: "3999.00", stock: 18, reservedStock: 0 },
      { sku: "LEV-511-IND-34x32", attributes: { Color: "Indigo", Size: "34x32" }, price: "3999.00", stock: 15, reservedStock: 0 },
    ]);

    // 30. Ray-Ban Aviator Sunglasses
    await upsertProduct({
      sellerId: seller1!.id, categoryId: catFashion.id,
      title: "Ray-Ban Classic Aviator Sunglasses", slug: "ray-ban-classic-aviator",
      description: "Iconic RB3025 aviator with teardrop-shaped lenses. 100% UV protection, lightweight metal frame, and adjustable nose pads for a perfect fit.",
      brand: "Ray-Ban", images: [img.fashion],
      specifications: { Frame: "Metal", Lens: "Glass", UVProtection: "100% UV400", Style: "Aviator", Size: "58mm" },
      ratingAverage: "4.7", reviewCount: 2134, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "RB3025-GLD-GRN", attributes: { Frame: "Gold",   Lens: "Green Classic G-15" }, price: "8990.00", stock: 22, reservedStock: 0 },
      { sku: "RB3025-SLV-BLU", attributes: { Frame: "Silver", Lens: "Blue Mirror"         }, price: "9490.00", stock: 15, reservedStock: 0 },
    ]);

    // ── Sports & Outdoors (seller2) ─────────────────────────────────────────

    // 31. Fitbit Charge 6
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catSports.id,
      title: "Fitbit Charge 6 Fitness Tracker", slug: "fitbit-charge-6",
      description: "Advanced fitness tracker with built-in GPS, ECG app, and Google integrations. 40+ exercise modes, 7-day battery, and stress management tools.",
      brand: "Fitbit", images: [img.sports],
      specifications: { GPS: "Built-in", Battery: "7 days", Display: "AMOLED", WaterResistance: "50m", Sensors: "ECG, SpO2, EDA" },
      ratingAverage: "4.4", reviewCount: 1123, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "FIT-C6-BLK", attributes: { Color: "Black/Graphite"  }, price: "12999.00", stock: 25, reservedStock: 0 },
      { sku: "FIT-C6-CRL", attributes: { Color: "Coral/Champagne" }, price: "12999.00", stock: 18, reservedStock: 0 },
    ]);

    // 32. Coleman Sundome Tent
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catSports.id,
      title: "Coleman Sundome Camping Tent", slug: "coleman-sundome-tent",
      description: "Easy setup dome tent with WeatherTec system. Patented welded floors and inverted seams keep water out. Color-coded poles for quick pitch.",
      brand: "Coleman", images: [img.sports],
      specifications: { SetupTime: "10 minutes", WeatherRating: "WeatherTec", Doors: "1", Windows: "2", Poles: "Fiberglass" },
      ratingAverage: "4.3", reviewCount: 3456, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "COL-SDOME-2P", attributes: { Capacity: "2 Person" }, price: "5999.00",  stock: 12, reservedStock: 0 },
      { sku: "COL-SDOME-4P", attributes: { Capacity: "4 Person" }, price: "8999.00",  stock: 8,  reservedStock: 0 },
    ]);

    // 33. Garmin Forerunner 255
    await upsertProduct({
      sellerId: seller2!.id, categoryId: catSports.id,
      title: "Garmin Forerunner 255 GPS Running Watch", slug: "garmin-forerunner-255",
      description: "Advanced GPS smartwatch for runners with Training Readiness, HRV Status, and 30 hours GPS battery. Multi-band GPS for accuracy in challenging environments.",
      brand: "Garmin", images: [img.sports],
      specifications: { GPS: "Multi-band", Battery: "30 hours GPS / 14 days smartwatch", Display: "MIP always-on", WaterResistance: "5ATM", Weight: "49g" },
      ratingAverage: "4.6", reviewCount: 678, status: "ACTIVE", embedding: zeroEmbedding(),
    }, [
      { sku: "GAR-FR255-BLK", attributes: { Color: "Black", Size: "Standard 46mm" }, price: "29999.00", stock: 10, reservedStock: 0 },
    ]);

    console.log("  ✓ 33 products with variants created");

    // ── 6. Addresses ────────────────────────────────────────────────────────
    console.log("\nSeeding addresses...");

    await db.insert(addresses).values({
      userId:       customer1!.id,
      label:        "Home",
      fullName:     "Alice Chen",
      phone:        "+91 98765 43210",
      addressLine1: "42, Bandra West",
      addressLine2: "Near Linking Road",
      city:         "Mumbai",
      state:        "Maharashtra",
      postalCode:   "400050",
      country:      "India",
      isDefault:    true,
    }).onConflictDoNothing();

    await db.insert(addresses).values({
      userId:       customer2!.id,
      label:        "Home",
      fullName:     "Bob Martinez",
      phone:        "+91 99887 76543",
      addressLine1: "15, Connaught Place",
      city:         "New Delhi",
      state:        "Delhi",
      postalCode:   "110001",
      country:      "India",
      isDefault:    true,
    }).onConflictDoNothing();

    console.log("  ✓ Addresses created");

    // ── 7. Coupons ──────────────────────────────────────────────────────────
    console.log("\nSeeding coupons...");

    await db.insert(coupons).values({
      code:              "WELCOME10",
      type:             "PERCENTAGE",
      value:            "10.00",
      minimumOrderValue: "1000.00",
      maximumDiscount:   "500.00",
      usageLimit:        1000,
      usedCount:         47,
      isActive:          true,
    }).onConflictDoUpdate({ target: coupons.code, set: { isActive: true } });

    await db.insert(coupons).values({
      code:              "FLAT500",
      type:             "FIXED",
      value:            "500.00",
      minimumOrderValue: "5000.00",
      usageLimit:        500,
      usedCount:         23,
      isActive:          true,
    }).onConflictDoUpdate({ target: coupons.code, set: { isActive: true } });

    console.log("  ✓ Coupons: WELCOME10, FLAT500");

    // ── 8. Orders ───────────────────────────────────────────────────────────
    console.log("\nSeeding demo orders...");

    const alice_address = {
      fullName: "Alice Chen", phone: "+91 98765 43210",
      addressLine1: "42, Bandra West", city: "Mumbai",
      state: "Maharashtra", postalCode: "400050", country: "India",
    };

    const bob_address = {
      fullName: "Bob Martinez", phone: "+91 99887 76543",
      addressLine1: "15, Connaught Place", city: "New Delhi",
      state: "Delhi", postalCode: "110001", country: "India",
    };

    // Fetch variant IDs needed for orders
    const [rogVariant] = await db.select().from(productVariants)
      .where(eq(productVariants.sku, "ROG-G16-32-1TB-BLK"));
    const [galaxyVariant] = await db.select().from(productVariants)
      .where(eq(productVariants.sku, "S25U-12-256-TIT"));
    const [macbookVariant] = await db.select().from(productVariants)
      .where(eq(productVariants.sku, "MBA-M3-8-256-MNL"));
    const [sonyVariantBlk] = await db.select().from(productVariants)
      .where(eq(productVariants.sku, "XM5-BLK"));

    // ORD-DEMO-001: Alice — ROG G16 (32GB) — DELIVERED + PAID → review-eligible + returnable
    const [ord1] = await db.insert(orders).values({
      orderNumber:     orderNumber(1),
      idempotencyKey:  "seed-ord-001",
      userId:          customer1!.id,
      shippingAddress: alice_address,
      subtotal:        "185000.00",
      shippingFee:     "0.00",
      tax:             "0.00",
      discount:        "0.00",
      total:           "185000.00",
      status:          "DELIVERED",
      paymentStatus:   "PAID",
      createdAt:       daysAgo(20),
      updatedAt:       daysAgo(15),
    }).onConflictDoUpdate({
      target: orders.idempotencyKey,
      set: { status: "DELIVERED", paymentStatus: "PAID" },
    }).returning();

    await db.insert(orderItems).values({
      orderId:            ord1!.id,
      productId:          rogG16.id,
      variantId:          rogVariant!.id,
      sellerId:           seller1!.id,
      titleSnapshot:      "ASUS ROG Strix G16 Gaming Laptop",
      skuSnapshot:        "ROG-G16-32-1TB-BLK",
      attributesSnapshot: { Color: "Eclipse Black", RAM: "32GB", Storage: "1TB" },
      unitPriceSnapshot:  "185000.00",
      quantity:           1,
      subtotalSnapshot:   "185000.00",
    }).onConflictDoNothing();

    await db.insert(payments).values({
      orderId:        ord1!.id,
      provider:       "cod",
      amount:         "185000.00",
      currency:       "INR",
      method:         "cod",
      status:         "PAID",
      idempotencyKey: "seed-pay-001",
      metadata:       { note: "Seed demo payment" },
    }).onConflictDoUpdate({ target: payments.idempotencyKey, set: { status: "PAID" } });

    const [ship1] = await db.insert(shipments).values({
      orderId:           ord1!.id,
      carrier:           "BlueDart",
      trackingNumber:    "BD123456789IN",
      status:            "DELIVERED",
      estimatedDelivery: daysAgo(16),
      shippedAt:         daysAgo(18),
      deliveredAt:       daysAgo(15),
    }).onConflictDoNothing().returning();

    if (ship1) {
      await db.insert(shipmentTracking).values([
        { shipmentId: ship1.id, status: "SHIPPED",           location: "Mumbai Hub",      description: "Package picked up",           occurredAt: daysAgo(18) },
        { shipmentId: ship1.id, status: "IN_TRANSIT",        location: "Pune Depot",      description: "In transit to destination",    occurredAt: daysAgo(17) },
        { shipmentId: ship1.id, status: "OUT_FOR_DELIVERY",  location: "Bandra West",     description: "Out for delivery",             occurredAt: daysAgo(15) },
        { shipmentId: ship1.id, status: "DELIVERED",         location: "Bandra West",     description: "Delivered to customer",        occurredAt: daysAgo(15) },
      ]).onConflictDoNothing();
    }

    // ORD-DEMO-002: Alice — Galaxy S25 Ultra — SHIPPED (tracking demo)
    const [ord2] = await db.insert(orders).values({
      orderNumber:     orderNumber(2),
      idempotencyKey:  "seed-ord-002",
      userId:          customer1!.id,
      shippingAddress: alice_address,
      subtotal:        "134999.00",
      shippingFee:     "0.00",
      tax:             "0.00",
      discount:        "0.00",
      total:           "134999.00",
      status:          "SHIPPED",
      paymentStatus:   "PAID",
      createdAt:       daysAgo(5),
      updatedAt:       daysAgo(3),
    }).onConflictDoUpdate({
      target: orders.idempotencyKey,
      set: { status: "SHIPPED", paymentStatus: "PAID" },
    }).returning();

    await db.insert(orderItems).values({
      orderId:            ord2!.id,
      productId:          galaxyS25.id,
      variantId:          galaxyVariant!.id,
      sellerId:           seller1!.id,
      titleSnapshot:      "Samsung Galaxy S25 Ultra",
      skuSnapshot:        "S25U-12-256-TIT",
      attributesSnapshot: { Color: "Titanium Gray", Storage: "256GB" },
      unitPriceSnapshot:  "134999.00",
      quantity:           1,
      subtotalSnapshot:   "134999.00",
    }).onConflictDoNothing();

    await db.insert(payments).values({
      orderId: ord2!.id, provider: "cod", amount: "134999.00", currency: "INR",
      method: "cod", status: "PAID", idempotencyKey: "seed-pay-002",
    }).onConflictDoUpdate({ target: payments.idempotencyKey, set: { status: "PAID" } });

    const [ship2] = await db.insert(shipments).values({
      orderId: ord2!.id, carrier: "FedEx", trackingNumber: "FX987654321IN",
      status: "IN_TRANSIT", estimatedDelivery: daysAgo(-2),
      shippedAt: daysAgo(3),
    }).onConflictDoNothing().returning();

    if (ship2) {
      await db.insert(shipmentTracking).values([
        { shipmentId: ship2.id, status: "SHIPPED",    location: "Mumbai Hub",  description: "Package dispatched",       occurredAt: daysAgo(3) },
        { shipmentId: ship2.id, status: "IN_TRANSIT", location: "Delhi Hub",   description: "Arrived at transit hub",   occurredAt: daysAgo(1) },
      ]).onConflictDoNothing();
    }

    // ORD-DEMO-003: Bob — MacBook Air M3 — PROCESSING (order status demo)
    const [ord3] = await db.insert(orders).values({
      orderNumber:     orderNumber(3),
      idempotencyKey:  "seed-ord-003",
      userId:          customer2!.id,
      shippingAddress: bob_address,
      subtotal:        "114900.00",
      shippingFee:     "0.00",
      tax:             "0.00",
      discount:        "0.00",
      total:           "114900.00",
      status:          "PROCESSING",
      paymentStatus:   "PAID",
      createdAt:       daysAgo(2),
      updatedAt:       daysAgo(1),
    }).onConflictDoUpdate({
      target: orders.idempotencyKey,
      set: { status: "PROCESSING", paymentStatus: "PAID" },
    }).returning();

    await db.insert(orderItems).values({
      orderId:            ord3!.id,
      productId:          macbookAirM3.id,
      variantId:          macbookVariant!.id,
      sellerId:           seller1!.id,
      titleSnapshot:      "Apple MacBook Air M3",
      skuSnapshot:        "MBA-M3-8-256-MNL",
      attributesSnapshot: { Color: "Midnight", RAM: "8GB", Storage: "256GB" },
      unitPriceSnapshot:  "114900.00",
      quantity:           1,
      subtotalSnapshot:   "114900.00",
    }).onConflictDoNothing();

    await db.insert(payments).values({
      orderId: ord3!.id, provider: "cod", amount: "114900.00", currency: "INR",
      method: "cod", status: "PAID", idempotencyKey: "seed-pay-003",
    }).onConflictDoUpdate({ target: payments.idempotencyKey, set: { status: "PAID" } });

    // ORD-DEMO-004: Alice — Sony WH-1000XM5 — DELIVERED → review-eligible
    const [ord4] = await db.insert(orders).values({
      orderNumber:     orderNumber(4),
      idempotencyKey:  "seed-ord-004",
      userId:          customer1!.id,
      shippingAddress: alice_address,
      subtotal:        "29990.00",
      shippingFee:     "0.00",
      tax:             "0.00",
      discount:        "0.00",
      total:           "29990.00",
      status:          "DELIVERED",
      paymentStatus:   "PAID",
      createdAt:       daysAgo(30),
      updatedAt:       daysAgo(25),
    }).onConflictDoUpdate({
      target: orders.idempotencyKey,
      set: { status: "DELIVERED", paymentStatus: "PAID" },
    }).returning();

    await db.insert(orderItems).values({
      orderId:            ord4!.id,
      productId:          sonyXM5.id,
      variantId:          sonyVariantBlk!.id,
      sellerId:           seller1!.id,
      titleSnapshot:      "Sony WH-1000XM5 Wireless Headphones",
      skuSnapshot:        "XM5-BLK",
      attributesSnapshot: { Color: "Black" },
      unitPriceSnapshot:  "29990.00",
      quantity:           1,
      subtotalSnapshot:   "29990.00",
    }).onConflictDoNothing();

    await db.insert(payments).values({
      orderId: ord4!.id, provider: "cod", amount: "29990.00", currency: "INR",
      method: "cod", status: "PAID", idempotencyKey: "seed-pay-004",
    }).onConflictDoUpdate({ target: payments.idempotencyKey, set: { status: "PAID" } });

    console.log("  ✓ 4 demo orders created");

    // ── 9. Reviews ──────────────────────────────────────────────────────────
    console.log("\nSeeding reviews...");

    await db.insert(schema.reviews).values({
      userId:           customer1!.id,
      productId:        sonyXM5.id,
      orderId:          ord4!.id,
      rating:           5,
      title:            "Best headphones I've ever owned",
      comment:          "Incredible noise cancellation. I use these daily for work-from-home and they completely block out background noise. Sound quality is phenomenal, especially with LDAC. Battery lasts forever. Worth every rupee.",
      images:           [],
      verifiedPurchase: true,
      status:           "PUBLISHED",
      createdAt:        daysAgo(22),
      updatedAt:        daysAgo(22),
    }).onConflictDoNothing();

    await db.insert(schema.reviews).values({
      userId:           customer1!.id,
      productId:        rogG16.id,
      orderId:          ord1!.id,
      rating:           5,
      title:            "Outstanding gaming laptop — RTX 4060 crushes every game",
      comment:          "This machine handles everything I throw at it. Cyberpunk 2077, Alan Wake 2 at high settings 1080p easily 80+ fps. The 165Hz display makes motion silky smooth. Build quality feels premium. Thermal performance is great with the ROG cooling system. Highly recommend.",
      images:           [],
      verifiedPurchase: true,
      status:           "PUBLISHED",
      createdAt:        daysAgo(12),
      updatedAt:        daysAgo(12),
    }).onConflictDoNothing();

    console.log("  ✓ 2 published reviews created");

    // ── 10. Returns ─────────────────────────────────────────────────────────
    console.log("\nSeeding return...");

    const [ret1] = await db.insert(returnsTable).values({
      orderId:      ord1!.id,
      userId:       customer1!.id,
      returnNumber: returnNumber(1),
      reason:       "DEFECTIVE",
      description:  "The left speaker occasionally cuts out after 2 hours of gaming. Tried all troubleshooting steps but issue persists.",
      images:       [],
      status:       "REQUESTED",
      createdAt:    daysAgo(10),
      updatedAt:    daysAgo(10),
    }).onConflictDoNothing().returning();

    if (ret1) {
      const [ord1Item] = await db.select().from(orderItems)
        .where(and(eq(orderItems.orderId, ord1!.id), eq(orderItems.skuSnapshot, "ROG-G16-32-1TB-BLK")));
      if (ord1Item) {
        await db.insert(returnItems).values({
          returnId:         ret1.id,
          orderItemId:      ord1Item.id,
          quantity:         1,
          unitRefundAmount: "185000.00",
        }).onConflictDoNothing();
      }
    }

    console.log("  ✓ 1 return request created");

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log("\n✅ Seed complete!");
    console.log("\nDemo accounts (password: Demo@1234):");
    console.log("  Customer : customer@demo.com");
    console.log("  Customer2: customer2@demo.com");
    console.log("  Seller   : seller@demo.com");
    console.log("  Seller2  : seller2@demo.com");
    console.log("  Admin    : admin@demo.com");

  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err);
  process.exit(1);
});
