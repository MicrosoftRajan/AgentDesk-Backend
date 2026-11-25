/* This file is used to start the server and handle the shutdown process. */

import { createServer, type Server } from "node:http";
import { createApp, type AppDeps } from "./app";
import { errorCode } from "./common/error-code";
import type { Env } from "./config/env";

/* This code help the close the resource safely during the shutdown time of server */

// run() -> it is function to execute the tasks
export type CleanupTask = { name: string; run: () => Promise<void> };

/* This define the time taken by sever to shutdown */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/* it stores the reference of HTTP Sever */
let server: Server | undefined;
/* This store the promise of shutdown sever process */
let shutdownPromise: Promise<void> | undefined;

/* This stores the list of resources that need to be close during server shutdown.. */
let cleanupTasks: readonly CleanupTask[] = [];

// It starts the server
export function startServer(env: Env, cleanup: readonly CleanupTask[] = [], deps: AppDeps = {}): Server {
  const port = env.PORT;
  cleanupTasks = cleanup;

  /* CreateServer() -> It creates the HTTP Server around App, createApp() -> it provide all the req dependencies need to create an Express App */
  server = createServer(createApp(deps));

  // Server Error
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Server error: ${error.code ?? error.name}`);
    process.exit(1);
  });

  // server has started listing on Given Port
  server.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });

 
  // IT Terminate the process from Task Manager -> SIGNAL TERMINATION
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
 // This is SIGNAL INTTRUPTION -> ctrl+C 
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return server;
}


// Server Shutdown
function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  console.log(`${signal} received, shutting down`);


  // this code help to froce shutdown the server and if the server is not shutdown in 10 sec
  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out, forcing exit");
    server?.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  shutdownPromise = (async () => {
    let exitCode = 0; // Successful Shutdown

    try {
      await closeHttpServer();
    } catch (error) {
      exitCode = 1; //
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
