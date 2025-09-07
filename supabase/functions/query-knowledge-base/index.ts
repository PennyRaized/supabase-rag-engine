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
  const startTime = Date.now();
  
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

    // Performance timing - declare at the very beginning
    const performanceMetrics = {
      embedding_generation_ms: 0,
      semantic_search_ms: 0,
      keyword_search_ms: 0,
      rrf_fusion_ms: 0,
      document_grouping_ms: 0,
      total_search_ms: 0
    };

    // Generate embedding for the query
    let queryEmbedding: number[];
    const embeddingStartTime = Date.now();
    
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
      performanceMetrics.embedding_generation_ms = Date.now() - embeddingStartTime;
      console.log(`[query-knowledge-base] Generated embedding for query (${queryEmbedding.length} dimensions) in ${performanceMetrics.embedding_generation_ms}ms`);
      
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
    const limit = body.limit || 50; // Increased from 20 to 50 for better RRF scoring and relevance density
    const minSimilarity = body.min_similarity || 0.6; // Better default threshold for balanced results
    const includePublicOnly = body.include_public_only || false;

    // Always pass the user ID as p_user_id to include private docs for the user
    const p_user_id = user?.id || null;

    // Helper function to time semantic search
    async function executeTimedSemanticSearch(params: any, supabase: any) {
      const startTime = Date.now();
      const { data, error } = await supabase.rpc('search_document_chunks_semantic', params);
      const duration = Date.now() - startTime;
      if (error) {
        console.error('[query-knowledge-base] Semantic search failed:', error);
        return { data: [], duration, error };
      }
      return { data, duration, error: null };
    }

    // Helper function to time keyword search
    async function executeTimedKeywordSearch(params: any, supabase: any) {
      const startTime = Date.now();
      const { data, error } = await supabase.rpc('search_document_chunks_keyword', params);
      const duration = Date.now() - startTime;
      if (error) {
        console.error('[query-knowledge-base] Keyword search failed:', error);
        return { data: [], duration, error };
      }
      return { data, duration, error: null };
    }

    // Call both specialized search functions IN PARALLEL with independent timing
    const parallelSearchStartTime = Date.now();
    
    const [semanticResult, keywordResult] = await Promise.all([
      executeTimedSemanticSearch({
        query_embedding: queryEmbedding,
        similarity_threshold: minSimilarity,
        max_results: limit,
        p_user_id, // Always pass the user ID
        include_public_only: includePublicOnly
      }, supabase),
      executeTimedKeywordSearch({
        query_text: body.user_query,
        max_results: limit,
        p_user_id, // Always pass the user ID
        include_public_only: includePublicOnly
      }, supabase)
    ]);
    
    const parallelSearchEndTime = Date.now();
    
    // Now we have ACCURATE, INDEPENDENT timings
    performanceMetrics.semantic_search_ms = semanticResult.duration;
    performanceMetrics.keyword_search_ms = keywordResult.duration;
    performanceMetrics.parallel_retrieval_ms = parallelSearchEndTime - parallelSearchStartTime;
    
    // Extract the response data
    const semanticResponse = { data: semanticResult.data, error: semanticResult.error };
    const keywordResponse = { data: keywordResult.data, error: keywordResult.error };

    // Check for errors in either search
    if (semanticResponse.error) {
      console.error('[query-knowledge-base] Semantic search failed:', semanticResponse.error);
      return new Response(
        JSON.stringify({ 
          error: 'Semantic search failed',
          details: semanticResponse.error.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (keywordResponse.error) {
      console.error('[query-knowledge-base] Keyword search failed:', keywordResponse.error);
      return new Response(
        JSON.stringify({ 
          error: 'Keyword search failed',
          details: keywordResponse.error.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // FUSE the two result sets using Reciprocal Rank Fusion (RRF)
    const semanticResults = semanticResponse.data || [];
    const keywordResults = keywordResponse.data || [];
    
    // Time the RRF fusion process
    const rrfStartTime = Date.now();
    
    // Create a map to track combined scores and deduplicate results
    const resultMap = new Map();
    
    // Process semantic results (similarity_score)
    semanticResults.forEach((result: any, index: number) => {
      const rrfScore = 1 / (60 + index); // RRF formula with k=60 (initial value)
      console.log(`[query-knowledge-base] Semantic result ${index + 1}: RRF = ${rrfScore}, similarity = ${result.similarity_score}`);
      resultMap.set(result.id, {
        ...result,
        similarity: result.similarity_score,
        rrf_score: rrfScore,
        semantic_rank: index + 1,
        search_type: 'semantic',
        raw_semantic_score: result.similarity_score, // Preserve raw semantic score
        keyword_rank: null // No keyword rank for semantic-only results
      });
    });
    
    // Process keyword results (relevance_score)
    keywordResults.forEach((result: any, index: number) => {
      const rrfScore = 1 / (60 + index); // RRF formula with k=60 (initial value)
      if (resultMap.has(result.id)) {
        // Combine scores for existing results
        const existing = resultMap.get(result.id);
        existing.rrf_score += rrfScore;
        existing.keyword_match = true;
        existing.keyword_rank = index + 1;
        existing.search_type = 'hybrid';
        // Keep existing raw_semantic_score, add keyword rank
      } else {
        // Add new keyword-only results
        resultMap.set(result.id, {
          ...result,
          similarity: result.relevance_score,
          rrf_score: rrfScore,
          keyword_match: true,
          keyword_rank: index + 1,
          search_type: 'keyword',
          raw_semantic_score: null, // No semantic score for keyword-only results
        });
      }
    });
    
    // Convert map to array and sort by RRF score
    const searchResults = Array.from(resultMap.values())
      .sort((a, b) => b.rrf_score - a.rrf_score);

    const rrfEndTime = Date.now();
    performanceMetrics.rrf_fusion_ms = rrfEndTime - rrfStartTime;

    console.log(`[query-knowledge-base] Hybrid search results: ${searchResults.length} chunks (${semanticResults.length} semantic + ${keywordResults.length} keyword)`);
    console.log(`[query-knowledge-base] Semantic results sample:`, semanticResults.slice(0, 2));
    console.log(`[query-knowledge-base] Keyword results sample:`, keywordResults.slice(0, 2));

    console.log(`[query-knowledge-base] Search results:`, searchResults ? searchResults.length : 0);

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

    // Group results by document
    const documentGroupingStartTime = Date.now();
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
        raw_semantic_score: result.raw_semantic_score, // Preserve raw semantic score
        keyword_rank: result.keyword_rank, // Preserve keyword rank
        total_chunk_count: result.total_chunk_count // Include total chunk count for density calculation
      };
      
      docEntry.chunks.push(chunkObj);
      
      // Track best RRF score for document-level ranking (for sorting)
      if (result.rrf_score > docEntry.best_rrf_score) {
        console.log(`[query-knowledge-base] Updating document RRF: ${docEntry.best_rrf_score} -> ${result.rrf_score} for doc ${result.document_title}`);
        docEntry.best_rrf_score = result.rrf_score;
      }
      
      // Track best raw semantic score for LLM baseline (for confidence generation)
      if (result.raw_semantic_score && result.raw_semantic_score > docEntry.best_raw_similarity) {
        console.log(`[query-knowledge-base] Updating document raw similarity: ${docEntry.best_raw_similarity} -> ${result.raw_semantic_score} for doc ${result.document_title}`);
        docEntry.best_raw_similarity = result.raw_semantic_score;
      }
    });
    
    // Convert map to array and sort by best RRF score
    const groupedResults = Array.from(documentMap.values())
      .sort((a, b) => b.best_rrf_score - a.best_rrf_score);

    const documentGroupingEndTime = Date.now();
    performanceMetrics.document_grouping_ms = documentGroupingEndTime - documentGroupingStartTime;
    
    // Calculate total search time as sum of all components
    performanceMetrics.total_search_ms = 
      performanceMetrics.embedding_generation_ms +
      performanceMetrics.parallel_retrieval_ms +
      performanceMetrics.rrf_fusion_ms +
      performanceMetrics.document_grouping_ms;

    console.log(`[query-knowledge-base] Returning ${groupedResults.length} document results with ${filteredResults.length} total chunks`);
    console.log(`[query-knowledge-base] Performance: Embedding=${performanceMetrics.embedding_generation_ms}ms, Search=${performanceMetrics.semantic_search_ms}ms, RRF=${performanceMetrics.rrf_fusion_ms}ms, Grouping=${performanceMetrics.document_grouping_ms}ms, Total=${performanceMetrics.total_search_ms}ms`);
    
    // DEBUG: Log the actual data being sent to frontend
    console.log(`[query-knowledge-base] Sample document data:`, JSON.stringify(groupedResults.slice(0, 2), null, 2));
    console.log(`[query-knowledge-base] Sample chunk data:`, JSON.stringify(groupedResults[0]?.chunks?.slice(0, 2), null, 2));

    return new Response(
      JSON.stringify({
        results: groupedResults,
        total_documents: groupedResults.length,
        total_chunks: filteredResults.length,
        query: body.user_query,
        performance_metrics: performanceMetrics,
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
