// supabase/functions/get-insights/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

// Получаем URL Supabase и Anon Key (публичный ключ)
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY'); // Anon Key доступен по умолчанию

// Инициализируем клиента Supabase с Anon Key
// RLS-политики, которые вы настроили, будут ограничивать доступ к данным только текущего пользователя.
const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
   auth: { persistSession: false },
});

serve(async (req) => {
  const startTime = Date.now();
  if (req.method !== 'GET' && req.method !== 'POST') {
    // For debugging: log bad method calls. In prod, consider removing or restricting.
    // Never log request body or any sensitive data.
    console.log('[get-insights] Invalid method:', req.method);
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  let params;
  try {
    params = req.method === 'POST' ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
  } catch (err) {
    console.error('[get-insights] Failed to parse params:', err);
    return new Response(JSON.stringify({ error: 'Invalid request', debug: err?.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { user_id, view_type, source_id, node_id, filters } = params;

  if (!user_id) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    let query, debug = { view_type };
    // Each branch logs what target is being queried for debugging.
    if (view_type === 'list_quotes') {
      query = supabase
        .from('quotes')
        .select('id, text, sentiment, emotions, raw_data(id, source_id, sources(id, type, metadata))')
        .eq('user_id', user_id);
      debug.target = 'quotes';
    } else if (view_type === 'list_nodes') {
      query = supabase
        .from('nodes')
        .select('id, type, label, description')
        .eq('user_id', user_id);
      debug.target = 'nodes';
    } else if (view_type === 'graph_data') {
      query = supabase
        .from('nodes')
        .select('id, type, label, description, embedding, edges!from_node_id(id, from_node_id, to_node_id, type, description), quote_node_links(id, quote_id, node_id, quotes(id, text))')
        .eq('user_id', user_id);
      debug.target = 'graph';
    } else if (view_type === 'ideas') {
      query = supabase
        .from('ideas')
        .select('id, text, type, status, generated_from_node_id, generated_from_quote_id')
        .eq('user_id', user_id);
      debug.target = 'ideas';
    } else {
      // Log and return error for unknown view_type
      console.log('[get-insights] Invalid view_type:', view_type);
      return new Response(JSON.stringify({ error: 'Invalid or missing view_type' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      // Log DB error for devs, but never include sensitive query info in production logs!
      // Only log error details, not queries or payloads.
      console.error('[get-insights] DB fetch error:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message, debug: fetchError.details }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // The debug field is safe for frontend and testing (contains only view_type, target, timing).
    const elapsed = Date.now() - startTime;
    return new Response(JSON.stringify({ data, debug: { ...debug, elapsed_ms: elapsed } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // For dev/stage, log error details and stack. In prod, consider filtering or redacting.
    console.error('[get-insights] Fatal error:', error?.message, error?.stack);
    return new Response(JSON.stringify({ error: error?.message, debug: error?.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// For testing: Add integration tests to check retrieval, error, and debug outputs!
// All debug fields in responses are safe (timing, view_type, target), but never include user data or queries.
// In production, consider restricting or filtering logs further.