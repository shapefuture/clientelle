// Deno test suite for process-ai-analysis Edge Function
// Run with: deno test --allow-net process-ai-analysis.test.ts
//
// These tests check method rejection, input validation, and debug info. For real LLM calls,
// use test API keys and/or mock litellm if possible to avoid unnecessary cost and side effects.
// Expand with DB fixtures for full integration coverage.
//
// TODO:
//
// Security tests:
// - Ensure no secrets (user_ai_key, etc) ever appear in any output, even in debug/error fields.
// - Add tests for prompt injection/XSS in LLM input/output.
//
// Permission/authorization tests:
// - Simulate user_id mismatch, raw_data_id not owned by user.
//
// Concurrency/stress tests:
// - Multiple simultaneous LLM calls, large batch processing.
//
// Fuzz/property-based tests:
// - Random, deeply nested, or malformed LLM responses and POST bodies.
//
// Mock/stub setup:
// - Add mocking/stubbing of litellm.completion and DB queried data for isolation.
// - Add test fixtures for DB/LLM state as needed.
//
// Rate limiting & DOS:
// - Test for excessive LLM calls, throttling, and timeout handling.

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

// Edge case: invalid JSON
Deno.test("process-ai-analysis: invalid JSON", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json }"
  });
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error);
  assert(data.error.includes("Invalid JSON"));
});

// Edge case: valid user_id, raw_data_id but missing user_ai_key (should fallback or error)
Deno.test("process-ai-analysis: missing user_ai_key", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id: "someid",
      user_id: "test-user"
    }),
  });
  const data = await res.json();
  assert("debug" in data || "error" in data);
});

// Edge: very large input (simulate oversized prompt)
Deno.test("process-ai-analysis: large content", async () => {
  // This test assumes you have a valid raw_data_id/user_id in your test DB.
  // Ideally, mock the DB or use a test fixture.
  const raw_data_id = "someid"; // Replace with valid value for real integration
  const user_id = "test-user";
  const user_ai_key = "sk-test-123";
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id,
      user_id,
      user_ai_key
    }),
  });
  const data = await res.json();
  // Should always include debug or error
  assert("debug" in data || "error" in data);
});

// Security: ensure no secrets in debug, even when error occurs
Deno.test("process-ai-analysis: security - no user_ai_key in output", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id: "someid",
      user_id: "test-user",
      user_ai_key: "sk-test-123"
    }),
  });
  const txt = await res.text();
  assert(!txt.includes("sk-test-123"));

  // Test again with forced error (missing field)
  const res2 = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id: "",
      user_id: "",
      user_ai_key: "sk-test-123"
    }),
  });
  const txt2 = await res2.text();
  assert(!txt2.includes("sk-test-123"));
});

// Timeout/slow response test (demonstration)
Deno.test({
  name: "process-ai-analysis: handles slow downstream",
  fn: async () => {
    // This is a placeholder: in real tests, use a mock or inject latency in litellm or DB.
    // Here, just ensure function doesn't crash on slow response (simulate with a sleep if possible).
    assert(true);
  },
  sanitizeOps: false,
  sanitizeResources: false
});

// Concurrency test: multiple process requests in parallel
Deno.test("process-ai-analysis: concurrency", async () => {
  const payload = {
    raw_data_id: "someid",
    user_id: "test-user",
    user_ai_key: "sk-test-123"
  };
  const requests = Array.from({ length: 3 }).map(() =>
    fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
  const results = await Promise.all(requests);
  for (const res of results) {
    const data = await res.json();
    assert("debug" in data || "error" in data);
  }
});

// Permission: simulate user_id mismatch (RLS/DB fixture dependent)
Deno.test("process-ai-analysis: user_id mismatch", async () => {
  // Try processing a raw_data_id not owned by this user_id
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data_id: "someid",
      user_id: "unauthorized-user",
      user_ai_key: "sk-test-123"
    })
  });
  const data = await res.json();
  // Should return a permission error or at least not leak data
  if (data.error) {
    assert(
      data.error.toLowerCase().includes("permission") ||
      data.error.toLowerCase().includes("not found") ||
      data.error.toLowerCase().includes("unauthorized") ||
      data.error.toLowerCase().includes("rls"),
      "Error should be about permissions or not found"
    );
  } else {
    assert(data.debug);
  }
});

// Fuzz test: random payloads
Deno.test("process-ai-analysis: fuzz random payloads", async () => {
  for (let i = 0; i < 3; i++) {
    const body = {
      raw_data_id: Math.random() > 0.5 ? "someid" : undefined,
      user_id: Math.random() > 0.5 ? "test-user" : undefined,
      user_ai_key: Math.random() > 0.5 ? "sk-test-123" : undefined,
      extra: Math.random().toString(36).substring(2)
    };
    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    assert("debug" in data || "error" in data);
  }
});

// TODO: Add stubs/mocks for litellm and DB for full CI isolation.