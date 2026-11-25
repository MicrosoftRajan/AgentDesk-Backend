import { readFileSync } from "node:fs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { errorCode } from "../common/error-code";
import * as schema from "../models";
import type { Env } from "./env";

// Pool -> use to manage and create the connection of DB


export type Database = {
  pool: Pool; // DB Connection manages
  db: NodePgDatabase<typeof schema> & { $client: Pool }; // it work with DB like Fetching the appointment, update appointment
  close: () => Promise<void>; // close the DB Connections
};


// connect the env.ts data 
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

// Create the DB
export function createDatabase(env: Env): Database {
  const pool = new Pool(buildPoolConfig(env));


  // if there is any error in DB
  pool.on("error", (error) => {
    console.error(`Database pool error: ${errorCode(error)}`);
  });

  const db = drizzle({ client: pool, schema });

  // it will close the DB Connection
  let closing: Promise<void> | undefined;

  return {
    pool,
    db,
    close: () => (closing ??= pool.end()),
  };
}


// WorkFlow 
/* new Pool() -> drizzle() -> close() */
// Drizzle() -> it connects the pool and DB Models
