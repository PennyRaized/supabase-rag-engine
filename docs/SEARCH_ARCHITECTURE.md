# Search Architecture

*Hybrid search implementation combining vector similarity and keyword matching*

## Overview

The RAG Insights Engine implements a hybrid search architecture that combines vector similarity search with keyword-based full-text search using Reciprocal Rank Fusion (RRF) for optimal result quality and performance.

> **Database Implementation**: The complete hybrid search system is implemented in migration `20250101000001_create_hybrid_search_system.sql`, which creates the core RAG tables, performance indexes, and search functions in a single atomic operation.

## What is Hybrid Search?

Hybrid search addresses fundamental limitations of single-search approaches by combining two complementary search methods:

### **Why Combine Semantic and Keyword Search?**

**Semantic Search Strengths:**
- Captures meaning and context beyond exact word matches
- Handles synonyms, related concepts, and conceptual relationships
- Works well for "find documents about X" queries

**Semantic Search Limitations:**
- Can miss exact technical terms or proper nouns
- May return conceptually related but irrelevant results
- Struggles with specific identifiers, codes, or exact phrases

**Keyword Search Strengths:**
- Excellent for exact matches, technical terms, and specific identifiers
- Fast and precise for "find documents containing X" queries
- Handles proper nouns, codes, and exact phrases well

**Keyword Search Limitations:**
- Misses synonyms and conceptual relationships
- Requires exact word matches or careful query construction
- Can return results that mention terms but aren't actually about the topic

### **Common Search Pitfalls Addressed**

1. **Semantic Drift**: Vector search can return conceptually related but irrelevant results
2. **Exact Match Blindness**: Semantic search misses specific technical terms
3. **Query Mismatch**: Users search with different vocabulary than document authors
4. **Context Loss**: Keyword search misses broader conceptual context
5. **Recall vs Precision Trade-off**: Single methods often optimize for one at the expense of the other

### **Document Chunking Strategy**

Documents are split into semantic chunks (typically 200-500 tokens) that:
- Maintain coherent meaning within each chunk
- Preserve context across chunk boundaries
- Enable granular retrieval of relevant sections
- Support both semantic and keyword matching at the chunk level

## Architecture Components

### **1. Parallel Search Execution**

The system executes two search types simultaneously:

- **Semantic Search**: Vector similarity using pgvector and cosine distance
- **Keyword Search**: Full-text search using PostgreSQL's tsvector and ts_rank

### **2. Reciprocal Rank Fusion (RRF)**

Results from both search types are combined using the industry-standard RRF algorithm:

```
RRF Score = 1 / (k + rank)
```

Where:
- `k = 60` (standard parameter for RRF fusion)
- `rank` = position in search results (1-based)

**RRF Benefits:**
- Combines ranked lists without requiring score normalization
- Handles different scoring scales between search methods
- Provides stable, interpretable fusion results

### **3. PostgreSQL Implementation**

#### **Semantic Search (pgvector)**
```sql
search_document_chunks_semantic(
  query_embedding vector(384),
  similarity_threshold float DEFAULT 0.6,
  max_results int DEFAULT 20,
  p_user_id uuid DEFAULT NULL,
  include_public_only boolean DEFAULT false
)
```

**PostgreSQL Features Used:**
- **pgvector extension**: Native vector operations with cosine distance (`<=>`)
- **HNSW index**: Hierarchical Navigable Small World for fast approximate nearest neighbor search
- **Vector dimensions**: 384 (gte-small model) - must match query embedding dimensions

#### **Keyword Search (tsvector)**
```sql
search_document_chunks_keyword(
  query_text text,
  max_results int DEFAULT 20,
  p_user_id uuid DEFAULT NULL,
  include_public_only boolean DEFAULT false
)
```

**PostgreSQL Features Used:**
- **tsvector**: Full-text search vectors with English language processing
- **ts_rank**: Relevance scoring based on term frequency and position
- **GIN index**: Generalized Inverted Index for fast text search
- **plainto_tsquery**: Converts user queries to searchable format

#### **PostgreSQL vs. Specialized Vector Databases**

**Advantages of PostgreSQL Approach:**
- **Unified System**: Single database for vectors, text, and metadata
- **ACID Compliance**: Full transactional guarantees
- **Mature Ecosystem**: Rich tooling, monitoring, and backup solutions
- **Cost Effective**: No additional infrastructure or licensing
- **SQL Integration**: Complex queries combining search with business logic

**Trade-offs:**
- **Tuning Limitations**: Fewer vector-specific optimization options
- **Scale Constraints**: May require sharding for very large vector collections
- **Performance**: Specialized vector DBs may offer better raw vector search speed

**When PostgreSQL Works Well:**
- Document collections under 1M chunks
- Mixed query patterns (search + metadata filtering)
- Teams familiar with SQL and PostgreSQL
- Cost-sensitive deployments

### **Scale Considerations**

#### **What is Sharding?**
Sharding is a database scaling technique that horizontally partitions data across multiple database instances. Instead of storing all data in one database, it's split across multiple "shards" based on a shard key (e.g., user_id, document_id, or geographic region).

**Sharding for Vector Search:**
- **Document-based sharding**: Split documents across multiple PostgreSQL instances
- **User-based sharding**: Separate user data into different databases
- **Geographic sharding**: Distribute data across regions for latency optimization

#### **Very Large Vector Collections**
- **1M+ chunks**: May require sharding or specialized vector databases
- **10M+ chunks**: Almost certainly needs distributed architecture
- **100M+ chunks**: Requires specialized vector databases (Pinecone, Weaviate, Qdrant)

**PostgreSQL Scale Limits:**
- **Single instance**: ~1-5M vectors with good performance
- **Sharded**: Can scale to 10M+ vectors with proper architecture
- **Memory requirements**: Vector indexes consume significant RAM
- **Query performance**: Degrades with very large collections

## Performance Characteristics

### **Search Latency**
- **Embedding Generation**: ~150ms (Supabase AI gte-small)
- **Parallel Search**: ~50-200ms (database queries)
- **RRF Fusion**: ~5-10ms (in-memory processing)
- **Total**: ~250-400ms typical response time

### **Embedding Model Requirements**
- **Query and Document Embeddings**: Must use the same model (gte-small)
- **Vector Dimensions**: 384 (fixed for gte-small)
- **Model Consistency**: Critical for meaningful similarity calculations
- **Alternative Models**: OpenAI text-embedding-ada-002 (1536 dimensions) or other models supported by Supabase AI
- **Dimension Limits**: PostgreSQL supports up to 16,000 dimensions, but [smaller dimensions often perform better](https://supabase.com/blog/fewer-dimensions-are-better-pgvector)

### **Database Indexing**
- **HNSW Index**: Vector similarity search (cosine distance)
- **GIN Index**: Full-text search (tsvector)
- **B-tree Indexes**: User permissions and document status

## Search Quality

### **Result Types**
1. **Semantic-only**: High vector similarity, no keyword match
2. **Keyword-only**: High text relevance, low vector similarity  
3. **Hybrid**: Strong matches in both semantic and keyword search

### **Scoring System**
- **RRF Score**: Primary ranking (0.0 - 1.0)
- **Similarity Score**: Raw vector similarity (0.0 - 1.0)
- **Relevance Score**: Text search relevance (0.0 - 1.0)

## Configuration

### **Default Parameters**
- **Similarity Threshold**: 0.6 (60% similarity minimum)
- **Max Results**: 20 chunks per search type
- **RRF K Parameter**: 10 (standard value)

### **User Permissions**
- Private documents: User-specific access
- Public documents: Available to all users
- Mixed access: Configurable via `include_public_only` flag

## Implementation Details

### **Edge Function Structure**
```typescript
// Parallel execution
const [semanticResult, keywordResult] = await Promise.all([
  supabase.rpc('search_document_chunks_semantic', params),
  supabase.rpc('search_document_chunks_keyword', params)
]);

// RRF fusion
const resultMap = new Map();
// Process semantic results with RRF scoring
// Process keyword results with RRF scoring
// Combine and deduplicate results
```

### **Error Handling**
- Graceful degradation if one search type fails
- Comprehensive error logging and metrics
- Fallback to single search type if needed

## Future Enhancements

- **Adaptive Thresholds**: Dynamic similarity thresholds based on result distribution
- **Query Expansion**: Automatic query enhancement for better recall
- **Caching**: Result caching for repeated queries
- **Analytics**: Search performance monitoring and optimization
