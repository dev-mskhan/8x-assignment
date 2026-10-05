-- Migration: 0000_vector_extension
-- Applied before all drizzle-kit generated migrations.
-- Drizzle does not manage extension creation — this file is committed manually.
-- Idempotent: safe to re-run.

-- pgvector: required for the embedding column on products (vector(1536))
-- and the HNSW index for cosine similarity search.
CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp: provides uuid_generate_v4() as an alternative to gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pg_trgm: trigram indexes for efficient LIKE/ILIKE text search (used in Phase 4 search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
