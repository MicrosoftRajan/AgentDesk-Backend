import { readFileSync } from "node:fs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { errorCode } from "../common/error-code";
import * as schema from "../models";
import type { Env } from "./env";

export type Database = {
  pool: Pool;
  db: NodePgDatabase<typeof schema> & { $client: Pool };
  close: () => Promise<void>;
};

export function buildPoolConfig(env: Env): PoolConfig {
  const url = new URL(env.DATABASE_URL);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: {
      ca: readFileSync(env.DATABASE_CA_CERT_PATH, "utf8"),
      rejectUnauthorized: true,
    },
    application_name: "agentdesk-api",
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  };
}

export function createDatabase(env: Env): Database {
  const pool = new Pool(buildPoolConfig(env));

  pool.on("error", (error) => {
    console.error(`Database pool error: ${errorCode(error)}`);
  });

  const db = drizzle({ client: pool, schema });
  let closing: Promise<void> | undefined;

  return {
    pool,
    db,
    close: () => (closing ??= pool.end()),
  };
}
