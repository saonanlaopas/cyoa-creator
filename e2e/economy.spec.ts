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
import { completeEconomyTextGame, withAuthoredEconomy } from "./helpers/economy.js";

test("W4 authors trade with stale edits and safe retries, then plays atomic inventory and shops offline", async ({ page, browser, playwright }, info) => {
  test.setTimeout(300000); page.setDefaultTimeout(15000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-w4-browser-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.W4_DATABASE,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.W4_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, W4_PROJECT_ID: projectId, W4_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`W4 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`W4 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      await call("create_project", { projectId, operationId: randomUUID(), name: "W4 Harbor Trade", approved: true }); await completeEconomyTextGame(call, projectId);
      let world = await withAuthoredEconomy(call, projectId, await authoredWorld(call, projectId));
      const apply = async (w: typeof world) => { const review = await call("review_world", { projectId, world: w }); return call("apply_world", { projectId, world: w, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true }); };
      await apply(world);
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); }, projectId);
      await page.goto(`${address}/#long-form`);
      const editor = page.getByRole("region", { name: "World authoring", exact: true });
      await expect(editor.getByLabel("Starting currency", { exact: true })).toHaveValue("20");
      await expect(editor.getByRole("button", { name: "Remove item 1", exact: true })).toBeDisabled();
      await expect(editor.getByRole("button", { name: "Remove person 1", exact: true })).toBeDisabled();
      await expect(editor.getByRole("button", { name: "Remove event 1", exact: true })).toBeDisabled();
      await expect(editor.getByRole("combobox", { name: "Gift 1 relationship 1", exact: true })).toHaveValue("relationship_1");
      await editor.getByLabel("Shop 1 offer 1 price", { exact: true }).fill("3");
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      const external = structuredClone(world); external.economy!.currency.maximum = 101; await apply(external);
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText("stale");
      await page.screenshot({ path: info.outputPath("w4-creator-stale.png"), fullPage: true });
      await editor.getByRole("button", { name: "Reload world", exact: true }).click(); await expect(editor.getByLabel("Shop 1 offer 1 price", { exact: true })).toHaveValue("4");
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      await editor.getByLabel("Gift 1 result", { exact: true }).fill("Mara welcomes the shared tea."); await expect(editor.getByRole("button", { name: "Apply world", exact: true })).toHaveCount(0);
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      const payloads: any[] = [];
      await page.route("**/world/apply_world", async (route) => { payloads.push(route.request().postDataJSON()); if (payloads.length === 1) { const applied = await route.fetch(); expect(applied.ok()).toBe(true); await route.abort("failed"); } else await route.continue(); });
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText(/fetch|network/i);
      const committed = (await call("read_world", { projectId })).versionId;
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged.");
      expect(payloads).toHaveLength(2); expect(payloads[0]).toEqual(payloads[1]); expect((await call("read_world", { projectId })).versionId).toBe(committed); await page.unroute("**/world/apply_world");
      world = (await call("read_world", { projectId })).world;
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        for (const [name, file] of [["Inventory and shops", "items"], ["Items", "quantities"], ["Shops", "shop"]]) {
          await editor.getByRole("heading", { name, exact: true }).evaluate((el) => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 120));
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath(`w4-creator-${file}-${width}.png`) });
        }
      }
      const ready = await call("publication_readiness", { projectId }); expect(ready.ready).toBe(true);
      const build = await call("compile_game", { projectId, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, operationId: randomUUID(), approved: true });
      const htmlExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "standalone" }), html = await request.get(htmlExport.downloadPath); await expect(html).toBeOK();
      const file = join(directory, "trade.html"); await writeFile(file, await html.body());
      const staticExport = await call("export_game", { projectId, buildVersionId: build.buildVersionId, format: "static" }), zip = await request.get(staticExport.downloadPath); await expect(zip).toBeOK();
      const files = unzipSync(await zip.body()), bundle = JSON.parse(Buffer.from(Object.entries(files).find(([path]) => path.endsWith("game.json"))![1]).toString());
      const config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle), initial = createNativePlayerSession(bundle, config);
      const commands: WorldCommand[] = [{ kind: "wait", minutes: 5 }, ...Array.from({ length: 3 }, (): WorldCommand => ({ kind: "purchase", id: "buy-tea" })), { kind: "gift", id: "gift-tea" }, { kind: "use", id: "drink-tea" }, { kind: "event", id: "hello" }, { kind: "wait", minutes: 5 }, { kind: "use", id: "drink-tea" }];
      const later: WorldCommand[] = [{ kind: "wait", minutes: 15 }, { kind: "wait", minutes: 5 }, { kind: "wait", minutes: 5 }, { kind: "wait", minutes: 1440 }, { kind: "gift", id: "gift-tea" }];
      const expected = commands.reduce((s, c) => actNativePlayerWorld(bundle, config, s, c).session, initial), final = later.reduce((s, c) => actNativePlayerWorld(bundle, config, s, c).session, expected);
      expect(expected.state.world!.economy).toMatchObject({ currency: 15, items: { tea: 1 } }); expect(final.state.relationships.relationship_1).toBe(4);
      const projected = await call("inspect_world_economy", { projectId, state: expected.state }); expect(projected.shops[0].offers[0].stock).toBe(0);
      const backup = await request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const readSave = (player: Page) => player.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("story-to-cyoa-native-player-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise<any>((resolve, reject) => { const r = database.transaction("autosaves", "readonly").objectStore("autosaves").getAll(); r.onsuccess = () => resolve(r.result[0]?.value); r.onerror = () => reject(r.error); }); } finally { database.close(); }
      });
      const play = async (player: Page, surface: string, width: number) => {
        player.setDefaultTimeout(15000);
        const panel = player.getByRole("region", { name: "Locations and time", exact: true }), trade = panel.getByRole("region", { name: "Inventory and shops", exact: true }), clock = panel.getByLabel("Game time");
        const confirm = async (button: Locator) => { await button.click(); await player.getByRole("button", { name: "Confirm action", exact: true }).click(); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
        const wait = (minutes: number) => confirm(panel.getByRole("button", { name: `Wait ${minutes} min`, exact: true }));
        const show = async (name: string) => { const b = trade.getByRole("button", { name, exact: true }); if (await b.getAttribute("aria-pressed") !== "true") await b.click(); };
        const buy = () => trade.getByRole("button", { name: "Buy 1 Tea · 4 Coins · 2 min", exact: true });
        const gift = () => trade.getByRole("button", { name: "Share tea · 1 Tea to Mara · 1 min", exact: true });
        const use = () => trade.getByRole("button", { name: "Drink tea · 1 Tea · 1 min · Gain 1 Coins", exact: true });
        await expect(clock).toHaveText("Day 1 · 23:50"); await show("Shops here"); await expect(buy()).toBeDisabled(); await expect(trade.getByText("Shop is closed during this purchase").first()).toBeVisible();
        await show("Inventory"); await expect(trade.getByText("Tea × 1", { exact: true })).toBeVisible(); await show("Give a gift"); await expect(gift()).toBeEnabled(); await expect(clock).toHaveText("Day 1 · 23:50");
        await wait(5); await show("Shops here"); await buy().click(); await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(clock).toHaveText("Day 1 · 23:55"); await expect(trade).toContainText("Coins: 20");
        for (let n = 0; n < 3; n++) await confirm(buy());
        await expect(clock).toHaveText("Day 2 · 00:01"); await expect(trade).toContainText("Coins: 8"); await expect(buy()).toBeDisabled(); await expect(trade.getByText("Out of stock", { exact: true })).toBeVisible();
        await expect(trade.getByRole("button", { name: "Buy 1 Ticket · 30 Coins · 0 min", exact: true })).toBeDisabled();
        expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await player.screenshot({ path: info.outputPath(`w4-${surface}-stock-${width}.png`), fullPage: true });
        await show("Give a gift"); await confirm(gift()); await expect(gift()).toBeDisabled(); await expect(trade.getByText("Already completed today", { exact: true })).toBeVisible();
        await player.screenshot({ path: info.outputPath(`w4-${surface}-gift-limit-${width}.png`), fullPage: true });
        await show("Inventory"); await confirm(use()); await expect(use()).toBeDisabled();
        await confirm(panel.getByRole("button", { name: /^Discuss the ledger · 0 min/ })); await expect(panel).toContainText("Milestones: Signal clue");
        await wait(5); await confirm(use()); await expect(clock).toHaveText("Day 2 · 00:09"); await expect(trade).toContainText("Coins: 15"); await expect(trade.getByText("Tea × 1", { exact: true })).toBeVisible();
        await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.state);
        await player.screenshot({ path: info.outputPath(`w4-${surface}-inventory-${width}.png`), fullPage: true });
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name").fill("After trade"); await player.getByRole("button", { name: "Create save", exact: true }).click();
        await player.reload(); await expect(clock).toHaveText("Day 2 · 00:09"); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.state);
        const finish = async () => { await wait(15); await wait(5); await show("Shops here"); await expect(trade.getByRole("button", { name: "Buy 1 Ticket · 0 Coins · 2 min", exact: true })).toBeDisabled(); await expect(clock).toHaveText("Day 2 · 00:29"); await expect(trade.getByText("Shop is closed during this purchase", { exact: true })).toBeVisible(); await wait(5); await wait(1440); await show("Give a gift"); await expect(gift()).toBeEnabled(); await confirm(gift()); };
        await finish(); await expect(clock).toHaveText("Day 3 · 00:35"); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state);
        await show("Inventory"); await expect(trade.getByText("No items held.", { exact: true })).toBeVisible(); await expect(trade.getByRole("button", { name: /^Drink tea/ })).toHaveCount(0);
        await player.screenshot({ path: info.outputPath(`w4-${surface}-gift-repeat-${width}.png`), fullPage: true });
        await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click(); await expect(clock).toHaveText("Day 2 · 00:09");
        await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.state); await finish(); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state);
        await player.reload(); await expect(clock).toHaveText("Day 3 · 00:35"); await expect.poll(async () => (await readSave(player))?.state).toEqual(final.state);
        await expect(player.getByRole("alert")).toHaveCount(0);
      };
      const server = createServer((req, res) => { const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = files[path]; if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes)); });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address();
      try {
        for (const surface of ["standalone", "static"]) for (const [width, height] of [[1280, 900], [390, 844]]) {
          const context = await browser.newContext({ viewport: { width, height } }), player = await context.newPage(), requests: string[] = []; player.on("request", (r) => requests.push(r.url()));
          try { await player.goto(surface === "standalone" ? pathToFileURL(file).href : `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/nested/index.html`); await play(player, surface, width); expect(requests.some((u) => /\/api\/|openrouter|provider/i.test(u))).toBe(false); }
          finally { await context.close(); }
        }
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
