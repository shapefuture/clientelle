import { json } from '@sveltejs/kit';
import { safeGetSession } from '../../hooks.server';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

export const POST = async ({ request, locals }) => {
  try {
    // Check user session
    const session = await safeGetSession(locals);
    const user = session?.user;
    if (!user) {
      return json({ error: 'Not authenticated' }, { status: 401 });
    }
    const user_id = user.id;

    // Parse request body from frontend
    const body = await request.json();
    const { text_content, source_type, source_url, user_ai_key } = body;

    if (!text_content || !user_ai_key) {
      return json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Build source metadata
    const source_metadata = {
      user_id,
      type: source_type || 'manual',
      url: source_url
    };

    // Call Supabase Edge Function for upload
    const edgeRes = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/upload-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text_content,
        source_metadata,
        user_ai_key
      })
    });

    const edgeData = await edgeRes.json();
    if (!edgeRes.ok) {
      return json({ error: edgeData?.error || 'Failed to upload data' }, { status: 500 });
    }

    return json({
      message: 'Upload successful',
      ...edgeData
    });
  } catch (e: any) {
    return json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
};