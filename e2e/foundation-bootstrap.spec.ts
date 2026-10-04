import { expect, test as base, type APIRequestContext } from "playwright/test";
import { spawn } from "node:child_process";

const test = base.extend<{}, { bootstrapBaseURL: string }>({
  bootstrapBaseURL: [async ({}, use) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { buildApp } from './apps/server/dist/app.js';
      import { createOfflineSetupClient } from './apps/server/dist/services/offline-setup-provider.js';
      const app = buildApp({ databasePath: ':memory:', openRouterClient: createOfflineSetupClient() });
      console.log(JSON.stringify({ address: await app.listen({ port: 0, host: '127.0.0.1' }) }));
      process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Bootstrap server startup timed out: ${errors}`)), 10_000);
        let output = "";
        child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const result = JSON.parse(line); if (result.address) { clearTimeout(timeout); resolve(result.address); } } catch { /* Wait for the complete startup record. */ } });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Bootstrap server exited: ${errors}`)); });
      });
      await use(address);
    } finally { if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); }
  }, { scope: "worker" }],
  baseURL: async ({ bootstrapBaseURL }, use) => { await use(bootstrapBaseURL); },
});
async function adaptedProject(request: APIRequestContext) {
  const response = await request.post("/api/long-form/projects", { data: { name: "A5 harbor foundations" } }); expect(response.ok()).toBe(true);
  const created = await response.json(), id = created.project.id, project = `/api/long-form/projects/${id}`;
  expect((await request.post(`/api/projects/${id}/source/text`, { data: { text: "Chapter 1\n\nRen dies during the harbor collapse. Jules and Ren are lovers.\n\nChapter 2\n\nMira departs the harbor." } })).ok()).toBe(true);
  expect((await request.post(`${project}/source-analysis/scope`, { data: { entireWork: true } })).ok()).toBe(true);
  const plan = await (await request.post(`${project}/source-analysis/preview`, { data: {} })).json();
  const job = await (await request.post(`${project}/source-analysis/plans/${plan.id}/start`, { data: { fingerprint: plan.fingerprint } })).json();
  await expect.poll(async () => (await (await request.get(`${project}/source-analysis/jobs/${job.id}`)).json()).status).toBe("completed");
  const dossier = await (await request.get(`${project}/source-analysis/dossier`)).json();
  expect((await request.post(`${project}/source-analysis/approve`, { data: { versionId: dossier.id } })).ok()).toBe(true);
  const intent = await (await request.post(`${project}/adaptation-intent/create`, { data: {} })).json();
  expect((await request.post(`${project}/adaptation-intent/approve`, { data: { versionId: intent.current.id } })).ok()).toBe(true);
  return { id, project, created };
}

test("A5 offline preview, generation, provenance review and dependency-safe draft Apply leave approval and prose untouched", async ({ page, request }, info) => {
  const f = await adaptedProject(request), root = `${f.project}/foundation-bootstrap`;
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "foundation-bootstrap"); }, f.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  await expect(page.getByRole("heading", { name: "Foundation bootstrap", exact: true })).toBeVisible();
  expect((await (await request.get(root)).json()).jobs).toHaveLength(0);
  await page.getByLabel("Foundation request").fill("Build reviewable foundations for the approved harbor adaptation.");
  await page.getByRole("button", { name: "Preview foundation generation" }).click();
  const preview = page.getByRole("region", { name: "Foundation generation preview" }); await expect(preview).toContainText("$0.00 (offline)");
  await expect(page.getByRole("button", { name: "Start foundation generation" })).toBeDisabled();
  expect((await (await request.get(root)).json()).jobs).toHaveLength(0);
  await page.getByLabel("Authorize this exact foundation generation").check(); await page.getByRole("button", { name: "Start foundation generation" }).click();
  await page.getByRole("button", { name: "Review foundation bundle" }).click();
  const review = page.getByRole("region", { name: "Foundation bundle review" }); await expect(review).toContainText("6 candidates");
  const beforeApply = await (await request.get(f.project)).json(); expect(beforeApply.brief.id).toBe(f.created.brief.id); expect(beforeApply.bible).toBeNull();
  await page.getByRole("button", { name: "Review Routes", exact: true }).click();
  const detail = page.getByRole("region", { name: "Foundation artifact detail" }); await expect(detail.getByRole("heading", { name: "Field changes" })).toBeVisible();
  await detail.getByText("Source / override / adaptation-only provenance", { exact: true }).click(); await expect(detail).toContainText("source");
  await review.getByText("Requested canon obligation assessment", { exact: true }).click(); await expect(review).toContainText("Passage-level preservation pending graph validation");
  await page.getByRole("checkbox", { name: "Routes", exact: true }).check(); await page.getByRole("button", { name: "Preview selected drafts" }).click();
  const application = page.getByRole("region", { name: "Foundation application preview" }); await expect(application).toContainText("Required dependencies:"); await expect(application).toContainText("Creative Direction");
  await page.screenshot({ path: info.outputPath("a5-desktop-review.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("a5-mobile-review.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Apply reviewed drafts" }).click();
  await expect(page.getByText("Foundation drafts applied. Ordinary approval required; no passage plan or prose generated.", { exact: true })).toBeVisible();
  const after = await (await request.get(f.project)).json();
  for (const id of ["brief", "creative-direction", "bible", "routes", "endings", "mechanics"]) {
    expect(after.workflow[id].status).toBe("draft"); expect(after.workflow[id].approvedVersionId).toBeNull();
    expect(after[id === "creative-direction" ? "creativeDirection" : id]).not.toBeNull();
  }
  const passages = await (await request.get(`${f.project}/passage-plan`)).json(); expect(passages.structure).toBeNull(); expect(passages.passages).toHaveLength(0);
  const drafts = await (await request.get(`${f.project}/drafts/review-queue`)).json(); expect(drafts.items ?? drafts).toHaveLength(0);
  await page.reload(); await expect(page.getByRole("heading", { name: "Foundation bootstrap", exact: true })).toBeVisible();
});
