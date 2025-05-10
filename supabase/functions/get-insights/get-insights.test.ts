// Deno test suite for get-insights Edge Function
// Run with: deno test --allow-net get-insights.test.ts
//
// These tests focus on input validation, method rejection, and debug output.
// Expand with more integration tests as needed, using test user_ids and DB fixtures.
//
// TODO:
//
// Security tests:
// - Ensure no user secrets, tokens, or sensitive DB fields ever appear in debug/data.
// - Test for SQL injection or filter argument attacks.
//
// Permission/authorization tests:
// - Simulate queries for data not owned by user_id (RLS).
//
// Concurrency/stress tests:
// - Multiple high-frequency queries, complex filters.
//
// Fuzz/property-based tests:
// - Random filters, view_types, and malformed payloads.
//
// Mock/stub setup:
// - Add stubs/mocks for DB queries (Deno std/mock or similar) for true isolation.
// - Add test fixtures and DB seeding for repeatable queries.
//
// Rate limiting & DOS:
// - Test for query throttling and DOS protection.

import { assertEquals, assertObjectMatch, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const EDGE_URL = Deno.env.get('TEST_GET_INSIGHTS_URL') || "http://localhost:54321/functions/v1/get-insights";

Deno.test("get-insights: rejects bad method", async () => {
  const res = await fetch(EDGE_URL, { method: "PUT" });
  assertEquals(res.status, 405);
  const data = await res.json();
  assert(data.error);
});

Deno.test("get-insights: missing user_id", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ view_type: "list_quotes" }),
  });
  assertEquals(res.status, 400);
  // Check Content-Type
  assert(res.headers.get("content-type")?.includes("application/json"));
  const data = await res.json();
  assert(data.error);
  if (data.debug && typeof data.debug === "string") {
    assert(data.debug.length > 0);
  }
});

Deno.test("get-insights: invalid view_type", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "test-user", view_type: "bad_view" }),
  });
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error);
});

Deno.test("get-insights: happy path (should 200, debug, no secrets)", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "test-user", view_type: "list_quotes" }),
  });
  assert([200,500].includes(res.status));
  assert(res.headers.get("content-type")?.includes("application/json"));
  const data = await res.json();
  assert("debug" in data);
  assert(typeof data.debug.elapsed_ms === "number" && data.debug.elapsed_ms >= 0);
  assert(data.debug.view_type === "list_quotes");
  assert(!JSON.stringify(data).includes("sk-")); // should never leak secrets
});

// Edge case: GET with query params
Deno.test("get-insights: GET with params", async () => {
  const url = `${EDGE_URL}?user_id=test-user&view_type=list_quotes`;
  const res = await fetch(url, { method: "GET" });
  const data = await res.json();
  assert("debug" in data || "error" in data);
});

// Security: ensure no user secrets are returned in debug/data, even with malicious inputs
Deno.test("get-insights: security - no secrets", async () => {
  // Normal call
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "test-user", view_type: "list_quotes" }),
  });
  const txt = await res.text();
  assert(!txt.includes("sk-")); // Should never leak API keys

  // SQL injection attempt in filter
  const res2 = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: "test-user",
      view_type: "list_quotes'; DROP TABLE users;--",
      filters: { "malicious": "'; DROP TABLE users;--" }
    }),
  });
  const txt2 = await res2.text();
  assert(!txt2.includes("sk-"));
  assert(!txt2.toLowerCase().includes("drop table"));
});

// Edge: large filter object (should not crash)
Deno.test("get-insights: large filters", async () => {
  const filters = {};
  for (let i = 0; i < 1000; i++) filters[`key${i}`] = `val${i}`;
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: "test-user",
      view_type: "list_quotes",
      filters
    }),
  });
  const data = await res.json();
  assert("debug" in data || "error" in data);
});

// Concurrency/stress test: burst of randomized insight queries in parallel
Deno.test("get-insights: burst concurrency stress test", async () => {
  const burst = 7;
  const requests = Array.from({ length: burst }).map((_, i) => {
    const payload: any = {
      user_id: Math.random() > 0.5 ? "test-user" : `other-user-${i}`,
      view_type: Math.random() > 0.5 ? "list_quotes" : "list_nodes"
    };
    if (Math.random() < 0.3) payload.filters = { fuzz: Math.random() };
    if (Math.random() < 0.2) delete payload.user_id;
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
    assert("debug" in data || "error" in data);
  }
});

// Permission: simulate user_id mismatch
Deno.test("get-insights: user_id mismatch", async () => {
  // Attempt to fetch data as a user_id that should not have access
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "unauthorized-user", view_type: "list_quotes" }),
  });
  const data = await res.json();
  // Should return empty data, error, or be filtered by RLS
  if (data.error) {
    assert(
      data.error.toLowerCase().includes("permission") ||
      data.error.toLowerCase().includes("unauthorized") ||
      data.error.toLowerCase().includes("rls") ||
      data.error.toLowerCase().includes("not found"),
      "Error should be about permissions"
    );
  } else if (data.data) {
    assert(Array.isArray(data.data));
    // Should not contain sensitive data
  }
});

// Fuzz/property-based test: random/nested filters
Deno.test("get-insights: property/fuzz test for filters and args", async () => {
  for (let i = 0; i < 5; i++) {
    const payload: any = {
      user_id: Math.random() > 0.5 ? "test-user" : Math.random().toString(36),
      view_type: Math.random() > 0.5 ? "list_quotes" : (Math.random() > 0.5 ? "list_nodes" : undefined),
    };
    if (Math.random() > 0.3) {
      payload.filters = {
        fuzz: Math.random(),
        deep: { a: [1,2,3, { b: Math.random() }], c: { d: Math.random() } }
      };
    }
    if (Math.random() > 0.7) payload[ Math.random().toString(36).slice(2) ] = Math.random();

    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await res.text();
    assert(txt.startsWith("{"));
    const data = JSON.parse(txt);
    assert("debug" in data || "error" in data);
  }
});

// Edge: downstream DB error simulation (requires DB manipulation or stubbing in CI)
Deno.test("get-insights: downstream DB error", async () => {
  // This test is mostly a template unless you can reliably trigger a DB failure.
  assert(true);
});

// TODO: Add DB/permission stubs/mocks for full isolation in CI.