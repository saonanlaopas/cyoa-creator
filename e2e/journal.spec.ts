import { actNativePlayerWorld, createNativePlayerConfig, createNativePlayerSession, type WorldCommand } from "@story-to-cyoa/runtime";
import { expect, test, type Page, type Locator } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { unzipSync } from "fflate";
import { authoredWorld } from "./helpers/world.js";
import { withAuthoredJournal } from "./helpers/journal.js";
import { completeEconomyTextGame, withAuthoredEconomy } from "./helpers/economy.js";

test("W5 authors visibility with stale edits and retries, then uses character and journal offline", async ({ page, browser, playwright }, info) => {
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
      await call("create_project", { projectId, operationId: randomUUID(), name: "W5 Harbor Journal", approved: true }); await completeEconomyTextGame(call, projectId);
      let world = await withAuthoredJournal(call, projectId, await withAuthoredEconomy(call, projectId, await authoredWorld(call, projectId)));
      const apply = async (w: typeof world) => { const r = await call("review_world", { projectId, world: w }); return call("apply_world", { projectId, world: w, fingerprint: r.fingerprint, operationId: randomUUID(), approved: true }); };
      await apply(world);
      const options = await call("read_world", { projectId });
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); }, projectId);
      await page.goto(`${address}/#long-form`); const editor = page.getByRole("region", { name: "World authoring", exact: true });
      await expect(editor.getByLabel(`Show Stat ${options.statOptions[0].label}`, { exact: true })).toBeChecked(); await expect(editor.getByLabel(`Show Stat ${options.statOptions[1].label}`, { exact: true })).not.toBeChecked();
      await expect(editor.getByRole("button", { name: "Remove event 1", exact: true })).toBeDisabled();
      await editor.getByLabel("Entry 1 title", { exact: true }).fill("A revised signal"); await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      const external = structuredClone(world); external.journal!.entries[0]!.text = "A brief lamp flashed before midnight."; await apply(external);
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText("stale");
      await page.screenshot({ path: info.outputPath("w5-creator-stale.png"), fullPage: true });
      await editor.getByRole("button", { name: "Reload world", exact: true }).click(); await expect(editor.getByRole("textbox", { name: "Entry 1 text", exact: true })).toHaveValue("A brief lamp flashed before midnight.");
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      await editor.getByRole("textbox", { name: "Entry 2 text", exact: true }).fill("Mara trusts you with the signal ledger."); await expect(editor.getByRole("button", { name: "Apply world", exact: true })).toHaveCount(0);
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      const payloads: any[] = []; await page.route("**/world/apply_world", async (route) => { payloads.push(route.request().postDataJSON()); if (payloads.length === 1) { const applied = await route.fetch(); expect(applied.ok()).toBe(true); await route.abort("failed"); } else await route.continue(); });
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText(/fetch|network/i); const committed = (await call("read_world", { projectId })).versionId;
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged."); expect(payloads).toHaveLength(2); expect(payloads[0]).toEqual(payloads[1]); expect((await call("read_world", { projectId })).versionId).toBe(committed); await page.unroute("**/world/apply_world");
      world = (await call("read_world", { projectId })).world;
      for (const [width, height] of [[1280, 900], [390, 844]]) { await page.setViewportSize({ width, height }); for (const [name, file] of [["Character visibility", "character"], ["Authored journal entries", "entries"], ["Objectives", "objectives"]]) { await editor.getByRole("heading", { name, exact: true }).evaluate((el) => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 120)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath(`w5-creator-${file}-${width}.png`) }); } }
      const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true); const build = await call("compile_game", { projectId, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, operationId: randomUUID(), approved: true });
      const htmlExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "standalone" }), html = await request.get(htmlExport.downloadPath); await expect(html).toBeOK(); const file = join(directory, "journal.html"); await writeFile(file, await html.body());
      const staticExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" }), zip = await request.get(staticExport.downloadPath); await expect(zip).toBeOK(); const files = unzipSync(await zip.body()), bundle = JSON.parse(Buffer.from(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]).toString());
      const config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle), initial = createNativePlayerSession(bundle, config), commands: WorldCommand[] = [{ kind: "wait", minutes: 5 }, { kind: "purchase", id: "buy-tea" }, { kind: "gift", id: "gift-tea" }];
      const afterGift = commands.reduce((s, c) => actNativePlayerWorld(bundle, config, s, c).session, initial), final = actNativePlayerWorld(bundle, config, afterGift, { kind: "event", id: "hello" }).session;
      expect(afterGift.state.relationships.relationship_1).toBe(2); expect(final.state.world!.journal!.completedObjectiveIds).toEqual(["ledger", "share"]);
      const projected = await call("inspect_world_journal", { projectId, state: final.state }); expect(projected.events).toMatchObject([{ id: "hello", count: 1 }]); expect(JSON.stringify(projected)).not.toMatch(/Undisclosed/);
      const backup = await request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const readSave = (player: Page) => player.evaluate(async () => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("story-to-cyoa-native-player-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); try { return await new Promise<any>((resolve, reject) => { const r = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll(); r.onsuccess = () => resolve(r.result[0]?.value); r.onerror = () => reject(r.error); }); } finally { db.close(); } });
      const play = async (player: Page, surface: string, width: number) => {
        player.setDefaultTimeout(15000); const views = player.getByRole("region", { name: "World views", exact: true }), nav = player.getByRole("navigation", { name: "World views", exact: true });
        const show = async (name: string) => { await nav.getByRole("button", { name, exact: true }).click(); }; const clock = () => views.getByLabel("Game time");
        const confirm = async (button: Locator) => { await button.click(); await player.getByRole("button", { name: "Confirm action", exact: true }).click(); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
        const noSecrets = async () => { expect(await views.innerText()).not.toMatch(/Undisclosed/); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          const contrast = await views.locator("article").evaluateAll((cards) => { const luminance = (value: string) => { const rgb = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722; }; return cards.flatMap((card) => { const bg = luminance(getComputedStyle(card).backgroundColor); return [...card.querySelectorAll("h5,p,small")].map((text) => { const fg = luminance(getComputedStyle(text).color); return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); }); }); });
          expect(contrast.every((ratio) => ratio >= 4.5)).toBe(true);
        };
        await expect(clock()).toHaveText("Day 1 · 23:50"); await expect(views.getByRole("button", { name: /^Station/ })).toHaveCount(0);
        await nav.getByRole("button", { name: "Explore", exact: true }).focus(); await player.keyboard.press("Tab"); await expect(nav.getByRole("button", { name: "Character", exact: true })).toBeFocused(); await player.keyboard.press("Space"); await expect(views.getByRole("heading", { name: "Character", level: 3 })).toBeFocused();
        await expect(player.getByRole("region", { name: "Choices", exact: true })).toHaveCount(0); await expect(views.getByText("Trust with Mara", { exact: true })).toHaveCount(0); await expect(views.getByText(options.statOptions[0].label, { exact: true })).toBeVisible(); await expect(views.getByText(options.statOptions[1].label, { exact: true })).toHaveCount(0);
        await player.keyboard.press("Tab"); await expect(views.getByRole("button", { name: "Back to exploration", exact: true })).toBeFocused(); await player.keyboard.press("Enter"); await expect(nav.getByRole("button", { name: "Explore", exact: true })).toBeFocused();
        await show("Journal"); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("Share a warm parcel"); await expect(views.getByText("Discuss the ledger", { exact: true })).toHaveCount(0); await views.getByRole("button", { name: "Places", exact: true }).click(); await expect(views.getByRole("region", { name: "Discovered locations" })).not.toContainText("Station");
        await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByText("No journal entries recorded.", { exact: true })).toBeVisible(); await noSecrets(); await player.keyboard.press("Escape"); await expect(nav.getByRole("button", { name: "Explore", exact: true })).toBeFocused();
        await views.getByRole("button", { name: "Wait 5 min", exact: true }).click(); await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock()).toHaveText("Day 1 · 23:50"); expect(await readSave(player)).toBeUndefined();
        await confirm(views.getByRole("button", { name: "Wait 5 min", exact: true })); await show("Journal"); await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByText("A fleeting signal", { exact: true })).toBeVisible(); await expect(views.getByText("A brief lamp flashed before midnight.", { exact: true })).toBeVisible(); await noSecrets();
        await show("Shops here"); await confirm(views.getByRole("button", { name: "Buy 1 Tea · 4 Coins · 2 min", exact: true })); await show("Give a gift"); await confirm(views.getByRole("button", { name: "Share tea · 1 Tea to Mara · 1 min", exact: true })); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterGift.state);
        await show("Character"); await expect(views.getByText("Trust with Mara", { exact: true })).toBeVisible(); await expect(player.getByRole("heading", { name: "Status", exact: true })).toHaveCount(0); await noSecrets(); await player.screenshot({ path: info.outputPath(`w5-${surface}-character-${width}.png`), fullPage: true });
        await show("Journal"); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("Discuss the ledger"); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("Completed objectives"); await noSecrets(); await player.screenshot({ path: info.outputPath(`w5-${surface}-objectives-${width}.png`), fullPage: true });
        await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByRole("region", { name: "Journal entries", exact: true })).toContainText("Mara trusts you with the signal ledger."); await player.screenshot({ path: info.outputPath(`w5-${surface}-entries-${width}.png`), fullPage: true });
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name").fill("After gift"); await player.getByRole("button", { name: "Create save", exact: true }).click(); await player.reload(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterGift.state);
        const ledger = () => views.getByRole("button", { name: /^Discuss the ledger · 0 min/ }); await confirm(ledger()); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state); await expect(ledger()).toBeDisabled();
        await show("Journal"); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("No active objectives disclosed."); await views.getByRole("button", { name: "Events", exact: true }).click(); await expect(views.getByRole("region", { name: "Recorded events", exact: true })).toContainText("Completed 1 time"); await expect(views.getByRole("heading", { name: "Discuss the ledger", exact: true })).toHaveCount(1); await noSecrets(); await player.screenshot({ path: info.outputPath(`w5-${surface}-events-${width}.png`), fullPage: true });
        await views.getByRole("button", { name: "Places", exact: true }).click(); await expect(views.getByRole("region", { name: "Discovered locations" })).toContainText("Station");
        await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterGift.state); await expect(views.getByRole("region", { name: "Discovered locations" })).not.toContainText("Station");
        await show("Explore"); await confirm(ledger()); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state);
        await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(afterGift.state); await show("Explore"); await confirm(ledger()); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state); await player.reload(); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state);
        await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state);
        await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Restart game", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(initial.state); await show("Journal"); await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByText("No journal entries recorded.", { exact: true })).toBeVisible(); await noSecrets(); await expect(player.getByRole("alert")).toHaveCount(0);
      };
      const server = createServer((req, res) => { const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = files[path]; if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes)); }); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address();
      try { for (const surface of ["standalone", "static"]) for (const [width, height] of [[1280, 900], [390, 844]]) { const context = await browser.newContext({ viewport: { width, height } }), player = await context.newPage(), requests: string[] = []; player.on("request", (r) => requests.push(r.url())); try { await player.goto(surface === "standalone" ? pathToFileURL(file).href : `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/nested/index.html`); await play(player, surface, width); expect(requests.some((u) => /\/api\/|openrouter|provider/i.test(u))).toBe(false); } finally { await context.close(); } } } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { await request.dispose(); }
  } finally { if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); await rm(directory, { recursive: true, force: true }); }
});
