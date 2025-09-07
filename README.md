# Advanced RAG Insights Engine with Hybrid Search

*When building a production AI system, you quickly realize that simple document search isn't enough. This repository contains the intelligence layer that transforms raw search results into actionable insights through sophisticated retrieval-augmented generation.*

**A production-ready RAG engine that combines hybrid search, intelligent fallback strategies, and multi-stage insight generation to deliver reliable, observable, and high-quality AI-powered document analysis.**

## 🎯 The Problem: Beyond Simple Document Search

Most RAG implementations are glorified document retrievers—they find chunks and call an LLM. But production systems need intelligence:

- **Resilience**: What happens when your precise search returns zero results?
- **Quality Measurement**: How do you know if retrieved documents are actually relevant?
- **Observable Performance**: Can you measure and optimize each stage of your pipeline?
- **Confidence Scoring**: How certain should you be about AI-generated insights?

Building a knowledge management system for investment analysis, I needed more than basic retrieval. I needed an engine that could intelligently adapt, measure its own performance, and provide confidence-scored insights that decision-makers could trust.

**The Challenge**: Not just finding documents, but doing it in a way that:
- Gracefully handles edge cases and failures
- Provides transparent quality metrics
- Scales from prototype to production
- Delivers trustworthy, confidence-scored insights

## ✅ Solution: Observable RAG System

This project implements a RAG system that prioritizes **observability**, **resilience**, and **quality** over simplicity. Every component is measurable, every failure mode is handled, and every insight comes with confidence metrics.

**Core Philosophy**: Instead of black-box AI, this system provides transparency where you can see exactly how decisions are made, measure performance at every stage, and understand why specific insights were generated.

```mermaid
graph TB
    A[User Query] --> B[Embedding Generation]
    B --> C[Hybrid Search Engine]
    C --> D{Results Quality Check}
    D -->|Good Results| E[Multi-Stage Insight Generation]
    D -->|Poor Results| F[Fallback Search Strategy]
    F --> E
    E --> G[Confidence-Scored Insights]
    
    subgraph "System Observability"
        H[Performance Metrics]
        I[Quality Measurements]
        J[Debug Scoring]
    end
    
    C --> H
    C --> I
    E --> J
    
    style A fill:#e1f5fe
    style E fill:#c8e6c9
    style G fill:#c8e6c9
    style H fill:#fff3e0
    style I fill:#fff3e0
    style J fill:#fff3e0
```

## 🏗️ What This Project Is (and Isn't)

✅ **This IS:**
- A sophisticated RAG intelligence layer with hybrid search
- Production-ready resilience patterns (fallback search, error handling)
- Comprehensive observability and performance monitoring
- Advanced quality metrics (relevance density, confidence scoring)
- A complete setup-to-production pipeline

❌ **This IS NOT:**
- A document processing or chunking system (see our [Sidecar Embedding Engine](https://github.com/PennyRaized/supabase-sidecar-embedding-engine))
- A front-end or user interface framework
- A general-purpose LLM orchestration platform

## 🚀 Getting Started

This project is a complete, deployable RAG system. To run it, you will need to set up your own free Supabase project and connect it to your OpenAI account. The entire process takes about 15-20 minutes.

### **Prerequisites**

- A [GitHub](https://github.com/) account
- A [Supabase](https://supabase.com/) account (the free tier is sufficient)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- [Node.js](https://nodejs.org/en/) (version 18 or later)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) installed on your machine
- [PostgreSQL client](https://www.postgresql.org/download/) (psql) for database setup

### **Step 1: Set Up Your Local Environment**

First, clone the repository and prepare your local configuration.

```bash
# Clone the repository
git clone https://github.com/PennyRaized/rag-insights-engine.git
cd rag-insights-engine

# Install project dependencies
npm install

# Prepare your environment file
cp .env.example .env
```

### **Step 2: Create and Configure Your Supabase Project**

Now, let's set up the cloud infrastructure.

1. **Create a New Supabase Project:** Go to your [Supabase Dashboard](https://app.supabase.com) and create a new project.
2. **Link Your Local Project:** In your terminal, run `supabase login` and then link your local files to your new project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_ID
   ```
   (You can find your `YOUR_PROJECT_ID` in your Supabase project's URL).
3. **Populate `.env` file:** Open the `.env` file and fill in the values from your Supabase project's API settings:
   ```bash
   # Get these from your Supabase Dashboard → Settings → API
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   SUPABASE_ANON_KEY=your_anon_key
   
   # Get this from OpenAI Platform → API Keys
   OPENAI_API_KEY=your_openai_api_key
   ```

### **Step 3: Deploy the Backend**

With your project linked and configured, you can now deploy the entire backend with three commands.

1. **Set Up the Database:** This single bootstrap script creates all tables, functions, and indexes, and seeds it with sample data.

   ```bash
   # Get your database URL from Supabase Dashboard → Settings → Database
   psql 'postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres' -f supabase/bootstrap.sql
   ```

   **Alternative method using Supabase CLI:**
   ```bash
   # If you prefer using the Supabase CLI
   supabase db reset
   psql $(supabase status | grep "DB URL" | awk '{print $3}') -f supabase/bootstrap.sql
   ```

   **What this bootstrap script includes:**
   - Complete database schema with `documents` and `document_chunks` tables
   - Hybrid search functions for semantic and keyword search
   - Insight caching system with `insight_cache` table
   - Search history tracking with `search_history` table
   - Sample data for immediate testing
   - All required indexes for optimal performance

2. **Set the OpenAI Secret:** Securely set your OpenAI key for the Edge Functions.

   ```bash
   supabase secrets set OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d '=' -f2)
   ```

3. **Deploy the Edge Functions:**

   ```bash
   supabase functions deploy
   ```

   **What gets deployed:**
   - `query-knowledge-base`: Hybrid search function with fallback strategies
   - `generate-rag-insights`: Multi-stage insight generation with caching
   - `_shared/cors.ts`: CORS configuration for web requests

   **If `supabase login` fails:**
   1. Go to your Supabase Dashboard → Settings → Access Tokens
   2. Generate a new access token
   3. Use: `supabase login --token YOUR_ACCESS_TOKEN`

   **Note**: You may see "WARNING: Docker is not running" - this is fine! The deployment will work without Docker.

### **Step 4: Verify the Installation**

Your system is now live. Run the smoke test to confirm everything is working end-to-end.

```bash
# This script will test the complete RAG pipeline
npm run smoke-test
```

The smoke test will:
- Test database connectivity using the bootstrap schema
- Verify Edge Function deployment (`query-knowledge-base` and `generate-rag-insights`)
- Run a sample search query with hybrid search
- Generate test insights using the sample data
- Show performance metrics and timing information
- Validate the complete RAG pipeline end-to-end

### **Step 5: Start Using the RAG Engine**

Now you can use the engine by invoking the Edge Functions:

```javascript
// Example of invoking the Edge Function from a client

const { data, error } = await supabase.functions.invoke('query-knowledge-base', {
  body: {
    user_query: 'machine learning applications in healthcare',

    // --- Core Parameters ---
    limit: 50, // The number of chunks to retrieve (default is 50)
    min_similarity: 0.6, // The minimum similarity score for semantic search (default is 0.6)

    // --- "Glass Box" Feature Flags ---
    debug: true,              // Set to true to get detailed scoring info for each chunk
    enable_fallback: true,    // Enables the resilient, multi-pass search strategy
    enable_density_calc: true, // Enables the relevance density quality metric

    // --- Optional Advanced Filtering ---
    /*
    filters: {
      document_type: ['research_paper'],
      dateRange: { start: '2024-01-01' }
    }
    */
  }
});

// Generate intelligent insights
const insightsResponse = await supabase.functions.invoke('generate-rag-insights', {
  body: {
    user_query: 'machine learning applications in healthcare',
    documents: data.results,
    insight_type: 'all',
    priority: true  // Use OpenAI priority processing
  }
});
```

### **Step 6: Add Your Own Documents (Optional)**

To add your own documents to the knowledge base:

1. **Insert documents into the `documents` table:**
   ```sql
   INSERT INTO documents (title, type, is_public, status, metadata) 
   VALUES ('Your Document Title', 'research_paper', true, 'pending', '{"author": "Your Name"}');
   ```

2. **Add document chunks:**
   ```sql
   INSERT INTO document_chunks (document_id, chunk_text, chunk_order, metadata)
   VALUES ('your-document-id', 'Your document content here...', 1, '{"section": "introduction"}');
   ```

3. **Generate embeddings** (requires additional setup - see the [Sidecar Embedding Engine](https://github.com/PennyRaized/supabase-sidecar-embedding-engine) for automated embedding generation)

### **Troubleshooting Common Issues**

#### **Database Connection Issues**
- **Problem**: `psql: error: connection to server failed`
- **Solution**: Verify your database URL format: `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`
- **Check**: Ensure your password doesn't contain special characters that need URL encoding

#### **Edge Function Deployment Issues**
- **Problem**: `Error: Invalid API key`
- **Solution**: Run `supabase login` again or use `supabase login --token YOUR_ACCESS_TOKEN`
- **Check**: Verify you're in the correct project directory

#### **OpenAI API Issues**
- **Problem**: `Error: Invalid API key provided`
- **Solution**: Verify your OpenAI API key in the Supabase secrets: `supabase secrets list`
- **Check**: Ensure your OpenAI account has sufficient credits

#### **Test Failures**
- **Problem**: Smoke test fails with timeout errors
- **Solution**: Check your internet connection and try again
- **Debug**: Run individual tests: `npm run test:performance` and `npm run test:quality`

### **Next Steps**

Once everything is working:

1. **Run Performance Tests:** `npm run test:performance`
2. **Run Quality Tests:** `npm run test:quality`
3. **Explore the API:** Check the detailed API documentation below
4. **Customize Configuration:** Adjust search parameters and insight generation settings
5. **Scale Up:** Add more documents and monitor performance metrics

### **Available Testing Scripts**

The repository includes comprehensive testing scripts (located in `scripts/` directory):

#### **Main Functionality Test**
```bash
npm run test
# Runs: scripts/test-rag-engine.cjs
```
- Tests database connectivity
- Validates Edge Function deployment
- Runs sample search queries
- Generates test insights
- Shows performance metrics

#### **Performance Benchmarking**
```bash
npm run test:performance
# Runs: scripts/test-performance.cjs
```
- Measures search latency across different configurations
- Tests embedding generation speed
- Benchmarks insight generation performance
- Provides optimization recommendations

#### **Search Quality Validation**
```bash
npm run test:quality
# Runs: scripts/test-search-quality.cjs
```
- Validates relevance density calculations
- Tests fallback search effectiveness
- Measures confidence scoring accuracy
- Ensures zero-result prevention

#### **Complete Smoke Test**
```bash
npm run smoke-test
# Runs all tests and shows success confirmation
```
- Executes all functionality tests
- Provides clear success/failure indication
- Perfect for CI/CD pipelines

## 📁 Repository Structure

This repository contains everything needed to run a production RAG system:

```
rag-insights-engine/
├── supabase/
│   ├── bootstrap.sql              # Complete database setup (tables, functions, sample data)
│   ├── functions/
│   │   ├── query-knowledge-base/  # Hybrid search Edge Function
│   │   ├── generate-rag-insights/ # Insight generation Edge Function
│   │   └── _shared/cors.ts        # CORS configuration
│   └── migrations/                # Individual migration files
├── scripts/
│   ├── test-rag-engine.cjs        # Main functionality tests
│   ├── test-performance.cjs       # Performance benchmarking
│   └── test-search-quality.cjs    # Search quality validation
├── docs/                          # Documentation and architecture guides
├── .env.example                   # Environment configuration template
├── package.json                   # Dependencies and npm scripts
├── package-lock.json              # Locked dependency versions
└── README.md                      # This comprehensive guide
```

**Key Files:**
- **`supabase/bootstrap.sql`**: One-command database setup with sample data
- **`scripts/test-rag-engine.cjs`**: Comprehensive functionality testing
- **`scripts/test-performance.cjs`**: Performance benchmarking and optimization
- **`scripts/test-search-quality.cjs`**: Search quality validation and metrics
- **`.env.example`**: Complete environment configuration template

## 🔧 Core Features

### Hybrid Search Engine
- **Vector Similarity Search**: Semantic understanding using 384-dimensional embeddings
- **Keyword Full-Text Search**: Precise term matching with PostgreSQL's tsvector
- **Reciprocal Rank Fusion**: Optimized RRF with k=10 for better result differentiation
- **Configurable Parameters**: Enable/disable advanced features as needed

### Production-Grade Resilience
- **Fallback Search Strategy**: Multi-pass retrieval when precision searches fail
- **Graceful Degradation**: System continues functioning even with missing components
- **Comprehensive Error Handling**: Every failure mode has a documented response
- **Timeout Protection**: All LLM calls include timeout and retry logic

### Advanced Quality Metrics
- **Relevance Density Calculation**: Measures topic concentration within documents
- **Confidence Scoring**: Dual-factor scoring using RRF scores and relevance density
- **Debug Scoring**: Detailed breakdown of how results were ranked and selected
- **Performance Monitoring**: Track latency at every stage of the pipeline

### Multi-Stage Insight Generation
- **Document Summaries**: Confidence-scored relevance summaries for each document
- **Direct Answers**: Synthesized responses with source citations
- **Related Questions**: Strategic, technical, and adoption-focused follow-ups
- **Intelligent Caching**: 24-hour TTL with cache key optimization
- **Priority Processing**: OpenAI priority tier for reduced latency

## 📊 Performance Characteristics

Based on production testing with 250+ documents and 3,750+ chunks:

### Search Performance
- **Average Search Time**: 985ms for 50 chunks (quality-optimized configuration)
- **Embedding Generation**: ~150ms for query embedding with gte-small
- **Parallel Retrieval**: ~400ms for semantic + keyword search in parallel
- **Document Grouping**: ~100ms for relevance density calculation and result organization

### Insight Generation Performance
- **Baseline Processing**: 6-8 seconds for comprehensive insights
- **Priority Processing**: 3-4 seconds with OpenAI priority tier (50%+ improvement)
- **Cache Hit Rate**: >70% for repeated queries in production workloads
- **Parallel LLM Generation**: All insight types generated simultaneously

### Quality Metrics
- **Zero Results Prevention**: Fallback search reduces zero-result queries by 85%
- **Relevance Density**: Distinguishes between documents "about" vs "mentioning" topics
- **Confidence Accuracy**: Precision-tested confidence scoring with real-world validation

## 🎛️ Configuration Options

### Search Configuration
```javascript
{
  user_query: "your search query",
  limit: 50,  // Number of chunks to retrieve
  min_similarity: 0.6,  // Similarity threshold (0.0-1.0)
  debug: true,  // Enable detailed scoring information
  enable_fallback: true,  // Enable multi-pass search strategy
  enable_density_calc: true,  // Enable relevance density metrics
  filters: {
    document_id: ["doc-1", "doc-2"],  // Filter by specific documents
    document_type: ["research_paper"],  // Filter by document type
    dateRange: {  // Filter by date metadata
      start: "2023-01-01",
      end: "2024-01-01"
    }
  }
}
```

### Insight Configuration
```javascript
{
  user_query: "your query",
  documents: searchResults,
  insight_type: "all",  // "document_summaries" | "direct_answer" | "related_questions" | "all"
  priority: true,  // Use OpenAI priority processing
  cache_key: "custom_key"  // Override automatic cache key generation
}
```

## 🧪 Testing & Validation

### Functionality Testing
```bash
npm run test  # Basic functionality test
```
Tests database connectivity, Edge Function deployment, and end-to-end RAG pipeline.

**Test Results:**
- **Priority Processing**: 55.2% improvement (3,592ms → 1,611ms)
- **LLM Calls**: 59.9% improvement (3,288ms → 1,319ms)
- **Confidence Score**: 90% (consistent across configurations)

### Performance Testing
```bash
npm run test:performance  # Performance benchmarking
```
Measures search latency, insight generation speed, and system throughput with various configurations.

**Test Results:**
- **Search Performance**: 361ms average (10 queries tested)
- **Embedding Generation**: 165ms average
- **Semantic Search**: 68ms average
- **Keyword Search**: 69ms average

### Quality Testing
```bash
npm run test:quality  # Search quality validation
```
Validates relevance density calculation, confidence scoring accuracy, and fallback search effectiveness.

**Test Results:**
- **Fallback Usage Rate**: 20% (1 out of 5 test cases)
- **Empty Result Rate**: 0% (fallback ensures results)
- **Average Density**: 17.0% across all queries
- **Documents per Query**: 5.6 average
- **Chunks per Query**: 12.6 average

## 🏗️ Architecture Deep Dive

### Database Schema
The system uses a clean separation between documents and searchable chunks:

```sql
-- Core documents table
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  type text NOT NULL,
  is_public boolean DEFAULT false,
  status text DEFAULT 'pending',
  metadata jsonb DEFAULT '{}'
);

-- Searchable chunks with embeddings
CREATE TABLE document_chunks (
  id uuid PRIMARY KEY,
  document_id uuid REFERENCES documents(id),
  chunk_text text NOT NULL,
  chunk_order integer NOT NULL,
  embedding vector(384),  -- gte-small embeddings
  search_vector tsvector,  -- Full-text search
  metadata jsonb DEFAULT '{}'
);
```

### Hybrid Search Implementation
1. **Parallel Retrieval**: Semantic and keyword searches run simultaneously
2. **Reciprocal Rank Fusion**: Results combined using optimized RRF formula (k=10)
3. **Quality Filtering**: Results filtered by similarity threshold and document criteria
4. **Fallback Strategy**: Broader search if initial results are insufficient
5. **Document Grouping**: Chunks grouped by document with relevance density calculation

### Insight Generation Pipeline
1. **Document Summaries**: Parallel processing with confidence scoring
2. **Direct Answers**: Multi-document synthesis with source attribution
3. **Related Questions**: Context-aware follow-up generation
4. **Quality Assurance**: Confidence scoring based on search quality and content relevance

## 🔍 Observability & Debugging

### Performance Metrics
Every request returns detailed timing information:
```json
{
  "performance_metrics": {
    "embedding_generation_ms": 150,
    "semantic_search_ms": 200,
    "keyword_search_ms": 180,
    "rrf_fusion_ms": 15,
    "document_grouping_ms": 95,
    "total_search_ms": 640,
    "insights_generation_ms": 3200,
    "cache_lookup_ms": 5
  }
}
```

### Debug Scoring
With `debug: true`, get detailed ranking information:
```json
{
  "_debug_scores": {
    "search_type": "hybrid",
    "semantic_rank": 1,
    "keyword_rank": 3,
    "rrf_score": 0.18,
    "raw_semantic_score": 0.89,
    "raw_keyword_score": 0.12,
    "relevance_density": 0.73
  }
}
```

### Quality Metrics
Monitor search and insight quality:
```json
{
  "fallback_info": {
    "used": true,
    "precision_results": 2,
    "fallback_results": 8,
    "threshold": 3
  },
  "confidence_score": 0.87,
  "relevance_density": 0.73
}
```

## 🚧 Scaling Considerations

### Current Tested Scale
- **250+ documents** with **3,750+ chunks**
- **985ms average search time** with quality-optimized settings
- **70%+ cache hit rate** in production workloads

### Optimization Strategies
- **Index Tuning**: HNSW parameters optimized for recall vs speed
- **Chunk Size**: 50 chunks provides optimal quality/performance balance
- **Connection Pooling**: PgBouncer recommended for high-throughput scenarios
- **Caching**: 24-hour TTL with intelligent cache key generation

### Future Scaling (10,000+ Documents)
- **Database Sharding**: Horizontal partitioning for very large collections
- **Embedding Model Upgrades**: Support for higher-dimensional embeddings
- **Advanced Chunking**: Content-aware and metadata-enhanced chunking strategies
- **Load Testing**: Automated testing for concurrent user scenarios

## 🤝 Contributing

We welcome contributions! This project follows a systematic development approach with comprehensive testing at every level.

### Development Setup
```bash
git clone https://github.com/PennyRaized/rag-insights-engine.git
cd rag-insights-engine
npm install
cp .env.example .env
# Edit .env with your development values
npm run dev  # Start local development
```

### Testing Your Changes
```bash
npm run test           # Functionality tests
npm run test:performance  # Performance regression tests
npm run test:quality      # Quality validation tests
```

### Code Standards
- **TypeScript**: All Edge Functions use TypeScript with strict typing
- **Error Handling**: Comprehensive error handling with meaningful messages
- **Performance**: All changes must maintain <1s search performance
- **Documentation**: Update performance metrics and configuration docs

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Related Projects

- **[Supabase Sidecar Embedding Engine](https://github.com/PennyRaized/supabase-sidecar-embedding-engine)**: The data pipeline that feeds this intelligence layer
- **[Supabase](https://supabase.com)**: The platform that powers our backend
- **[OpenAI](https://platform.openai.com)**: LLM provider for insight generation

---

