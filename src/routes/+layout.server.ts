import { json } from '@sveltejs/kit';
import { safeGetSession } from '$lib/auth';
import { createClient } from '@supabase/supabase-js';

// API endpoint to securely proxy upload-data call to Supabase Edge Function
export const POST = async ({ request, locals, url }) => {
    // Only handle our /api/upload-data route
    if (!url.pathname.endsWith('/api/upload-data')) {
        return json({ error: 'Invalid API route' }, { status: 404 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Get the Supabase client for invoking Edge Functions (via locals or re-init)
    const supabase = locals.supabase;
    // Get user session for user_id (extra safety)
    const session = await safeGetSession(locals);

    // Ensure user_id in metadata matches session
    const user_id = session?.user?.id;
    if (!user_id || user_id !== body.source_metadata?.user_id) {
        return json({ error: 'User authentication failed' }, { status: 401 });
    }

    // Call the upload-data Edge Function
    const { data, error } = await supabase.functions.invoke('upload-data', {
        body
    });

    if (error) {
        return json({ error: error.message || error }, { status: 500 });
    }
    return json(data);
};
