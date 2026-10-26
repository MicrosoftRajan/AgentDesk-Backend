import { createClient } from "@supabase/supabase-js";

import { env } from "./env.js";

// Backend-only client. The service role key bypasses RLS and must
// never be shipped to the Expo app.
export const supabase = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
