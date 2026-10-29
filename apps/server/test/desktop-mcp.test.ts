import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, it } from "vitest";

it("CP1 starts the documented persistent host, exposes the full configured tool set and recovers reviewed drafts across process restarts (SDK only)", async () => {
  const root = resolve("."), evidenceRoot = process.env.CP1_EVIDENCE_DIR;
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true });
  const directory = await mkdtemp(join(evidenceRoot ?? tmpdir(), "cp1-sdk-"));
  const portServer = createServer(); portServer.listen(0, "127.0.0.1"); await once(portServer, "listening");
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((done, fail) => portServer.close((error) => error ? fail(error) : done()));
  const setup = resolve(root, "scripts/configure-local-creator.mjs"), database = join(directory, "persistent creator.sqlite");
  const configure = (...args: string[]) => spawnSync(process.execPath, [setup, ...args], { cwd: directory, encoding: "utf8" });
  let child: ChildProcess | undefined, client: Client | undefined;
  const address = `http://127.0.0.1:${port}`, rootApi = (projectId: string) => `${address}/api/long-form/projects/${projectId}`;
  const stop = async () => {
    await client?.close(); client = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit"), timer = setTimeout(() => child?.kill("SIGKILL"), 5000);
      child.kill("SIGTERM");
      try { await exit; } finally { clearTimeout(timer); }
    }
    child = undefined;
  };
  const json = async (url: string) => { const result = await fetch(url); expect(result.ok).toBe(true); return result.json(); };
  try {
    const initialized = configure("--database", database, "--port", String(port));
    expect(initialized.status, initialized.stderr).toBe(0);
    const summary = JSON.parse(initialized.stdout), projectId = summary.projectId as string;
    const envFile = join(directory, "data/creator-mcp.env"), envBytes = await readFile(envFile), environment = parseEnv(envBytes.toString());
    expect(summary).toMatchObject({ database, creationEnabled: true, port });
    expect(initialized.stdout).not.toContain(environment.CYOA_MCP_TOKEN);
    if (process.platform !== "win32") expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    expect(configure("--database", database, "--port", String(port)).status).not.toBe(0);
    expect(await readFile(envFile)).toEqual(envBytes);
    expect(environment.DATABASE_PATH).toBe(database.replaceAll("\\", "/"));
    const start = async () => {
      let diagnostic = "";
      // The production entry and Node env-file path match the desktop guide. No inherited provider credentials.
      child = spawn(process.execPath, ["--env-file", envFile, resolve(root, "apps/server/dist/main.js")], {
        cwd: root, env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), NODE_ENV: "test", E2E_FAKE_MODEL_PROVIDER: "1" }, stdio: ["ignore", "pipe", "pipe"],
      });
      child.stderr!.on("data", (chunk) => { diagnostic = (diagnostic + String(chunk)).slice(-2000); });
      child.on("error", (error) => { diagnostic = error.message; });
      const deadline = Date.now() + 15000; let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Production host exited: ${diagnostic}`);
        try { const r = await fetch(`${address}/api/health`); if (r.ok) { ready = true; break; } } catch { /* Wait for the child listener. */ }
        await new Promise((done) => setTimeout(done, 100));
      }
      expect(ready, diagnostic).toBe(true);
      client = new Client({ name: "cp1-cloud-sdk-verification-not-native-codex", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${environment.CYOA_MCP_TOKEN}` } } }));
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client!.callTool({ name, arguments: args });
      if (r.isError) throw new Error(JSON.stringify(r.content));
      return r.structuredContent as any;
    };
    await start();
    const template = await readFile(resolve(root, "docs/examples/codex-local-mcp.toml"), "utf8");
    const enabled = [...template.match(/enabled_tools\s*=\s*\[([\s\S]*?)\]/)![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    const actual = (await client!.listTools()).tools.map((t) => t.name);
    expect(new Set(enabled).size).toBe(enabled.length);
    expect(enabled.slice().sort()).toEqual(actual.slice().sort()); expect(actual).toHaveLength(47);
    expect(template).toContain('bearer_token_env_var = "CYOA_MCP_TOKEN"');
    expect(template).toContain('url = "http://127.0.0.1:3000/mcp"');
    const instructions = client!.getInstructions();
    expect(instructions).toContain("Applying drafts is separate");
    expect(instructions).toContain("native standalone HTML");
    expect(instructions).toContain("SDK connection does not prove native Codex tool discovery");
    expect(await call("list_projects", {})).toEqual({ projects: [], creationSlots: [projectId] });
    await expect(call("create_project", { projectId, name: "CP1 smoke", operationId: randomUUID(), approved: false })).rejects.toThrow();
    const create = { projectId, name: "CP1 SDK persistent smoke", operationId: randomUUID(), approved: true };
    const created = await call("create_project", create);
    await expect(call("project_state", { projectId: randomUUID() })).rejects.toThrow("access_denied");
    expect(await call("list_staged_assets", { projectId })).toMatchObject({ enabled: true, items: [] });
    const original = await call("read_foundation", { projectId, artifactId: "brief" });
    const state = await call("project_state", { projectId });
    const prepare = { projectId, operationId: randomUUID(), message: "Change the Brief working title only, as a draft", headFingerprint: state.headFingerprint, targets: [{ key: "brief:root", versionId: original.versionId }] };
    const prepared = await call("prepare_edit", prepare);
    // Restart with prepared-but-unsubmitted work. Recovery uses the retained exact envelope, not an invented history tool.
    await stop(); await start();
    expect(await call("prepare_edit", prepare)).toEqual(prepared);
    const submit = { projectId, operationId: randomUUID(), planId: prepared.plan.id, fingerprint: prepared.plan.fingerprint,
      response: { message: "Title draft", groups: [{ id: "title", label: "Premise title", explanation: "A title-only draft revision", dependsOnGroupIds: [], operations: [{ targetKey: "brief:root", kind: "set-fields", changes: { workingTitle: "CP1 persistent draft verified" } }] }] } };
    const proposed = await call("submit_edit", submit), selection = { projectId, proposalId: proposed.proposalId, groupIds: ["title"] };
    const review = await call("review_edit", selection);
    expect((await call("read_foundation", { projectId, artifactId: "brief" })).versionId).toBe(original.versionId);
    const apply = { ...selection, operationId: randomUUID(), fingerprint: review.fingerprint, approved: true };
    await expect(call("apply_edit", { ...apply, approved: false })).rejects.toThrow();
    expect((await call("read_foundation", { projectId, artifactId: "brief" })).versionId).toBe(original.versionId);
    // Fixture authorization is scripted; this is not evidence of an actual human chat approval.
    const applied = await call("apply_edit", apply);
    const revised = await call("read_foundation", { projectId, artifactId: "brief" });
    expect(revised.content.workingTitle).toBe("CP1 persistent draft verified"); expect(revised.versionId).not.toBe(original.versionId);
    const visible = await json(rootApi(projectId));
    expect(visible.brief.id).toBe(revised.versionId); expect(visible.workflow.brief.status).toBe("draft"); expect(visible.workflow.brief.approvedVersionId).toBeNull();
    await expect(call("prepare_edit", { ...prepare, operationId: randomUUID() })).rejects.toThrow("stale");
    await expect(call("apply_edit", { ...apply, groupIds: ["different"] })).rejects.toThrow("operation_id_conflict");
    const versionsBefore = await json(`${address}/api/projects/${projectId}/artifacts/brief/versions`);
    await stop(); await start();
    // New client can rediscover current canonical work and proposal without the previous transcript.
    expect(await call("list_projects", {})).toMatchObject({ projects: [{ id: projectId }], creationSlots: [] });
    expect(await call("list_edits", { projectId })).toMatchObject({ total: 1, items: [{ id: proposed.proposalId, status: "applied" }] });
    expect(await call("get_edit", { projectId, proposalId: proposed.proposalId })).toMatchObject({ status: "applied" });
    expect(await call("create_project", create)).toEqual(created);
    expect(await call("submit_edit", submit)).toEqual(proposed);
    expect(await call("apply_edit", apply)).toEqual(applied);
    expect((await call("read_foundation", { projectId, artifactId: "brief" })).versionId).toBe(revised.versionId);
    expect(await json(`${address}/api/projects/${projectId}/artifacts/brief/versions`)).toEqual(versionsBefore);
    expect((await json(rootApi(projectId))).workflow.brief.status).toBe("draft");
    if (evidenceRoot) await writeFile(join(directory, "sdk-proof.json"), JSON.stringify({ verification: "local SDK against production child process, not native Codex", nativeDesktopVerification: "pending", projectId, originalVersionId: original.versionId, resultingVersionId: revised.versionId, proposalId: proposed.proposalId, toolCount: actual.length, configuredTools: enabled, instructionsReceived: Boolean(instructions), processStarts: 3, result: "passed", credentialFile: "private local fixture only; not published" }, null, 2) + "\n");
  } finally { await stop(); if (!evidenceRoot) await rm(directory, { recursive: true, force: true }); }
}, 60000);

it("local desktop setup binds existing projects without creation and rejects invalid/persistent-unsafe input without replacing settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cp1-setup-")), script = resolve("scripts/configure-local-creator.mjs");
  try {
    const configure = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: "utf8" });
    for (const args of [["--project-id", "not-a-uuid"], ["--database", ":memory:"], ["--port", "0"]]) expect(configure(...args).status).not.toBe(0);
    const projectId = randomUUID(), configured = configure("--project-id", projectId);
    expect(configured.status, configured.stderr).toBe(0);
    const file = join(directory, "data/creator-mcp.env"), before = await readFile(file);
    expect(parseEnv(before.toString())).toMatchObject({ CYOA_MCP_PROJECT_IDS: projectId, CYOA_MCP_ALLOW_PROJECT_CREATION: "0", DATABASE_PATH: resolve(directory, "data/story-to-cyoa.sqlite").replaceAll("\\", "/") });
    expect(configure().status).not.toBe(0); expect(await readFile(file)).toEqual(before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
