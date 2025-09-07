#!/usr/bin/env node

/**
 * RAG Insights Engine - Basic Functionality Test
 * Tests the core RAG engine functionality with sample queries
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY');
  console.error('💡 Make sure you have a .env file with the required variables');
  console.error('💡 Copy .env.example to .env and fill in your values');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Test data
const testQuery = "What are the key security considerations for API development?";
const testDocuments = [
  {
    document_id: 'test-doc-1',
    document_title: 'API Security Guidelines',
    document_type: 'pdf',
    chunks: [
      {
        id: 'chunk-1',
        text: 'API security is crucial for protecting sensitive data. Key considerations include authentication, authorization, rate limiting, and input validation.',
        order: 1,
        similarity: 0.95
      },
      {
        id: 'chunk-2',
        text: 'Implementing OAuth 2.0 and JWT tokens provides robust authentication. Always validate and sanitize user inputs to prevent injection attacks.',
        order: 2,
        similarity: 0.92
      }
    ]
  }
];

async function testRagInsights(priority = false) {
  try {
    console.log(`\n🧪 Testing RAG Insights ${priority ? 'WITH PRIORITY' : 'WITHOUT PRIORITY'}`);
    console.log('=' .repeat(60));
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-rag-insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        user_query: testQuery,
        documents: testDocuments,
        insight_type: 'all',
        cache_key: `priority-test-${priority ? 'priority' : 'regular'}-${Date.now()}`,
        priority: priority
      })
    });

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    console.log(`✅ Request completed in ${totalDuration}ms`);
    console.log(`📊 Priority Processing: ${result.performance_metrics?.priority_processing ? '✅ Enabled' : '❌ Disabled'}`);
    
    if (result.performance_metrics) {
      console.log(`\n📈 Performance Metrics:`);
      console.log(`   Total Duration: ${result.performance_metrics.total_duration_ms}ms`);
      console.log(`   Cache Lookup: ${result.performance_metrics.cache_lookup_ms}ms`);
      console.log(`   Insights Generation: ${result.performance_metrics.insights_generation_ms}ms`);
      console.log(`   LLM Calls: ${result.performance_metrics.llm_calls_ms}ms`);
      
      if (result.performance_metrics.breakdown) {
        console.log(`\n🔍 Breakdown:`);
        console.log(`   Key Questions: ${result.performance_metrics.breakdown.key_questions_ms}ms`);
        console.log(`   Direct Answer: ${result.performance_metrics.breakdown.direct_answer_ms}ms`);
        console.log(`   Related Questions: ${result.performance_metrics.breakdown.related_questions_ms}ms`);
      }
    }
    
    // Display insights summary
    if (result.key_questions) {
      console.log(`\n❓ Key Questions: ${result.key_questions.length} document(s) with questions`);
    }
    
    if (result.direct_answer) {
      console.log(`\n💡 Direct Answer: ${result.direct_answer.answer.substring(0, 100)}...`);
      console.log(`   Confidence: ${Math.round(result.direct_answer.confidence * 100)}%`);
    }
    
    if (result.related_questions) {
      console.log(`\n🔗 Related Questions: ${result.related_questions.length} questions generated`);
    }
    
    return {
      success: true,
      totalDuration,
      performanceMetrics: result.performance_metrics,
      priority: priority
    };
    
  } catch (error) {
    console.error(`❌ Error testing ${priority ? 'priority' : 'regular'} processing:`, error.message);
    return {
      success: false,
      error: error.message,
      priority: priority
    };
  }
  } catch (error) {
    console.error(`❌ Fatal error in testRagInsights:`, error.message);
    return {
      success: false,
      error: error.message,
      priority: priority
    };
  }
}

async function runPriorityComparison() {
  console.log('🚀 RAG Insights Priority Processing Comparison Test');
  console.log('=' .repeat(60));
  
  // Test regular processing first
  const regularResult = await testRagInsights(false);
  
  // Wait a bit between tests
  console.log('\n⏳ Waiting 2 seconds between tests...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test priority processing
  const priorityResult = await testRagInsights(true);
  
  // Compare results
  console.log('\n📊 COMPARISON RESULTS');
  console.log('=' .repeat(60));
  
  if (regularResult.success && priorityResult.success) {
    const regularTime = regularResult.totalDuration;
    const priorityTime = priorityResult.totalDuration;
    const timeDifference = regularTime - priorityTime;
    const percentageImprovement = ((timeDifference / regularTime) * 100).toFixed(1);
    
    console.log(`⏱️  Regular Processing: ${regularTime}ms`);
    console.log(`⚡ Priority Processing: ${priorityTime}ms`);
    console.log(`📉 Time Difference: ${timeDifference}ms`);
    console.log(`📊 Improvement: ${percentageImprovement}%`);
    
    if (timeDifference > 0) {
      console.log(`\n🎉 Priority processing is ${percentageImprovement}% faster!`);
    } else if (timeDifference < 0) {
      console.log(`\n⚠️  Priority processing was ${Math.abs(percentageImprovement)}% slower (this can happen due to OpenAI queue variations)`);
    } else {
      console.log(`\n🤔 No significant difference in processing time`);
    }
    
    // Compare individual metrics
    if (regularResult.performanceMetrics && priorityResult.performanceMetrics) {
      console.log(`\n🔍 Detailed Comparison:`);
      console.log(`   Regular LLM Calls: ${regularResult.performanceMetrics.llm_calls_ms}ms`);
      console.log(`   Priority LLM Calls: ${priorityResult.performanceMetrics.llm_calls_ms}ms`);
      
      const llmImprovement = regularResult.performanceMetrics.llm_calls_ms - priorityResult.performanceMetrics.llm_calls_ms;
      if (llmImprovement > 0) {
        console.log(`   LLM Improvement: ${llmImprovement}ms (${((llmImprovement / regularResult.performanceMetrics.llm_calls_ms) * 100).toFixed(1)}%)`);
      }
    }
    
  } else {
    console.log('❌ One or both tests failed, cannot compare results');
    if (!regularResult.success) {
      console.log(`   Regular test error: ${regularResult.error}`);
    }
    if (!priorityResult.success) {
      console.log(`   Priority test error: ${priorityResult.error}`);
    }
  }
  
  console.log('\n✨ Test completed!');
}

// Run the comparison test
async function main() {
  try {
    await runPriorityComparison();
  } catch (error) {
    console.error('❌ Fatal error in main test execution:', error.message);
    console.error('💡 Check your environment variables and Supabase connection');
    process.exit(1);
  }
}

main();
