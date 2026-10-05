/**
 * Object storage abstraction.
 *
 * Supports:
 *   - MinIO (local dev)    — S3-compatible, endpoint = http://localhost:9000
 *   - Cloudflare R2 (prod) — S3-compatible, endpoint = https://<account_id>.r2.cloudflarestorage.com
 *   - AWS S3               — standard S3 endpoint
 *
 * All three providers use the AWS SDK v3 S3 client.
 * Only the endpoint URL and credentials differ between environments.
 *
 * Usage:
 *   import { getStorage } from "@/core/storage/storage";
 *   const storage = getStorage();
 *   const url = await storage.upload({ key, body, contentType });
 *   await storage.delete(key);
 *   const signed = await storage.presignedUploadUrl({ key, contentType, expiresIn });
 *
 * Key naming convention (AGENTS.md §26 adapted for storage):
 *   <scope>/<resourceId>/<filename>
 *   e.g. products/<productId>/main.jpg
 *        sellers/<sellerId>/logo.png
 *        avatars/<userId>/avatar.webp
 *
 * The stored URL returned from upload() is the public CDN URL.
 * Sensitive paths should never use public buckets — use presigned URLs.
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { serverEnv } from "@marketplace/env";
import { createLogger } from "../logger/logger";

const logger = createLogger("storage");

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface UploadOptions {
  /** Storage key / path, e.g. "products/abc123/main.jpg" */
  key: string;
  /** File contents as Buffer or string (Node.js Readable streams are accepted at runtime) */
  body: Buffer | string;
  /** MIME type, e.g. "image/jpeg" */
  contentType: string;
  /** Optional metadata to attach to the object */
  metadata?: Record<string, string>;
}

export interface PresignedUploadOptions {
  key: string;
  contentType: string;
  /** Expiry in seconds (default 300 = 5 min) */
  expiresIn?: number;
  /** Max allowed content length in bytes */
  maxSizeBytes?: number;
}

export interface StorageService {
  /** Upload a file and return its public URL */
  upload(options: UploadOptions): Promise<string>;
  /** Delete a file by key */
  delete(key: string): Promise<void>;
  /** Generate a pre-signed PUT URL for direct browser upload */
  presignedUploadUrl(options: PresignedUploadOptions): Promise<string>;
  /** Check if a key exists */
  exists(key: string): Promise<boolean>;
  /** Construct the public URL for a key without making a request */
  publicUrl(key: string): string;
}

// ─────────────────────────────────────────────
// S3 CLIENT FACTORY
// ─────────────────────────────────────────────

function createS3Client(): S3Client {
  const { STORAGE_PROVIDER, STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY } = serverEnv;

  // All three providers use the same S3Client configuration.
  // MinIO and R2 require forcePathStyle (virtual-hosted style not supported).
  const forcePathStyle = STORAGE_PROVIDER === "minio";

  return new S3Client({
    endpoint: STORAGE_ENDPOINT,
    region: STORAGE_REGION,
    credentials: {
      accessKeyId: STORAGE_ACCESS_KEY,
      secretAccessKey: STORAGE_SECRET_KEY,
    },
    forcePathStyle,
  });
}

// ─────────────────────────────────────────────
// STORAGE SERVICE IMPLEMENTATION
// ─────────────────────────────────────────────

function createStorageService(): StorageService {
  const client = createS3Client();
  const bucket = serverEnv.STORAGE_BUCKET;
  const publicBase = serverEnv.STORAGE_PUBLIC_URL.replace(/\/$/, "");

  return {
    publicUrl(key: string): string {
      return `${publicBase}/${key}`;
    },

    async upload({ key, body, contentType, metadata }: UploadOptions): Promise<string> {
      try {
        // Use multipart upload for large files (handles streams gracefully)
        const upload = new Upload({
          client,
          params: {
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: metadata,
          },
        });

        await upload.done();
        const url = this.publicUrl(key);
        logger.debug({ key, bucket, contentType }, "File uploaded to storage");
        return url;
      } catch (err) {
        logger.error({ err, key, bucket }, "Storage upload failed");
        throw err;
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
        logger.debug({ key, bucket }, "File deleted from storage");
      } catch (err) {
        logger.error({ err, key, bucket }, "Storage delete failed");
        throw err;
      }
    },

    async presignedUploadUrl({
      key,
      contentType,
      expiresIn = 300,
    }: PresignedUploadOptions): Promise<string> {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });

      const url = await getSignedUrl(client, command, { expiresIn });
      logger.debug({ key, expiresIn }, "Presigned upload URL generated");
      return url;
    },

    async exists(key: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ─────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────

let _storage: StorageService | null = null;

/**
 * Returns the singleton storage service.
 * Lazily initialized on first call.
 */
export function getStorage(): StorageService {
  if (!_storage) {
    _storage = createStorageService();
    logger.info(
      { provider: serverEnv.STORAGE_PROVIDER, bucket: serverEnv.STORAGE_BUCKET },
      "Storage service initialized",
    );
  }
  return _storage;
}

/**
 * Allowed MIME types for product/seller image uploads.
 * Validated at the controller layer before calling storage.upload().
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * Key builders for consistent storage key naming across modules.
 *
 * Convention: <scope>/<resourceId>/<filename>
 */
export const storageKey = {
  productImage:  (productId: string,  filename: string): string => `products/${productId}/${filename}`,
  sellerLogo:    (sellerId: string,   filename: string): string => `sellers/${sellerId}/logo/${filename}`,
  sellerBanner:  (sellerId: string,   filename: string): string => `sellers/${sellerId}/banner/${filename}`,
  userAvatar:    (userId: string,     filename: string): string => `avatars/${userId}/${filename}`,
  reviewImage:   (reviewId: string,   filename: string): string => `reviews/${reviewId}/${filename}`,
  returnImage:   (returnId: string,   filename: string): string => `returns/${returnId}/${filename}`,
  categoryImage: (categoryId: string, filename: string): string => `categories/${categoryId}/${filename}`,
};
