export interface RuntimeConfig {
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  databasePath: string;
}

const loopbackHosts = new Set<RuntimeConfig["host"]>([
  "127.0.0.1",
  "localhost",
  "::1",
]);

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const host = environment.HOST ?? "127.0.0.1";

  if (!loopbackHosts.has(host as RuntimeConfig["host"])) {
    throw new Error("HOST must be a loopback address");
  }

  const port = Number(environment.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  return {
    host: host as RuntimeConfig["host"],
    port,
    databasePath: environment.DATABASE_PATH ?? "data/story-to-cyoa.sqlite",
  };
}
