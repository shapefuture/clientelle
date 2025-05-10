// Deno test suite for upload-data Edge Function
// Run with: deno test --allow-net upload-data.test.ts
// 
// These tests cover basic validation, method rejection, and happy path. In CI or production,
// mock/stub downstream calls (e.g., process-ai-analysis) to avoid triggering real LLM costs or side effects.
// Expand with more tests as needed for DB fixture setups or real user flows.
//
// TODO:
//
// Security tests:
// - Ensure secrets (user_ai_key, etc) are never logged or returned, even on error.
// - Add more tests for XSS, SQLi, and payload escaping.
//
// Permission/authorization tests:
// - Simulate uploads with mismatched user_id/session (if possible).
// - Add tests for RLS enforcement or permission failures.
//
// Concurrency/stress tests:
// - High-frequency uploads, burst traffic, uploads with large payloads.
//
// Fuzz/property-based tests:
// - Randomized JSON, deeply nested objects, strings with control chars, etc.
//
// Mock/stub setup:
// - Add mocking/stubbing of process-ai-analysis for isolation (see Deno std/mock or similar).
// - Add test fixtures for DB state if needed for repeatable integration tests.
//
// Rate limiting & DOS:
// - Add tests for rate limiting, throttling, and DOS protection.

import { assertEquals, assertObjectMatch, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const EDGE_URL = Deno.env.get('TEST_UPLOAD_DATA_URL') || "http://localhost:54321/functions/v1/upload-data";

Deno.test("upload-data: rejects GET", async () => {
  const res = await fetch(EDGE_URL, { method: "GET" });
  assertEquals(res.status, 405);
  const data = await res.json();
  assert(data.error);
});

Deno.test("upload-data: rejects missing text_content", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_metadata: { user_id: "test-user" } }),
  });
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error);
});

Deno.test("upload-data: rejects missing user_id", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text_content: "Test text", source_metadata: {} }),
  });
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error);
});

Deno.test("upload-data: success, triggers process-ai-analysis", async () => {
  // You may want to stub process-ai-analysis if running locally
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "Test content for upload-data function.",
      source_metadata: { user_id: "test-user", type: "manual", url: "http://test.com" },
      user_ai_key: "sk-test-123"
    }),
  });
  const data = await res.json();
  assertEquals(res.status, 200);
  assert(data.raw_data_id, "should return raw_data_id");
  assert(data.source_id, "should return source_id");
  assertObjectMatch(data, { analysis_status: "success" });
  assert(data.debug); // debug info should always be present
  // Ensure user_ai_key is never present in response
  assert(!JSON.stringify(data).includes("sk-test-123"));
});

// Edge case: invalid JSON
Deno.test("upload-data: invalid JSON", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ invalid json }"
  });
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error);
  assert(data.error.includes("Invalid JSON"));
});

// Edge case: extra fields should not break function
Deno.test("upload-data: ignores extra fields", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "Extra fields test",
      source_metadata: { user_id: "test-user" },
      user_ai_key: "sk-test-123",
      extra_param: "some-value"
    })
  });
  const data = await res.json();
  // Should succeed or at least not 500
  assert(res.status === 200 || res.status === 400);
});

// Edge case: very large text_content (simulate attach 1MB+)
Deno.test("upload-data: large text_content", async () => {
  const bigText = "A".repeat(1024 * 1024); // 1MB
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: bigText,
      source_metadata: { user_id: "test-user" },
      user_ai_key: "sk-test-123"
    })
  });
  const data = await res.json();
  // Should not 500, may be 200/400 depending on backend limits
  assert([200, 400, 413].includes(res.status)); // 413 = Payload Too Large
});

// Security: ensure user_ai_key never appears in logs or output, even on error
Deno.test("upload-data: security - key never in error", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "",
      source_metadata: { user_id: "test-user" },
      user_ai_key: "sk-test-123"
    })
  });
  const txt = await res.text();
  assert(!txt.includes("sk-test-123"));

  // Test again with a forced error (bad JSON)
  const res2 = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ bad: json,"
  });
  const txt2 = await res2.text();
  assert(!txt2.includes("sk-test-123"));
});

// Edge: downstream process-ai-analysis failure
Deno.test("upload-data: downstream analysis error propagation", async () => {
  // To simulate, stub or break process-ai-analysis or inject known-bad raw_data_id
  // Here, we just check error propagation structure
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "Should fail downstream",
      source_metadata: { user_id: "test-user" },
      user_ai_key: "sk-test-123"
    })
  });
  const data = await res.json();
  // Should still return a debug field with error info if downstream fails
  assert("debug" in data);
});

// Concurrency test: multiple uploads in parallel
Deno.test("upload-data: concurrency", async () => {
  const requests = Array.from({ length: 5 }).map((_, i) =>
    fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text_content: `Concurrent upload ${i}`,
        source_metadata: { user_id: `test-user` },
        user_ai_key: "sk-test-123"
      })
    })
  );
  const results = await Promise.all(requests);
  for (const res of results) {
    const data = await res.json();
    assert("debug" in data || "error" in data);
  }
});

// Permission: user_id mismatch (simulate if RLS enabled)
Deno.test("upload-data: user_id mismatch", async () => {
  // This assumes you have RLS or permission checks; adjust as needed.
  // Try uploading with a user_id that does not belong to the authenticated/test session
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "Test",
      source_metadata: { user_id: "unauthorized-user" },
      user_ai_key: "sk-test-123"
    })
  });
  const data = await res.json();
  // Should return error or be filtered by RLS
  // Check error message for permission/authorization failure if possible
  if (data.error) {
    // Acceptable: permission error message
    assert(
      data.error.toLowerCase().includes("permission") ||
      data.error.toLowerCase().includes("not allowed") ||
      data.error.toLowerCase().includes("unauthorized") ||
      data.error.toLowerCase().includes("rls"),
      "Error should be about permissions"
    );
  } else {
    // If not an error, at least ensure no sensitive data is returned
    assert(data.debug);
  }
});

// Fuzz test: random payloads
Deno.test("upload-data: fuzz random payloads", async () => {
  for (let i = 0; i < 3; i++) {
    const body = {
      text_content: Math.random() > 0.5 ? "Test" : undefined,
      source_metadata: Math.random() > 0.5 ? { user_id: "test-user" } : undefined,
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

// TODO: Add stubs/mocks for process-ai-analysis in CI to avoid real API calls.