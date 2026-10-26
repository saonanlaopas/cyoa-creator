import { actNativePlayerWorld, createNativePlayerConfig, createNativePlayerSession } from "@story-to-cyoa/runtime";
import { expect, test, type Page } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { unzipSync } from "fflate";
import { completeConnectedTextGame } from "./helpers/connected-text-game.js";
import { authoredWorld, townMap } from "./helpers/world.js";
import { withAuthoredPeople } from "./helpers/people.js";
import { imageMetadata } from "./helpers/image-assets.js";

test("W3 authors weekly schedules, resolves mandatory priorities and plays presence overrides offline", async ({ page, browser, playwright }, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-w3-browser-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W3_DATABASE, assetStagingDirectory: process.env.W3_DIRECTORY,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W3_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W3_PROJECT_ID: projectId, W3_DIRECTORY: directory, W3_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`W3 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`W3 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      const unauthorized = await request.post("/mcp", { data: {} }); expect(unauthorized.status()).toBe(401);
      const crossOrigin = await request.post(`/api/long-form/projects/${projectId}/world/read_world`, { headers: { Origin: "https://other.invalid" }, data: {} }); expect(crossOrigin.status()).toBe(403);
      await call("create_project", { projectId, operationId: randomUUID(), name: "W3 Harbor District", approved: true });
      await completeConnectedTextGame(call, projectId);
      const bytes = townMap(); await writeFile(join(directory, "district.png"), bytes);
      const candidate = await call("import_staged_asset", { projectId, operationId: randomUUID(), approved: true, filename: "district.png", sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        metadata: { ...imageMetadata, title: "Harbor district map", altText: "Home, cafe and station along roads beside the harbor" } });
      const assetReview = await call("review_asset", { projectId, assetId: candidate.assetId, versionId: candidate.versionId });
      const approved = await call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: assetReview.fingerprint });
      let world = await withAuthoredPeople(call, projectId, await authoredWorld(call, projectId, { assetId: approved.assetId, versionId: approved.versionId }));
      // A valid ID inherited by ordinary objects must still execute in both exported players.
      world.progression!.transitions[0]!.id = "toString";
      const review = await call("review_world", { projectId, world });
      await call("apply_world", { projectId, world, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); }, projectId);
      await page.goto(`${address}/#long-form`);
      const editor = page.getByRole("region", { name: "World authoring", exact: true });
      await expect(editor.getByRole("textbox", { name: "Person name 1", exact: true })).toHaveValue("Mara");
      await expect(editor.getByRole("button", { name: "Remove person 1", exact: true })).toBeDisabled();
      await expect(editor.getByRole("button", { name: "Remove chapter 1", exact: true })).toBeDisabled();
      await expect(editor.getByTitle("Remove location 2", { exact: true })).toBeDisabled();
      await editor.getByRole("spinbutton", { name: "Schedule 1 start minute", exact: true }).fill("1436");
      await editor.getByRole("spinbutton", { name: "Schedule 1 start minute", exact: true }).fill("1435");
      await editor.getByRole("spinbutton", { name: "Encounter 3 priority", exact: true }).fill("20");
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText("people_mandatory_priority_conflict");
      await page.setViewportSize({ width: 390, height: 844 }); await editor.getByRole("alert").scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("w3-creator-priority-conflict-390.png") });
      await editor.getByRole("spinbutton", { name: "Encounter 3 priority", exact: true }).fill("10");
      await editor.getByRole("textbox", { name: "Person name 1", exact: true }).fill("Mara Vale");
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await editor.getByLabel("I approve this exact world and time definition.").check();
      const concurrent = structuredClone(world); concurrent.people!.characters[1]!.name = "Ivo Bell";
      const concurrentReview = await call("review_world", { projectId, world: concurrent });
      await call("apply_world", { projectId, world: concurrent, fingerprint: concurrentReview.fingerprint, operationId: randomUUID(), approved: true });
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText("stale");
      await editor.getByRole("button", { name: "Reload world", exact: true }).click(); await expect(editor.getByRole("textbox", { name: "Person name 1", exact: true })).toHaveValue("Mara");
      await editor.getByRole("textbox", { name: "Person name 1", exact: true }).fill("Mara Vale");
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.").check();
      let lost = false;
      await page.route("**/world/apply_world", async (route) => { if (lost) { await route.continue(); return; } lost = true; const r = await route.fetch(); expect(r.ok()).toBe(true); await route.abort("failed"); });
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText(/fetch|network/i);
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged.");
      await page.unroute("**/world/apply_world"); world = (await call("read_world", { projectId })).world;
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await editor.getByRole("heading", { name: "People and schedules", exact: true }).evaluate((e) => window.scrollTo(0, scrollY + e.getBoundingClientRect().top - 100));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`w3-creator-people-${width}.png`) });
        await editor.getByRole("heading", { name: "Encounter priorities", exact: true }).evaluate((e) => window.scrollTo(0, scrollY + e.getBoundingClientRect().top - 100));
        await page.screenshot({ path: info.outputPath(`w3-creator-priorities-${width}.png`) });
      }
      const exportWorld = async (prefix: string) => {
        const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true);
        const build = await call("compile_game", { projectId, operationId: randomUUID(), approved: true, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint });
        const exported = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "standalone" });
        const html = await request.get(exported.downloadPath); await expect(html).toBeOK(); const file = join(directory, `${prefix}.html`); await writeFile(file, await html.body());
        const archive = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" });
        const zip = await request.get(archive.downloadPath); await expect(zip).toBeOK(); const files = unzipSync(await zip.body());
        const bundle = JSON.parse(Buffer.from(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]).toString());
        expect(bundle.world.people.schemaId).toBe("cyoa.native-people"); expect(bundle.world.assets).toHaveLength(1);
        expect(JSON.stringify(bundle.world)).not.toMatch(/versionId|operationId|sourceName|sourceSha256|provenance/);
        return { file, files, bundle };
      };
      const chapters = await exportWorld("chapter-led"), config = createNativePlayerConfig({ gameId: chapters.bundle.gameId }, chapters.bundle), initial = createNativePlayerSession(chapters.bundle, config);
      const waited = actNativePlayerWorld(chapters.bundle, config, initial, { kind: "wait", minutes: 60 }).session;
      const copy = JSON.stringify(waited), projection = await call("inspect_world_presence", { projectId, state: waited.state });
      expect(projection.present).toEqual([{ id: "mara", name: "Mara Vale" }]); expect(projection.mandatory.eventId).toBe("urgent");
      expect(JSON.stringify(projection)).not.toMatch(/schedules|overrides|1530|station|cafe/); expect(JSON.stringify(waited)).toBe(copy);
      const free = structuredClone(world); free.progression!.chapters = []; free.progression!.initialChapterId = null; free.progression!.transitions = [];
      free.progression!.events = free.progression!.events.filter((e) => e.id !== "crossing");
      free.people!.events = free.people!.events.filter((r) => r.eventId !== "crossing");
      free.people!.overrides = free.people!.overrides.filter((o) => o.id === "invitation").map((o) => ({ ...o, prerequisites: o.prerequisites.filter((c) => c.kind !== "chapter") }));
      const freeReview = await call("review_world", { projectId, world: free }); await call("apply_world", { projectId, world: free, fingerprint: freeReview.fingerprint, operationId: randomUUID(), approved: true });
      const chapterFree = await exportWorld("chapter-free");
      const backup = await request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const play = async (player: Page, surface: string, freeMode: boolean) => {
        const panel = player.getByRole("region", { name: "Locations and time", exact: true }), clock = panel.getByLabel("Game time"), here = panel.getByRole("region", { name: "People present" });
        await expect(clock).toHaveText("Day 1 · 23:50"); await expect(here).toHaveText("Here now: No one encountered");
        await expect(panel.getByRole("button", { name: /Speak with Mara|Greet Ivo|Remember the crossing|Discuss the clue/ })).toHaveCount(0);
        await panel.getByText("Map", { exact: true }).click(); await panel.getByRole("combobox", { name: "Area", exact: true }).selectOption("town");
        await panel.getByRole("button", { name: "Inspect Station", exact: true }).click(); await expect(here).toHaveText("Here now: No one encountered"); await expect(clock).toHaveText("Day 1 · 23:50");
        await panel.getByText("Map", { exact: true }).click();
        const confirm = async (label: string) => { await panel.getByRole("button", { name: label, exact: true }).click(); await player.getByRole("button", { name: "Confirm action", exact: true }).focus(); await player.keyboard.press("Enter"); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
        await confirm("Wait 60 min"); await expect(clock).toHaveText("Day 2 · 00:00"); await expect(here).toHaveText("Here now: Mara Vale");
        await expect(panel.getByRole("status")).toContainText("Required encounter: Hear the midnight warning");
        await expect(panel.getByRole("button", { name: /Answer the midnight signal/ })).toBeDisabled(); await expect(panel.getByRole("button", { name: "Wait 5 min", exact: true })).toBeDisabled();
        for (const button of await player.getByRole("region", { name: "Choices", exact: true }).getByRole("button").all()) await expect(button).toBeDisabled();
        await expect(panel.getByRole("button", { name: /Greet Ivo/ })).toBeDisabled();
        expect(await here.textContent()).not.toMatch(/Ivo|station|cafe|Day|1435/);
        for (const [width, height] of [[1280, 900], [390, 844]]) { await player.setViewportSize({ width, height }); await here.scrollIntoViewIfNeeded(); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await player.screenshot({ path: info.outputPath(`w3-${surface}-${freeMode ? "free-" : ""}midnight-${width}.png`), fullPage: true }); }
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name").fill("Midnight watch"); await player.getByRole("button", { name: "Create save", exact: true }).click();
        await player.reload(); await expect(panel.getByRole("status")).toContainText("Required encounter: Hear the midnight warning");
        await panel.getByRole("button", { name: "Hear the midnight warning · 0 min", exact: true }).click(); await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock).toHaveText("Day 2 · 00:00");
        await confirm("Hear the midnight warning · 0 min"); await expect(panel.getByRole("status")).toContainText("Required encounter: Answer the midnight signal");
        await confirm("Answer the midnight signal · 0 min"); await expect(panel.getByRole("status")).toHaveCount(0);
        await confirm("Speak with Mara · 0 min"); await expect(here).toHaveText("Here now: No one encountered");
        await expect(panel.getByRole("button", { name: /Discuss the clue/ })).toHaveCount(0);
        await confirm("Cafe · 15 min"); await expect(here).toHaveText("Here now: Mara Vale"); await expect(clock).toHaveText("Day 2 · 00:15");
        await confirm("Discuss the clue · 0 min");
        if (!freeMode) {
          await panel.getByRole("button", { name: "Begin the next chapter · 5 min", exact: true }).click();
          await expect(player.getByRole("region", { name: "Chapter transition preview" })).toContainText("Milestones expiring: Invitation");
          await expect(player.getByRole("region", { name: "Chapter transition preview" })).toContainText("Greet Ivo: expires permanently");
          await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock).toHaveText("Day 2 · 00:15");
          await confirm("Begin the next chapter · 5 min"); await expect(here).toHaveText("Here now: Mara Vale"); await expect(clock).toHaveText("Day 2 · 00:20");
          await confirm("Remember the crossing · 0 min"); await confirm("Wait 60 min"); await expect(clock).toHaveText("Day 2 · 01:20"); await expect(here).toHaveText("Here now: Mara Vale");
          await confirm("Wait 15 min"); await expect(clock).toHaveText("Day 2 · 01:35"); await expect(here).toHaveText("Here now: No one encountered");
          for (const [width, height] of [[1280, 900], [390, 844]]) { await player.setViewportSize({ width, height }); await here.scrollIntoViewIfNeeded(); await player.screenshot({ path: info.outputPath(`w3-${surface}-override-absence-${width}.png`), fullPage: true }); }
          await confirm("Wait 15 min"); await expect(here).toHaveText("Here now: Mara Vale"); await expect(clock).toHaveText("Day 2 · 01:50");
        } else await expect(panel.getByText("Chapter-free play", { exact: true })).toBeVisible();
        await player.reload(); await expect(here).toHaveText("Here now: Mara Vale");
        await player.getByRole("button", { name: "Rewind", exact: true }).click();
        await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click();
        await expect(clock).toHaveText("Day 2 · 00:00"); await expect(panel.getByRole("status")).toContainText("Required encounter: Hear the midnight warning");
        await confirm("Hear the midnight warning · 0 min"); await confirm("Answer the midnight signal · 0 min");
        await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Restart game", exact: true }).click();
        await expect(clock).toHaveText("Day 1 · 23:50"); await expect(here).toHaveText("Here now: No one encountered");
      };
      for (const [mode, exported] of [["chapters", chapters], ["free", chapterFree]] as const) {
        const context = await browser.newContext(), standalone = await context.newPage(), requests: string[] = []; standalone.on("request", (r) => requests.push(r.url()));
        try { await standalone.goto(pathToFileURL(exported.file).href); await play(standalone, "standalone", mode === "free"); expect(requests.some((u) => /\/api\/|openrouter|provider/i.test(u))).toBe(false); } finally { await context.close(); }
        const server = createServer((req, res) => { const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = exported.files[path]; if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes)); });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address(), staticContext = await browser.newContext(), staticPage = await staticContext.newPage(), staticRequests: string[] = []; staticPage.on("request", (r) => staticRequests.push(r.url()));
        try { await staticPage.goto(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/nested/index.html`); await play(staticPage, "static", mode === "free"); expect(staticRequests.some((u) => /\/api\/|openrouter|provider/i.test(u))).toBe(false); }
        finally { await staticContext.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
      }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
