import { env } from "./config/env.js";
import app from "./app.js";
import { expireStaleApprovals } from "./modules/ai-agent/agent.service.js";

const server = app.listen(env.port, () => {
  console.log(`AgentDesk API running on http://localhost:${env.port}`);
});

// Expire approval requests nobody answered so runs never hang forever.
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;

const expirySweep = setInterval(() => {
  expireStaleApprovals().catch((error: unknown) => {
    console.error(
      "Approval expiry sweep failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  });
}, EXPIRY_SWEEP_INTERVAL_MS);

expirySweep.unref();

function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down...`);

  clearInterval(expirySweep);

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
