import { expect, test } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { completeConnectedTextGame, submitGameDraft } from "./helpers/connected-text-game.js";
import { originalTitle } from "./helpers/original-foundations.js";

test("M3 authors a complete text game through MCP, reviews exact prose in Creator, revises and plays all exported endings offline", async ({ page, browser, playwright }, info) => {
  test.setTimeout(120000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "cyoa-m3-browser-files-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    import { buildApp } from './apps/server/dist/app.js';
    const dir = mkdtempSync(join(tmpdir(), 'cyoa-m3-browser-'));
    const app = buildApp({ databasePath: join(dir, 'disposable.sqlite'),
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.M3_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => { rmSync(dir, { recursive: true, force: true }); process.exit(0); }));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, M3_PROJECT_ID: projectId }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const { address } = await new Promise<{ address: string }>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`M3 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try {
        const result = JSON.parse(line); if (result.address) { clearTimeout(timer); resolve(result); }
      } catch { /* Wait for the complete startup record. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`M3 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
          data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result;
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      await call("create_project", { projectId, operationId: randomUUID(), name: originalTitle, approved: true });
      await page.addInitScript((id) => {
        localStorage.setItem("story-to-cyoa.long-form-project-id", id);
        localStorage.setItem("story-to-cyoa.long-form-stage", "passage-plan");
      }, projectId);
      const selectOpening = async () => {
        const jump = page.locator(".jump-control");
        await jump.getByPlaceholder("Jump to stable ID").fill("passage-shared-opening");
        await jump.getByRole("button", { name: "Jump", exact: true }).click();
        await expect(page.locator(".passage-editor input").first()).toHaveValue("A Signal in the Rain");
      };
      const proof = await completeConnectedTextGame(call, projectId, async (passageId) => {
        if (passageId !== "passage-shared-opening") return;
        await page.goto(`${address}/#long-form`); await selectOpening();
        const prose = page.getByLabel("Passage prose review");
        await expect(prose.getByText("Connected assistant / no provider generation", { exact: true })).toBeVisible();
        await expect(prose.getByRole("region", { name: "Candidate prose", exact: true })).toContainText("Rain rattles the signal glass.");
        await expect(prose.getByText("No prose has been accepted.")).toBeVisible();
        await page.screenshot({ path: info.outputPath("m3-desktop-candidate-review.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await prose.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("m3-mobile-candidate-review.png") });
        const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
          const box = el.getBoundingClientRect(); return box.width > 0 && box.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed";
        }).slice(0, 12).map((el) => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
        await page.setViewportSize({ width: 1280, height: 900 });
      });
      const revisedText = "Rain rattles the signal glass. Mira names the false light before the harbor trusts it again. The open ledger records both the warning and its cost.";
      const candidate = await submitGameDraft(call, projectId, "passage-shared-opening", revisedText);
      await page.reload(); await selectOpening();
      const prose = page.getByLabel("Passage prose review");
      await expect(prose.getByRole("region", { name: "Candidate prose", exact: true })).toContainText(revisedText);
      await expect(prose.getByRole("region", { name: "Current accepted prose", exact: true })).toContainText("Below, a fishing boat answers");
      await prose.getByRole("button", { name: "Preview exact acceptance" }).click();
      await prose.getByRole("button", { name: "Accept exact candidate" }).click();
      await expect(page.getByText("Exact candidate accepted as a new immutable lifecycle version.")).toBeVisible();
      const draft = await call("read_game_record", { projectId, kind: "draft", entityId: "passage-shared-opening" });
      expect(draft.draft.proseMarkdown).toBe(revisedText); expect(draft.head.acceptedVersionId).not.toBe(candidate.draftVersionId);
      for (const [choiceIds, expectedEndingId] of [[proof.alternate, "ending-2"], [proof.detourPath, "ending-3"]] as const) {
        const result = await call("simulate_game", { projectId, operationId: randomUUID(), headFingerprint: (await call("game_state", { projectId })).headFingerprint, choiceIds, expectedEndingId, approved: true });
        expect(result.result).toMatchObject({ kind: "completed-ending", endingId: expectedEndingId });
      }
      const review = await call("publication_readiness", { projectId }); expect(review.ready).toBe(true);
      const compiled = await call("compile_game", { projectId, operationId: randomUUID(), headFingerprint: review.headFingerprint, fingerprint: review.fingerprint, approved: true });
      const exported = await call("export_game", { projectId, buildVersionId: compiled.buildVersionId, format: "standalone" });
      const response = await request.get(exported.downloadPath); await expect(response).toBeOK();
      const html = await response.text(); expect(html).toContain("connect-src 'none'");
      const file = join(directory, "harbor.html"); await writeFile(file, html);
      const labels = new Map<string, string>();
      for (const choiceId of new Set([...proof.path, ...proof.alternate, ...proof.detourPath])) {
        labels.set(choiceId, (await call("read_game_record", { projectId, kind: "choice", entityId: choiceId })).record.content.label);
      }
      // The delivered artifact, not Creator or a mocked bundle, must work after shutdown.
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      for (const [path, title] of [[proof.path, "A Public Reckoning"], [proof.alternate, "A Shared Repair"], [proof.detourPath, "The Costly Warning"]] as const) {
        const context = await browser.newContext(), player = await context.newPage(), requests: string[] = [];
        try {
          player.on("request", (entry) => requests.push(entry.url()));
          await player.goto(pathToFileURL(file).href);
          await expect(player.getByRole("heading", { name: "A Signal in the Rain", exact: true })).toBeVisible();
          await expect(player.getByText(revisedText, { exact: true })).toBeVisible();
          for (const choiceId of path) await player.getByRole("button", { name: labels.get(choiceId)!, exact: true }).click();
          await expect(player.getByRole("heading", { name: title, exact: true })).toBeVisible();
          await player.getByRole("button", { name: "Rewind", exact: true }).click();
          await expect(player.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
          await player.getByRole("button", { name: labels.get(path.at(-1)!)!, exact: true }).click();
          await expect(player.getByRole("heading", { name: title, exact: true })).toBeVisible();
          await player.screenshot({ path: info.outputPath(`m3-export-${title.replaceAll(" ", "-")}.png`) });
          expect(requests.some((url) => /\/api\/|openrouter|provider/i.test(url))).toBe(false);
        } finally { await context.close(); }
      }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
