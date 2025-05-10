# SvelteKit + Supabase AI Insights Platform

This project allows users to upload text data, use their **own AI API keys** to run analysis via LLMs, and visualize structured insights, all while keeping their keys secure.

## Core Features

- **User-provided AI API keys:** Users input their key for each upload; keys are never stored and are only sent to the backend for the current analysis request.
- **Secure backend logic:** All AI LLM calls and key usage happen on the backend (Supabase Edge Functions). User keys are never logged, stored, or exposed.
- **Supabase Postgres:** All insights, quotes, nodes, and links are securely stored, with Row Level Security (RLS) enabled.
- **Frontend:** SvelteKit app with upload form, key entry, and dynamic display of analyzed insights.

## How It Works

1. **User logs in and goes to the upload form.**
2. **User pastes text, optionally provides source info, and enters their AI API key.**
3. **Upload is sent to the backend; the key is securely forwarded to the Edge Function.**
4. **Edge Functions process the data via LLM, store structured results, and return status.**
5. **User sees their insights in their dashboard.**

## Security Notes

- **User API keys are never stored or logged.**
- **All LLM requests occur server-side.**
- **RLS ensures users only see their data.**

## Local Development

- Copy `.env.example` to `.env` and fill in your Supabase project details.
- Run the SvelteKit dev server.
- Use the Supabase CLI to deploy Edge Functions:  
  ```
  supabase functions deploy upload-data --no-verify-jwt
  supabase functions deploy process-ai-analysis --no-verify-jwt
  supabase functions deploy get-insights --no-verify-jwt
  ```
- Ensure your hosting is HTTPS for key security.

## Deployment

- Set environment variables (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, etc.) in your hosting platform.
- Deploy Edge Functions and frontend as usual.

## Testing

- Register/login, upload text with your own AI API key, and view results on your dashboard.

## Debugging & Troubleshooting

- **Verbose logging** is implemented in all Supabase Edge Functions and backend endpoints (see source files).
- **Error and debug outputs** are returned in API responses under a `debug` field (never containing secrets).
- The SvelteKit frontend surfaces this debug info alongside errors in the UI for both uploads and insights.
- To test error handling, submit bad/malformed payloads or force errors in the backend, and inspect the `debug` output in the UI or network responses.
- All logs use clear tags (`[upload-data]`, `[process-ai-analysis]`, `[get-insights]`, `[upload-api]`) for easy filtering in console and server logs.
- Do **not** enable detailed debug output in production for end-users, but it is invaluable for development, staging, and automated testing.

