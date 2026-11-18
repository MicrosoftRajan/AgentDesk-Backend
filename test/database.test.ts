import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { TLSSocket } from "node:tls";
import { buildPoolConfig, createDatabase } from "../src/config/database";
import { parseEnv } from "../src/config/env";

const FIXTURES = path.join(__dirname, "fixtures");
const UNRELATED_CA = path.join(FIXTURES, "test-ca.crt");

const LOCALHOST_CERT = path.join(FIXTURES, "tls-localhost.crt");
const LOCALHOST_KEY = path.join(FIXTURES, "tls-localhost.key");

const SSL_REQUEST_CODE = 80877103;

function envFor(host: string, port: number, ca: string, query = "") {
  return parseEnv({
    DATABASE_URL: `postgresql://agentdesk_app.ref:p%40ss%3Aw0rd@${host}:${port}/postgres${query}`,
    DATABASE_CA_CERT_PATH: ca,
    DB_POOL_MAX: "3",
    DB_CONNECTION_TIMEOUT_MS: "3000",
  });
}

describe("buildPoolConfig", () => {
  it("uses discrete fields, never a connection string", () => {
    const config = buildPoolConfig(envFor("db.example.test", 5432, UNRELATED_CA, "?application_name=evil&options=-c%20x%3Dy"));
    assert.equal("connectionString" in config, false);
    assert.equal(config.host, "db.example.test");
    assert.equal(config.port, 5432);
    assert.equal(config.user, "agentdesk_app.ref");
    assert.equal(config.password, "p@ss:w0rd");
    assert.equal(config.database, "postgres");

    assert.equal(config.application_name, "agentdesk-api");
    assert.equal(config.options, undefined);
  });

  it("verifies TLS with the configured CA and no overrides", () => {
    const config = buildPoolConfig(envFor("db.example.test", 5432, UNRELATED_CA));
    assert.deepEqual(config.ssl, { ca: readFileSync(UNRELATED_CA, "utf8"), rejectUnauthorized: true });
  });

  it("uses the validated pool settings", () => {
    const config = buildPoolConfig(envFor("db.example.test", 5432, UNRELATED_CA));
    assert.equal(config.max, 3);
    assert.equal(config.idleTimeoutMillis, 30_000);
    assert.equal(config.connectionTimeoutMillis, 3_000);
  });
});

describe("createDatabase", () => {
  it("wires Drizzle to the pool and closes once", async () => {
    const database = createDatabase(envFor("db.example.test", 5432, UNRELATED_CA));
    assert.equal(database.db.$client, database.pool);
    const first = database.close();
    assert.equal(database.close(), first);
    await first;
    assert.equal(database.pool.ended, true);
  });
});

describe("TLS behaviour against a local fake server", () => {
  let server: Server;
  let port: number;
  let mode: "N" | "S" = "S";
  let handshakes = 0;

  before(async () => {
    const key = readFileSync(LOCALHOST_KEY);
    const cert = readFileSync(LOCALHOST_CERT);
    server = createServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", (packet: Buffer) => {
        assert.equal(packet.readInt32BE(4), SSL_REQUEST_CODE, "client must ask for TLS first");
        if (mode === "N") {
          socket.end("N");
          return;
        }
        socket.write("S");
        const tls = new TLSSocket(socket, { isServer: true, key, cert });
        tls.on("error", () => {});
        tls.on("secure", () => {
          handshakes++;
          tls.destroy();
        });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function connect(host: string, ca: string): Promise<unknown> {
    const database = createDatabase(envFor(host, port, ca));
    try {
      await database.pool.query("select 1");
      return undefined;
    } catch (error) {
      return error;
    } finally {
      await database.close();
    }
  }

  it("never falls back to plaintext when the server refuses TLS", async () => {
    mode = "N";
    const error = await connect("localhost", LOCALHOST_CERT);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "The server does not support SSL connections");
  });

  it("rejects a server certificate not signed by the configured CA", async () => {
    mode = "S";
    const error = await connect("localhost", UNRELATED_CA);
    assert.match(String((error as { code?: string }).code), /SELF_SIGNED|UNABLE_TO_VERIFY/);
  });

  it("rejects a trusted certificate whose name does not match the host", async () => {
    mode = "S";
    const error = await connect("127.0.0.1", LOCALHOST_CERT);
    assert.equal((error as { code?: string }).code, "ERR_TLS_CERT_ALTNAME_INVALID");
  });

  it("completes the handshake when the CA and host name match", async () => {
    mode = "S";
    const before = handshakes;
    const error = await connect("localhost", LOCALHOST_CERT);
    assert.equal(handshakes, before + 1, "server saw a verified TLS handshake");

    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, undefined);
  });
});
