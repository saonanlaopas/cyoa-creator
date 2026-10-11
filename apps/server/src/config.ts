export interface RuntimeConfig {
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  databasePath: string;
  connectedEditing?: ConnectedEditingConfig;
}

export interface ConnectedEditingConfig { token: string; projectIds: string[] }
export function validateConnectedEditingConfig(config: ConnectedEditingConfig): ConnectedEditingConfig {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(config.token) || !Array.isArray(config.projectIds) || !config.projectIds.length || config.projectIds.length > 50
    || new Set(config.projectIds).size !== config.projectIds.length || config.projectIds.some((id) => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))) {
    throw new Error("Connected editing requires a strong token and 1-50 explicit project UUIDs");
  }
  return { token: config.token, projectIds: [...config.projectIds] };
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
    ...(environment.CYOA_MCP_ENABLED === "1" ? { connectedEditing: validateConnectedEditingConfig({
      token: environment.CYOA_MCP_TOKEN ?? "", projectIds: (environment.CYOA_MCP_PROJECT_IDS ?? "").split(",").map((s) => s.trim()),
    }) } : {}),
  };
}
