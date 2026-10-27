import { actNativePlayerWorld, createNativePlayerConfig, createNativePlayerSession, previewChapterTransition, type NativePlayerSave } from "@story-to-cyoa/runtime";
import { expect, test, type Page } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { unzipSync } from "fflate";
import { authoredWorld } from "./helpers/world.js";
import { withAuthoredProgression } from "./helpers/progression.js";
import { completeConnectedTextGame } from "./helpers/connected-text-game.js";

test("W5 journal-only stationary events and chapter transitions observe short windows in actual offline exports", async ({ page, browser, playwright }, info) => {
  test.setTimeout(300000); page.setDefaultTimeout(15000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-w5-browser-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W5_DATABASE,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W5_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W5_PROJECT_ID: projectId, W5_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`W5 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`W5 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      await call("create_project", { projectId, operationId: randomUUID(), name: "Journal-only boundaries", approved: true });
      await completeConnectedTextGame(call, projectId);
      const world = await withAuthoredProgression(call, projectId, await authoredWorld(call, projectId)), progression = world.progression!;
      progression.events = [{ ...progression.events[0]!, prerequisites: [], minutes: 15 }];
      progression.transitions[0] = { ...progression.transitions[0]!, passage: null, minutes: 15, expireEventIds: [] };
      world.journal = { schemaId: "cyoa.world-journal", schemaVersion: 1, character: [], locations: [],
        entries: [
          { id: "event-window", title: "Event signal", text: "A brief signal during the stationary event.", when: [{ kind: "time", from: 1432, until: 1434 }] },
          { id: "chapter-window", title: "Chapter signal", text: "A brief signal before the chapter changes.", when: [{ kind: "time", from: 1447, until: 1449 }, { kind: "chapter", chapterId: "first", current: true }] },
          { id: "premature-event", title: "Hidden before event effects", text: "Must remain hidden.", when: [{ kind: "time", from: 1445, until: null }, { kind: "milestone", milestoneId: "clue", achieved: false }] },
          { id: "premature-chapter", title: "Hidden before chapter effects", text: "Must remain hidden.", when: [{ kind: "time", from: 1460, until: null }, { kind: "chapter", chapterId: "first", current: true }] },
        ], objectives: [
          { id: "event-window", title: "Observe event signal", description: "Watch during the event.", when: [{ kind: "time", from: 1432, until: 1434 }], completeWhen: [{ kind: "time", from: 1433, until: 1434 }] },
          { id: "chapter-window", title: "Observe chapter signal", description: "Watch before the chapter changes.", when: [{ kind: "time", from: 1447, until: 1449 }], completeWhen: [{ kind: "time", from: 1448, until: 1449 }] },
        ] };
      expect(world).not.toHaveProperty("people"); expect(world).not.toHaveProperty("economy");
      const review = await call("review_world", { projectId, world });
      await call("apply_world", { projectId, world, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
      const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true);
      const build = await call("compile_game", { projectId, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, operationId: randomUUID(), approved: true });
      const htmlExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "standalone" }), html = await request.get(htmlExport.downloadPath); await expect(html).toBeOK();
      const file = join(directory, "journal-only.html"); await writeFile(file, await html.body());
      const staticExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" }), zip = await request.get(staticExport.downloadPath); await expect(zip).toBeOK();
      const files = unzipSync(await zip.body()), bundle = JSON.parse(Buffer.from(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]).toString());
      expect(bundle.world).not.toHaveProperty("people"); expect(bundle.world).not.toHaveProperty("economy");
      const config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle), initial = createNativePlayerSession(bundle, config);
      const afterEvent = actNativePlayerWorld(bundle, config, initial, { kind: "event", id: "notice" }).session;
      const afterChapter = actNativePlayerWorld(bundle, config, afterEvent, { kind: "chapter-transition", id: "next", previewFingerprint: previewChapterTransition(bundle.world, afterEvent.state, "next").fingerprint }).session;
      expect(afterEvent.state.world!.journal!.entryIds).toEqual(["event-window"]);
      expect(afterEvent.state.world!.journal!.completedObjectiveIds).toEqual(["event-window"]);
      expect(afterChapter.state.world!.journal!.entryIds).toEqual(["chapter-window", "event-window"]);
      expect(afterChapter.state.world!.journal!.completedObjectiveIds).toEqual(["chapter-window", "event-window"]);
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const readSave = (player: Page) => player.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("story-to-cyoa-native-player-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise<NativePlayerSave | undefined>((resolve, reject) => { const r = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll(); r.onsuccess = () => resolve(r.result[0]?.value); r.onerror = () => reject(r.error); }); } finally { db.close(); }
      });
      const play = async (player: Page, surface: string, width: number) => {
        const views = player.getByRole("region", { name: "World views", exact: true }), nav = player.getByRole("navigation", { name: "World views", exact: true });
        const show = async (name: string) => { await nav.getByRole("button", { name, exact: true }).click(); };
        const confirm = async (label: string) => { await show("Explore"); await views.getByRole("button", { name: label, exact: true }).click(); await player.getByRole("button", { name: "Confirm action", exact: true }).click(); };
        const journal = async (stage: "event" | "chapter") => {
          await show("Journal"); await views.getByRole("button", { name: "Objectives", exact: true }).click();
          const objectives = views.getByRole("region", { name: "Objectives", exact: true });
          await expect(objectives).toContainText("No active objectives disclosed."); await expect(objectives).toContainText("Completed objectives");
          await expect(objectives.getByText("Observe event signal", { exact: true })).toHaveCount(1);
          await expect(objectives.getByText("Observe chapter signal", { exact: true })).toHaveCount(stage === "chapter" ? 1 : 0);
          await player.screenshot({ path: info.outputPath(`w5-correction-${surface}-${width}-${stage}-objectives.png`), fullPage: true });
          await views.getByRole("button", { name: "Entries", exact: true }).click();
          await expect(views.getByRole("heading", { name: "Event signal", exact: true })).toHaveCount(1);
          await expect(views.getByRole("heading", { name: "Chapter signal", exact: true })).toHaveCount(stage === "chapter" ? 1 : 0);
          expect(await views.innerText()).not.toMatch(/Hidden before|Must remain hidden/);
          expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await player.screenshot({ path: info.outputPath(`w5-correction-${surface}-${width}-${stage}-entries.png`), fullPage: true });
        };
        await expect(views.getByLabel("Game time")).toHaveText("Day 1 · 23:50");
        await show("Journal"); await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByText("No journal entries recorded.", { exact: true })).toBeVisible();
        await show("Explore"); await views.getByRole("button", { name: "Read the signal notice · 15 min", exact: true }).click(); await player.getByRole("button", { name: "Cancel", exact: true }).click();
        expect(await readSave(player)).toBeUndefined(); await expect(views.getByLabel("Game time")).toHaveText("Day 1 · 23:50");
        await confirm("Read the signal notice · 15 min"); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterEvent.state);
        await expect(views.getByLabel("Game time")).toHaveText("Day 2 · 00:05"); await journal("event");
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name").fill("After stationary event"); await player.getByRole("button", { name: "Create save", exact: true }).click();
        await player.reload(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterEvent.state);
        await confirm("Begin the next chapter · 15 min"); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterChapter.state);
        await expect(views.getByLabel("Game time")).toHaveText("Day 2 · 00:20"); await journal("chapter");
        await player.reload(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterChapter.state);
        await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterEvent.state);
        await confirm("Begin the next chapter · 15 min"); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterChapter.state);
        await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterEvent.state);
        await confirm("Begin the next chapter · 15 min"); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterChapter.state);
        await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Restart game", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(initial.state);
        await confirm("Read the signal notice · 15 min"); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterEvent.state);
        await confirm("Begin the next chapter · 15 min"); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterChapter.state);
        const saved = await readSave(player); expect(saved!.state.world).not.toHaveProperty("people"); expect(saved!.state.world).not.toHaveProperty("economy");
        await writeFile(info.outputPath(`w5-correction-${surface}-${width}-state.json`), JSON.stringify(saved!.state, null, 2));
        await expect(player.getByRole("alert")).toHaveCount(0);
      };
      const server = createServer((req, res) => { const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = files[path]; if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes)); });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address();
      try {
        for (const surface of ["standalone", "static"]) for (const [width, height] of [[1280, 900], [390, 844]]) {
          const context = await browser.newContext({ viewport: { width, height } }), player = await context.newPage(), requests: string[] = []; player.on("request", (r) => requests.push(r.url()));
          try { await player.goto(surface === "standalone" ? pathToFileURL(file).href : `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/nested/index.html`); await play(player, surface, width); expect(requests.some((u) => /\/api\/|openrouter|provider/i.test(u))).toBe(false); } finally { await context.close(); }
        }
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { await request.dispose(); }
  } finally { if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); await rm(directory, { recursive: true, force: true }); }
});
