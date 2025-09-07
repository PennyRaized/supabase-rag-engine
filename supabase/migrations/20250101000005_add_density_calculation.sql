-- Add relevance density calculation support for search quality improvements
-- This migration adds the document_chunk_counts view and updates search functions
-- to support relevance density calculation for distinguishing "about" vs "mentioning" topics

-- Step 1: Create the document_chunk_counts view for density calculation
CREATE OR REPLACE VIEW document_chunk_counts AS
SELECT
  document_id,
  COUNT(id) AS total_chunk_count
FROM
  document_chunks
GROUP BY
  document_id;

-- Add comment for documentation
COMMENT ON VIEW document_chunk_counts IS 'View for calculating total chunk counts per document to support relevance density calculation';

-- Step 2: Update semantic search function to include total_chunk_count
DROP FUNCTION IF EXISTS search_document_chunks_semantic(vector,double precision,integer,uuid,boolean);

CREATE OR REPLACE FUNCTION search_document_chunks_semantic(
  query_embedding vector(384),
  similarity_threshold double precision DEFAULT 0.6,
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
  similarity_score double precision,
  total_chunk_count bigint
)
LANGUAGE plpgsql AS $$
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
  INNER JOIN document_chunk_counts dcc ON dc.document_id = dcc.document_id
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
    AND d.status = 'indexed'
    AND (
      -- Security Pre-filter: Include user's private documents
      (p_user_id IS NOT NULL AND d.user_id = p_user_id)
      OR
      -- Security Pre-filter: Include public documents
      (d.is_public = true)
      OR
      -- Security Pre-filter: Include documents if not filtering by public only
      (NOT include_public_only)
    )
  ORDER BY dc.embedding <=> query_embedding
  LIMIT max_results;
END;
$$;

-- Step 3: Update keyword search function to include total_chunk_count
DROP FUNCTION IF EXISTS search_document_chunks_keyword(text,integer,uuid,boolean);

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
  relevance_score double precision,
  total_chunk_count bigint
)
LANGUAGE plpgsql AS $$
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
  INNER JOIN document_chunk_counts dcc ON dc.document_id = dcc.document_id
  WHERE dc.search_vector IS NOT NULL
    AND dc.search_vector @@ plainto_tsquery('english', query_text)
    AND d.status = 'indexed'
    AND (
      -- Security Pre-filter: Include user's private documents
      (p_user_id IS NOT NULL AND d.user_id = p_user_id)
      OR
      -- Security Pre-filter: Include public documents
      (d.is_public = true)
      OR
      -- Security Pre-filter: Include documents if not filtering by public only
      (NOT include_public_only)
    )
  ORDER BY ts_rank(dc.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT max_results;
END;
$$;

-- Add comments for documentation
COMMENT ON FUNCTION search_document_chunks_semantic IS 'Semantic search with relevance density calculation support';
COMMENT ON FUNCTION search_document_chunks_keyword IS 'Keyword search with relevance density calculation support';
