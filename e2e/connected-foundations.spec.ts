import { expect, test } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { approveFoundation, completeOriginalFoundations, originalTitle, proposeFoundation } from "./helpers/original-foundations.js";

test("M2 creates and authors original foundations through MCP; Creator reviews revisions and displays exact approvals", async ({ page, playwright }, info) => {
  test.setTimeout(90000);
  const token = randomBytes(32).toString("hex"), projectId = randomUUID();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    import { buildApp } from './apps/server/dist/app.js';
    const dir = mkdtempSync(join(tmpdir(), 'cyoa-m2-browser-'));
    const app = buildApp({ databasePath: join(dir, 'disposable.sqlite'),
      connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [process.env.M2_PROJECT_ID], allowProjectCreation: true },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider calls forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }) }));
    process.on('SIGTERM', () => app.close().then(() => { rmSync(dir, { recursive: true, force: true }); process.exit(0); }));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, M2_PROJECT_ID: projectId }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const { address } = await new Promise<{ address: string }>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`M2 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try {
        const result = JSON.parse(line); if (result.address) { clearTimeout(timer); resolve(result); }
      } catch { /* Wait for the complete startup record. */ } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`M2 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: address });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
          data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      const create = { projectId, operationId: randomUUID(), name: originalTitle, approved: true };
      expect(await call("list_projects", {})).toEqual({ projects: [], creationSlots: [projectId] });
      expect(await call("create_project", create)).toEqual(await call("create_project", create));
      await completeOriginalFoundations(call, projectId, async (artifactId) => {
        if (artifactId !== "bible") return;
        await page.goto(address);
        await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "editing"); }, projectId);
        await page.getByRole("button", { name: "Long-form workspace" }).click();
        await page.locator(".bootstrap-detail").filter({ hasText: "proposed / Original bible proposal" }).getByRole("button", { name: "Open saved proposal" }).click();
        await expect(page.getByRole("region", { name: "Editing proposal" })).toContainText("Original bible proposal");
        await expect(page.getByText("Connected assistant / no provider generation", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Review selected changes" }).click();
        const review = page.getByRole("region", { name: "Effective editing changes" });
        await review.getByText("bible / root: before and after", { exact: true }).click();
        await expect(review).toContainText("Storm beacon");
        await page.screenshot({ path: info.outputPath("m2-desktop-foundation-review.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: info.outputPath("m2-mobile-foundation-review.png"), fullPage: true });
        await page.locator(".edit-workspace").evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: info.outputPath("m2-mobile-viewport.png") });
        const heading = await page.getByRole("heading", { name: "Conversational editing", exact: true }).boundingBox(), nav = await page.locator(".app-mode-nav").boundingBox();
        expect(heading!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      });
      await page.reload();
      const state = await call("project_state", { projectId });
      expect(state.workflow.every((entry: any) => entry.workflow.status === "approved" && entry.workflow.approvedVersionId === entry.currentVersionId)).toBe(true);
      for (const name of ["Project brief", "Creative Direction", "Story bible", "Routes", "Endings", "Mechanics"]) await expect(page.getByRole("button", { name: `${name} approved`, exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^Project brief / }).click();
      await expect(page.getByLabel("Working title", { exact: true })).toHaveValue(originalTitle);
      await expect(page.getByPlaceholder("What is this adaptation or original story about?", { exact: true })).toHaveValue(/storm severs the harbor signal/);
      const rejected = await proposeFoundation(call, projectId, "brief", { premise: "Reject this replacement" });
      await call("reject_edit", { projectId, operationId: randomUUID(), proposalId: rejected.proposalId });
      const prior = state.workflow.find((entry: any) => entry.artifactId === "brief").currentVersionId;
      expect((await call("read_foundation", { projectId, artifactId: "brief" })).versionId).toBe(prior);
      const revised = await proposeFoundation(call, projectId, "brief", { premise: "Mira restores the signal while publishing the cost of every civic bargain." });
      await page.getByRole("button", { name: "Conversational editing", exact: true }).click();
      await page.locator(".bootstrap-detail").filter({ hasText: "proposed / Original brief proposal" }).getByRole("button", { name: "Open saved proposal" }).click();
      await page.getByRole("button", { name: "Review selected changes" }).click();
      await page.getByRole("button", { name: "Apply selected editing changes" }).click();
      await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
      expect(await call("get_edit", { projectId, proposalId: revised.proposalId })).toMatchObject({ status: "applied" });
      const draft = (await call("project_state", { projectId })).workflow.find((entry: any) => entry.artifactId === "brief");
      expect(draft.workflow).toMatchObject({ status: "draft", approvedVersionId: prior });
      await approveFoundation(call, projectId, "brief");
      await page.reload(); await page.getByRole("button", { name: /^Project brief / }).click();
      await expect(page.getByPlaceholder("What is this adaptation or original story about?", { exact: true })).toHaveValue("Mira restores the signal while publishing the cost of every civic bargain.");
      const current = (await call("project_state", { projectId })).workflow.find((entry: any) => entry.artifactId === "brief");
      expect(current.workflow).toMatchObject({ status: "approved", approvedVersionId: draft.currentVersionId });
    } finally { await request.dispose(); }
  } finally { if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); }
});
