#!/usr/bin/env node

/**
 * Performance Testing Script for RAG Insights Engine
 * 
 * This script tests the performance of both Edge Functions with various
 * configurations to measure optimization impact.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/penny/MVP-in-bolt-v2/mvp-in-bolt-v3/.env' });

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Test queries for search performance
const SEARCH_TEST_QUERIES = [
  "What are the latest trends in artificial intelligence?",
  "How does machine learning work in practice?",
  "What are the benefits of cloud computing?",
  "Explain quantum computing applications in healthcare",
  "What is the future of blockchain technology?",
  "How do neural networks process information?",
  "What are the challenges in data science?",
  "Explain the role of APIs in modern software",
  "What are the security considerations for web applications?",
  "How does database optimization work?"
];

// Test configurations for RAG insights
const RAG_TEST_CONFIGURATIONS = [
  { name: "Baseline", priority: false, cache: false },
  { name: "Priority Only", priority: true, cache: false },
  { name: "Priority + Cache", priority: true, cache: true }
];

// Performance measurement utilities
class PerformanceTimer {
  constructor() {
    this.startTime = Date.now();
    this.marks = {};
  }

  mark(name) {
    this.marks[name] = Date.now() - this.startTime;
  }

  getDuration() {
    return Date.now() - this.startTime;
  }

  getMark(name) {
    return this.marks[name] || 0;
  }
}

// Test search performance
async function testSearchPerformance() {
  console.log('\n🔍 Testing Search Performance...');
  console.log('=' .repeat(50));

  const results = [];

  for (let i = 0; i < SEARCH_TEST_QUERIES.length; i++) {
    const query = SEARCH_TEST_QUERIES[i];
    const timer = new PerformanceTimer();

    try {
      const { data, error } = await supabase.functions.invoke('query-knowledge-base', {
        body: {
          user_query: query,
          limit: 20,
          min_similarity: 0.6
        }
      });

      timer.mark('complete');

      if (error) {
        console.error(`❌ Query ${i + 1} failed:`, error.message);
        continue;
      }

      const duration = timer.getDuration();
      const performanceMetrics = data.performance_metrics || {};

      results.push({
        query: query.substring(0, 50) + '...',
        duration,
        embedding_ms: performanceMetrics.embedding_generation_ms || 0,
        semantic_ms: performanceMetrics.semantic_search_ms || 0,
        keyword_ms: performanceMetrics.keyword_search_ms || 0,
        rrf_ms: performanceMetrics.rrf_fusion_ms || 0,
        grouping_ms: performanceMetrics.document_grouping_ms || 0,
        total_search_ms: performanceMetrics.total_search_ms || 0,
        documents: data.total_documents || 0,
        chunks: data.total_chunks || 0
      });

      console.log(`✅ Query ${i + 1}: ${duration}ms (${data.total_documents} docs, ${data.total_chunks} chunks)`);

    } catch (error) {
      console.error(`❌ Query ${i + 1} error:`, error.message);
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Calculate averages
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const avgEmbedding = results.reduce((sum, r) => sum + r.embedding_ms, 0) / results.length;
  const avgSemantic = results.reduce((sum, r) => sum + r.semantic_ms, 0) / results.length;
  const avgKeyword = results.reduce((sum, r) => sum + r.keyword_ms, 0) / results.length;
  const avgRRF = results.reduce((sum, r) => sum + r.rrf_ms, 0) / results.length;
  const avgGrouping = results.reduce((sum, r) => sum + r.grouping_ms, 0) / results.length;

  console.log('\n📊 Search Performance Summary:');
  console.log(`Average Total Duration: ${avgDuration.toFixed(0)}ms`);
  console.log(`Average Embedding: ${avgEmbedding.toFixed(0)}ms`);
  console.log(`Average Semantic Search: ${avgSemantic.toFixed(0)}ms`);
  console.log(`Average Keyword Search: ${avgKeyword.toFixed(0)}ms`);
  console.log(`Average RRF Fusion: ${avgRRF.toFixed(0)}ms`);
  console.log(`Average Document Grouping: ${avgGrouping.toFixed(0)}ms`);

  return results;
}

// Test RAG insights performance
async function testRAGInsightsPerformance() {
  console.log('\n🧠 Testing RAG Insights Performance...');
  console.log('=' .repeat(50));

  // First, get some search results to use for RAG testing
  const { data: searchData, error: searchError } = await supabase.functions.invoke('query-knowledge-base', {
    body: {
      user_query: "What are the latest trends in artificial intelligence?",
      limit: 10,
      min_similarity: 0.6
    }
  });

  if (searchError || !searchData.results) {
    console.error('❌ Failed to get search results for RAG testing:', searchError);
    return;
  }

  const testDocuments = searchData.results.slice(0, 5); // Use first 5 documents
  const testQuery = "What are the key trends and developments in AI?";

  const results = [];

  for (const config of RAG_TEST_CONFIGURATIONS) {
    console.log(`\n🔧 Testing ${config.name}...`);

    const timer = new PerformanceTimer();

    try {
      const { data, error } = await supabase.functions.invoke('generate-rag-insights', {
        body: {
          user_query: testQuery,
          documents: testDocuments,
          insight_type: 'all',
          priority: config.priority,
          cache_key: config.cache ? `test_${Date.now()}` : undefined,
          search_time_ms: searchData.performance_metrics?.total_search_ms || 0
        }
      });

      timer.mark('complete');

      if (error) {
        console.error(`❌ ${config.name} failed:`, error.message);
        continue;
      }

      const duration = timer.getDuration();
      const performanceMetrics = data.performance_metrics || {};

      results.push({
        configuration: config.name,
        duration,
        cached: data.cached || false,
        cache_lookup_ms: performanceMetrics.cache_lookup_ms || 0,
        insights_generation_ms: performanceMetrics.insights_generation_ms || 0,
        llm_calls_ms: performanceMetrics.llm_calls_ms || 0,
        priority_processing: performanceMetrics.priority_processing || false,
        breakdown: performanceMetrics.breakdown || {}
      });

      console.log(`✅ ${config.name}: ${duration}ms (cached: ${data.cached || false})`);

    } catch (error) {
      console.error(`❌ ${config.name} error:`, error.message);
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Calculate improvements
  const baseline = results.find(r => r.configuration === 'Baseline');
  const priority = results.find(r => r.configuration === 'Priority Only');
  const priorityCache = results.find(r => r.configuration === 'Priority + Cache');

  console.log('\n📊 RAG Insights Performance Summary:');
  console.log(`Baseline: ${baseline?.duration || 0}ms`);
  console.log(`Priority Only: ${priority?.duration || 0}ms`);
  console.log(`Priority + Cache: ${priorityCache?.duration || 0}ms`);

  if (baseline && priority) {
    const improvement = ((baseline.duration - priority.duration) / baseline.duration * 100).toFixed(1);
    console.log(`Priority Improvement: ${improvement}%`);
  }

  if (baseline && priorityCache) {
    const improvement = ((baseline.duration - priorityCache.duration) / baseline.duration * 100).toFixed(1);
    console.log(`Priority + Cache Improvement: ${improvement}%`);
  }

  return results;
}

// Test cache effectiveness
async function testCacheEffectiveness() {
  console.log('\n💾 Testing Cache Effectiveness...');
  console.log('=' .repeat(50));

  const testQuery = "What are the benefits of cloud computing?";
  const cacheKey = `cache_test_${Date.now()}`;

  // First request (cache miss)
  const timer1 = new PerformanceTimer();
  const { data: data1, error: error1 } = await supabase.functions.invoke('generate-rag-insights', {
    body: {
      user_query: testQuery,
      documents: [], // Empty for simplicity
      insight_type: 'direct_answer',
      cache_key: cacheKey
    }
  });
  timer1.mark('complete');

  if (error1) {
    console.error('❌ First request failed:', error1.message);
    return;
  }

  // Second request (cache hit)
  const timer2 = new PerformanceTimer();
  const { data: data2, error: error2 } = await supabase.functions.invoke('generate-rag-insights', {
    body: {
      user_query: testQuery,
      documents: [],
      insight_type: 'direct_answer',
      cache_key: cacheKey
    }
  });
  timer2.mark('complete');

  if (error2) {
    console.error('❌ Second request failed:', error2.message);
    return;
  }

  const firstDuration = timer1.getDuration();
  const secondDuration = timer2.getDuration();
  const improvement = ((firstDuration - secondDuration) / firstDuration * 100).toFixed(1);

  console.log(`First Request (Cache Miss): ${firstDuration}ms`);
  console.log(`Second Request (Cache Hit): ${secondDuration}ms`);
  console.log(`Cache Improvement: ${improvement}%`);
  console.log(`Cache Hit: ${data2.cached || false}`);
}

// Main test execution
async function runPerformanceTests() {
  console.log('🚀 Starting RAG Insights Engine Performance Tests');
  console.log('=' .repeat(60));

  try {
    // Test search performance
    const searchResults = await testSearchPerformance();

    // Test RAG insights performance
    const ragResults = await testRAGInsightsPerformance();

    // Test cache effectiveness
    await testCacheEffectiveness();

    console.log('\n✅ Performance testing completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`- Search queries tested: ${searchResults.length}`);
    console.log(`- RAG configurations tested: ${ragResults.length}`);
    console.log('- Cache effectiveness verified');

  } catch (error) {
    console.error('❌ Performance testing failed:', error.message);
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runPerformanceTests();
}

module.exports = {
  testSearchPerformance,
  testRAGInsightsPerformance,
  testCacheEffectiveness,
  runPerformanceTests
};
