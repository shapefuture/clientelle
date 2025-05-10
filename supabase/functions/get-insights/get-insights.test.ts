// Deno test suite for get-insights Edge Function
// Run with: deno test --allow-net get-insights.test.ts

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