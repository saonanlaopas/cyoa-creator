import { expect, test } from "playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureImage, imageMetadata } from "./helpers/image-assets.js";

test("V1 imports through MCP, uploads/reviews/replaces in Creator and restores/duplicates complete image history", async ({ page, playwright }, info) => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "cyoa-v1-browser-")), token = randomBytes(32).toString("hex"), projectId = randomUUID(), children: ChildProcess[] = [];
  const originalBytes = fixtureImage(); await writeFile(join(directory, "harbor.png"), originalBytes);
  const start = async (databaseName: string) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { buildApp } from './apps/server/dist/app.js';
      const app = buildApp({ databasePath: process.env.V1_DATABASE, assetStagingDirectory: process.env.V1_STAGING,
        connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.V1_PROJECT_ID], allowProjectCreation: true },
        conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
      console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
      process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, V1_DATABASE: join(directory, databaseName), V1_STAGING: directory, V1_PROJECT_ID: projectId }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child); let errors = ""; child.stderr!.on("data", (chunk) => { errors += String(chunk); });
    const { address } = await new Promise<{ address: string }>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`V1 startup timeout: ${errors}`)), 10000);
      child.stdout!.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const item = JSON.parse(line); if (item.address) { clearTimeout(timer); resolve(item); } } catch { /* Complete startup record only. */ } });
      child.once("error", (e) => { clearTimeout(timer); reject(e); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`V1 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    const call = async (name: string, args: Record<string, unknown>) => {
      const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
        data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
      await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
    };
    return { address, request, call };
  };
  try {
    const first = await start("original.sqlite");
    try {
      await first.call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "V1 Harbor Library" });
      const staged = await first.call("list_staged_assets", { projectId }); expect(staged.items[0].filename).toBe("harbor.png");
      const importInput = { projectId, operationId: randomUUID(), approved: true, filename: "harbor.png", sourceSha256: staged.items[0].sourceSha256, metadata: imageMetadata };
      const candidate = await first.call("import_staged_asset", importInput);
      await page.addInitScript((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "assets"); }, projectId);
      await page.goto(`${first.address}/#long-form`);
      await page.getByRole("button", { name: /Harbor study.*candidate/ }).click();
      await expect(page.getByRole("heading", { name: "Harbor study", exact: true })).toBeVisible();
      await expect(page.getByText("Assistant import / no provider call", { exact: true })).toBeVisible();
      await expect(page.getByRole("img", { name: imageMetadata.altText, exact: true })).toBeVisible();
      expect(await page.getByRole("img", { name: imageMetadata.altText, exact: true }).evaluate((el) => ({ width: (el as HTMLImageElement).naturalWidth, height: (el as HTMLImageElement).naturalHeight }))).toEqual({ width: 512, height: 320 });
      await page.getByLabel("Title", { exact: true }).fill("Harbor daylight"); await page.getByLabel("Tags", { exact: true }).fill("harbor, coast");
      let lostResponse = false;
      await page.route("**/assets/*/revise", async (route) => {
        if (lostResponse) { await route.continue(); return; }
        lostResponse = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed");
      });
      await page.getByRole("button", { name: "Save metadata candidate", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(/fetch|network/i);
      await page.getByRole("button", { name: "Save metadata candidate", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Candidate saved");
      await page.unroute("**/assets/*/revise");
      await page.getByRole("button", { name: "Review candidate", exact: true }).click();
      await page.getByLabel("I reviewed this exact image and metadata.").check();
      await page.getByRole("button", { name: "Approve candidate", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Exact image candidate approved.");
      const approved = await first.call("read_asset", { projectId, assetId: candidate.assetId });
      expect(approved.approved.content.metadata.tags).toEqual(["harbor", "coast"]); const originalHash = approved.approved.image.sha256;
      await page.getByLabel("Replacement image", { exact: true }).setInputFiles({ name: "sunset.png", mimeType: "image/png", buffer: fixtureImage(512, 320, true) });
      await page.getByLabel("Title", { exact: true }).fill("Harbor sunset");
      await page.getByRole("textbox", { name: "Description", exact: true }).fill("A golden harbor sky, red signal tower and blue water.");
      await page.getByRole("button", { name: "Upload replacement candidate", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Candidate saved");
      await expect(page.getByText("Candidate image / v4", { exact: true })).toBeVisible();
      await expect(page.getByText("Approved image / v3", { exact: true })).toBeVisible();
      await page.getByRole("heading", { name: "Harbor sunset", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("v1-desktop-replacement-review.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("heading", { name: "Harbor sunset", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("v1-mobile-replacement-review.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator(".asset-comparison img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      const replacement = await first.call("read_asset", { projectId, assetId: candidate.assetId });
      expect(replacement.approved.image.sha256).toBe(originalHash); expect(replacement.selected.image.sha256).not.toBe(originalHash);
      const review = await first.call("review_asset", { projectId, assetId: candidate.assetId, versionId: replacement.selected.id });
      const rejection = { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: replacement.selected.id, fingerprint: review.fingerprint };
      const rejected = await first.call("reject_asset", rejection);
      await page.getByRole("button", { name: "Refresh assets", exact: true }).click();
      await expect(page.locator(".asset-inspector > header")).toContainText("rejected");
      const revised = await first.call("revise_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, expectedVersionId: rejected.versionId, metadata: { ...imageMetadata, title: "Sunset revisited" } });
      const reviewAgain = await first.call("review_asset", { projectId, assetId: candidate.assetId, versionId: revised.versionId });
      await first.call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: revised.versionId, fingerprint: reviewAgain.fingerprint });
      const oldFile = await first.request.get(approved.approved.image.url); await expect(oldFile).toBeOK();
      expect(createHash("sha256").update(await oldFile.body()).digest("hex")).toBe(originalHash);
      await page.getByRole("button", { name: "Refresh assets", exact: true }).click();
      await page.getByRole("button", { name: "Inspect usage", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("0 scene/map assignments; 7 immutable library versions");
      await page.getByLabel("Replacement image", { exact: true }).setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
      await page.getByRole("button", { name: "Upload replacement candidate", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("image_static_png_jpeg_webp_required");
      expect((await first.call("list_assets", { projectId })).total).toBe(1);
      const backup = await first.request.post(`/api/projects/${projectId}/recovery/backups`); await expect(backup).toBeOK(); expect(backup.headers()["x-cyoa-backup-verification"]).toBe("verified");
      const second = await start("restored.sqlite");
      try {
        const restored = await second.request.post("/api/recovery/backups/restore", { multipart: { file: { name: "library.cyoa-backup.zip", mimeType: "application/zip", buffer: await backup.body() } } }); await expect(restored).toBeOK();
        const final = await second.call("read_asset", { projectId, assetId: candidate.assetId }); expect(final.totalVersions).toBe(7); expect(final.approved.image.sha256).toBe(replacement.selected.image.sha256);
        expect(await second.call("import_staged_asset", importInput)).toEqual(candidate);
        const duplicate = await second.request.post(`/api/projects/${projectId}/duplicate`, { data: { name: "Independent image library" } }); await expect(duplicate).toBeOK(); const copy = await duplicate.json();
        const copyDetail = await (await second.request.get(`/api/long-form/projects/${copy.id}/assets/${candidate.assetId}`)).json();
        expect(copyDetail.totalVersions).toBe(7); expect(copyDetail.selected.id).not.toBe(final.selected.id);
        const copyFile = await second.request.get(copyDetail.approved.image.url); await expect(copyFile).toBeOK(); expect(createHash("sha256").update(await copyFile.body()).digest("hex")).toBe(final.approved.image.sha256);
        await page.goto(`${second.address}/#long-form`); await page.getByRole("button", { name: /Sunset revisited.*approved/ }).click();
        await expect(page.getByRole("heading", { name: "Sunset revisited", exact: true })).toBeVisible();
        await expect(page.getByRole("img", { name: imageMetadata.altText, exact: true })).toBeVisible();
      } finally { await second.request.dispose(); }
    } finally { await first.request.dispose(); }
  } finally {
    for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
    });
    await rm(directory, { recursive: true, force: true });
  }
});
