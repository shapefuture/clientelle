// Deno test suite for process-ai-analysis Edge Function
// Run with: deno test --allow-net process-ai-analysis.test.ts
//
// These tests check method rejection, input validation, and debug info. For real LLM calls,
// use test API keys and/or mock litellm if possible to avoid unnecessary cost and side effects.
// Expand with DB fixtures for full integration coverage.

import { assertEquals, assertObjectMatch, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const EDGE_URL = Deno.env.get('TEST_PROCESS_AI_ANALYSIS_URL') || "http://localhost:54321/functions/v1/process-ai-analysis";

Deno.test("process-ai-analysis: rejects GET", async () => {
  const res = await fetch(EDGE_URL, { method: "GET" });
  assertEquals(res.status, 405);
  const data = await res.json();
  assert(data.error);
});

Deno.test("process-ai-analysis: rejects missing fields", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error);
});

Deno.test("process-ai-analysis: rejects invalid raw_data_id/user_id", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id: "nonexistent",
      user_id: "nonexistent",
      user_ai_key: "sk-test-123"
    }),
  });
  // Should fail with 404 or 500 depending on DB
  const data = await res.json();
  assert(data.error);
});

Deno.test("process-ai-analysis: debug field always present", async () => {
  // This will likely fail unless a valid raw_data_id/user_id exist
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id: "nonexistent",
      user_id: "nonexistent",
      user_ai_key: "sk-test-123"
    }),
  });
  const data = await res.json();
  assert("debug" in data);
  // Ensure user_ai_key is never leaked
  assert(!JSON.stringify(data).includes("sk-test-123"));
});

// Add more tests with real data if possible!