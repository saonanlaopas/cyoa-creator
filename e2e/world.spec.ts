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
import { imageMetadata } from "./helpers/image-assets.js";

test("W1 reviews shared world operations and travels home/cafe/station with free maps, midnight and offline save/resume", async ({ page, browser, playwright }, info) => {
  test.setTimeout(120000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-w1-browser-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W1_DATABASE, assetStagingDirectory: process.env.W1_DIRECTORY,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W1_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W1_PROJECT_ID: projectId, W1_DIRECTORY: directory, W1_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`W1 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`W1 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      const unauthorized = await request.post("/mcp", { data: {} }); expect(unauthorized.status()).toBe(401);
      const crossOrigin = await request.post(`/api/long-form/projects/${projectId}/world/read_world`, { headers: { Origin: "https://other.invalid" }, data: {} }); expect(crossOrigin.status()).toBe(403);
      await call("create_project", { projectId, operationId: randomUUID(), name: "W1 Harbor District", approved: true });
      await completeConnectedTextGame(call, projectId);
      const bytes = townMap(); await writeFile(join(directory, "district.png"), bytes);
      const candidate = await call("import_staged_asset", { projectId, operationId: randomUUID(), approved: true, filename: "district.png", sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        metadata: { ...imageMetadata, title: "Harbor district map", altText: "Home, cafe and station along roads beside the harbor" } });
      const assetReview = await call("review_asset", { projectId, assetId: candidate.assetId, versionId: candidate.versionId });
      const approved = await call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: assetReview.fingerprint });
      const world = await authoredWorld(call, projectId, { assetId: approved.assetId, versionId: approved.versionId });
      const review = await call("review_world", { projectId, world });
      expect((await call("read_world", { projectId })).versionId).toBeNull();
      const input = { projectId, operationId: randomUUID(), approved: true, world, fingerprint: review.fingerprint };
      const applied = await call("apply_world", input); expect(await call("apply_world", input)).toEqual(applied);
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); }, projectId);
      await page.goto(`${address}/#long-form`);
      const editor = page.getByRole("region", { name: "World authoring", exact: true });
      await expect(editor.getByLabel("Location name 1", { exact: true })).toHaveValue("Harbor district");
      await expect(editor.getByLabel("Travel minutes 1", { exact: true })).toHaveValue("15");
      await editor.getByLabel("Action minutes 1", { exact: true }).fill("7");
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Apply world" })).toBeDisabled();
      await editor.getByLabel("I approve this exact world and time definition.").check();
      const concurrent = { ...world, initialMinutes: 1420 }, concurrentReview = await call("review_world", { projectId, world: concurrent });
      await call("apply_world", { projectId, operationId: randomUUID(), approved: true, world: concurrent, fingerprint: concurrentReview.fingerprint });
      await editor.getByRole("button", { name: "Apply world" }).click();
      await expect(editor.getByRole("alert")).toContainText("stale");
      await editor.getByRole("button", { name: "Reload world" }).click();
      await expect(editor.getByLabel("Initial game minutes")).toHaveValue("1420");
      await editor.getByLabel("Initial game minutes").fill("1430"); await editor.getByLabel("Action minutes 1", { exact: true }).fill("7");
      await editor.getByRole("button", { name: "Review world", exact: true }).click();
      await editor.getByLabel("I approve this exact world and time definition.").check();
      let lost = false;
      await page.route("**/world/apply_world", async (route) => { if (lost) { await route.continue(); return; } lost = true; const result = await route.fetch(); expect(result.ok()).toBe(true); await route.abort("failed"); });
      await editor.getByRole("button", { name: "Apply world" }).click(); await expect(editor.getByRole("alert")).toContainText(/fetch|network/i);
      await editor.getByRole("button", { name: "Apply world" }).click();
      await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged."); await page.unroute("**/world/apply_world");
      await editor.getByText("Map preview", { exact: true }).click(); await editor.getByText("Map", { exact: true }).click();
      await expect(editor.getByRole("img")).toHaveJSProperty("naturalWidth", 640);
      await editor.getByRole("button", { name: "Inspect Station", exact: true }).click();
      await expect(editor.getByRole("region", { name: "Destination" })).toContainText("Station");
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height }); await editor.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`w1-editor-${width}.png`), fullPage: true });
      }
      const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true);
      const compiled = await call("compile_game", { projectId, operationId: randomUUID(), headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, approved: true });
      const standalone = await call("export_game", { projectId, buildVersionId: compiled.buildVersionId, format: "standalone" });
      const html = await request.get(standalone.downloadPath); await expect(html).toBeOK();
      const file = join(directory, "world.html"); await writeFile(file, await html.body());
      const exported = await call("export_game", { projectId, buildVersionId: compiled.buildVersionId, format: "static" });
      const zip = await request.get(exported.downloadPath); await expect(zip).toBeOK(); const files = unzipSync(await zip.body());
      const bundle = JSON.parse(Buffer.from(Object.entries(files).find(([p]) => p.endsWith("game.json"))![1]).toString());
      expect(bundle.world.assets).toHaveLength(1); expect(bundle.initialState.world).toMatchObject({ locationId: "home", minutes: 1430 });
      expect(JSON.stringify(bundle.world)).not.toMatch(/sourceName|sourceSha256|operationId|Author request|provenance/);
      const backup = await request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const play = async (player: Page, label: string) => {
        const requests: string[] = []; player.on("request", (r) => requests.push(r.url()));
        const worldPanel = player.getByRole("region", { name: "Locations and time", exact: true }), clock = worldPanel.getByLabel("Game time");
        await expect(clock).toHaveText("Day 1 · 23:50");
        await worldPanel.getByText("Map", { exact: true }).click();
        await worldPanel.getByRole("button", { name: "Inspect Cafe", exact: true }).click();
        await expect(worldPanel.getByRole("region", { name: "Destination" })).toContainText("Cafe"); await expect(clock).toHaveText("Day 1 · 23:50");
        for (const [width, height] of [[1280, 900], [390, 844]]) {
          await player.setViewportSize({ width, height });
          await expect(worldPanel.getByRole("img")).toHaveJSProperty("naturalWidth", 640);
          const geometry = await worldPanel.locator(".world-map").evaluate((map) => { const r = map.getBoundingClientRect(); return [...map.querySelectorAll("button")].map((b) => { const p = b.getBoundingClientRect(); return p.width > 0 && p.height > 0 && p.left >= r.left && p.right <= r.right && p.top >= r.top && p.bottom <= r.bottom; }); });
          expect(geometry).toEqual([true, true, true]); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await worldPanel.scrollIntoViewIfNeeded(); await player.screenshot({ path: info.outputPath(`w1-${label}-map-${width}.png`), fullPage: true });
        }
        await worldPanel.getByRole("navigation", { name: "Travel", exact: true }).getByRole("button", { name: "Cafe · 15 min", exact: true }).click();
        await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock).toHaveText("Day 1 · 23:50");
        const confirm = async () => { await player.getByRole("button", { name: "Confirm action", exact: true }).focus(); await player.keyboard.press("Enter"); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
        await worldPanel.getByRole("navigation", { name: "Travel", exact: true }).getByRole("button", { name: "Cafe · 15 min", exact: true }).click(); await confirm();
        await expect(clock).toHaveText("Day 2 · 00:05"); await expect(worldPanel.locator("header strong")).toHaveText("Cafe");
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name").fill("Midnight cafe"); await player.getByRole("button", { name: "Create save", exact: true }).click();
        await player.reload(); await expect(clock).toHaveText("Day 2 · 00:05");
        await worldPanel.getByRole("button", { name: "Station · 10 min", exact: true }).click(); await confirm();
        await expect(clock).toHaveText("Day 2 · 00:15"); await expect(worldPanel.locator("header strong")).toHaveText("Station");
        await worldPanel.getByRole("button", { name: "Read departure board · 7 min", exact: true }).click(); await confirm();
        await expect(clock).toHaveText("Day 2 · 00:22"); await expect(player.getByRole("status")).toContainText("The early train leaves at dawn.");
        await worldPanel.getByRole("button", { name: "Wait 15 min", exact: true }).click(); await confirm(); await expect(clock).toHaveText("Day 2 · 00:37");
        await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect(clock).toHaveText("Day 2 · 00:22");
        await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click();
        await expect(clock).toHaveText("Day 2 · 00:05"); await expect(worldPanel.locator("header strong")).toHaveText("Cafe");
        await worldPanel.getByRole("button", { name: "Home · 15 min", exact: true }).click(); await confirm(); await expect(clock).toHaveText("Day 2 · 00:20");
        for (let i = 0; i < 2; i++) { await worldPanel.getByRole("button", { name: "Wait 60 min", exact: true }).click(); await confirm(); }
        await expect(worldPanel.getByRole("button", { name: "Cafe · 15 min · Closed at arrival", exact: true })).toBeDisabled();
        expect(requests.some((url) => /\/api\/|openrouter|provider/i.test(url))).toBe(false);
      };
      const offline = await browser.newContext(), standalonePage = await offline.newPage();
      try { await standalonePage.goto(pathToFileURL(file).href); await play(standalonePage, "standalone"); } finally { await offline.close(); }
      const staticServer = createServer((req, res) => {
        const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = files[path];
        if (!bytes) { res.writeHead(404); res.end(); return; }
        res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes));
      });
      await new Promise<void>((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
      const socket = staticServer.address(), context = await browser.newContext(), staticPage = await context.newPage();
      try { await staticPage.goto(`http://127.0.0.1:${typeof socket === "object" && socket ? socket.port : 0}/nested/index.html`); await play(staticPage, "static"); }
      finally { await context.close(); await new Promise<void>((resolve) => staticServer.close(() => resolve())); }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
