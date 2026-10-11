import { expect, test } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

test("M1 connected proposals are reviewable in Creator; browser and MCP Apply share exact draft-only outcomes", async ({ page, playwright }, info) => {
  const token = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    import { buildApp } from './apps/server/dist/app.js';
    import { ArtifactRepository, ChangeSetRepository, ProjectRepository, WorkflowRepository, openDatabase } from './packages/persistence/dist/index.js';
    import { LongFormProjectService } from './apps/server/dist/services/long-form-project-service.js';
    const dir = mkdtempSync(join(tmpdir(), 'cyoa-m1-browser-')), path = join(dir, 'disposable.sqlite'), db = openDatabase(path);
    const service = new LongFormProjectService(new ProjectRepository(db), new ArtifactRepository(db), new WorkflowRepository(db), new ChangeSetRepository(db));
    const created = service.createProject('M1 disposable harbor'); service.approveArtifact(created.project.id, 'brief', created.brief.id); db.close();
    const app = buildApp({ databasePath: path, connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [created.project.id] },
      conversationalEditProvider: { id: 'offline-edit', async generate() { throw new Error('Provider generation forbidden'); } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }), projectId: created.project.id }));
    process.on('SIGTERM', () => app.close().then(() => { rmSync(dir, { recursive: true, force: true }); process.exit(0); }));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
  try {
    const server = await new Promise<{ address: string; projectId: string }>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`M1 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try {
        const result = JSON.parse(line); if (result.address) { clearTimeout(timer); resolve(result); }
      } catch { /* Wait for the complete startup record. */ } });
      child.once("error", (e) => { clearTimeout(timer); reject(e); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`M1 exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: server.address });
    try {
      const projectId = server.projectId, root = `/api/long-form/projects/${projectId}`;
      const call = async (name: string, args: unknown) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
          data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError).not.toBe(true); return result.structuredContent;
      };
      const original = (await (await request.get(root)).json()).brief;
      const propose = async (title: string) => {
        const state = await call("project_state", { projectId }), catalogue = await call("list_edit_targets", { projectId, search: "brief:root" });
        const preview = await call("prepare_edit", { projectId, operationId: randomUUID(), message: `Change title to ${title}`, headFingerprint: state.headFingerprint,
          targets: catalogue.items.map(({ key, versionId }: { key: string; versionId: string }) => ({ key, versionId })) });
        return call("submit_edit", { projectId, operationId: randomUUID(), planId: preview.plan.id, fingerprint: preview.plan.fingerprint,
          response: { message: title, groups: [{ id: "title", label: "Project title", explanation: "Explicit title change only", dependsOnGroupIds: [],
            operations: [{ targetKey: "brief:root", kind: "set-fields", changes: { workingTitle: title } }] }] } });
      };
      const submitted = await propose("Connected harbor");
      await page.goto(server.address); await page.evaluate((id) => {
        localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "editing");
      }, projectId);
      await page.getByRole("button", { name: "Long-form workspace" }).click();
      await page.getByRole("button", { name: "Open saved proposal" }).click();
      await expect(page.getByText("Connected assistant / no provider generation", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Review selected changes" }).click();
      const review = page.getByRole("region", { name: "Effective editing changes" });
      await review.getByText("brief / root: before and after", { exact: true }).click();
      await expect(review).toContainText('"workingTitle": "Connected harbor"');
      expect((await (await request.get(root)).json()).brief.id).toBe(original.id);
      await page.screenshot({ path: info.outputPath("m1-desktop-review.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: info.outputPath("m1-mobile-review.png"), fullPage: true });
      await page.locator(".edit-workspace").evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: info.outputPath("m1-mobile-viewport.png") });
      const heading = await page.getByRole("heading", { name: "Conversational editing", exact: true }).boundingBox(), nav = await page.locator(".app-mode-nav").boundingBox();
      expect(heading!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: "Apply selected editing changes" }).click();
      await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
      const applied = await call("get_edit", { projectId, proposalId: submitted.proposalId }); expect(applied.status).toBe("applied");
      const next = await propose("Second connected harbor"), reviewed = await call("review_edit", { projectId, proposalId: next.proposalId, groupIds: ["title"] });
      const apply = { projectId, operationId: randomUUID(), proposalId: next.proposalId, groupIds: ["title"], fingerprint: reviewed.fingerprint, approved: true };
      expect(await call("apply_edit", apply)).toEqual(await call("apply_edit", apply));
      await page.reload(); await page.getByRole("button", { name: /^Project brief / }).click();
      await expect(page.getByLabel("Working title", { exact: true })).toHaveValue("Second connected harbor");
      const after = await (await request.get(root)).json();
      expect(after.workflow.brief.status).toBe("draft"); expect(after.workflow.brief.approvedVersionId).toBe(original.id);
    } finally { await request.dispose(); }
  } finally { if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); }
});
