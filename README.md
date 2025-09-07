# RAG Insights Engine

*Advanced RAG system for document insights with hybrid search and multi-stage LLM processing*

## Overview

A production-ready RAG (Retrieval-Augmented Generation) system that transforms document embeddings into intelligent insights through multi-stage LLM processing and hybrid search. This system focuses exclusively on the "intelligence layer" - querying existing embeddings, hybrid search, LLM calls for insights, caching, and performance monitoring.

## Architecture

The system uses a Supabase-native architecture with Edge Functions for serverless processing:

- **Hybrid Search**: Combines vector similarity, full-text search, and structured filtering
- **Multi-Stage RAG**: Generates key questions, direct answers, and related questions
- **Performance Monitoring**: Comprehensive latency tracking and optimization
- **Intelligent Caching**: Reduces LLM costs and improves response times

## Project Structure

```
rag-insights-engine/
├── supabase/           # Database migrations and Edge Functions
├── src/               # Source code and scripts
├── docs/              # Documentation and architecture guides
├── config/            # Configuration files
├── tests/             # Testing infrastructure
└── examples/          # Usage examples and sample data
```

## Development Roadmap

This project demonstrates professional refactoring practices through 8 focused commits:

1. **Foundation Setup** ✅ (Current)
2. **Hybrid Search Engine** 📋
3. **Core RAG Pipeline** 📋
4. **Performance Monitoring** 📋
5. **Search Quality Optimization** 📋
6. **Generalization & Configuration** 📋
7. **Documentation & Examples** 📋
8. **Future Roadmap** 📋

## License

MIT License - see [LICENSE](LICENSE) file for details.
