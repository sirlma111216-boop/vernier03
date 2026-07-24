/**
 * Cloudflare Pages Function: share-session connection config.
 *
 * Hands the browser the Supabase URL + publishable/anon key from environment
 * variables so no key is committed to the repo. When either is missing we answer
 * { configured: false } and the client quietly disables sharing — the local
 * experiment keeps working.
 *
 * Exposing the anon key is safe ONLY because share_sessions has RLS enabled with
 * zero policies and just two SECURITY DEFINER functions are granted to anon
 * (create_share_session / get_share_session). Do not add table policies.
 *
 * Configure with:
 *   wrangler pages secret put SUPABASE_URL
 *   wrangler pages secret put SUPABASE_ANON_KEY
 */

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const url = (env.SUPABASE_URL ?? "").trim();
  const anonKey = (env.SUPABASE_ANON_KEY ?? "").trim();
  const body = url && anonKey ? { configured: true, url, anonKey } : { configured: false };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

// Minimal type shim so this file type-checks without @cloudflare/workers-types.
type PagesFunction<E = unknown> = (context: {
  request: Request;
  env: E;
}) => Response | Promise<Response>;
