// Deno test suite for get-insights Edge Function
// Run with: deno test --allow-net get-insights.test.ts
//
// These tests focus on input validation, method rejection, and debug output.
// Expand with more integration tests as needed, using test user_ids and DB fixtures.

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
  const data = await res.json();
  assert(data.error);
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

Deno.test("get-insights: valid minimal", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "test-user", view_type: "list_quotes" }),
  });
  // Acceptable statuses: 200 if data, 500 if DB misconfigured
  const data = await res.json();
  assert("debug" in data);
  // No secrets or sensitive info should be present
});

// Edge case: GET with query params
Deno.test("get-insights: GET with params", async () => {
  const url = `${EDGE_URL}?user_id=test-user&view_type=list_quotes`;
  const res = await fetch(url, { method: "GET" });
  const data = await res.json();
  assert("debug" in data || "error" in data);
});

// Security: ensure no user secrets are returned in debug/data
Deno.test("get-insights: security - no secrets", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "test-user", view_type: "list_quotes" }),
  });
  const txt = await res.text();
  assert(!txt.includes("sk-")); // Should never leak API keys
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

// Concurrency test: multiple get-insights requests
Deno.test("get-insights: concurrency", async () => {
  const payload = {
    user_id: "test-user",
    view_type: "list_quotes"
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

// Permission: simulate user_id mismatch
Deno.test("get-insights: user_id mismatch", async () => {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "other-user", view_type: "list_quotes" }),
  });
  const data = await res.json();
  assert("debug" in data || "error" in data);
});

// Fuzz test: random payloads
Deno.test("get-insights: fuzz random payloads", async () => {
  for (let i = 0; i < 3; i++) {
    const body = {
      user_id: Math.random() > 0.5 ? "test-user" : undefined,
      view_type: Math.random() > 0.5 ? "list_quotes" : undefined,
      filters: Math.random() > 0.5 ? { fuzz: Math.random() } : undefined,
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

// Edge: downstream DB error simulation (requires DB manipulation or stubbing in CI)
Deno.test("get-insights: downstream DB error", async () => {
  // This test is mostly a template unless you can reliably trigger a DB failure.
  assert(true);
});

// TODO: Add DB/permission stubs/mocks for full isolation in CI.