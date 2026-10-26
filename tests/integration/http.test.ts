import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.COHERE_API_KEY ??= "test-cohere-key";

async function withServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const { default: app } = await import("../../src/app.ts");
  const server: Server = app.listen(0);

  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("HTTP contract", () => {
  it("answers the health check", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        success: true,
        data: { status: "ok", service: "agentdesk-api" },
      });
    });
  });

  it("rejects missing credentials on the versioned routes", async () => {
    await withServer(async (baseUrl) => {
      const paths = [
        "/api/v1/me",
        "/api/v1/appointments",
        "/api/v1/patient/appointments",
        "/api/v1/patient/slots",
        "/api/v1/agents/runs",
      ];

      for (const path of paths) {
        const response = await fetch(`${baseUrl}${path}`);
        const body = await response.json();

        assert.equal(response.status, 401, path);
        assert.equal(body.success, false);
        assert.equal(body.error.code, "UNAUTHENTICATED");
      }
    });
  });

  it("returns the JSON envelope for an unknown route and for invalid JSON", async () => {
    await withServer(async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/v1/does-not-exist`);
      const missingBody = await missing.json();

      assert.equal(missing.status, 404);
      assert.equal(missingBody.error.code, "NOT_FOUND");

      const invalid = await fetch(`${baseUrl}/api/v1/me`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      const invalidBody = await invalid.json();

      assert.equal(invalid.status, 400);
      assert.equal(invalidBody.error.code, "INVALID_JSON");
      assert.equal(typeof invalidBody.error.stack, "undefined");
    });
  });
});
