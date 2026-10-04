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
  await expect(detail.getByRole("heading", { name: "Routes", exact: true })).toBeFocused();
  await detail.getByText("Source / override / adaptation-only provenance", { exact: true }).click(); await expect(detail).toContainText("source");
  await review.getByText("Requested canon obligation assessment", { exact: true }).click(); await expect(review).toContainText("Passage-level preservation pending graph validation");
  await page.getByRole("checkbox", { name: "Routes", exact: true }).check(); await page.getByRole("button", { name: "Preview selected drafts" }).click();
  const application = page.getByRole("region", { name: "Foundation application preview" }); await expect(application).toContainText("Required dependencies:"); await expect(application).toContainText("Creative Direction");
  await page.screenshot({ path: info.outputPath("a5-desktop-review.png"), fullPage: true });
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: info.outputPath("a5-desktop-viewport.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("a5-mobile-review.png"), fullPage: true });
  await page.evaluate(() => document.querySelector('.bootstrap-workspace')!.scrollIntoView()); await page.screenshot({ path: info.outputPath("a5-mobile-viewport.png") });
  const titleBox = await page.getByRole("heading", { name: "Foundation bootstrap", exact: true }).boundingBox(), navBox = await page.locator(".app-mode-nav").boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
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

test("A5 unused-preview archive recovery requires a real download and leaves canonical work untouched", async ({ page, request }) => {
  const f = await adaptedProject(request), root = `${f.project}/foundation-bootstrap`, before = await (await request.get(f.project)).json();
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "foundation-bootstrap"); }, f.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  await page.getByLabel("Foundation request").fill("Unused reviewed foundation preview.");
  await page.getByRole("button", { name: "Preview foundation generation" }).click();
  await expect(page.getByRole("region", { name: "Foundation generation preview" })).toBeVisible();
  await page.getByRole("button", { name: "Preview foundation generation" }).click();
  await expect.poll(async () => (await (await request.get(root)).json()).plans.length).toBe(1);
  await page.getByText("Saved generation previews", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download unused preview archive" }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe(`foundation-previews-${f.id}.json`);
  const stream = await download.createReadStream(); expect(stream).not.toBeNull();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const archive = JSON.parse(Buffer.concat(chunks).toString()); expect(archive.plans).toHaveLength(1); expect(archive.projectId).toBe(f.id);
  const retire = page.getByRole("button", { name: "Retire archived unused previews" }); await expect(retire).toBeDisabled();
  await page.getByLabel("Archive saved; retire only unused previews").check(); await retire.click();
  await expect(page.getByText("1 unused previews archived. Job and artifact history retained.", { exact: true })).toBeVisible();
  const state = await (await request.get(root)).json(); expect(state.plans).toHaveLength(0); expect(state.jobs).toHaveLength(0);
  expect(await (await request.get(f.project)).json()).toEqual(before);
  await page.getByLabel("Foundation request").fill("Fresh foundation request after archived previews."); await page.getByRole("button", { name: "Preview foundation generation" }).click();
  await expect(page.getByRole("region", { name: "Foundation generation preview" })).toContainText("Fresh foundation request after archived previews.");
});
