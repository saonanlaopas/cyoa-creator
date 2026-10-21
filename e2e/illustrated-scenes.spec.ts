import { expect, test, type Locator } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { unzipSync } from "fflate";
import { completeConnectedTextGame } from "./helpers/connected-text-game.js";
import { fixtureImage, imageMetadata } from "./helpers/image-assets.js";
import { portraitImage } from "./helpers/illustrated-assets.js";

const portraitOrders = [
  ["right", "left"], ["right", "center", "left"], ["left", "center", "right"],
  ["left", "right", "center"], ["center", "left", "right"], ["center", "right", "left"],
  ["right", "left", "center"], ["center", "left"],
] as const;
async function expectPortraitRow(scene: Locator, positions: readonly string[]) {
  await expect(scene.locator(".scene-portrait")).toHaveCount(positions.length);
  await expect(scene.locator(".scene-character img")).toHaveCount(positions.length);
  for (const image of await scene.locator(".scene-character img").all()) await expect(image).toHaveJSProperty("naturalWidth", 180);
  const bounds = await scene.locator(".scene-stage").evaluate((stage) => {
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { stage: rect(stage), portraits: [...stage.querySelectorAll(".scene-portrait")].map((portrait) => ({
      className: portrait.className, ...rect(portrait), content: [...portrait.querySelectorAll("img,figcaption")].map(rect),
    })) };
  });
  expect(bounds.stage.height).toBeGreaterThan(0);
  for (const [i, portrait] of bounds.portraits.entries()) {
    expect(portrait.className).toContain(`scene-portrait-${positions[i]}`);
    const column = ["left", "center", "right"].indexOf(positions[i]!);
    expect(Math.abs(portrait.x - (bounds.stage.x + column * bounds.stage.width / 3))).toBeLessThanOrEqual(1);
    for (const box of [portrait, ...portrait.content]) {
      expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(bounds.stage.x - 1); expect(box.right).toBeLessThanOrEqual(bounds.stage.right + 1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.stage.y - 1); expect(box.bottom).toBeLessThanOrEqual(bounds.stage.bottom + 1);
    }
    expect(Math.abs(portrait.y - bounds.portraits[0]!.y)).toBeLessThanOrEqual(1);
  }
}

test("V2 reviews browser scenes, replays lost Apply and plays packaged backgrounds, expressions and authored choices offline", async ({ page, browser, playwright }, info) => {
  test.setTimeout(120000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "cyoa-v2-browser-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.V2_DATABASE, assetStagingDirectory: process.env.V2_DIRECTORY,
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.V2_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, V2_PROJECT_ID: projectId, V2_DIRECTORY: directory, V2_DATABASE: join(directory, "project.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`V2 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item.address); } } catch { /* Complete startup record only. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`V2 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      await call("create_project", { projectId, operationId: randomUUID(), name: "V2 Illustrated Harbor", approved: true });
      const proof = await completeConnectedTextGame(call, projectId);
      const importImage = async (filename: string, bytes: Buffer, title: string, altText: string) => {
        await writeFile(join(directory, filename), bytes);
        const candidate = await call("import_staged_asset", { projectId, operationId: randomUUID(), approved: true, filename,
          sourceSha256: createHash("sha256").update(bytes).digest("hex"), metadata: { ...imageMetadata, title, altText } });
        const review = await call("review_asset", { projectId, assetId: candidate.assetId, versionId: candidate.versionId });
        const approved = await call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
        return { assetId: approved.assetId, versionId: approved.versionId };
      };
      const harbor = await importImage("harbor.png", fixtureImage(), "Harbor daylight", "Red signal tower over blue harbor water");
      const concerned = await importImage("mira.png", portraitImage(), "Mira concerned", "Mira in a green coat, concerned expression");
      const smiling = await importImage("mira-smile.png", portraitImage(true), "Mira relieved", "Mira in a red coat, relieved expression");
      const ordersByPassage = new Map<string, readonly string[]>(), titles = new Map<string, string>();
      for (const [i, passage] of proof.passages.entries()) {
        const state = await call("read_scene", { projectId, passageId: passage.entityId }), ending = passage.entityId.startsWith("passage-ending-");
        const positions = portraitOrders[i]!; ordersByPassage.set(passage.entityId, positions);
        titles.set(passage.entityId, (await call("read_game_record", { projectId, kind: "passage", entityId: passage.entityId })).record.content.title);
        const scene = { ...state.scene, layout: "illustrated", background: harbor, portraits: positions.map((position, index) => ({ character: ["Mira", "Tomas", "Anika"][index], expression: ending ? "Relieved" : "Concerned", position, image: ending ? smiling : concerned })),
          dialogue: [{ speaker: "Mira", text: ending ? "The harbor can answer for itself." : "Who lit that signal?" }] };
        const review = await call("review_scene", { projectId, scene }); await call("apply_scene", { projectId, operationId: randomUUID(), scene, fingerprint: review.fingerprint, approved: true });
      }
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "scenes"); }, projectId);
      await page.goto(`${address}/#long-form`);
      const editor = page.getByRole("region", { name: "Illustrated scenes", exact: true });
      await expect(editor).toBeVisible();
      const selectPassage = async (passageId: string) => {
        const select = editor.getByRole("combobox", { name: "Passage", exact: true }); await expect(select).toBeEnabled();
        if (await select.inputValue() !== passageId) {
          const loaded = page.waitForResponse((response) => response.url().endsWith("/scenes/read_scene") && response.request().postDataJSON().passageId === passageId);
          await select.selectOption(passageId); expect((await loaded).status()).toBe(200);
        }
        await expect(editor.getByRole("button", { name: "Review scene", exact: true })).toBeEnabled();
      };
      for (const [passageId, positions] of ordersByPassage) {
        await selectPassage(passageId);
        for (const [width, height] of [[1280, 900], [390, 844]]) {
          await page.setViewportSize({ width, height }); await expectPortraitRow(editor.locator(".illustrated-scene"), positions);
          if (positions.join() === "right,center,left") { await editor.locator(".scene-stage").scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`v2-r01-editor-${width}.png`) }); }
        }
      }
      await selectPassage("passage-shared-opening");
      const openingOrder = ordersByPassage.get("passage-shared-opening")!;
      for (const positions of [[openingOrder[1]!, openingOrder[0]!, ...openingOrder.slice(2)], openingOrder]) {
        await editor.getByRole("combobox", { name: "Position 1", exact: true }).selectOption(positions[0]!);
        await editor.getByRole("combobox", { name: "Position 2", exact: true }).selectOption(positions[1]!);
        for (const [width, height] of [[1280, 900], [390, 844]]) { await page.setViewportSize({ width, height }); await expectPortraitRow(editor.locator(".illustrated-scene"), positions); }
      }
      await expect(editor.getByLabel("Dialogue 1")).toHaveValue("Who lit that signal?");
      await editor.getByLabel("Dialogue 1").fill("Who lit the signal before the storm?");
      await editor.getByRole("button", { name: "Review scene", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Apply scene" })).toBeDisabled();
      await editor.getByLabel("I approve this exact scene and image selection.").check();
      let lost = false;
      await page.route("**/scenes/apply_scene", async (route) => { if (lost) { await route.continue(); return; } lost = true; const result = await route.fetch(); expect(result.ok()).toBe(true); await route.abort("failed"); });
      await editor.getByRole("button", { name: "Apply scene" }).click();
      await expect(editor.getByRole("alert")).toContainText(/fetch|network/i);
      await editor.getByRole("button", { name: "Apply scene" }).click();
      await expect(editor.getByRole("status")).toHaveText("Scene applied. Existing builds are unchanged.");
      await page.unroute("**/scenes/apply_scene");
      await expect(editor.locator(".scene-background img")).toHaveJSProperty("naturalWidth", 512);
      await editor.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath("v2-desktop-scene-editor.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await editor.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("v2-mobile-scene-editor.png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const review = await call("publication_readiness", { projectId }); expect(review.ready).toBe(true);
      const compiled = await call("compile_game", { projectId, operationId: randomUUID(), headFingerprint: review.headFingerprint, fingerprint: review.fingerprint, approved: true });
      const exported = await call("export_game", { projectId, buildVersionId: compiled.buildVersionId, format: "standalone" });
      const htmlResponse = await request.get(exported.downloadPath); await expect(htmlResponse).toBeOK();
      const htmlFile = join(directory, "illustrated.html"); await writeFile(htmlFile, await htmlResponse.body());
      const staticExport = await call("export_game", { projectId, buildVersionId: compiled.buildVersionId, format: "static" });
      const zip = await request.get(staticExport.downloadPath); await expect(zip).toBeOK();
      const files = unzipSync(await zip.body()), gameFile = Object.entries(files).find(([path]) => path.endsWith("game.json"));
      expect(gameFile).toBeTruthy(); const bundle = JSON.parse(Buffer.from(gameFile![1]).toString());
      expect(bundle.illustratedPresentation.assets).toHaveLength(3);
      expect(JSON.stringify(bundle)).not.toMatch(/sourceName|sourceSha256|assistant-import|operationId|Author request/);
      const labels = new Map<string, string>(), destinations = new Map<string, string>();
      for (const id of new Set([...proof.path, ...proof.alternate, ...proof.detourPath])) {
        const choice = (await call("read_game_record", { projectId, kind: "choice", entityId: id })).record.content;
        labels.set(id, choice.label); destinations.set(id, choice.destinationPassageId);
      }
      const backup = await request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const seenOrders = new Set<string>();
      for (const [path, title] of [[proof.path, "A Public Reckoning"], [proof.alternate, "A Shared Repair"], [proof.detourPath, "The Costly Warning"]] as const) {
        const context = await browser.newContext(), player = await context.newPage(), requests: string[] = [];
        try {
          player.on("request", (r) => requests.push(r.url())); await player.goto(pathToFileURL(htmlFile).href);
          await expect(player.getByRole("heading", { name: "A Signal in the Rain", exact: true })).toBeVisible();
          await expect(player.getByText("Who lit the signal before the storm?", { exact: true })).toBeVisible();
          await expect(player.getByRole("img", { name: "Mira in a green coat, concerned expression" }).first()).toHaveJSProperty("naturalWidth", 180);
          for (const [width, height] of [[1280, 900], [390, 844]]) {
            await player.setViewportSize({ width, height }); await player.screenshot({ path: info.outputPath(`v2-offline-player-${width}.png`), fullPage: true });
            expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(await player.locator(".illustrated-scene img").evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
            await expectPortraitRow(player.locator(".illustrated-scene"), openingOrder);
          }
          seenOrders.add(openingOrder.join());
          for (const choiceId of path) {
            const choice = player.getByRole("button", { name: labels.get(choiceId)!, exact: true }); await choice.focus(); await player.keyboard.press("Enter");
            const passageId = destinations.get(choiceId)!, positions = ordersByPassage.get(passageId)!;
            await expect(player.getByRole("heading", { name: titles.get(passageId)!, exact: true })).toBeVisible();
            for (const [width, height] of [[1280, 900], [390, 844]]) {
              await player.setViewportSize({ width, height }); await expectPortraitRow(player.locator(".illustrated-scene"), positions);
              if (positions.join() === "right,center,left") await player.screenshot({ path: info.outputPath(`v2-r01-offline-${width}.png`), fullPage: true });
            }
            seenOrders.add(positions.join());
          }
          await expect(player.getByRole("heading", { name: title, exact: true })).toBeVisible();
          await expect(player.getByRole("img", { name: "Mira in a red coat, relieved expression" }).first()).toHaveJSProperty("naturalWidth", 180);
          await player.getByRole("button", { name: "Rewind", exact: true }).click();
          await expect(player.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
          expect(requests.some((url) => /\/api\/|openrouter|provider/i.test(url))).toBe(false);
        } finally { await context.close(); }
      }
      expect([...seenOrders].sort()).toEqual(portraitOrders.map((positions) => positions.join()).sort());
      const staticServer = createServer((req, res) => {
        const path = req.url?.replace(/^\/nested\//, "") ?? "index.html", bytes = files[path];
        if (!bytes) { res.writeHead(404); res.end(); return; }
        res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html");
        res.end(Buffer.from(bytes));
      });
      await new Promise<void>((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
      const staticAddress = staticServer.address(), context = await browser.newContext(), staticPage = await context.newPage();
      try {
        await staticPage.goto(`http://127.0.0.1:${typeof staticAddress === "object" && staticAddress ? staticAddress.port : 0}/nested/index.html`);
        await expect(staticPage.getByRole("img", { name: "Red signal tower over blue harbor water" })).toHaveJSProperty("naturalWidth", 512);
        await staticPage.getByRole("button", { name: "Save game", exact: true }).click(); await staticPage.getByLabel("Save name").fill("Illustrated opening");
        await staticPage.getByRole("button", { name: "Create save", exact: true }).click();
        await staticPage.getByRole("button", { name: labels.get(proof.path[0])!, exact: true }).click();
        await expect(staticPage.getByRole("heading", { name: "The Open Ledger", exact: true })).toBeVisible();
        await staticPage.reload(); await expect(staticPage.getByRole("heading", { name: "The Open Ledger", exact: true })).toBeVisible();
        await staticPage.getByRole("button", { name: "Load game", exact: true }).click(); await staticPage.getByRole("button", { name: "Load", exact: true }).click();
        await expect(staticPage.getByRole("heading", { name: "A Signal in the Rain", exact: true })).toBeVisible();
        await expect(staticPage.getByText("Who lit the signal before the storm?", { exact: true })).toBeVisible();
        const staticOrders = new Set<string>();
        for (const path of [proof.path, proof.alternate, proof.detourPath]) {
          await staticPage.getByRole("button", { name: "Restart", exact: true }).click(); await staticPage.getByRole("button", { name: "Restart game", exact: true }).click();
          await expect(staticPage.getByRole("heading", { name: "A Signal in the Rain", exact: true })).toBeVisible();
          for (const [width, height] of [[1280, 900], [390, 844]]) { await staticPage.setViewportSize({ width, height }); await expectPortraitRow(staticPage.locator(".illustrated-scene"), openingOrder); }
          staticOrders.add(openingOrder.join());
          for (const choiceId of path) {
            await staticPage.getByRole("button", { name: labels.get(choiceId)!, exact: true }).click();
            const passageId = destinations.get(choiceId)!, positions = ordersByPassage.get(passageId)!;
            await expect(staticPage.getByRole("heading", { name: titles.get(passageId)!, exact: true })).toBeVisible();
            for (const [width, height] of [[1280, 900], [390, 844]]) { await staticPage.setViewportSize({ width, height }); await expectPortraitRow(staticPage.locator(".illustrated-scene"), positions); }
            staticOrders.add(positions.join());
          }
        }
        expect([...staticOrders].sort()).toEqual([...seenOrders].sort());
      } finally { await context.close(); await new Promise<void>((resolve) => staticServer.close(() => resolve())); }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
