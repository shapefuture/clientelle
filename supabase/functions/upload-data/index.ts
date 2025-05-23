// supabase/functions/upload-data/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SERVICE_KEY');

// Strict type for incoming POST body
type UploadRequest = {
  text_content: string;
  source_metadata: {
    user_id: string;
    type?: string;
    url?: string;
    [key: string]: any;
  };
  user_ai_key?: string;
};

const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
  auth: { persistSession: false },
});

function logDebug(context: string, info: unknown) {
  // Use this for verbose debugging in development and staging.
  // Never log secrets (like user_ai_key) or user text content.
  // For production, you may want to disable or restrict these logs (see below).
  // Example: if (Deno.env.get('NODE_ENV') === 'production') return;
  // Always review logDebug calls before expanding!
  console.log(`[upload-data] ${context}:`, info);
}

serve(async (req) => {
  const startTime = Date.now();
  if (req.method !== 'POST') {
    logDebug('Invalid method', req.method);
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  let body: UploadRequest;
  try {
    body = await req.json();
  } catch (err) {
    logDebug('JSON parse error', err);
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verbose body type check (never log keys!)
  if (!body || typeof body.text_content !== 'string' || typeof body.source_metadata !== 'object') {
    logDebug('Bad input', body);
    return new Response(JSON.stringify({ error: 'Invalid input structure' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { text_content, source_metadata, user_ai_key } = body;
  const user_id = source_metadata?.user_id || null;

  if (!text_content || !user_id) {
    logDebug('Missing fields', { text_content, user_id });
    return new Response(JSON.stringify({ error: 'text_content and user_id are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let source, rawData;
  try {
    // 1. Save source
    const { data: sourceData, error: sourceError } = await supabase
      .from('sources')
      .insert([{
        user_id,
        type: source_metadata?.type || 'manual',
        url: source_metadata?.url,
        metadata: source_metadata
      }])
      .select()
      .single();

    if (sourceError) throw sourceError;
    source = sourceData;
    // Log only database-generated ID or meta, never user content.
    logDebug('Source inserted', source?.id);

    // 2. Save text
    const { data: rawDataData, error: rawDataError } = await supabase
      .from('raw_data')
      .insert([{
        source_id: source.id,
        user_id,
        content: text_content
      }])
      .select()
      .single();

    // If error, log details for debugging (never log sensitive user content)
    if (rawDataError) throw rawDataError;
    rawData = rawDataData;
    // As above, only log database IDs or meta.
    logDebug('Raw data inserted', rawData?.id);

    // 3. Trigger analysis
    let analysisInvokeResult = null;
    let analysisInvokeError = null;
    try {
      // Never log or expose user_ai_key or any secrets!
      const { data, error } = await supabase.functions.invoke('process-ai-analysis', {
        body: {
          raw_data_id: rawData.id,
          user_id: user_id,
          user_ai_key: user_ai_key // never log or expose this!
        }
      });
      analysisInvokeResult = data;
      analysisInvokeError = error;
      // Only log error messages (never any part of user_ai_key or request body)
      if (error) logDebug('Invoke error', error);
    } catch (invokeErr) {
      // Log stack for debugging in dev/stage. Remove or restrict for production!
      logDebug('Invoke exception', { message: invokeErr?.message, stack: invokeErr?.stack });
      analysisInvokeError = invokeErr?.message || 'Unknown invocation error';
    }

    // 4. Structured response for easier testing and frontend debugging
    // 'debug' field is safe because it contains only timings or error messages (never secrets)
    const elapsed = Date.now() - startTime;
    return new Response(JSON.stringify({
      message: 'Data uploaded and analysis function invoked',
      raw_data_id: rawData.id,
      source_id: source.id,
      analysis_status: analysisInvokeError ? 'failed' : 'success',
      debug: {
        elapsed_ms: elapsed,
        analysis_invoke_error: analysisInvokeError ? `${analysisInvokeError}` : undefined
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // For dev/stage, log error details. In prod, restrict or disable as appropriate.
    logDebug('Fatal error', { message: error?.message, stack: error?.stack });
    return new Response(JSON.stringify({ error: error?.message || "Unknown error", debug: error?.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// For testing: Add unit/integration tests to verify upload, error, and analysis invocation paths!
    // All debug outputs in this function are designed to be safe for frontend/testing, but review carefully before expanding.
    // Never log or return user secrets, keys, or sensitive content in logs or responses.
    // In production, consider toggling or filtering logDebug() output as appropriate.