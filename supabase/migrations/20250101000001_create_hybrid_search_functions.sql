-- Create hybrid search system for RAG Insights Engine
-- This migration creates the complete hybrid search system including:
-- - Core RAG tables (documents, document_chunks)
-- - Required indexes for performance
-- - Search functions for vector and keyword search

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create core RAG tables
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL,
  is_public boolean DEFAULT false,
  status text DEFAULT 'pending',
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_text text NOT NULL,
  chunk_order integer NOT NULL,
  embedding vector(384),
  search_vector tsvector,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Add search_vector column if it doesn't exist (for full-text search)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'document_chunks' AND column_name = 'search_vector') THEN
    ALTER TABLE document_chunks ADD COLUMN search_vector tsvector;
  END IF;
END $$;

-- Create indexes for performance (standard database practice)
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_document_chunks_search_vector 
ON document_chunks USING gin (search_vector);

CREATE INDEX IF NOT EXISTS idx_documents_status 
ON documents (status);

CREATE INDEX IF NOT EXISTS idx_documents_is_public 
ON documents (is_public);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
ON document_chunks (document_id);

-- Create semantic search function
CREATE OR REPLACE FUNCTION search_document_chunks_semantic(
  query_embedding vector(384),
  similarity_threshold float DEFAULT 0.6,
  max_results int DEFAULT 20,
  p_user_id uuid DEFAULT NULL,
  include_public_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  document_title text,
  document_type text,
  chunk_text text,
  chunk_order int,
  metadata jsonb,
  similarity_score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id,
    dc.document_id,
    d.title as document_title,
    d.type as document_type,
    dc.chunk_text,
    dc.chunk_order,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity_score
  FROM document_chunks dc
  INNER JOIN documents d ON dc.document_id = d.id
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
    AND d.status = 'indexed'
    AND (
      -- Include user's private documents
      (p_user_id IS NOT NULL AND d.user_id = p_user_id)
      OR
      -- Include public documents
      (d.is_public = true)
      OR
      -- Include documents if not filtering by public only
      (NOT include_public_only)
    )
  ORDER BY 1 - (dc.embedding <=> query_embedding) DESC
  LIMIT max_results;
END;
$$;

-- Create keyword search function
CREATE OR REPLACE FUNCTION search_document_chunks_keyword(
  query_text text,
  max_results int DEFAULT 20,
  p_user_id uuid DEFAULT NULL,
  include_public_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  document_title text,
  document_type text,
  chunk_text text,
  chunk_order int,
  metadata jsonb,
  relevance_score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id,
    dc.document_id,
    d.title as document_title,
    d.type as document_type,
    dc.chunk_text,
    dc.chunk_order,
    dc.metadata,
    ts_rank(dc.search_vector, plainto_tsquery('english', query_text)) as relevance_score
  FROM document_chunks dc
  INNER JOIN documents d ON dc.document_id = d.id
  WHERE dc.search_vector IS NOT NULL
    AND dc.search_vector @@ plainto_tsquery('english', query_text)
    AND d.status = 'indexed'
    AND (
      -- Include user's private documents
      (p_user_id IS NOT NULL AND d.user_id = p_user_id)
      OR
      -- Include public documents
      (d.is_public = true)
      OR
      -- Include documents if not filtering by public only
      (NOT include_public_only)
    )
  ORDER BY ts_rank(dc.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT max_results;
END;
$$;

-- Add comments for documentation
COMMENT ON FUNCTION search_document_chunks_semantic IS 'Semantic search using vector similarity with pgvector';
COMMENT ON FUNCTION search_document_chunks_keyword IS 'Keyword search using full-text search with tsvector';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_document_chunks_search_vector ON document_chunks USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents (user_id);
CREATE INDEX IF NOT EXISTS idx_documents_is_public ON documents (is_public);
