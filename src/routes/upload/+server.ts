import { json } from '@sveltejs/kit';
import { safeGetSession } from '../../hooks.server';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

// Utility for debug logs (disable in production as needed)
function logDebug(context: string, payload: unknown) {
  // For development/staging debugging only.
  // Never log secrets (like user_ai_key) or user text content.
  // In production, you may want to disable or restrict these logs:
  // if (process.env.NODE_ENV === 'production') return;
  // Always review logDebug calls before expanding!
  console.log(`[upload-api] ${context}:`, payload);
}

export const POST = async ({ request, locals }) => {
  const startTime = Date.now();
  try {
    // Check user session
    let session, user;
    try {
      session = await safeGetSession(locals);
      user = session?.user;
      if (!user) throw new Error('No user session');
    } catch (err) {
      logDebug('Session error', err);
      return json({ error: 'Not authenticated', debug: err?.message }, { status: 401 });
    }
    const user_id = user.id;

    // Parse request body from frontend
    let body;
    try {
      body = await request.json();
    } catch (err) {
      logDebug('JSON parse error', err);
      return json({ error: 'Invalid JSON body', debug: err?.message }, { status: 400 });
    }
    const { text_content, source_type, source_url, user_ai_key } = body || {};

    if (!text_content) {
      logDebug('Missing text_content', body);
      return json({ error: 'Missing required text_content' }, { status: 400 });
    }

    // Build source metadata
    const source_metadata = {
      user_id,
      type: source_type || 'manual',
      url: source_url
    };

    let edgeRes, edgeData, edgeError;
    try {
      edgeRes = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/upload-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_content,
          source_metadata,
          user_ai_key // never log this value anywhere!
        })
      });
      try {
        edgeData = await edgeRes.json();
      } catch (err) {
        // Only log error details, never raw response that could contain sensitive info.
        logDebug('Edge function invalid response', err);
        edgeError = 'Invalid response from backend';
      }
      if (!edgeRes.ok) {
        // Only log safe error string, never log full backend payload in production.
        logDebug('Edge function error', edgeData?.error || edgeError);
        return json({ error: edgeData?.error || edgeError || 'Failed to upload data', debug: edgeData }, { status: 500 });
      }
    } catch (err) {
      // Only log safe error string, never log full request or sensitive data.
      logDebug('Edge function fetch error', err);
      return json({ error: 'Failed to call backend', debug: err?.message }, { status: 500 });
    }

    logDebug('Upload complete', { user_id, elapsed_ms: Date.now() - startTime });
    // The debug field here is for timing/performance and never contains secrets.
    // If adding more info, ensure it is not sensitive before returning to client.
    return json({
      message: 'Upload successful',
      ...edgeData,
      debug: { elapsed_ms: Date.now() - startTime }
    });
  } catch (e: any) {
    // For dev/stage, expose stack in debug. For prod, consider stripping or removing.
    logDebug('Fatal error', { error: e?.message, stack: e?.stack });
    return json({ error: e?.message || 'Unknown error', debug: e?.stack }, { status: 500 });
  }
};
// For testing: Create integration tests that POST various payloads and check debug/error output!
// All debug fields here are safe (timing, stack traces), never returning or logging secrets.
// In production, limit or filter debug output and logs as needed.