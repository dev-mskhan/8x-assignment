-- PostgreSQL initialization script for local development.
-- Runs automatically when the postgres container starts for the first time.
-- The pgvector/pgvector:pg16 image includes the vector extension binary.

-- Enable pgvector for semantic/embedding search (AGENTS.md §35)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for fuzzy text search (useful for product search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp for gen_random_uuid() (Drizzle uses this by default)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
