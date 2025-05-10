// Deno test suite for upload-data Edge Function
// Run with: deno test --allow-net upload-data.test.ts

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