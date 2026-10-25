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
import { withAuthoredProgression } from "./helpers/progression.js";
import { imageMetadata } from "./helpers/image-assets.js";

test("W2 authors optional chapters/events and previews carry/expiry before offline standalone/static save-resume", async ({ page, browser, playwright }, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-w2-browser-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W2_DATABASE, assetStagingDirectory: process.env.W2_DIRECTORY,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W2_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W2_PROJECT_ID: projectId, W2_DIRECTORY: directory, W2_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`W2 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`W2 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      const unauthorized = await request.post("/mcp", { data: {} }); expect(unauthorized.status()).toBe(401);
      const crossOrigin = await request.post(`/api/long-form/projects/${projectId}/world/read_world`, { headers: { Origin: "https://other.invalid" }, data: {} }); expect(crossOrigin.status()).toBe(403);
      await call("create_project", { projectId, operationId: randomUUID(), name: "W2 Harbor District", approved: true });
      await completeConnectedTextGame(call, projectId);
      const bytes = townMap(); await writeFile(join(directory, "district.png"), bytes);
      const candidate = await call("import_staged_asset", { projectId, operationId: randomUUID(), approved: true, filename: "district.png", sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        metadata: { ...imageMetadata, title: "Harbor district map", altText: "Home, cafe and station along roads beside the harbor" } });
      const assetReview = await call("review_asset", { projectId, assetId: candidate.assetId, versionId: candidate.versionId });
      const approved = await call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: assetReview.fingerprint });
      let world = await withAuthoredProgression(call, projectId, await authoredWorld(call, projectId, { assetId: approved.assetId, versionId: approved.versionId }));
      // A valid ID inherited by ordinary objects must still execute in both exported players.
      world.progression!.transitions[0]!.id = "toString";
      const review = await call("review_world", { projectId, world }); expect(review.diagnostics.exhaustive).toBe(false);
      const input = { projectId, world, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true };
      const applied = await call("apply_world", input); expect(await call("apply_world", input)).toEqual(applied);
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); }, projectId);
      await page.goto(`${address}/#long-form`);
      const editor = page.getByRole("region", { name: "World authoring", exact: true });
      await expect(editor.getByLabel("Chapter name 1", { exact: true })).toHaveValue("Before dawn");
      await editor.getByText("Map preview", { exact: true }).click();
      const previewPanel = editor.getByRole("region", { name: "Locations and time", exact: true });
      await previewPanel.getByText("Map", { exact: true }).click();
      await expect(previewPanel.getByAltText("Home, cafe and station along roads beside the harbor")).toBeVisible();
      await editor.getByRole("combobox", { name: "Map artwork 1", exact: true }).selectOption("");
      await expect(editor.getByText("Map preview", { exact: true })).toBeVisible();
      await expect(previewPanel.locator("img")).toHaveCount(0);
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height }); await previewPanel.locator(".world-map").scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`w2-map-removed-${width}.png`) });
      }
      await editor.getByRole("combobox", { name: "Map artwork 1", exact: true }).selectOption(approved.versionId);
      await expect(previewPanel.getByAltText("Home, cafe and station along roads beside the harbor")).toBeVisible();
      const removeMilestone = editor.getByRole("button", { name: "Remove milestone 1", exact: true });
      const removeEvent = editor.getByRole("button", { name: "Remove event 2", exact: true });
      await expect(removeMilestone).toBeDisabled(); await expect(removeEvent).toBeDisabled();
      expect(await removeMilestone.evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent)).toContain("Event 1 (Read the signal notice): milestone grant");
      expect(await removeEvent.evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent)).toContain("Transition 1 (Begin the next chapter): event expiry");
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await editor.getByLabel("Milestone name 1", { exact: true }).evaluate((element) => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 130));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`w2-deletion-dependencies-${width}.png`) });
      }
      await removeEvent.evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: info.outputPath("w2-event-expiry-reference-390.png") });
      await editor.getByLabel("Grant Signal clue for event 1", { exact: true }).uncheck();
      await editor.getByLabel("Carry Signal clue at transition 1", { exact: true }).uncheck();
      await editor.getByRole("button", { name: "Remove Event 6 prerequisite 2", exact: true }).click();
      await editor.getByRole("button", { name: "Remove Transition 1 prerequisite 1", exact: true }).click();
      await expect(removeMilestone).toBeEnabled(); await removeMilestone.click();
      await editor.getByLabel("Expire A last conversation at transition 1", { exact: true }).uncheck();
      await expect(removeEvent).toBeEnabled(); await removeEvent.click();
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Apply world", exact: true })).toBeDisabled();
      await expect(editor.getByRole("alert")).toHaveCount(0);
      await editor.getByRole("button", { name: "Reload world", exact: true }).click();
      await expect(editor.getByLabel("Milestone name 1", { exact: true })).toHaveValue("Signal clue");
      await expect(editor.getByLabel("Event label 2", { exact: true })).toHaveValue("A last conversation");
      await editor.getByLabel("Chapters and events enabled", { exact: true }).uncheck();
      await editor.getByLabel("Chapters and events enabled", { exact: true }).check();
      await expect(editor.getByLabel("Chapter name 1", { exact: true })).toHaveValue("Chapter 1");
      await editor.getByRole("button", { name: "Reload world", exact: true }).click();
      await expect(editor.getByLabel("Chapter name 1", { exact: true })).toHaveValue("Before dawn");
      await editor.getByRole("textbox", { name: "Event result 1", exact: true }).fill("A proposed notebook clue.");
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Apply world", exact: true })).toBeDisabled();
      await editor.getByLabel("I approve this exact world and time definition.").check();
      const concurrent = structuredClone(world); concurrent.progression!.events[0]!.result = "A concurrent authored clue.";
      const concurrentReview = await call("review_world", { projectId, world: concurrent });
      await call("apply_world", { projectId, world: concurrent, operationId: randomUUID(), approved: true, fingerprint: concurrentReview.fingerprint });
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText("stale");
      await editor.getByRole("button", { name: "Reload world", exact: true }).click();
      await expect(editor.getByRole("textbox", { name: "Event result 1", exact: true })).toHaveValue("A concurrent authored clue.");
      await editor.getByRole("textbox", { name: "Event result 1", exact: true }).fill("The clue is copied into your notebook.");
      await editor.getByLabel("Milestone name 2", { exact: true }).fill("Farewell memory");
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await expect(editor.getByRole("region", { name: "Progression diagnostics" })).toContainText("not an exhaustive proof");
      await editor.getByLabel("I approve this exact world and time definition.").check();
      let lost = false;
      await page.route("**/world/apply_world", async (route) => { if (lost) { await route.continue(); return; } lost = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); });
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText(/fetch|network/i);
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged.");
      await page.unroute("**/world/apply_world"); world = (await call("read_world", { projectId })).world;
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height }); await editor.getByRole("region", { name: "Chapters and events", exact: true }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`w2-editor-${width}.png`), fullPage: true });
        await editor.getByRole("heading", { name: "Chapters and events", exact: true }).evaluate((element) => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 100));
        await page.screenshot({ path: info.outputPath(`w2-editor-controls-${width}.png`) });
      }
      const exportWorld = async (prefix: string) => {
        const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true);
        const build = await call("compile_game", { projectId, operationId: randomUUID(), approved: true, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint });
        const exported = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "standalone" });
        const html = await request.get(exported.downloadPath); await expect(html).toBeOK(); const file = join(directory, `${prefix}.html`); await writeFile(file, await html.body());
        const archive = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" });
        const zip = await request.get(archive.downloadPath); await expect(zip).toBeOK(); const files = unzipSync(await zip.body());
        const bundle = JSON.parse(Buffer.from(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]).toString());
        expect(bundle.world.assets).toHaveLength(1); expect(bundle.world.progression.schemaVersion).toBe(1);
        expect(JSON.stringify(bundle.world)).not.toMatch(/versionId|sourceName|sourceSha256|operationId|Author request|provenance/);
        return { file, files, bundle };
      };
      const chapterLed = await exportWorld("chapter-led");
      const free = structuredClone(world); free.progression!.chapters = []; free.progression!.initialChapterId = null; free.progression!.transitions = [];
      free.progression!.events = free.progression!.events.filter((event) => event.repeat.kind !== "once-per-chapter").map((event) => ({ ...event, prerequisites: event.prerequisites.filter((condition) => condition.kind !== "chapter") }));
      const freeReview = await call("review_world", { projectId, world: free }); await call("apply_world", { projectId, world: free, operationId: randomUUID(), approved: true, fingerprint: freeReview.fingerprint });
      await editor.getByRole("button", { name: "Reload world", exact: true }).click(); await expect(editor.getByText(/Chapter-free play: events/)).toBeVisible();
      await editor.getByRole("region", { name: "Chapters and events", exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath("w2-editor-chapter-free.png") });
      const chapterFree = await exportWorld("chapter-free");
      const backup = await request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const play = async (player: Page, surface: string, freeMode: boolean) => {
        const requests: string[] = []; player.on("request", (r) => requests.push(r.url()));
        const panel = player.getByRole("region", { name: "Locations and time", exact: true }), clock = panel.getByLabel("Game time");
        await expect(clock).toHaveText("Day 1 · 23:50");
        const confirm = async (label: string) => { await panel.getByRole("button", { name: label, exact: true }).click(); await player.getByRole("button", { name: "Confirm action", exact: true }).focus(); await player.keyboard.press("Enter"); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
        if (freeMode) {
          await expect(panel.getByText("Chapter-free play", { exact: true })).toBeVisible();
          await expect(panel.getByRole("navigation", { name: "Chapter transitions" }).getByRole("button")).toHaveCount(0);
          await confirm("Read the signal notice · 5 min"); await expect(clock).toHaveText("Day 1 · 23:55"); await player.reload();
          await expect(panel.getByText("Milestones: Signal clue, Farewell memory", { exact: true })).toBeVisible();
          for (const [width, height] of [[1280, 900], [390, 844]]) { await player.setViewportSize({ width, height }); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await panel.scrollIntoViewIfNeeded(); await player.screenshot({ path: info.outputPath(`w2-${surface}-free-${width}.png`), fullPage: true }); }
          return;
        }
        await expect(panel.getByText("Chapter: Before dawn", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Begin the next chapter · 5 min", exact: true })).toBeDisabled();
        await expect(panel.getByRole("button", { name: /Remember the crossing/ })).toHaveCount(0);
        await confirm("Read the signal notice · 5 min"); await expect(clock).toHaveText("Day 1 · 23:55");
        await confirm("Listen to the daily bell · 0 min"); await expect(panel.getByRole("button", { name: /Listen to the daily bell.*Already played today/ })).toBeDisabled();
        await confirm("Chapter check-in · 0 min"); await expect(panel.getByRole("button", { name: /Chapter check-in.*Already played in this chapter/ })).toBeDisabled();
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name").fill("Before crossing"); await player.getByRole("button", { name: "Create save", exact: true }).click();
        await panel.getByRole("button", { name: "Begin the next chapter · 5 min", exact: true }).click();
        const preview = player.getByRole("region", { name: "Chapter transition preview" });
        await expect(preview).toContainText("Milestones kept: Signal clue"); await expect(preview).toContainText("Milestones expiring: Farewell memory"); await expect(preview).toContainText("A last conversation: expires permanently");
        for (const [width, height] of [[1280, 900], [390, 844]]) { await player.setViewportSize({ width, height }); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await player.screenshot({ path: info.outputPath(`w2-${surface}-transition-preview-${width}.png`) }); }
        await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock).toHaveText("Day 1 · 23:55");
        await expect(panel.getByText("Chapter: Before dawn", { exact: true })).toBeVisible();
        await confirm("Begin the next chapter · 5 min"); await expect(clock).toHaveText("Day 2 · 00:00");
        await expect(panel.getByText("Chapter: After the crossing", { exact: true })).toBeVisible(); await expect(panel.getByText("Milestones: Signal clue", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: /A last conversation.*Expired/ })).toBeDisabled();
        await confirm("Listen to the daily bell · 0 min"); await confirm("Chapter check-in · 0 min"); await confirm("Remember the crossing · 0 min");
        await confirm("Rest · 0 min"); await expect(panel.getByRole("button", { name: /Rest.*Cooldown has not elapsed/ })).toBeDisabled();
        await confirm("Wait 15 min"); await confirm("Rest · 0 min"); await expect(clock).toHaveText("Day 2 · 00:15");
        await player.reload(); await expect(clock).toHaveText("Day 2 · 00:15"); await expect(panel.getByText("Chapter: After the crossing", { exact: true })).toBeVisible();
        for (const [width, height] of [[1280, 900], [390, 844]]) { await player.setViewportSize({ width, height }); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await panel.scrollIntoViewIfNeeded(); await player.screenshot({ path: info.outputPath(`w2-${surface}-second-chapter-${width}.png`), fullPage: true }); }
        await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect(panel.getByRole("button", { name: "Rest · 0 min", exact: true })).toBeEnabled();
        await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click();
        await expect(clock).toHaveText("Day 1 · 23:55"); await expect(panel.getByText("Chapter: Before dawn", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "A last conversation · 0 min", exact: true })).toBeEnabled();
        await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Restart game", exact: true }).click();
        await expect(clock).toHaveText("Day 1 · 23:50"); await expect(panel.getByText("Milestones: None yet", { exact: true })).toBeVisible();
        expect(requests.some((url) => /\/api\/|openrouter|provider/i.test(url))).toBe(false);
      };
      for (const [mode, exported] of [["chapters", chapterLed], ["free", chapterFree]] as const) {
        const context = await browser.newContext(), standalone = await context.newPage();
        try { await standalone.goto(pathToFileURL(exported.file).href); await play(standalone, "standalone", mode === "free"); } finally { await context.close(); }
        const server = createServer((req, res) => { const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = exported.files[path]; if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes)); });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address(), staticContext = await browser.newContext(), staticPage = await staticContext.newPage();
        try { await staticPage.goto(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/nested/index.html`); await play(staticPage, "static", mode === "free"); }
        finally { await staticContext.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
      }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
