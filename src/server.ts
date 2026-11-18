import { createServer, type Server } from "node:http";
import { createApp, type AppDeps } from "./app";
import { errorCode } from "./common/error-code";
import type { Env } from "./config/env";

export type CleanupTask = { name: string; run: () => Promise<void> };

const SHUTDOWN_TIMEOUT_MS = 10_000;

let server: Server | undefined;
let shutdownPromise: Promise<void> | undefined;

let cleanupTasks: readonly CleanupTask[] = [];

export function startServer(env: Env, cleanup: readonly CleanupTask[] = [], deps: AppDeps = {}): Server {
  const port = env.PORT;
  cleanupTasks = cleanup;

  server = createServer(createApp(deps));

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Server error: ${error.code ?? error.name}`);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return server;
}

function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out, forcing exit");
    server?.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  shutdownPromise = (async () => {
    let exitCode = 0;

    try {
      await closeHttpServer();
    } catch (error) {
      exitCode = 1;
      console.error(`HTTP server close failed: ${errorCode(error)}`);
    }

    for (const task of cleanupTasks) {
      try {
        await task.run();
      } catch (error) {
        exitCode = 1;
        console.error(`Cleanup "${task.name}" failed: ${errorCode(error)}`);
      }
    }

    console.log("Shutdown complete");
    process.exit(exitCode);
  })();

  return shutdownPromise;
}

function closeHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server?.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}
