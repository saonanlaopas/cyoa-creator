import { actNativePlayerWorld, createNativePlayerConfig, createNativePlayerSession } from "@story-to-cyoa/runtime";
import { expect, test, type Page } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { unzipSync } from "fflate";
import { completeConnectedTextGame } from "./helpers/connected-text-game.js";
import { authoredWorld } from "./helpers/world.js";
import { withAuthoredPeople } from "./helpers/people.js";

test("W3 review fixes complete required costs, observe effects before discovery and preview genuine losses offline", async ({ browser, playwright }, info) => {
  test.setTimeout(120000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-w3-review-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W3_DATABASE,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W3_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W3_PROJECT_ID: projectId, W3_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`W3 review startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`W3 review exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      await call("create_project", { projectId, operationId: randomUUID(), name: "W3 review regression harbor", approved: true });
      await completeConnectedTextGame(call, projectId);
      const world = await withAuthoredPeople(call, projectId, await authoredWorld(call, projectId)), p = world.progression!, people = world.people!, event = p.events[0]!;
      people.schedules = [{ id: "endpoint", characterId: "mara", locationId: "home", days: [0], from: 1435, until: 1440 }];
      people.overrides = [{ id: "completion-absence", characterId: "mara", locationId: null, priority: 10, prerequisites: [{ kind: "milestone", milestoneId: "clue", achieved: true }] }];
      p.events = [
        { ...event, id: "urgent", label: "Finish the warning", prerequisites: [], minutes: 5, milestoneIds: ["clue"], result: "The warning is complete." },
        { ...event, id: "answer", label: "Answer the later signal", prerequisites: [{ kind: "time", from: 1432, until: null }], milestoneIds: [], result: "The later signal is answered." },
        { ...event, id: "hello", label: "Hidden greeting", prerequisites: [], milestoneIds: [], result: "Mara greets you." },
        { ...event, id: "ledger", label: "Read the ledger", prerequisites: [], visibility: "always", milestoneIds: [], result: "The ledger remains readable." },
        { ...event, id: "arrival", label: "Complete arrival check", prerequisites: [{ kind: "chapter", chapterId: "second", current: true }], milestoneIds: [], result: "The arrival check is complete." },
        { ...event, id: "notes", label: "First chapter notes", prerequisites: [{ kind: "chapter", chapterId: "first", current: true }], visibility: "always", milestoneIds: [], result: "Notes from before dawn." },
      ];
      people.events = p.events.map((e) => ({ eventId: e.id, priority: e.id === "urgent" ? 20 : e.id === "answer" ? 10 : e.id === "arrival" ? 30 : 0, mandatory: ["urgent", "answer", "arrival"].includes(e.id), characterIds: e.id === "hello" ? ["mara"] : [] }));
      Object.assign(p.transitions[0]!, { minutes: 0, passage: null, expireEventIds: [], carryMilestoneIds: ["clue"] });
      const review = await call("review_world", { projectId, world }); await call("apply_world", { projectId, world, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
      const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true);
      const build = await call("compile_game", { projectId, operationId: randomUUID(), approved: true, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint });
      const htmlExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "standalone" });
      const file = join(directory, "review.html"); const html = await request.get(htmlExport.downloadPath); await expect(html).toBeOK(); await writeFile(file, await html.body());
      const staticExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" });
      const zip = await request.get(staticExport.downloadPath); await expect(zip).toBeOK(); const files = unzipSync(await zip.body());
      const bundle = JSON.parse(Buffer.from(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]).toString()), config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle);
      const initial = createNativePlayerSession(bundle, config), completed = actNativePlayerWorld(bundle, config, actNativePlayerWorld(bundle, config, initial, { kind: "event", id: "urgent" }).session, { kind: "event", id: "answer" }).session;
      const preview = (await call("preview_chapter_transition", { projectId, transitionId: p.transitions[0]!.id, state: completed.state })).preview;
      expect(preview.lostOpportunities.map((e: { id: string }) => e.id)).toEqual(["notes"]);
      const inspected = await call("inspect_world_presence", { projectId, state: completed.state }); expect(inspected.present).toEqual([]); expect(inspected.encounters.some((e: { id: string }) => e.id === "hello")).toBe(false);
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });

      const play = async (page: Page, surface: string, width: number) => {
        page.setDefaultTimeout(10000);
        const panel = page.getByRole("region", { name: "Locations and time", exact: true }), clock = panel.getByLabel("Game time"), here = panel.getByRole("region", { name: "People present" });
        const confirm = async (label: string) => { await panel.getByRole("button", { name: label, exact: true }).click(); await page.getByRole("button", { name: "Confirm action", exact: true }).click(); await expect(page.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
        await expect(clock).toHaveText("Day 1 · 23:50"); await expect(panel.getByRole("button", { name: "Wait 5 min", exact: true })).toBeDisabled();
        await panel.getByRole("button", { name: "Finish the warning · 5 min", exact: true }).click(); await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock).toHaveText("Day 1 · 23:50");
        await confirm("Finish the warning · 5 min"); await expect(clock).toHaveText("Day 1 · 23:55");
        await expect(panel.getByRole("status")).toContainText("Required encounter: Answer the later signal");
        await expect(here).toHaveText("Here now: No one encountered"); await expect(panel.getByRole("button", { name: /Hidden greeting/ })).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`w3-review-${surface}-completion-${width}.png`), fullPage: true });
        await page.reload(); await expect(clock).toHaveText("Day 1 · 23:55"); await expect(panel.getByRole("button", { name: /Hidden greeting/ })).toHaveCount(0);
        await confirm("Answer the later signal · 0 min");
        await page.getByRole("button", { name: "Save game", exact: true }).click(); await page.getByLabel("Save name").fill("Before transition"); await page.getByRole("button", { name: "Create save", exact: true }).click();
        await panel.getByRole("button", { name: "Begin the next chapter · 0 min", exact: true }).click();
        const previewRegion = page.getByRole("region", { name: "Chapter transition preview", exact: true });
        await expect(previewRegion).toContainText("First chapter notes: A prerequisite is lost"); await expect(previewRegion).not.toContainText("Read the ledger"); await expect(previewRegion).not.toContainText("Repeat rule");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`w3-review-${surface}-preview-${width}.png`), fullPage: true });
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await confirm("Begin the next chapter · 0 min"); await expect(panel.getByRole("status")).toContainText("Complete arrival check");
        await expect(panel.getByRole("button", { name: /Read the ledger/ })).toBeDisabled();
        await confirm("Complete arrival check · 0 min"); await expect(panel.getByRole("button", { name: "Read the ledger · 0 min", exact: true })).toBeEnabled();
        await confirm("Read the ledger · 0 min"); await expect(panel.getByRole("button", { name: /Read the ledger/ })).toContainText("Completed");
        await page.getByRole("button", { name: "Load game", exact: true }).click(); await page.getByRole("button", { name: "Load", exact: true }).click();
        await expect(panel.getByRole("button", { name: "Read the ledger · 0 min", exact: true })).toBeEnabled(); await expect(panel.getByRole("button", { name: /Hidden greeting/ })).toHaveCount(0);
        await confirm("Begin the next chapter · 0 min"); await confirm("Complete arrival check · 0 min"); await confirm("Read the ledger · 0 min");
        await page.reload(); await expect(here).toHaveText("Here now: No one encountered"); await expect(panel.getByRole("button", { name: /Hidden greeting/ })).toHaveCount(0);
      };
      const server = createServer((req, res) => { const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = files[path]; if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes)); });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address();
      try {
        for (const surface of ["standalone", "static"]) for (const [width, height] of [[1280, 900], [390, 844]]) {
          const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage(), requests: string[] = []; page.on("request", (r) => requests.push(r.url()));
          try { await page.goto(surface === "standalone" ? pathToFileURL(file).href : `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/nested/index.html`); await play(page, surface, width); expect(requests.some((u) => /\/api\/|openrouter|provider/i.test(u))).toBe(false); }
          finally { await context.close(); }
        }
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
