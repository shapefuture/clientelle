import { getOrCreateUserProfile } from "$lib/auth";
import { db } from "$lib/db/index.js";
import { profileTable } from "$lib/db/schema.js";
import { error } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { zfd } from "zod-form-data";

import { PUBLIC_SUPABASE_URL } from '$env/static/public';

export const load = async ({ locals }) => {
  const userProfile = await getOrCreateUserProfile(locals);

  let insights = null;
  let insightsError = null;

  if (userProfile?.id || userProfile?.userId) {
    const user_id = userProfile.id || userProfile.userId;
    try {
      // Fetch insights (quotes) for the user from the Edge Function
      const res = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/get-insights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id,
          view_type: 'list_quotes'
        })
      });
      if (res.ok) {
        insights = await res.json();
      } else {
        insightsError = (await res.json())?.error || 'Failed to fetch insights';
      }
    } catch (e) {
      insightsError = e?.message || 'Failed to fetch insights';
    }
  }

  return {
    userProfile,
    insights,
    insightsError
  };
};

export const actions = {
  default: async ({ request, locals }) => {
    const userProfile = await getOrCreateUserProfile(locals);

    if (!userProfile) {
      error(401, "You need to be logged in!");
    }

    const schema = zfd.formData({
      firstName: zfd.text(),
      lastName: zfd.text(),
      email: zfd.text(),
    });

    const { data } = schema.safeParse(await request.formData());

    if (!data) {
      error(400, "Invalid form data");
    }

    await db.update(profileTable).set({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
    }).where(eq(profileTable.id, userProfile.id));

    return { success: true };
  },
};
