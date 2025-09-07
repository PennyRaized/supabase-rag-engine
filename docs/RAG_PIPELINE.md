# RAG Pipeline Architecture

*Multi-stage RAG pipeline for generating document insights, direct answers, and forward-looking questions*

## Overview

The RAG Pipeline transforms search results into three types of intelligent insights through parallel LLM processing. This implementation focuses on the core functionality without advanced features like confidence scoring or complex optimization.

## Pipeline Components

### **1. Document Relevance Analysis**

Analyzes why each document is relevant to the user's query.

**Input:**
- User query
- Document chunks with similarity scores
- Document metadata

**Output:**
- Relevance reasoning for each document
- Confidence score (0.0-1.0)
- Document identification

**Example:**
```json
{
  "document_id": "doc-123",
  "document_title": "Quantum Computing in Healthcare",
  "relevance_reason": "This document is relevant because it specifically addresses quantum algorithms for drug discovery, which directly relates to your question about pharmaceutical applications.",
  "confidence": 0.87
}
```

### **2. Direct Answer Generation**

Synthesizes a comprehensive answer from multiple document sources.

**Input:**
- User query
- Top-ranked document chunks
- Source document titles

**Output:**
- Synthesized answer with markdown formatting
- Inline source citations
- Confidence score
- Source document list

**Example:**
```json
{
  "answer": "Quantum computing in pharmaceuticals offers **three key advantages**: [Source: Quantum Computing in Healthcare]\n\n1. **Molecular Simulation**: Quantum algorithms can simulate complex molecular interactions that classical computers cannot handle efficiently [Source: Drug Discovery Methods]\n\n2. **Optimization Problems**: Quantum annealing can solve complex optimization problems in drug design [Source: Quantum Algorithms for Pharma]\n\n3. **Machine Learning**: Quantum machine learning can identify patterns in molecular data that classical methods miss [Source: Quantum ML in Drug Discovery]",
  "confidence": 0.92,
  "source_documents": ["Quantum Computing in Healthcare", "Drug Discovery Methods", "Quantum Algorithms for Pharma"]
}
```

### **3. Forward-Looking Questions**

Generates strategic follow-up questions to guide user exploration.

**Input:**
- User query
- Document context
- Query analysis

**Output:**
- 3 categorized questions
- Relevance scores
- Strategic categories

**Categories:**
- **Strategic**: Market, competition, business model, future trends
- **Technical**: Implementation, architecture, features, science
- **Adoption**: Risks, challenges, use cases, ROI

**Example:**
```json
[
  {
    "question": "How do quantum algorithms for molecular simulation differ from classical methods?",
    "category": "technical",
    "relevance": 0.89
  },
  {
    "question": "What are the primary regulatory hurdles for implementing quantum computing in clinical trials?",
    "category": "adoption",
    "relevance": 0.91
  },
  {
    "question": "What is the long-term competitive advantage for pharmaceutical companies that master quantum computing first?",
    "category": "strategic",
    "relevance": 0.76
  }
]
```

## Implementation Details

### **Parallel Processing**

All three insight types are generated simultaneously using `Promise.all()`:

```typescript
const insights = await Promise.all([
  generateDocumentRelevance(documents, query),
  generateDirectAnswer(documents, query),
  generateForwardQuestions(documents, query)
]);
```

### **Context Selection**

For each insight type, the system:
1. Selects top chunks from each document (3 per document)
2. Sorts by similarity score
3. Limits total context (12 chunks for answers, 3 for questions)
4. Combines into coherent context

### **LLM Integration**

**Model:** GPT-4o-mini (cost-effective, fast)
**Temperature:** 0.3 (balanced creativity and consistency)
**Max Tokens:** 2000 (sufficient for comprehensive responses)

### **Error Handling**

- Graceful degradation if individual insights fail
- Fallback responses for failed generations
- Comprehensive error logging
- Timeout protection

## Performance Characteristics

### **Latency**
- **Document Relevance**: ~200-400ms per document
- **Direct Answer**: ~300-600ms
- **Forward Questions**: ~200-400ms
- **Total Pipeline**: ~300-800ms (parallel execution)

### **Token Usage**
- **Input**: ~2000-4000 tokens per insight type
- **Output**: ~500-1500 tokens per insight type
- **Total**: ~6000-12000 tokens per pipeline execution

### **Cost Optimization**
- Single model (GPT-4o-mini) for all insights
- Parallel processing reduces total time
- Efficient context selection
- Reasonable token limits

## API Interface

### **Request Format**
```typescript
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
  }>;
  insight_type: 'document_relevance' | 'direct_answer' | 'forward_questions' | 'all';
}
```

### **Response Format**
```typescript
interface InsightResponse {
  insights: {
    document_relevance?: DocumentRelevance[];
    direct_answer?: DirectAnswer;
    forward_questions?: ForwardQuestion[];
  };
  query: string;
  document_count: number;
  performance_metrics: {
    total_time_ms: number;
    document_relevance?: { startTime: number; duration: number };
    direct_answer?: { startTime: number; duration: number };
    forward_questions?: { startTime: number; duration: number };
  };
}
```

## Performance Testing Plan

### **Baseline Performance (Current Implementation)**
- **Target**: 300-800ms total pipeline execution
- **Components**: Document relevance (~200-400ms), Direct answer (~300-600ms), Forward questions (~200-400ms)
- **Model**: GPT-4o-mini with temperature 0.3
- **Context**: 12 chunks for answers, 3 chunks for questions

### **Performance Optimization Testing**

#### **Priority Processing Evaluation**
- **Current**: Standard OpenAI API calls
- **Optimization**: Priority processing flag for faster response times
- **Expected Improvement**: 8-11s → 3-5s (based on production experience)
- **Test Method**: A/B testing with identical queries

#### **Evaluation Dataset Requirements**
- **Query Types**: 50+ diverse queries covering different domains
- **Document Sets**: Various document sizes and types
- **Metrics**: Latency, accuracy, cost per query
- **Test Scenarios**:
  - Single document queries
  - Multi-document synthesis
  - Complex technical questions
  - Strategic business questions

#### **Performance Test Framework**
```typescript
interface PerformanceTest {
  query: string;
  documents: Document[];
  expected_insights: {
    document_relevance: DocumentRelevance[];
    direct_answer: DirectAnswer;
    forward_questions: ForwardQuestion[];
  };
  performance_targets: {
    max_latency_ms: number;
    min_confidence: number;
    max_cost_per_query: number;
  };
}
```

### **Optimization Strategies to Test**

1. **Priority Processing**: OpenAI priority API for faster responses
2. **Context Optimization**: Dynamic chunk selection based on query type
3. **Parallel Processing**: Fine-tuned parallel execution
4. **Caching**: Result caching for repeated queries
5. **Model Selection**: Different models for different insight types

## Future Enhancements

- **Confidence Scoring**: Advanced confidence calculation based on source quality
- **Caching**: Result caching for repeated queries
- **Streaming**: Real-time insight generation
- **Custom Models**: Support for different LLM providers
- **Advanced Prompting**: Chain-of-thought and few-shot prompting
- **Quality Metrics**: Automated quality assessment and improvement
