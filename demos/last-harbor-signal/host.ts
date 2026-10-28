import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

/** Disposable local Creator host. Never opens an existing user's database. */
export async function demoHost(directory: string, projectId: string, database = "creator.sqlite", repositoryRoot = process.cwd()) {
  const token = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W6_DATABASE, assetStagingDirectory: process.env.W6_DIRECTORY,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W6_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { cwd: repositoryRoot, env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W6_PROJECT_ID: projectId, W6_DIRECTORY: directory, W6_DATABASE: join(directory, database) }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const address = await new Promise<string>((resolve, reject) => {
    let output = ""; const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Demo startup timeout: ${errors}`)); }, 15000);
    child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const r = JSON.parse(line); if (r.address) { clearTimeout(timer); resolve(r.address); } } catch { /* Wait for complete startup record. */ } });
    child.once("error", (e) => { clearTimeout(timer); reject(e); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`Demo server exited: ${errors}`)); });
  });
  const response = async (path: string, init?: RequestInit) => {
    const r = await fetch(`${address}${path}`, init); if (!r.ok) throw new Error(`${r.status} ${path}: ${(await r.text()).slice(0, 5000)}`); return r;
  };
  const json = async (path: string, body?: unknown) => (await response(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const calls: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    const r = await response("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }) });
    const reply = await r.json(); if (reply.error || reply.result?.isError) throw new Error(`${name}: ${JSON.stringify(reply.error ?? reply.result.content)}`); return reply.result.structuredContent;
  };
  const close = async () => { if (child.exitCode !== null) return; await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); };
  return { address, response, json, call, close, calls };
}
export type DemoHost = Awaited<ReturnType<typeof demoHost>>;
