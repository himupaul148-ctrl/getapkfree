import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy the values into .env.local.",
  );
}

/**
 * Cookie-less client for the public catalogue: apps and published versions are
 * readable by anyone, so these reads need no session. Anything user-scoped goes
 * through ./server (server components) or ./client (browser), which carry the
 * auth cookie. Row Level Security — not this key — protects the private tables.
 */
export const supabase = createClient(url, anonKey);
