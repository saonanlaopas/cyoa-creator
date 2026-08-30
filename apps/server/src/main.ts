import { buildApp } from "./app.js";
import { readRuntimeConfig } from "./config.js";
import { DatabaseRecoveryError } from "@story-to-cyoa/persistence";

const config = readRuntimeConfig();
try {
  const app = buildApp({ databasePath: config.databasePath });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  const diagnostic = error instanceof DatabaseRecoveryError
    ? error.diagnostic
    : { code: "server_start_failed", message: "The server could not start safely.", sourcePreserved: true };
  console.error(JSON.stringify({ event: "startup_recovery_required", diagnostic }));
  process.exitCode = 1;
}
