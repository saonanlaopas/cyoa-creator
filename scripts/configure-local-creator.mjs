import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// Local setup only: no server, Codex process, project, or provider is started.
const { values } = parseArgs({ options: {
  "project-id": { type: "string" }, database: { type: "string" }, port: { type: "string", default: "3000" },
} });
const projectId = values["project-id"] ?? randomUUID();
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(projectId)) throw new Error("Supply a lowercase project UUID");
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Supply a port from 1 to 65535");
const database = resolve(values.database ?? "data/story-to-cyoa.sqlite");
if (database === ":memory:" || values.database === ":memory:") throw new Error("Desktop Creator requires a persistent database file");
const staging = resolve("data/mcp-staging"), environmentFile = resolve("data/creator-mcp.env");
// Forward slashes work with Node on Windows too. These values are dotenv, not shell code.
const quotePath = (path) => {
  if (/[\r\n"]/.test(path)) throw new Error("Choose a path without newlines or double quotes");
  return `"${path.replaceAll("\\", "/")}"`;
};
const content = [
  "HOST=127.0.0.1", `PORT=${port}`, `DATABASE_PATH=${quotePath(database)}`,
  "CYOA_MCP_ENABLED=1", `CYOA_MCP_TOKEN=${randomBytes(32).toString("hex")}`,
  `CYOA_MCP_PROJECT_IDS=${projectId}`, `CYOA_MCP_ALLOW_PROJECT_CREATION=${values["project-id"] ? "0" : "1"}`,
  `CYOA_ASSET_STAGING_DIR=${quotePath(staging)}`, "",
].join("\n");
await mkdir(resolve("data"), { recursive: true });
await mkdir(staging, { recursive: true });
// Never rotate credentials or replace a user's configuration as an incidental retry.
await writeFile(environmentFile, content, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ environmentFile, database, staging, projectId, port,
  creationEnabled: !values["project-id"], next: "Build, then start Creator with this env file. Merge docs/examples/codex-local-mcp.toml into project Codex settings. No project has been created." }, null, 2));
