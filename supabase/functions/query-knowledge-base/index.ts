import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Environment variables
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

// Initialize Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface SearchRequest {
  user_query: string;
  user_id?: string;
  filters?: {
    document_id?: string[];
    document_type?: string[];
    dateRange?: {
      start?: string;
      end?: string;
    };
  };
  limit?: number;
  min_similarity?: number;
  include_public_only?: boolean;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ 
        error: 'Method not allowed. Use POST to query the knowledge base.' 
      }), 
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  // Get user from auth header
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  // Allow internal calls with service or anon key (for Edge Function to Edge Function calls)
  let user: any = null;
  if (
    authHeader === `Bearer ${serviceKey}` ||
    authHeader === `Bearer ${anonKey}`
  ) {
    // Internal call, skip user check, user remains null
  } else {
    // Only do user check for real user JWTs
    const { data: userData, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    user = userData.user;
  }

  try {
    // Parse request body
    const body: SearchRequest = await req.json();
    
    if (!body.user_query || body.user_query.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'user_query is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`[query-knowledge-base] Processing query: "${body.user_query}" for user ${user?.id}`);

    // Generate embedding for the query
    let queryEmbedding: number[];
    
    try {
      // @ts-ignore: Supabase AI embedding call for Deno Edge Functions
      const model = new Supabase.ai.Session('gte-small');
      // Generate embedding
      const embeddingResult = await model.run(body.user_query.trim(), { 
        mean_pool: true, 
        normalize: true 
      });
      
      if (!embeddingResult || !Array.isArray(embeddingResult)) {
        throw new Error('Invalid embedding result format');
      }
      
      queryEmbedding = embeddingResult;
      console.log(`[query-knowledge-base] Generated embedding for query (${queryEmbedding.length} dimensions)`);
      
    } catch (embeddingError: any) {
      console.error('[query-knowledge-base] Error generating query embedding:', embeddingError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to generate query embedding',
          details: embeddingError.message || 'Unknown embedding error'
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Set default values
    const limit = body.limit || 50;
    const minSimilarity = body.min_similarity || 0.6;
    const includePublicOnly = body.include_public_only || false;

    // Always pass the user ID as p_user_id to include private docs for the user
    const p_user_id = user?.id || null;

    // Helper function to execute semantic search
    async function executeSemanticSearch(params: any, supabase: any) {
      const { data, error } = await supabase.rpc('search_document_chunks_semantic', params);
      if (error) {
        console.error('[query-knowledge-base] Semantic search failed:', error);
        return { data: [], error };
      }
      return { data, error: null };
    }

    // Helper function to execute keyword search
    async function executeKeywordSearch(params: any, supabase: any) {
      const { data, error } = await supabase.rpc('search_document_chunks_keyword', params);
      if (error) {
        console.error('[query-knowledge-base] Keyword search failed:', error);
        return { data: [], error };
      }
      return { data, error: null };
    }

    // Call both specialized search functions IN PARALLEL
    const [semanticResult, keywordResult] = await Promise.all([
      executeSemanticSearch({
        query_embedding: queryEmbedding,
        similarity_threshold: minSimilarity,
        max_results: limit,
        p_user_id, // Always pass the user ID
        include_public_only: includePublicOnly
      }, supabase),
      executeKeywordSearch({
        query_text: body.user_query,
        max_results: limit,
        p_user_id, // Always pass the user ID
        include_public_only: includePublicOnly
      }, supabase)
    ]);

    // Check for errors in either search
    if (semanticResult.error) {
      console.error('[query-knowledge-base] Semantic search failed:', semanticResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Semantic search failed',
          details: semanticResult.error.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (keywordResult.error) {
      console.error('[query-knowledge-base] Keyword search failed:', keywordResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Keyword search failed',
          details: keywordResult.error.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // FUSE the two result sets using Reciprocal Rank Fusion (RRF)
    const semanticResults = semanticResult.data || [];
    const keywordResults = keywordResult.data || [];
    
    // Create a map to track combined scores and deduplicate results
    const resultMap = new Map();
    
    // Process semantic results (similarity_score)
    semanticResults.forEach((result: any, index: number) => {
      const rrfScore = 1 / (60 + index); // RRF formula with k=60 (initial value)
      resultMap.set(result.id, {
        ...result,
        similarity: result.similarity_score,
        rrf_score: rrfScore,
        search_type: 'semantic'
      });
    });
    
    // Process keyword results (relevance_score)
    keywordResults.forEach((result: any, index: number) => {
      const rrfScore = 1 / (60 + index); // RRF formula with k=60 (initial value)
      if (resultMap.has(result.id)) {
        // Combine scores for existing results
        const existing = resultMap.get(result.id);
        existing.rrf_score += rrfScore;
        existing.search_type = 'hybrid';
      } else {
        // Add new keyword-only results
        resultMap.set(result.id, {
          ...result,
          similarity: result.relevance_score,
          rrf_score: rrfScore,
          search_type: 'keyword'
        });
      }
    });
    
    // Convert map to array and sort by RRF score
    const searchResults = Array.from(resultMap.values())
      .sort((a, b) => b.rrf_score - a.rrf_score);

    console.log(`[query-knowledge-base] Hybrid search results: ${searchResults.length} chunks (${semanticResults.length} semantic + ${keywordResults.length} keyword)`);

    // Apply additional filters
    let filteredResults = searchResults || [];
    
    if (body.filters && typeof body.filters === 'object') {
      // Filter by document_id (primary for document RAG)
      if (Array.isArray(body.filters.document_id) && body.filters.document_id.length > 0) {
        filteredResults = filteredResults.filter(result =>
          body.filters!.document_id!.includes(result.document_id)
        );
      }
      // Filter by document type (legacy, only if present in data)
      if (Array.isArray(body.filters.document_type) && body.filters.document_type.length > 0 && filteredResults.length > 0 && 'document_type' in filteredResults[0]) {
        filteredResults = filteredResults.filter(result =>
          body.filters!.document_type!.includes(result.document_type)
        );
      }
      // Filter by date range (if metadata contains created_at or date field)
      if (body.filters.dateRange && typeof body.filters.dateRange === 'object') {
        if (body.filters.dateRange.start) {
          const startDate = new Date(body.filters.dateRange.start);
          filteredResults = filteredResults.filter(result => {
            const docDate = result.metadata?.created_at || result.metadata?.date;
            return docDate ? new Date(docDate) >= startDate : true;
          });
        }
        if (body.filters.dateRange.end) {
          const endDate = new Date(body.filters.dateRange.end);
          filteredResults = filteredResults.filter(result => {
            const docDate = result.metadata?.created_at || result.metadata?.date;
            return docDate ? new Date(docDate) <= endDate : true;
          });
        }
      }
    }

    // Group results by document with sophisticated metadata handling
    const documentMap = new Map();
    
    filteredResults.forEach(result => {
      if (!documentMap.has(result.document_id)) {
        documentMap.set(result.document_id, {
          document_id: result.document_id,
          document_title: result.document_title,
          document_type: result.document_type,
          chunks: [],
          best_rrf_score: 0, // Highest RRF score from any chunk (for sorting)
          best_raw_similarity: 0, // Highest raw semantic score (for LLM baseline)
          rrf_score: 0, // Document-level RRF score for sorting
          similarity_score: 0 // Document-level similarity score
        });
      }
      
      const docEntry = documentMap.get(result.document_id);
      
      // Create chunk object with comprehensive metadata
      const chunkObj: any = {
        id: result.id,
        text: result.chunk_text,
        order: result.chunk_order,
        metadata: result.metadata,
        similarity: result.rrf_score, // Keep raw RRF score (0.0-1.0)
        raw_semantic_score: result.similarity_score, // Preserve raw semantic score
        keyword_rank: result.keyword_rank, // Preserve keyword rank
        search_type: result.search_type // Track search type for debugging
      };
      
      docEntry.chunks.push(chunkObj);
      
      // Track best RRF score for document-level ranking (for sorting)
      if (result.rrf_score > docEntry.best_rrf_score) {
        docEntry.best_rrf_score = result.rrf_score;
        docEntry.rrf_score = result.rrf_score; // Use best RRF as document score
      }
      
      // Track best raw semantic score for LLM baseline (for confidence generation)
      if (result.similarity_score && result.similarity_score > docEntry.best_raw_similarity) {
        docEntry.best_raw_similarity = result.similarity_score;
        docEntry.similarity_score = result.similarity_score; // Use best similarity as document score
      }
    });
    
    // Convert map to array and sort by best RRF score
    const groupedResults = Array.from(documentMap.values())
      .sort((a, b) => b.best_rrf_score - a.best_rrf_score);

    console.log(`[query-knowledge-base] Returning ${groupedResults.length} document results with ${filteredResults.length} total chunks`);

    return new Response(
      JSON.stringify({
        results: groupedResults,
        total_documents: groupedResults.length,
        total_chunks: filteredResults.length,
        query: body.user_query,
        search_metadata: {
          semantic_results: semanticResults.length,
          keyword_results: keywordResults.length,
          hybrid_results: searchResults.length,
          filtered_results: filteredResults.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('[query-knowledge-base] Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

console.log("[query-knowledge-base] Edge Function initialized and ready to process requests.");