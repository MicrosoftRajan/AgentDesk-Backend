/**
 * Confirms the backend can reach Supabase and that migration 006
 * is visible through the service-role client.
 *
 * Usage: npm run db:verify
 */
import "dotenv/config";

import { lookup } from "node:dns/promises";

import { createClient } from "@supabase/supabase-js";

const tables = [
  "organizations",
  "locations",
  "departments",
  "profiles",
  "staff_assignments",
  "patients",
  "appointment_types",
  "schedule_templates",
  "template_shifts",
  "doctor_schedules",
  "schedule_exceptions",
  "appointments",
  "appointment_events",
  "agent_runs",
  "messages",
  "approval_requests",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = required("SUPABASE_URL");
  const hostname = new URL(supabaseUrl).hostname;

  try {
    await lookup(hostname);
  } catch {
    throw new Error(
      `${supabaseUrl} did not resolve. The Supabase project is not reachable from this machine.`,
    );
  }

  const supabase = createClient(supabaseUrl, required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(8000),
        }),
    },
  });

  let failed = false;

  for (const table of tables) {
    // A HEAD request returns success for a table that does not exist.
    // A real select is what the API uses, and it reports a missing table.
    const { error } = await supabase.from(table).select("id").limit(1);

    if (error) {
      failed = true;
      console.error(`FAIL  ${table}  ${error.code ?? ""} ${error.message}`);
      continue;
    }

    console.log(`ok    ${table}`);
  }

  const clinic = await supabase
    .from("locations")
    .select("id, name, timezone")
    .eq("name", "Main")
    .limit(1)
    .maybeSingle();

  if (clinic.error) {
    failed = true;
    console.error(`FAIL  clinic  ${clinic.error.message}`);
  } else if (!clinic.data) {
    failed = true;
    console.error("FAIL  clinic  Main location was not found");
  } else {
    console.log(`ok    clinic  ${clinic.data.name} ${clinic.data.timezone}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
