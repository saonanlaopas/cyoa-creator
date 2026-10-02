import { expect, test as base } from "playwright/test";
import { spawn } from "node:child_process";

const test = base.extend<{}, { sourceBaseURL: string }>({
  sourceBaseURL: [async ({}, use) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { buildApp } from './apps/server/dist/app.js';
      import { DeterministicSourceAnalysisProvider } from './apps/server/dist/services/source-analysis-provider.js';
      import { createOfflineSetupClient } from './apps/server/dist/services/offline-setup-provider.js';
      const app = buildApp({ databasePath: ':memory:', openRouterClient: createOfflineSetupClient(), sourceAnalysisProvider: new DeterministicSourceAnalysisProvider({ delayMs: 120 }) });
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      console.log(JSON.stringify({ address }));
      process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Source server startup timed out: ${errors}`)), 10000);
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          for (const line of output.split("\n")) {
            try { const result = JSON.parse(line) as { address?: string }; if (result.address) { clearTimeout(timeout); resolve(result.address); } }
            catch { /* Wait for the complete startup record. */ }
          }
        });
        child.once("error", (e) => { clearTimeout(timeout); reject(e); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Source server exited: ${errors}`)); });
      });
      await use(address);
    } finally {
      if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    }
  }, { scope: "worker" }],
  baseURL: async ({ sourceBaseURL }, use) => { await use(sourceBaseURL); },
});
const manuscript = "Chapter 1\n\nAlex and Mira are friends. Alex is twenty. Alexander watched the harbor.\n\nMira is Alex's sister. Ren is Mira's rival. Jules and Ren are lovers.\n\nChapter 2\n\nAlex is twenty-one. He remained behind. Perhaps he feared the sea.";
const createdProjects: string[] = [];
test.afterEach(async ({ request }) => { for (const id of createdProjects.splice(0)) await request.post(`/api/projects/${id}/archive`); });

test("A3 import, exact scope, bounded analysis, evidence, correction, history and explicit approval", async ({ page, request }, testInfo) => {
  const created = (await (await request.post("/api/long-form/projects", { data: { name: "Harbor manuscript" } })).json()); createdProjects.push(created.project.id);
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "source-analysis"); }, created.project.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  await expect(page.getByRole("heading", { name: "Source analysis", exact: true })).toBeVisible();
  expect((await page.getByRole("region", { name: "Source analysis", exact: true }).boundingBox())!.width).toBeGreaterThan(700);
  await page.getByText("Paste source text", { exact: true }).click(); await page.getByLabel("Source manuscript", { exact: true }).fill(manuscript);
  await page.getByRole("button", { name: "Import pasted story" }).click();
  await expect(page.getByText("Source imported. Select its scope.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview analysis", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Select entire work" }).click();
  await page.getByRole("button", { name: "Preview analysis", exact: true }).click();
  await expect(page.getByRole("region", { name: "Analysis preview" })).toContainText("$0.00 (offline)");
  await expect(page.getByRole("button", { name: "Start source analysis" })).toBeDisabled();
  await page.getByLabel("Authorize this exact source-analysis request").check();
  await page.getByRole("button", { name: "Start source analysis" }).click();
  const review = page.getByRole("region", { name: "Source Dossier review" }); await expect(review).toBeVisible();
  await expect(page.getByText("Dossier v1: draft", { exact: true })).toBeVisible();
  await page.getByLabel("Category", { exact: true }).selectOption("relationship");
  const list = page.getByRole("region", { name: "Dossier records" }); await expect(list).toContainText("friendship"); await expect(list).toContainText("family");
  await list.getByRole("button").filter({ hasText: "friendship" }).click();
  await page.getByRole("button", { name: "Why? Evidence 1", exact: true }).click();
  await expect(page.getByRole("blockquote")).toContainText("Alex and Mira are friends.");
  await page.getByText("Correct source analysis", { exact: true }).click();
  await page.getByLabel("Review action").selectOption("classification");
  await page.getByLabel("Classification", { exact: true }).selectOption("inference");
  await page.getByLabel("Correction reason").fill("Relationship interpretation needs reviewer qualification.");
  await page.getByLabel("I am correcting the source analysis, not choosing changes for an adaptation.").check();
  await page.getByRole("button", { name: "Save analysis correction" }).click();
  await expect(page.getByText("Dossier v2: draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve dossier", exact: true }).click();
  await expect(page.getByText("Source Dossier approved.", { exact: true })).toBeVisible();
  await page.getByText("Dossier version history (2)", { exact: true }).click();
  await page.getByLabel("Historical version").selectOption({ label: "v1 / 0 corrections" });
  await page.getByRole("button", { name: "Compare with current" }).click();
  await expect(page.getByText(/Material changed/)).toBeVisible();
  await page.getByRole("button", { name: "Restore as draft", exact: true }).click();
  await expect(page.getByText("Dossier v3: draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve dossier", exact: true }).click();
  await expect(page.getByText("Dossier v3: approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Long-form workflow" }).getByRole("button", { name: "Source analysis approved", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("a3-desktop-dossier.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: testInfo.outputPath("a3-mobile-dossier.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await expect(page.getByText("Dossier v3: approved", { exact: true })).toBeVisible();
  const after = (await (await request.get(`/api/long-form/projects/${created.project.id}`)).json());
  expect(after.bible).toBeNull(); expect(after.routes).toBeNull(); expect(after.brief.id).toBe(created.brief.id);
});

test("A3 explicit identity merge and split remap dependent references, without adaptation overrides", async ({ page, request }) => {
  const created = await (await request.post("/api/long-form/projects", { data: { name: "Identity review" } })).json(); createdProjects.push(created.project.id);
  const root = `/api/long-form/projects/${created.project.id}/source-analysis`;
  await request.post(`/api/projects/${created.project.id}/source/text`, { data: { text: manuscript } }); await request.post(`${root}/scope`, { data: { entireWork: true } });
  const plan = await (await request.post(`${root}/preview`, { data: {} })).json(); const job = await (await request.post(`${root}/plans/${plan.id}/start`, { data: { fingerprint: plan.fingerprint } })).json();
  await expect.poll(async () => (await (await request.get(`${root}/jobs/${job.id}`)).json()).status).toBe("completed");
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "source-analysis"); }, created.project.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click(); await page.getByLabel("Category", { exact: true }).selectOption("character");
  const list = page.getByRole("region", { name: "Dossier records" }); await list.getByRole("button").filter({ hasText: "Alex: identity" }).click();
  await page.getByText("Correct source analysis", { exact: true }).click(); await page.getByLabel("Review action").selectOption("merge");
  await page.getByLabel("Identity to merge into this record").selectOption({ label: "Alexander: identity" });
  await page.getByLabel("Correction reason").fill("Both names refer to the same source person."); await page.getByLabel("I am correcting the source analysis, not choosing changes for an adaptation.").check();
  await page.getByRole("button", { name: "Save analysis correction" }).click(); await expect(page.getByText("Dossier v2: draft", { exact: true })).toBeVisible();
  const merged = await (await request.get(`${root}/export`)).json(); const target = merged.records.find((r: { identityKey: string; field: string; status: string }) => r.identityKey === "Alex" && r.field === "identity" && r.status === "supported");
  const rejected = merged.records.find((r: { identityKey: string; field: string }) => r.identityKey === "Alexander" && r.field === "identity");
  expect(merged.records.flatMap((r: { references: string[] }) => r.references)).not.toContain(rejected.id);
  await list.getByRole("button").filter({ hasText: "Alex: identity" }).click(); await page.getByText("Correct source analysis", { exact: true }).click(); await page.getByLabel("Review action").selectOption("split");
  await page.getByRole("group", { name: "Resulting identity 1" }).getByLabel("Name", { exact: true }).fill("Alex");
  await page.getByRole("group", { name: "Resulting identity 2" }).getByLabel("Name", { exact: true }).fill("Alexander");
  await page.getByRole("group", { name: "Resulting identity 2" }).getByLabel("Source identity claim").fill("Alexander");
  await expect(page.locator('.source-correction label').filter({ hasText: /refers to/ }).first()).toBeVisible();
  for (const select of await page.locator('.source-correction label').filter({ hasText: /belongs to|refers to/ }).locator('select').all()) await select.selectOption("both");
  await page.getByLabel("Correction reason").fill("Separate source identities with explicit evidence and dependent assignments."); await page.getByLabel("I am correcting the source analysis, not choosing changes for an adaptation.").check();
  await page.getByRole("button", { name: "Save analysis correction" }).click(); await expect(page.getByText("Dossier v3: draft", { exact: true })).toBeVisible();
  const split = await (await request.get(`${root}/export`)).json(); expect(split.records.flatMap((r: { references: string[] }) => r.references)).not.toContain(target.id);
  expect(split.provenance).toEqual(merged.provenance);
});

test("A3 large-source metadata stays paginated and cancellation cannot publish a late dossier", async ({ page, request }, testInfo) => {
  const created = await (await request.post("/api/long-form/projects", { data: { name: "Large source" } })).json(); createdProjects.push(created.project.id);
  const text = Array.from({ length: 60 }, (_, i) => `Chapter ${i + 1}\n\n${"A quiet harbor. ".repeat(150)}`).join("\n\n");
  await request.post(`/api/projects/${created.project.id}/source/text`, { data: { text } });
  await page.goto("/"); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "source-analysis"); }, created.project.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  const chapters = page.getByRole("group", { name: "Chapters to analyze" }); await expect(chapters.getByRole("checkbox")).toHaveCount(50);
  await page.getByRole("navigation", { name: "Chapter pages" }).getByRole("button", { name: "Next" }).click(); await expect(chapters.getByRole("checkbox")).toHaveCount(10);
  await page.getByRole("button", { name: "Select entire work" }).click(); await page.getByRole("button", { name: "Preview analysis", exact: true }).click();
  await page.getByLabel("Authorize this exact source-analysis request").check(); await page.getByRole("button", { name: "Start source analysis" }).click();
  await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
  await expect(page.getByText("Analysis cancelled.", { exact: true })).toBeVisible(); await page.waitForTimeout(300);
  await expect(page.getByRole("region", { name: "Source Dossier review" })).not.toBeVisible();
  expect((await request.get(`/api/long-form/projects/${created.project.id}/source-analysis/dossier`)).status()).toBe(404);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: testInfo.outputPath("a3-mobile-large-source.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
