#!/usr/bin/env node

/**
 * Search Quality Testing Script for RAG Insights Engine
 * 
 * This script tests the search quality features including fallback search,
 * relevance density calculation, and informed judge confidence scoring.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Test queries designed to trigger different quality features
const QUALITY_TEST_QUERIES = [
  {
    name: "High Precision Query",
    query: "machine learning algorithms for natural language processing",
    expectedFeatures: ["high_similarity", "good_density"],
    filters: { min_similarity: 0.8 }
  },
  {
    name: "Restrictive Filter Query",
    query: "artificial intelligence trends",
    expectedFeatures: ["fallback_search", "broader_results"],
    filters: { 
      document_type: ["research_paper"],
      min_similarity: 0.9
    }
  },
  {
    name: "Low Density Query",
    query: "quantum computing applications",
    expectedFeatures: ["low_density", "mention_only"],
    filters: { min_similarity: 0.5 }
  },
  {
    name: "Complex Multi-Concept Query",
    query: "blockchain technology in healthcare data management",
    expectedFeatures: ["synthesis", "multiple_concepts"],
    filters: { min_similarity: 0.6 }
  },
  {
    name: "Very Specific Technical Query",
    query: "transformer architecture attention mechanisms self-attention",
    expectedFeatures: ["technical_precision", "high_confidence"],
    filters: { min_similarity: 0.7 }
  }
];

// Quality metrics tracking
class QualityMetrics {
  constructor() {
    this.results = [];
    this.fallbackUsage = 0;
    this.emptyResults = 0;
    this.confidenceScores = [];
    this.densityScores = [];
  }

  addResult(testName, result) {
    this.results.push({
      testName,
      totalDocuments: result.total_documents,
      totalChunks: result.total_chunks,
      fallbackUsed: result.fallback_info?.used || false,
      performance: result.performance_metrics,
      documents: result.results?.map(doc => ({
        title: doc.document_title,
        rrfScore: doc.best_rrf_score,
        density: doc.relevance_density,
        chunks: doc.chunks?.length || 0
      })) || []
    });

    if (result.fallback_info?.used) {
      this.fallbackUsage++;
    }

    if (result.total_documents === 0) {
      this.emptyResults++;
    }

    // Collect confidence scores from document summaries
    if (result.results) {
      result.results.forEach(doc => {
        if (doc.relevance_density !== undefined) {
          this.densityScores.push(doc.relevance_density);
        }
      });
    }
  }

  getSummary() {
    const totalTests = this.results.length;
    const fallbackRate = (this.fallbackUsage / totalTests * 100).toFixed(1);
    const emptyResultRate = (this.emptyResults / totalTests * 100).toFixed(1);
    const avgDensity = this.densityScores.length > 0 
      ? (this.densityScores.reduce((a, b) => a + b, 0) / this.densityScores.length * 100).toFixed(1)
      : 0;

    return {
      totalTests,
      fallbackRate: `${fallbackRate}%`,
      emptyResultRate: `${emptyResultRate}%`,
      avgDensity: `${avgDensity}%`,
      avgDocuments: (this.results.reduce((sum, r) => sum + r.totalDocuments, 0) / totalTests).toFixed(1),
      avgChunks: (this.results.reduce((sum, r) => sum + r.totalChunks, 0) / totalTests).toFixed(1)
    };
  }
}

// Test search quality features
async function testSearchQuality() {
  console.log('\n🔍 Testing Search Quality Features...');
  console.log('=' .repeat(60));

  const metrics = new QualityMetrics();

  for (let i = 0; i < QUALITY_TEST_QUERIES.length; i++) {
    const test = QUALITY_TEST_QUERIES[i];
    console.log(`\n📋 Test ${i + 1}: ${test.name}`);
    console.log(`Query: "${test.query}"`);
    console.log(`Expected Features: ${test.expectedFeatures.join(', ')}`);

    try {
      const { data, error } = await supabase.functions.invoke('query-knowledge-base', {
        body: {
          user_query: test.query,
          limit: 20,
          min_similarity: test.filters.min_similarity || 0.6,
          filters: test.filters,
          debug: true // Enable debug information
        }
      });

      if (error) {
        console.error(`❌ Test ${i + 1} failed:`, error.message);
        continue;
      }

      // Analyze results
      const analysis = analyzeSearchResults(data, test.expectedFeatures);
      console.log(`✅ Results: ${data.total_documents} documents, ${data.total_chunks} chunks`);
      console.log(`📊 Analysis: ${analysis.summary}`);
      
      if (data.fallback_info?.used) {
        console.log(`🔄 Fallback used: ${data.fallback_info.precision_results} precision + ${data.fallback_info.fallback_results} fallback = ${data.fallback_info.total_combined} total`);
      }

      // Show sample documents with quality metrics
      if (data.results && data.results.length > 0) {
        console.log(`📄 Sample Documents:`);
        data.results.slice(0, 3).forEach((doc, idx) => {
          const density = doc.relevance_density ? (doc.relevance_density * 100).toFixed(0) : 'N/A';
          console.log(`  ${idx + 1}. "${doc.document_title}" (RRF: ${doc.best_rrf_score?.toFixed(3)}, Density: ${density}%)`);
        });
      }

      metrics.addResult(test.name, data);

    } catch (error) {
      console.error(`❌ Test ${i + 1} error:`, error.message);
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return metrics;
}

// Analyze search results for quality features
function analyzeSearchResults(data, expectedFeatures) {
  const analysis = {
    summary: '',
    features: []
  };

  // Check for fallback usage
  if (data.fallback_info?.used) {
    analysis.features.push('fallback_search');
    analysis.summary += 'Fallback used, ';
  }

  // Check for empty results
  if (data.total_documents === 0) {
    analysis.features.push('empty_results');
    analysis.summary += 'No results, ';
  }

  // Check for high-quality results
  if (data.results && data.results.length > 0) {
    const avgRrfScore = data.results.reduce((sum, doc) => sum + (doc.best_rrf_score || 0), 0) / data.results.length;
    const avgDensity = data.results.reduce((sum, doc) => sum + (doc.relevance_density || 0), 0) / data.results.length;

    if (avgRrfScore > 0.1) {
      analysis.features.push('good_rrf_scores');
    }
    if (avgDensity > 0.3) {
      analysis.features.push('good_density');
    }
    if (avgDensity < 0.2) {
      analysis.features.push('low_density');
    }

    analysis.summary += `Avg RRF: ${avgRrfScore.toFixed(3)}, Avg Density: ${(avgDensity * 100).toFixed(0)}%`;
  }

  return analysis;
}

// Test RAG insights quality
async function testRAGInsightsQuality() {
  console.log('\n🧠 Testing RAG Insights Quality...');
  console.log('=' .repeat(60));

  // First get some search results
  const { data: searchData, error: searchError } = await supabase.functions.invoke('query-knowledge-base', {
    body: {
      user_query: "artificial intelligence machine learning applications",
      limit: 5,
      min_similarity: 0.6
    }
  });

  if (searchError || !searchData.results) {
    console.error('❌ Failed to get search results for RAG testing:', searchError);
    return;
  }

  const testDocuments = searchData.results.slice(0, 3);
  const testQuery = "What are the key applications of AI and machine learning?";

  console.log(`\n📋 Testing RAG Insights with ${testDocuments.length} documents`);
  console.log(`Query: "${testQuery}"`);

  try {
    const { data, error } = await supabase.functions.invoke('generate-rag-insights', {
      body: {
        user_query: testQuery,
        documents: testDocuments,
        insight_type: 'all',
        priority: true,
        search_time_ms: searchData.performance_metrics?.total_search_ms || 0
      }
    });

    if (error) {
      console.error('❌ RAG insights failed:', error.message);
      return;
    }

    console.log('✅ RAG Insights Generated Successfully');
    console.log(`📊 Performance: ${data.performance_metrics?.total_duration_ms || 0}ms total`);

    // Analyze document summaries quality
    if (data.document_summaries) {
      console.log('\n📄 Document Summaries:');
      data.document_summaries.forEach((summary, idx) => {
        console.log(`  ${idx + 1}. "${summary.document_title}"`);
        console.log(`     Confidence: ${(summary.confidence_score * 100).toFixed(0)}%`);
        console.log(`     Summary: ${summary.relevance_summary.substring(0, 100)}...`);
      });
    }

    // Analyze direct answer quality
    if (data.direct_answer) {
      console.log('\n💬 Direct Answer:');
      console.log(`  Confidence: ${(data.direct_answer.confidence * 100).toFixed(0)}%`);
      console.log(`  Answer: ${data.direct_answer.answer.substring(0, 200)}...`);
      console.log(`  Sources: ${data.direct_answer.source_documents.length} documents`);
    }

    // Analyze related questions quality
    if (data.related_questions) {
      console.log('\n❓ Related Questions:');
      data.related_questions.forEach((q, idx) => {
        console.log(`  ${idx + 1}. [${q.category}] ${q.question} (${(q.relevance * 100).toFixed(0)}%)`);
      });
    }

  } catch (error) {
    console.error('❌ RAG insights error:', error.message);
  }
}

// Test debug information
async function testDebugInformation() {
  console.log('\n🐛 Testing Debug Information...');
  console.log('=' .repeat(60));

  try {
    const { data, error } = await supabase.functions.invoke('query-knowledge-base', {
      body: {
        user_query: "machine learning algorithms",
        limit: 5,
        min_similarity: 0.6,
        debug: true // Enable debug mode
      }
    });

    if (error) {
      console.error('❌ Debug test failed:', error.message);
      return;
    }

    console.log('✅ Debug Information Retrieved');
    
    if (data.results && data.results.length > 0) {
      const firstDoc = data.results[0];
      if (firstDoc.chunks && firstDoc.chunks.length > 0) {
        const firstChunk = firstDoc.chunks[0];
        if (firstChunk._debug_scores) {
          console.log('\n🔍 Sample Debug Scores:');
          console.log(`  Search Type: ${firstChunk._debug_scores.search_type}`);
          console.log(`  Semantic Rank: ${firstChunk._debug_scores.semantic_rank}`);
          console.log(`  Keyword Rank: ${firstChunk._debug_scores.keyword_rank}`);
          console.log(`  RRF Score: ${firstChunk._debug_scores.rrf_score}`);
          console.log(`  Keyword Match: ${firstChunk._debug_scores.keyword_match}`);
          console.log(`  Raw Semantic: ${firstChunk._debug_scores.raw_semantic_score}`);
          console.log(`  Raw Keyword: ${firstChunk._debug_scores.raw_keyword_score}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Debug test error:', error.message);
  }
}

// Main test execution
async function runQualityTests() {
  console.log('🚀 Starting RAG Insights Engine Quality Tests');
  console.log('=' .repeat(70));

  try {
    // Test search quality features
    const searchMetrics = await testSearchQuality();

    // Test RAG insights quality
    await testRAGInsightsQuality();

    // Test debug information
    await testDebugInformation();

    // Print summary
    console.log('\n📊 Quality Test Summary');
    console.log('=' .repeat(50));
    const summary = searchMetrics.getSummary();
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Fallback Usage Rate: ${summary.fallbackRate}`);
    console.log(`Empty Result Rate: ${summary.emptyResultRate}`);
    console.log(`Average Density: ${summary.avgDensity}`);
    console.log(`Average Documents per Query: ${summary.avgDocuments}`);
    console.log(`Average Chunks per Query: ${summary.avgChunks}`);

    console.log('\n✅ Quality testing completed successfully!');

  } catch (error) {
    console.error('❌ Quality testing failed:', error.message);
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runQualityTests();
}

module.exports = {
  testSearchQuality,
  testRAGInsightsQuality,
  testDebugInformation,
  runQualityTests
};
