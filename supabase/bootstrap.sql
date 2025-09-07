-- RAG Insights Engine - Complete Database Setup
-- This file sets up the entire database schema and sample data for the RAG Insights Engine
-- Run this file to bootstrap a new Supabase project with all required tables, functions, and sample data

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

-- Create indexes for performance
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
  similarity_score float,
  total_chunk_count bigint
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
    1 - (dc.embedding <=> query_embedding) as similarity_score,
    dcc.total_chunk_count
  FROM document_chunks dc
  INNER JOIN documents d ON dc.document_id = d.id
  INNER JOIN (
    SELECT document_id, COUNT(id) AS total_chunk_count
    FROM document_chunks
    GROUP BY document_id
  ) dcc ON dc.document_id = dcc.document_id
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
    AND d.status = 'indexed'
    AND (
      (p_user_id IS NOT NULL AND d.user_id = p_user_id)
      OR
      (d.is_public = true)
      OR
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
  relevance_score float,
  total_chunk_count bigint
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
    ts_rank(dc.search_vector, plainto_tsquery('english', query_text)) as relevance_score,
    dcc.total_chunk_count
  FROM document_chunks dc
  INNER JOIN documents d ON dc.document_id = d.id
  INNER JOIN (
    SELECT document_id, COUNT(id) AS total_chunk_count
    FROM document_chunks
    GROUP BY document_id
  ) dcc ON dc.document_id = dcc.document_id
  WHERE dc.search_vector IS NOT NULL
    AND dc.search_vector @@ plainto_tsquery('english', query_text)
    AND d.status = 'indexed'
    AND (
      (p_user_id IS NOT NULL AND d.user_id = p_user_id)
      OR
      (d.is_public = true)
      OR
      (NOT include_public_only)
    )
  ORDER BY ts_rank(dc.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT max_results;
END;
$$;

-- Create insight cache table
CREATE TABLE IF NOT EXISTS insight_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text UNIQUE NOT NULL,
  insights_data jsonb NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insight_cache_key ON insight_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_insight_cache_expires ON insight_cache (expires_at);

-- Create search history table
CREATE TABLE IF NOT EXISTS search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  query text NOT NULL,
  direct_answer text,
  related_questions jsonb,
  clicked_documents uuid[],
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history (user_id);
CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history (created_at);

-- Add comments for documentation
COMMENT ON FUNCTION search_document_chunks_semantic IS 'Semantic search using vector similarity with pgvector';
COMMENT ON FUNCTION search_document_chunks_keyword IS 'Keyword search using full-text search with tsvector';
COMMENT ON TABLE documents IS 'Core documents table for RAG system';
COMMENT ON TABLE document_chunks IS 'Document chunks with embeddings for hybrid search';
COMMENT ON TABLE insight_cache IS 'Cache for generated insights to improve performance';
COMMENT ON TABLE search_history IS 'User search history for analytics and personalization';

-- Insert sample data for testing
INSERT INTO documents (id, title, type, is_public, status, metadata) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'Introduction to Machine Learning', 'research_paper', true, 'indexed', '{"author": "Dr. Jane Smith", "year": 2023, "pages": 45}'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Advanced RAG Systems', 'technical_guide', true, 'indexed', '{"author": "Tech Team", "version": "2.1", "category": "AI"}'),
  ('550e8400-e29b-41d4-a716-446655440003', 'Vector Database Optimization', 'whitepaper', true, 'indexed', '{"company": "VectorDB Inc", "published": "2024-01-15"}');

-- Insert sample document chunks (these would normally have real embeddings)
INSERT INTO document_chunks (document_id, chunk_text, chunk_order, metadata) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'Machine learning is a subset of artificial intelligence that focuses on algorithms that can learn from data. It has revolutionized many industries including healthcare, finance, and technology.', 1, '{"section": "introduction"}'),
  ('550e8400-e29b-41d4-a716-446655440001', 'The three main types of machine learning are supervised learning, unsupervised learning, and reinforcement learning. Each has its own applications and use cases.', 2, '{"section": "types"}'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Retrieval-Augmented Generation (RAG) combines the power of large language models with external knowledge bases. This approach allows for more accurate and up-to-date responses.', 1, '{"section": "overview"}'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Hybrid search combines vector similarity search with keyword-based full-text search using Reciprocal Rank Fusion (RRF) for optimal results.', 2, '{"section": "search"}'),
  ('550e8400-e29b-41d4-a716-446655440003', 'Vector databases are specialized databases designed to store and query high-dimensional vectors efficiently. They use indexing techniques like HNSW for fast similarity search.', 1, '{"section": "introduction"}'),
  ('550e8400-e29b-41d4-a716-446655440003', 'Performance optimization in vector databases involves careful tuning of index parameters, query strategies, and hardware configuration.', 2, '{"section": "optimization"}');

-- Update search_vector columns for full-text search
UPDATE document_chunks SET search_vector = to_tsvector('english', chunk_text) WHERE search_vector IS NULL;

-- Note: In a real setup, you would generate actual embeddings for the sample chunks
-- This requires running the embedding generation process with your chosen model
-- For now, the chunks are inserted without embeddings for demonstration purposes

-- Display setup completion message
DO $$
BEGIN
  RAISE NOTICE 'RAG Insights Engine database setup completed successfully!';
  RAISE NOTICE 'Tables created: documents, document_chunks, insight_cache, search_history';
  RAISE NOTICE 'Functions created: search_document_chunks_semantic, search_document_chunks_keyword';
  RAISE NOTICE 'Sample data inserted: 3 documents with 6 chunks';
  RAISE NOTICE 'Next steps: Generate embeddings for the sample chunks and test the Edge Functions';
END $$;
