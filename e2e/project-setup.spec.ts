import { expect, test as base } from "playwright/test";
import { spawn } from "node:child_process";

// Setup owns its server/database so parallel CI cannot expose its temporary projects to older browser journeys.
const test = base.extend<{}, { setupBaseURL: string }>({
  setupBaseURL: [async ({}, use) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { buildApp } from './apps/server/dist/app.js';
      import { createOfflineSetupClient } from './apps/server/dist/services/offline-setup-provider.js';
      const app = buildApp({ databasePath: ':memory:', openRouterClient: createOfflineSetupClient() });
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      console.log(JSON.stringify({ address }));
      process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Setup server startup timed out: ${errors}`)), 10000);
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          for (const line of output.split("\n")) {
            try {
              const result = JSON.parse(line) as { address?: string };
              if (result.address) { clearTimeout(timeout); resolve(result.address); }
            } catch { /* Wait for a complete startup line. */ }
          }
        });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Setup server exited: ${errors}`)); });
      });
      await use(address);
    } finally {
      if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    }
  }, { scope: "worker" }],
  baseURL: async ({ setupBaseURL }, use) => { await use(setupBaseURL); },
});

const createdProjects: string[] = [];
test.afterEach(async ({ request }) => {
  for (const projectId of createdProjects.splice(0)) await expect(await request.post(`/api/projects/${projectId}/archive`)).toBeOK();
});

test("A2 author journey reviews, edits and explicitly applies foundations without generating passages", async ({ page, request }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  await page.getByRole("button", { name: "Talk through an original idea" }).click();
  await expect(page.getByRole("heading", { name: "Talk it through" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve brief" })).not.toBeVisible();
  const projectId = await page.evaluate(() => localStorage.getItem("story-to-cyoa.long-form-project-id"));
  if (projectId) createdProjects.push(projectId);
  const url = `/api/long-form/projects/${projectId}`;
  const before = await (await request.get(url)).json();
  const composer = page.getByLabel("Your idea or clarification");
  await composer.fill("I want a 20k slow-burn BL about two guys who already like each other. Warm, descriptive, lots of interiority, some angst but low melodrama.");
  await page.getByRole("button", { name: "Save idea", exact: true }).click();
  await page.getByRole("button", { name: "Ask Studio", exact: true }).click();
  await expect(page.getByText("Ready for a draft proposal", { exact: true })).toBeVisible();
  await expect(page.getByText(/Is 20,000 words the length of one read-through/)).toBeVisible();
  await composer.fill("That is per playthrough. They are named Haru and Ren. First-person present tense, set in a mountain town.");
  await page.getByRole("button", { name: "Save idea", exact: true }).click();
  await page.getByRole("button", { name: "Ask Studio", exact: true }).click();
  await expect(page.getByText(/Named characters: Haru, Ren\./)).toBeVisible();
  await page.getByRole("button", { name: "Preview proposal context" }).click();
  await expect(page.getByRole("button", { name: "Draft foundation proposal" })).toBeDisabled();
  await page.getByLabel("Authorize this exact proposal request").check();
  await page.getByRole("button", { name: "Draft foundation proposal" }).click();
  const proposal = page.getByRole("region", { name: "Foundation proposal" });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByText("Status: proposed", { exact: true })).toBeVisible();
  const unapplied = await (await request.get(url)).json();
  expect(unapplied.brief.id).toBe(before.brief.id); expect(unapplied.creativeDirection.id).toBe(before.creativeDirection.id); expect(unapplied.bible).toBeNull();
  await proposal.locator("article").filter({ has: page.getByLabel("Project shape", { exact: true }) }).getByText(/Review \d+ proposed fields/).click();
  const premise = proposal.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^Premise$/ }) });
  await premise.getByText("Edit proposed value", { exact: true }).click();
  await proposal.getByRole("textbox", { name: "Premise", exact: true }).fill("Haru and Ren return to a mountain town with feelings neither has confessed.");
  await expect(page.getByRole("button", { name: "Apply selected foundations" })).toBeDisabled();
  await page.getByRole("button", { name: "Save edits for review" }).click();
  await expect(proposal.getByText("Status: proposed", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Haru and Ren return to a mountain town with feelings neither has confessed.", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("a2-desktop-review.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("a2-mobile-review.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Apply selected foundations" }).click();
  await expect(page.getByText("Selected foundations applied as drafts, not approved. No passages generated.", { exact: true })).toBeVisible();
  const after = await (await request.get(url)).json();
  expect(after.brief.content.premise).toBe("Haru and Ren return to a mountain town with feelings neither has confessed.");
  expect(after.creativeDirection.content.prose.pointOfView).toBe("first-person");
  expect(after.creativeDirection.content.prose.tense).toBe("present");
  expect(after.bible.content.characters.map((item: { name: string }) => item.name)).toEqual(["Haru", "Ren"]);
  for (const artifact of ["brief", "creative-direction", "bible"]) {
    expect(after.workflow[artifact].status).toBe("draft"); expect(after.workflow[artifact].approvedVersionId).toBeNull();
  }
  const passages = await request.get(`${url}/passage-plan`);
  expect(passages.status() === 404 || (await passages.json()).structure == null).toBe(true);
  await page.reload(); await expect(page.getByText("Status: applied", { exact: true })).toBeVisible();
  await page.getByText("Advanced workspace", { exact: true }).click();
  await page.getByRole("button", { name: /Project brief/ }).click();
  await expect(page.getByPlaceholder("What is this adaptation or original story about?")).toHaveValue(after.brief.content.premise);
});

test("A2 non-romance detective refinement stays noncanonical and can be rejected", async ({ page, request }) => {
  const created = await (await request.post("/api/long-form/setup-projects", { data: { name: "Flooded detective" } })).json();
  createdProjects.push(created.project.id);
  await page.goto("/");
  await page.evaluate((projectId) => {
    localStorage.setItem("story-to-cyoa.long-form-project-id", projectId);
    localStorage.setItem("story-to-cyoa.long-form-stage", "setup");
  }, created.project.id);
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  for (const content of ["I want a detective story in a flooded city.", "Actually make the detective retired and reluctant.", "Keep it melancholy but not hopeless."]) {
    await page.getByLabel("Your idea or clarification").fill(content);
    await page.getByRole("button", { name: "Save idea", exact: true }).click();
  }
  await page.getByRole("button", { name: "Ask Studio", exact: true }).click();
  await expect(page.getByText("Ready for a draft proposal", { exact: true })).toBeVisible();
  const understanding = page.getByRole("region", { name: "What Studio understands" });
  expect(await understanding.innerText()).not.toMatch(/romance|romantic|slow-burn|intimacy|attraction/i);
  await page.getByRole("button", { name: "Preview proposal context" }).click();
  await page.getByLabel("Authorize this exact proposal request").check();
  await page.getByRole("button", { name: "Draft foundation proposal" }).click();
  const proposal = page.getByRole("region", { name: "Foundation proposal" });
  await expect(proposal).toBeVisible(); expect(await proposal.innerText()).not.toMatch(/romance|romantic|slow-burn|intimacy|attraction/i);
  await page.getByRole("button", { name: "Reject proposal" }).click();
  await expect(page.getByText("Status: rejected", { exact: true })).toBeVisible();
  const after = await (await request.get(`/api/long-form/projects/${created.project.id}`)).json();
  expect(after.brief.id).toBe(created.brief.id); expect(after.creativeDirection.id).toBe(created.creativeDirection.id); expect(after.bible).toBeNull();
});
