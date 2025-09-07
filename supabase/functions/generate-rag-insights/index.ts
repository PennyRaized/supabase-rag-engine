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

interface InsightRequest {
  user_query: string;
  user_id?: string;
  documents: Array<{
    document_id: string;
    document_title: string;
    document_type: string;
    chunks: Array<{
      id: string;
      text: string;
      order: number;
      similarity: number;
    }>;
    rrf_score?: number; // RRF score from search results
    similarity_score?: number; // Similarity score from search results
  }>;
  insight_type: 'document_summaries' | 'key_questions' | 'direct_answer' | 'related_questions' | 'all';
  cache_key?: string; // For caching optimization
  priority?: boolean; // Enable OpenAI priority processing
  search_time_ms?: number; // Actual search time from query-knowledge-base
}

// Document relevance summaries (replaces legacy KeyQuestion flow)
interface DocumentSummary {
  document_id: string;
  document_title: string;
  document_type: string;
  relevance_summary: string;
  confidence_score: number;
}

interface DirectAnswer {
  answer: string;
  confidence: number;
  source_documents: string[];
  source_document_ids: string[]; // New: for clickable sources
}

interface RelatedQuestion {
  question: string;
  relevance: number;
  category: 'Strategic' | 'Technical' | 'Adoption';
}

interface InsightResponse {
  document_summaries?: DocumentSummary[];
  direct_answer?: DirectAnswer;
  related_questions?: RelatedQuestion[];
  cache_key: string;
  generated_at: string;
}

// Generate cache key for insights
function generateCacheKey(query: string, documents: any[], insightType: string): string {
  const docIds = documents.map(d => d.document_id).sort().join(',');
  const queryHash = btoa(query).replace(/[^a-zA-Z0-9]/g, '');
  return `${insightType}_${queryHash}_${docIds}`;
}

// Helper function to get OpenAI chat completion with timeout (following query-enhancer pattern)
// Using gpt-4o-mini for optimal speed/latency balance
async function getOpenAIChatCompletion(messages: any[], model = 'gpt-4o-mini', temperature = 0.3, priority = false) {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  // Add timeout to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const requestBody = {
      model,
      messages,
      temperature,
      response_format: { type: "json_object" },
      max_tokens: 1000,
      ...(priority && { service_tier: "priority" })
    };
    
    console.log(`[getOpenAIChatCompletion] Sending request with priority: ${priority}, service_tier: ${priority ? 'priority' : 'undefined'}`);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid response structure from OpenAI API');
    }
    
    return data.choices[0].message.content;
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

// Generate a single concise relevance sentence per document
async function generateDocumentSummaries(
  documents: any[],
  userQuery: string,
  priority: boolean = false
): Promise<DocumentSummary[]> {
  const tasks = documents.map(async (doc: any) => {
    try {
      const context = (doc.chunks || [])
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, 6)
        .map((c: any) => c.text)
        .join('\n\n');

      const prompt = `You are an expert research analyst. Your task is to read the provided document excerpts and extract the single most important and compelling insight, conclusion, or key data point that is relevant to the user's original query.

---
USER QUERY:
"${userQuery}"

---
DOCUMENT EXCERPTS:
${context}

---
INSTRUCTIONS:
1. Generate a single, concise sentence that directly addresses the user's query.
2. Start directly with the key finding. Be impactful.
3. Do NOT use meta-commentary like "This document discusses..." or "This chunk is relevant because...".
4. Do NOT repeat the user's query.
5. Base your confidence on how well the document content addresses the query.

CONFIDENCE SCORING GUIDELINES:
- High relevance: Document directly addresses the query (0.8-0.95)
- Medium relevance: Document partially addresses the query (0.5-0.8)
- Low relevance: Document only mentions the topic (0.2-0.5)
- Very low relevance: Document barely related (0.1-0.3)

JSON OUTPUT EXAMPLE:
{
  "relevance_summary": "Small Language Models (SLMs) are optimized for edge deployment with reduced computational requirements, achieving 90% accuracy while using 10x less memory than traditional models.",
  "confidence_score": 0.85
}

IMPORTANT: Your confidence score should reflect how well the document content addresses the user's query.`;

      const messages = [{ role: 'user', content: prompt }];
      const llmResponse = await getOpenAIChatCompletion(messages, 'gpt-4o-mini', 0.2, priority);
      let relevance_summary = '';
      let confidence_score = 0.8;
      try {
        const parsed = JSON.parse(llmResponse);
        relevance_summary = parsed.relevance_summary || '';
        confidence_score = typeof parsed.confidence_score === 'number' ? parsed.confidence_score : confidence_score;
      } catch {
        relevance_summary = (llmResponse || '').toString().trim();
      }

      return {
        document_id: doc.document_id,
        document_title: doc.document_title,
        document_type: doc.document_type,
        relevance_summary,
        confidence_score
      } as DocumentSummary;
    } catch (err) {
      console.error('[generateDocumentSummaries] error for', doc?.document_title, err);
      return {
        document_id: doc.document_id,
        document_title: doc.document_title,
        document_type: doc.document_type,
        relevance_summary: 'Summary unavailable.',
        confidence_score: 0.0
      } as DocumentSummary;
    }
  });

  return Promise.all(tasks);
}

// Generate direct answer from multiple documents
async function generateDirectAnswer(
  documents: any[], 
  userQuery: string,
  priority: boolean = false
): Promise<DirectAnswer> {
  try {
    const topChunks = documents
      .flatMap(doc => doc.chunks.slice(0, 4)) // Increased from 2 to 4 chunks per document
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, 16); // Increased from 8 to 16 chunks total for better synthesis
    
    const context = topChunks.map(chunk => chunk.text).join('\n\n');
    const sourceDocs = [...new Set(topChunks.map(chunk => 
      documents.find(d => d.chunks.some(c => c.id === chunk.id))?.document_title
    ))].filter(Boolean);
    
    const prompt = `Based on the following document content, provide a direct, comprehensive answer to the user's query.

User Query: "${userQuery}"

Document Content:
${context}

Available Document Titles for Citations:
${sourceDocs.map((title, index) => `${index + 1}. ${title}`).join('\n')}

Requirements:
1. Provide a clear, direct answer that addresses the user's query
2. Use markdown formatting for better readability (e.g., **bold**, *italic*, lists, etc.)
3. Embed source citations directly in the answer text using the format: [Source: EXACT_DOCUMENT_TITLE]
4. Use the EXACT document titles from the list above for citations
5. Synthesize information from multiple sources when relevant
6. Be specific and actionable
7. Acknowledge any limitations or uncertainties
8. Keep the answer concise but comprehensive

Format the response as JSON:
{
  "answer": "Your synthesized answer with **markdown formatting** and [Source: EXACT_DOCUMENT_TITLE] citations...",
  "confidence": 0.0-1.0 based on how well the documents answer the query,
  "source_documents": ["Document 1", "Document 2"]
}`;

    const messages = [
      {
        role: 'user',
        content: prompt
      }
    ];

    const llmResponse = await getOpenAIChatCompletion(messages, 'gpt-4o-mini', 0.3, priority);

    try {
      const parsed = JSON.parse(llmResponse);
      
      // Extract source citations from answer text and map to document IDs
      const sourceDocumentIds: string[] = [];
      const sourceCitations = parsed.answer?.match(/\[Source: ([^\]]+)\]/g) || [];
      
      // Map source citations to document IDs
      for (const citation of sourceCitations) {
        const title = citation.replace(/\[Source: ([^\]]+)\]/, '$1');
        const matchingDoc = documents.find(doc => doc.document_title === title);
        if (matchingDoc && !sourceDocumentIds.includes(matchingDoc.document_id)) {
          sourceDocumentIds.push(matchingDoc.document_id);
        }
      }
      
      // Fallback: if no citations found, use all source documents
      if (sourceDocumentIds.length === 0) {
        sourceDocumentIds.push(...documents.map(doc => doc.document_id));
      }
      
      return {
        answer: parsed.answer,
        confidence: parsed.confidence || 0.8,
        source_documents: parsed.source_documents || sourceDocs,
        source_document_ids: sourceDocumentIds
      };
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      return {
        answer: "Based on the available documents, I can provide some relevant information, though the answer may not be complete.",
        confidence: 0.6,
        source_documents: sourceDocs,
        source_document_ids: documents.map(doc => doc.document_id)
      };
    }
  } catch (error) {
    console.error('Error generating direct answer:', error);
    return {
      answer: "An error occurred while generating the answer.",
      confidence: 0.0,
      source_documents: [],
      source_document_ids: []
    };
  }
}

// Generate related questions based on direct answer or fallback context
async function generateRelatedQuestions(
  context: string, 
  userQuery: string,
  priority: boolean = false
): Promise<RelatedQuestion[]> {
  console.log(`[generateRelatedQuestions] Starting with context length: ${context.length}, userQuery: "${userQuery}"`);
  try {
    const isDirectAnswer = context.length < 1000; // Heuristic: short text is likely a direct answer
    
    const prompt = `You are an expert analyst. Based on the provided context and the original user query, generate the top 3 most relevant and insightful follow-up questions.

Each question MUST be assigned one of the following categories:
- Strategic: The "Why" (market, competition, business model, future trends).
- Technical: The "How" (implementation, architecture, features, science).
- Adoption: The "What now" (risks, challenges, use cases, ROI).

---
CONTEXT:
${context}

---
ORIGINAL USER QUERY:
"${userQuery}"

---
Provide your answer in a strict JSON array format.

EXAMPLE:
User Query: "What is quantum computing going to do in pharma?"
JSON Output:
[
  {
    "question": "How do quantum algorithms for molecular simulation differ from classical methods?",
    "relevance": 0.89,
    "category": "Technical"
  },
  {
    "question": "What are the primary regulatory and implementation hurdles for using quantum-derived data in clinical trials?",
    "relevance": 0.91,
    "category": "Adoption"
  },
  {
    "question": "What is the long-term competitive advantage for a pharmaceutical company that masters quantum computing first?",
    "relevance": 0.76,
    "category": "Strategic"
  }
]

IMPORTANT: 
1. Generate realistic relevance scores between 0.5 and 0.95. Do NOT use round numbers like 0.9, 0.8, 0.7.
2. Use varied, realistic scores like 0.89, 0.91, 0.76, etc.
3. Do NOT imply that any category is inherently more valuable than others. All categories can have high or low relevance scores.

---
JSON OUTPUT:`;

    const fullPrompt = prompt;

    const messages = [
      {
        role: 'user',
        content: fullPrompt
      }
    ];

    const llmResponse = await getOpenAIChatCompletion(messages, 'gpt-4o-mini', 0.3, priority);
    
    console.log(`[generateRelatedQuestions] Raw LLM response:`, llmResponse);
    console.log(`[generateRelatedQuestions] Response length:`, llmResponse.length);

    try {
      const parsed = JSON.parse(llmResponse);
      console.log(`[generateRelatedQuestions] Parsed response:`, JSON.stringify(parsed, null, 2));
      
      // Handle the response format from our prompt
      if (Array.isArray(parsed)) {
        console.log(`[generateRelatedQuestions] Returning ${parsed.length} related questions (direct array)`);
        return parsed;
      } else if (parsed.questions && Array.isArray(parsed.questions)) {
        console.log(`[generateRelatedQuestions] Found questions array with ${parsed.questions.length} items`);
        return parsed.questions;
      } else if (parsed.related_questions && Array.isArray(parsed.related_questions)) {
        console.log(`[generateRelatedQuestions] Found related_questions array with ${parsed.related_questions.length} items`);
        return parsed.related_questions;
      } else {
        console.error('Unexpected response structure:', parsed);
        console.error('Response type:', typeof parsed);
        console.error('Response keys:', Object.keys(parsed));
        return [];
      }
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      console.error('Raw response was:', llmResponse);
      console.error('Response starts with:', llmResponse.substring(0, 100));
      console.error('Response ends with:', llmResponse.substring(llmResponse.length - 100));
      return [];
    }
      } catch (error) {
      console.error('Error generating related questions:', error);
      return [];
    }
    
    console.log(`[generateRelatedQuestions] Function completed successfully`);
  }

// Check cache for existing insights
async function checkCache(cacheKey: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('insight_cache')
      .select('insights_data')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (error || !data) return null;
    return data.insights_data;
  } catch (error) {
    console.error('Cache check error:', error);
    return null;
  }
}

// Store insights in cache
async function storeInCache(cacheKey: string, insights: any): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour TTL
    
    const { error } = await supabase
      .from('insight_cache')
      .upsert({
        cache_key: cacheKey,
        insights_data: insights,
        expires_at: expiresAt.toISOString()
      });
    
    if (error) {
      console.error('Cache storage error:', error);
    }
  } catch (error) {
    console.error('Cache storage error:', error);
  }
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
        error: 'Method not allowed. Use POST to generate insights.' 
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

  // Allow internal calls with service or anon key
  let user: any = null;
  if (
    authHeader === `Bearer ${serviceKey}` ||
    authHeader === `Bearer ${anonKey}`
  ) {
    // Internal call, skip user check
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
    const body: InsightRequest = await req.json();
    
    if (!body.user_query || !body.documents || body.documents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'user_query and documents are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`[generate-rag-insights] Processing ${body.insight_type} for query: "${body.user_query}" with ${body.documents.length} documents`);
    console.log(`[generate-rag-insights] Priority processing requested: ${body.priority} (type: ${typeof body.priority})`);

    // Generate cache key
    const cacheKey = body.cache_key || generateCacheKey(body.user_query, body.documents, body.insight_type);
    
    // Check cache first
    const cacheStartTime = Date.now();
    const cachedInsights = await checkCache(cacheKey);
    const cacheDuration = Date.now() - cacheStartTime;
    
    if (cachedInsights) {
      console.log(`[generate-rag-insights] Cache hit for key: ${cacheKey} (${cacheDuration}ms)`);
      const totalDuration = Date.now() - startTime;
      return new Response(
        JSON.stringify({
          ...cachedInsights,
          cache_key: cacheKey,
          cached: true,
          performance_metrics: {
            total_duration_ms: totalDuration,
            cache_lookup_ms: cacheDuration,
            insights_generation_ms: 0, // Cached, no generation needed
            llm_calls_ms: 0
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    console.log(`[generate-rag-insights] Cache miss, generating insights (${cacheDuration}ms)`);

    // Generate insights based on type with individual timing
    const insights: any = {};
    const llmStartTime = Date.now();
    
    // Create all insight promises in parallel with individual timing
    const insightPromises: { [key: string]: Promise<any> } = {};
    const timingData: { [key: string]: { startTime: number, duration?: number } } = {};
    
    if (body.insight_type === 'document_summaries' || body.insight_type === 'all') {
      (timingData as any).document_summaries = { startTime: Date.now() };
      insightPromises.document_summaries = generateDocumentSummaries(body.documents, body.user_query, body.priority);
    }
    
    if (body.insight_type === 'direct_answer' || body.insight_type === 'all') {
      timingData.direct_answer = { startTime: Date.now() };
      insightPromises.direct_answer = generateDirectAnswer(body.documents, body.user_query, body.priority);
    }
    
    if (body.insight_type === 'related_questions' || body.insight_type === 'all') {
      timingData.related_questions = { startTime: Date.now() };
      // Always use fallback context for related questions - no dependency on direct answer
      const fallbackContext = body.documents
        .flatMap(doc => doc.chunks.slice(0, 4))
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, 16)
        .map(chunk => chunk.text)
        .join('\n\n');

      console.log(`[generate-rag-insights] Using fallback context for related questions (${fallbackContext.length} chars)`);
      console.log(`[generate-rag-insights] Fallback context preview: ${fallbackContext.substring(0, 200)}...`);
      
      insightPromises.related_questions = generateRelatedQuestions(fallbackContext, body.user_query, body.priority);
    }
    
    // Wait for all insights to complete in parallel
    const insightResults = await Promise.all(Object.values(insightPromises));
    
    // Assign results to insights object and calculate individual timing
    let resultIndex = 0;
    if ('document_summaries' in insightPromises) {
      insights.document_summaries = insightResults[resultIndex++];
      (timingData as any).document_summaries!.duration = Date.now() - (timingData as any).document_summaries!.startTime;
      console.log(`[generate-rag-insights] Document summaries completed in ${(timingData as any).document_summaries!.duration}ms`);
    }
    if ('direct_answer' in insightPromises) {
      insights.direct_answer = insightResults[resultIndex++];
      timingData.direct_answer!.duration = Date.now() - timingData.direct_answer!.startTime;
      console.log(`[generate-rag-insights] Direct answer completed in ${timingData.direct_answer!.duration}ms`);
    }
    if ('related_questions' in insightPromises) {
      insights.related_questions = insightResults[resultIndex++];
      timingData.related_questions!.duration = Date.now() - timingData.related_questions!.startTime;
      console.log(`[generate-rag-insights] Related questions completed in ${timingData.related_questions!.duration}ms`);
    }
    
    console.log(`[generate-rag-insights] All insights generated in parallel in ${Date.now() - llmStartTime}ms`);

    // Store in cache
    await storeInCache(cacheKey, insights);

    // Store search history if user is authenticated
    if (user?.id) {
      try {
        await supabase
          .from('search_history')
          .insert({
            user_id: user.id,
            query: body.user_query,
            direct_answer: insights.direct_answer?.answer,
            related_questions: insights.related_questions,
            clicked_documents: body.documents.map(d => d.document_id)
          });
      } catch (historyError) {
        console.error('Failed to store search history:', historyError);
        // Don't fail the request for history storage errors
      }
    }

    const llmDuration = Date.now() - llmStartTime;
    const totalDuration = Date.now() - startTime;
    
    const response: InsightResponse = {
      ...insights,
      cache_key: cacheKey,
      generated_at: new Date().toISOString(),
      performance_metrics: {
        total_duration_ms: totalDuration + (body.search_time_ms || 0), // Include semantic search time for end-to-end duration
        cache_lookup_ms: cacheDuration,
        semantic_search_ms: body.search_time_ms || 0, // Use actual search time from query-knowledge-base
        insights_generation_ms: llmDuration,
        llm_calls_ms: llmDuration,
        priority_processing: body.priority || false,
        breakdown: {
          document_summaries_ms: (timingData as any).document_summaries?.duration || 0,
          direct_answer_ms: timingData.direct_answer?.duration || 0,
          related_questions_ms: timingData.related_questions?.duration || 0
        }
      }
    };

    console.log(`[generate-rag-insights] Successfully generated insights for ${body.insight_type} in ${totalDuration}ms (LLM: ${llmDuration}ms)`);

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('[generate-rag-insights] Unexpected error:', error);
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

console.log("[generate-rag-insights] Edge Function initialized and ready to process requests.");