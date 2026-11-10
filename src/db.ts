import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./config.js";

let client: SupabaseClient | undefined;

// Lazy so the server can start and list tools without credentials.
export function db(): SupabaseClient {
  if (!client) {
    const { url, key } = getSupabaseEnv();
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
