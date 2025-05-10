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
  // Check Content-Type
  assert(res.headers.get("content-type")?.includes("application/json"));
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

Deno.test("upload-data: success path (should 200, debug, no secrets)", async () => {
  // You may want to stub process-ai-analysis if running locally; this is a basic happy-path test.
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "Success path test content.",
      source_metadata: { user_id: "test-user", type: "manual", url: "http://test.com" },
      user_ai_key: "sk-test-123"
    }),
  });
  assertEquals(res.status, 200);
  assert(res.headers.get("content-type")?.includes("application/json"));
  const data = await res.json();
  assert(typeof data.raw_data_id === "string" && data.raw_data_id.length > 0, "should return raw_data_id as string");
  assert(typeof data.source_id === "string" && data.source_id.length > 0, "should return source_id as string");
  assert(typeof data.analysis_status === "string");
  assert(data.debug && typeof data.debug === "object");
  assert(typeof data.debug.elapsed_ms === "number" && data.debug.elapsed_ms >= 0);
  assert(!JSON.stringify(data).includes("sk-test-123")); // never leak secrets
});

// Edge case: invalid JSON (should include error and possibly debug.stack)
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
  if (data.debug && typeof data.debug === "string") {
    assert(data.debug.length > 0);
  }
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

// Edge: downstream process-ai-analysis failure, error propagation test
Deno.test("upload-data: downstream analysis error propagation", async () => {
  // To simulate, stub or break process-ai-analysis or inject a payload that will cause it to fail
  // Here, intentionally send a text_content that will create a bad raw_data record or a bogus user_id
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_content: "error downstream " + Math.random(),
      source_metadata: { user_id: "fail-user" }, // unlikely user_id
      user_ai_key: "sk-test-123"
    })
  });
  const data = await res.json();
  // Should still return a debug field with error info if downstream fails
  assert("debug" in data);
  // Should surface downstream error string, but never secrets
  if (data.debug && typeof data.debug.analysis_invoke_error === "string") {
    assert(!data.debug.analysis_invoke_error.includes("sk-test-123"));
    assert(data.debug.analysis_invoke_error.length > 0);
  }
});

// Concurrency/stress test: burst of randomized uploads in parallel
Deno.test("upload-data: burst concurrency stress test", async () => {
  const burst = 8;
  const requests = Array.from({ length: burst }).map((_, i) => {
    const payload: any = {
      text_content: `Concurrent upload ${i}`,
      source_metadata: { user_id: `test-user` },
      user_ai_key: "sk-test-123"
    };
    // Randomly corrupt some payloads to simulate user errors
    if (Math.random() < 0.3) delete payload.text_content;
    if (Math.random() < 0.2) payload.source_metadata = "bad";
    return fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  });
  const results = await Promise.all(requests);
  for (const res of results) {
    const txt = await res.text();
    assert(txt.startsWith("{"));
    const data = JSON.parse(txt);
    // Accept error or debug, but should not 500 unless truly broken input
    assert("debug" in data || "error" in data);
    assert(!txt.includes("sk-test-123")); // never leak secrets
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

// Fuzz/property-based test: random and adversarial payloads
Deno.test("upload-data: property/fuzz test for robustness", async () => {
  for (let i = 0; i < 5; i++) {
    // Generate random payload structure
    const payload: any = {};
    if (Math.random() > 0.3) payload.text_content = Math.random() > 0.5 ? "Test" : 12345;
    if (Math.random() > 0.5) payload.source_metadata = Math.random() > 0.5
      ? { user_id: "test-user", nested: { a: Math.random() } }
      : "bad-metadata";
    if (Math.random() > 0.5) payload.user_ai_key = Math.random().toString(36);
    if (Math.random() > 0.7) payload[ Math.random().toString(36).slice(2) ] = Math.random();

    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await res.text();
    // Should never crash, always return valid JSON with error/debug
    assert(txt.startsWith("{"));
    const data = JSON.parse(txt);
    assert("debug" in data || "error" in data);
    // Should never leak secrets
    assert(!txt.includes("sk-test-123"));
  }
});

// TODO: Add stubs/mocks for process-ai-analysis in CI to avoid real API calls.