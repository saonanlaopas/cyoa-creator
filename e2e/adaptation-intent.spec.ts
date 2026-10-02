import { expect, test as base, type APIRequestContext } from "playwright/test";
import { spawn } from "node:child_process";

const test = base.extend<{}, { intentBaseURL: string }>({
  intentBaseURL: [async ({}, use) => {
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
        const timeout = setTimeout(() => reject(new Error(`Intent server startup timed out: ${errors}`)), 10_000);
        let output = "";
        child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const result = JSON.parse(line); if (result.address) { clearTimeout(timeout); resolve(result.address); } } catch { /* Wait for complete startup record. */ } });
        child.once("error", (e) => { clearTimeout(timeout); reject(e); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Intent server exited: ${errors}`)); });
      });
      await use(address);
    } finally { if (child.exitCode === null) await new Promise<void>((r) => { child.once("exit", () => r()); child.kill("SIGTERM"); }); }
  }, { scope: "worker" }],
  baseURL: async ({ intentBaseURL }, use) => { await use(intentBaseURL); },
});
async function project(request: APIRequestContext, chapters = 2) {
  const created = await (await request.post("/api/long-form/projects", { data: { name: "A4 harbor adaptation" } })).json();
  const id = created.project.id, source = `/api/long-form/projects/${id}/source-analysis`, root = `/api/long-form/projects/${id}/adaptation-intent`;
  await request.post(`/api/projects/${id}/source/text`, { data: { text: "Chapter 1\n\nRen dies during the harbor collapse. Jules and Ren are lovers." + Array.from({ length: chapters - 1 }, (_, i) => `\n\nChapter ${i + 2}\n\nMira departs the harbor on day ${i + 1}.`).join("") } });
  await request.post(`${source}/scope`, { data: { entireWork: true } });
  const plan = await (await request.post(`${source}/preview`, { data: {} })).json();
  const job = await (await request.post(`${source}/plans/${plan.id}/start`, { data: { fingerprint: plan.fingerprint } })).json();
  await expect.poll(async () => (await (await request.get(`${source}/jobs/${job.id}`)).json()).status).toBe("completed");
  const dossier = await (await request.get(`${source}/dossier`)).json(); await request.post(`${source}/approve`, { data: { versionId: dossier.id } });
  return { id, root, source, created };
}
test("A4 explicit adoption, dimensions, source/override separation, evidence and history on desktop/mobile", async ({ page, request }, info) => {
  const f = await project(request), sourceBefore = await (await request.get(`${f.source}/export`)).json();
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "adaptation-intent"); }, f.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  await expect(page.getByRole("heading", { name: "Adaptation Intent", exact: true })).toBeVisible();
  await expect(page.getByText("Not adopted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create intent draft" }).click();
  await expect(page.getByText("Intent v1: draft", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Fidelity preset", exact: true }).selectOption("faithful"); await page.getByRole("button", { name: "Apply expanded preset" }).click();
  await expect(page.getByText("Intent v2: draft", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Character fidelity", exact: true }).selectOption("strict"); await expect(page.getByText("Intent v3: draft", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Adaptation views" }).getByRole("button", { name: "Overrides", exact: true }).click();
  await page.getByLabel("Find source record").fill("dies");
  const targets = page.getByRole("group", { name: "Source targets" });
  await expect(targets.getByRole("checkbox")).toHaveCount(1); await targets.getByRole("checkbox").check();
  await expect(page.getByText("Ren dies during the harbor collapse.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Why? Source evidence" }).click(); await expect(page.getByRole("blockquote")).toContainText("Ren dies");
  await page.getByLabel("Adaptation effect").fill("Ren survives the collapse"); await page.getByLabel("Rationale", { exact: true }).fill("Keep Ren available for the final act");
  await page.getByLabel("Reviewed exact effect and evidence").check(); await page.getByRole("button", { name: "Add intent item" }).click();
  await expect(page.getByText("Intent v4: draft", { exact: true })).toBeVisible();
  expect(await (await request.get(`${f.source}/export`)).json()).toEqual(sourceBefore);
  await page.screenshot({ path: info.outputPath("a4-desktop-override.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("a4-mobile-override.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Deactivate", exact: true }).click(); await expect(page.getByText("Intent v5: draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve intent", exact: true }).click(); await expect(page.getByText("Intent v5: approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click(); await page.getByRole("combobox", { name: "Historical intent", exact: true }).selectOption({ label: "v1 / manual" });
  await page.getByRole("button", { name: "Compare with current" }).click(); await expect(page.getByText(/Material changed; provenance changed/)).toBeVisible();
  await page.getByRole("button", { name: "Restore as new draft" }).click(); await expect(page.getByText("Intent v6: draft", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("Intent v6: draft", { exact: true })).toBeVisible();
  expect(await page.getByText("Canon route preserved", { exact: true }).count()).toBe(0);
  const after = await (await request.get(`/api/long-form/projects/${f.id}`)).json(); expect(after.brief.id).toBe(f.created.brief.id); expect(after.bible).toBeNull(); expect(after.routes).toBeNull();
});
test("A4 requested ending, reviewed exception, invention and 30k+50k=80k expansion with honest discrepancy", async ({ page, request }) => {
  const f = await project(request); await request.post(`${f.root}/create`, { data: {} });
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "adaptation-intent"); }, f.id); await page.getByRole("button", { name: "Long-form workspace" }).click();
  const views = page.getByRole("navigation", { name: "Adaptation views" });
  await views.getByRole("button", { name: "Canon route requested", exact: true }).click();
  await page.getByLabel("Find source record").fill("dies"); await expect(page.getByRole("group", { name: "Source targets" }).getByRole("checkbox")).toHaveCount(1); await page.getByRole("group", { name: "Source targets" }).getByRole("checkbox").check();
  await page.getByLabel("Adaptation request").fill("Request the source ending's final state"); await page.getByLabel("Rationale", { exact: true }).fill("Keep the source result");
  await page.getByRole("combobox", { name: "Requested obligation kind", exact: true }).selectOption("ending"); await page.getByLabel("change-delivery", { exact: true }).check(); await page.getByRole("button", { name: "Add intent item" }).click();
  await expect(page.getByText("Intent v2: draft", { exact: true })).toBeVisible();
  const obligation = (await (await request.get(`${f.root}/collections/obligations`)).json()).items[0];
  await views.getByRole("button", { name: "Reviewed exceptions", exact: true }).click(); await page.getByLabel("Obligation stable ID").fill(obligation.id);
  await page.getByLabel("Adaptation permission").fill("Reveal indirectly rather than reproduce the confrontation"); await page.getByLabel("Rationale", { exact: true }).fill("Different delivery"); await page.getByLabel("Reviewed exact effect and evidence").check(); await page.getByRole("button", { name: "Add intent item" }).click();
  await expect(page.getByText("Intent v3: draft", { exact: true })).toBeVisible();
  await views.getByRole("button", { name: "Fidelity", exact: true }).click(); await page.getByRole("combobox", { name: "Requested source ending", exact: true }).selectOption("preserve-result-alter-mechanism");
  await expect(page.getByText("Intent v4: draft", { exact: true })).toBeVisible(); await page.getByLabel("Canon route requested", { exact: true }).check();
  await expect(page.getByText("Intent v5: draft", { exact: true })).toBeVisible();
  await views.getByRole("button", { name: "Adaptation-only additions", exact: true }).click(); await page.getByLabel("Adaptation description").fill("A new harbor vigil scene"); await page.getByLabel("Rationale", { exact: true }).fill("Connective author material"); await page.getByRole("button", { name: "Add intent item" }).click(); await expect(page.getByText("Intent v6: draft", { exact: true })).toBeVisible();
  await views.getByRole("button", { name: "Expansion", exact: true }).click();
  await page.getByLabel("Source-equivalent certainty").selectOption("estimated"); await page.getByLabel("Source-equivalent words").fill("30000"); await page.getByLabel("Target certainty").selectOption("estimated"); await page.getByLabel("Target words", { exact: true }).fill("80000"); await page.getByRole("button", { name: "Save author budget" }).click(); await expect(page.getByText("Intent v7: draft", { exact: true })).toBeVisible();
  await page.getByLabel("Adaptation description").fill("Branching consequences"); await page.getByLabel("Rationale", { exact: true }).fill("Explore alternate consequences"); await page.getByLabel("Allocation certainty").selectOption("estimated"); await page.getByLabel("Allocation words").fill("50000"); await page.getByRole("button", { name: "Add intent item" }).click();
  await expect(page.getByText(/Planned: 80000.*Difference: 0.*reconciled/)).toBeVisible();
  await page.getByRole("button", { name: "Review / edit", exact: true }).click(); await page.getByLabel("Allocation words").fill("90000"); await page.getByRole("button", { name: "Save reviewed item" }).click();
  await expect(page.getByText(/Planned: 120000.*Target: 80000.*review-required/)).toBeVisible(); await page.getByRole("button", { name: "Approve intent" }).click(); await expect(page.getByText("adaptation budget review required", { exact: true })).toBeVisible();
});
test("A4 bounded source selection and explicit conversational preview/review/Apply", async ({ page, request }, info) => {
  const f = await project(request, 26); await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "adaptation-intent"); }, f.id); await page.getByRole("button", { name: "Long-form workspace" }).click();
  await page.getByRole("button", { name: "Director suggestions", exact: true }).click(); const sourceTargets = page.getByRole("group", { name: "Source targets" }); await expect(sourceTargets.getByRole("checkbox")).toHaveCount(20);
  await page.getByRole("navigation", { name: "Source record pages" }).getByRole("button", { name: "Next" }).click(); await expect(page.getByRole("navigation", { name: "Source record pages" })).toContainText("21"); expect(await sourceTargets.getByRole("checkbox").count()).toBeLessThanOrEqual(20);
  await page.getByLabel("Adaptation preference").fill("Keep character dynamics close; reinterpret adaptation structure"); await page.getByRole("button", { name: "Preview suggestion" }).click();
  const preview = page.getByRole("region", { name: "Adaptation suggestion preview" }); await expect(preview).toContainText("must-not-exist"); await expect(preview).toContainText("$0.00 (offline)");
  await expect(page.getByRole("button", { name: "Generate suggestion" })).toBeDisabled(); await page.getByLabel("Authorize this exact adaptation suggestion").check(); await page.getByRole("button", { name: "Generate suggestion" }).click();
  await expect(page.getByRole("region", { name: "Adaptation proposal review" })).toBeVisible(); expect((await (await request.get(f.root)).json()).current).toBeNull();
  await page.getByRole("button", { name: "Apply reviewed suggestion" }).click(); await expect(page.getByText("Intent v1: draft", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("a4-mobile-director.png"), fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
