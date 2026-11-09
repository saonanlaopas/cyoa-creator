import { expect, test } from "playwright/test";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyPreviewWorld, boundaryProse, completePreviewOpening, openingProse, openingSelection, previewStop, previewWorld } from "./helpers/partial-preview.js";
import { imageMetadata } from "./helpers/image-assets.js";
import { townMap } from "./helpers/world.js";

test("PF-008 plays a reviewed opening offline on desktop and mobile without advancing past the accepted stop", async ({ browser, playwright }, info) => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "cyoa-preview-browser-"));
  const token = randomBytes(32).toString("hex"), projectId = randomUUID();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    const app = buildApp({ databasePath: process.env.FIXTURE_DB, assetStagingDirectory: process.env.FIXTURE_DIR,
      connectedEditing: { token: process.env.FIXTURE_TOKEN, projectIds: [process.env.FIXTURE_PROJECT], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(await app.listen({ host: '127.0.0.1', port: 0 }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", FIXTURE_DB: join(directory, "fixture.sqlite"),
    FIXTURE_DIR: directory, FIXTURE_TOKEN: token, FIXTURE_PROJECT: projectId }, stdio: ["ignore", "pipe", "pipe"] });
  const stopped = new Promise<void>(resolve => child.once("close", () => resolve()));
  let errors = "";
  child.stderr.on("data", chunk => { errors += String(chunk); });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`Preview fixture startup timed out: ${errors}`)), 10000);
      child.stdout.on("data", chunk => {
        output += String(chunk);
        const address = /^http:\/\/127\.0\.0\.1:\d+$/m.exec(output)?.[0];
        if (address) { clearTimeout(timer); resolve(address); }
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Preview fixture exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    const file = join(directory, "partial-preview.html");
    try {
      const authorization = { Authorization: `Bearer ${token}` };
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { ...authorization, Accept: "application/json, text/event-stream" },
          data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK();
        const result = (await reply.json()).result;
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        return result.structuredContent;
      };
      await call("create_project", { projectId, name: "Disposable harbor preview", operationId: randomUUID(), approved: true });
      await completePreviewOpening(call, projectId);
      const image = townMap();
      await writeFile(join(directory, "district.png"), image);
      const candidate = await call("import_staged_asset", { projectId, operationId: randomUUID(), approved: true, filename: "district.png",
        sourceSha256: createHash("sha256").update(image).digest("hex"),
        metadata: { ...imageMetadata, title: "Harbor map", altText: "Roads beside the harbor" } });
      const review = await call("review_asset", { projectId, assetId: candidate.assetId, versionId: candidate.versionId });
      const asset = await call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId,
        versionId: candidate.versionId, fingerprint: review.fingerprint });
      await applyPreviewWorld(call, projectId, await previewWorld(call, projectId, { assetId: asset.assetId, versionId: asset.versionId }));
      const full = await call("publication_readiness", { projectId });
      expect(full.ready).toBe(false);
      const preview = await call("review_preview", { projectId, selection: openingSelection });
      expect(preview).toMatchObject({ ready: true, kind: "partial-preview", acceptedDraftCount: 2, boundary: { stopPassageId: previewStop } });
      const built = await call("compile_preview", { projectId, selection: preview.selection, operationId: randomUUID(), approved: true,
        fingerprint: preview.fingerprint, headFingerprint: preview.headFingerprint });
      const exported = await call("export_preview", { projectId, buildVersionId: built.buildVersionId });
      expect(exported.kind).toBe("partial-preview");
      expect((await request.get(exported.downloadPath)).status()).toBe(401);
      expect((await request.get(exported.downloadPath, { headers: { ...authorization, Origin: "https://other.invalid" } })).status()).toBe(403);
      const download = await request.get(exported.downloadPath, { headers: authorization });
      await expect(download).toBeOK();
      expect(download.headers()["content-disposition"]).toContain("cyoa-partial-preview.html");
      await writeFile(file, await download.body());
    } finally { await request.dispose(); }
    child.kill("SIGTERM");
    await stopped;
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, offline: true });
      try {
        const page = await context.newPage();
        const network: string[] = [];
        page.on("request", req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
        await page.goto(pathToFileURL(file).href);
        const world = page.getByRole("region", { name: "Locations and time" });
        const clock = world.getByLabel("Game time");
        await expect(page.getByText("Partial preview", { exact: true })).toBeVisible();
        await expect(page.getByText(openingProse, { exact: true })).toBeVisible();
        await world.getByText("Map", { exact: true }).click();
        await expect(world.getByRole("img")).toHaveJSProperty("naturalWidth", 640);
        await expect(clock).toHaveText("Day 1 · 23:50");
        await world.getByRole("navigation", { name: "Travel", exact: true }).getByRole("button", { name: "Cafe · 15 min", exact: true }).click();
        await page.getByRole("button", { name: "Confirm action", exact: true }).click();
        await expect(clock).toHaveText("Day 2 · 00:05");
        const assertStop = async () => {
          await expect(page.getByText(boundaryProse, { exact: true })).toBeVisible();
          await expect(page.getByText("Preview boundary reached.", { exact: true })).toBeVisible();
          await expect(page.getByText("This ending is complete.", { exact: true })).toHaveCount(0);
          await expect(page.getByRole("region", { name: "Choices" })).toHaveCount(0);
          await expect(world.getByRole("button", { name: "Home · 15 min", exact: true })).toBeDisabled();
          await expect(world.getByRole("button", { name: "Read departure board · 5 min", exact: true })).toBeDisabled();
          await expect(world.getByRole("button", { name: "Wait 15 min", exact: true })).toBeDisabled();
          await expect(clock).toHaveText("Day 2 · 00:05");
        };
        await assertStop();
        await page.getByRole("button", { name: "Save game", exact: true }).click();
        await page.getByLabel("Save name").fill("Reviewed boundary");
        await page.getByRole("button", { name: "Create save", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.reload();
        await assertStop();
        await page.getByRole("button", { name: "Rewind", exact: true }).click();
        await expect(page.getByText(openingProse, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Load game", exact: true }).click();
        await page.getByRole("button", { name: "Load", exact: true }).click();
        await assertStop();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(network).toEqual([]);
        await page.screenshot({ path: info.outputPath(`preview-boundary-${width}.png`), fullPage: true });
      } finally { await context.close(); }
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await stopped; }
    await rm(directory, { recursive: true, force: true });
  }
});
