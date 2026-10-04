import { expect, test as base, type APIRequestContext, type Page } from "playwright/test";
import { spawn } from "node:child_process";

const test = base.extend<{}, { editingBaseURL: string }>({
  editingBaseURL: [async ({}, use) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { buildApp } from './apps/server/dist/app.js';
      import { createOfflineSetupClient } from './apps/server/dist/services/offline-setup-provider.js';
      import { OfflineEditProvider } from './apps/server/dist/services/conversational-edit-provider.js';
      const offline = new OfflineEditProvider();
      const conversationalEditProvider = { id: 'offline-edit', async generate(plan, signal) {
        if (plan.request.message === 'Add setup without payoff') return { message: 'Review the nonblocking continuity warning', groups: [{ id: 'thread-setup', label: 'Thread setup', explanation: 'Add only the selected setup', dependsOnGroupIds: [], operations: [{ kind: 'set-fields', targetKey: plan.targets[0].key, changes: { setupPassageIds: [plan.targets[0].value.description] } }] }] };
        return offline.generate(plan, signal);
      } };
      const app = buildApp({ databasePath: ':memory:', openRouterClient: createOfflineSetupClient(), conversationalEditProvider });
      console.log(JSON.stringify({ address: await app.listen({ port: 0, host: '127.0.0.1' }) }));
      process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    let errors = ""; child.stderr.on("data", (chunk) => { errors += String(chunk); });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Editing server startup timed out: ${errors}`)), 10_000);
        let output = "";
        child.stdout.on("data", (chunk) => { output += String(chunk); for (const line of output.split("\n")) try { const result = JSON.parse(line); if (result.address) { clearTimeout(timeout); resolve(result.address); } } catch { /* Wait for the complete startup record. */ } });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Editing server exited: ${errors}`)); });
      });
      await use(address);
    } finally { if (child.exitCode === null) await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); }
  }, { scope: "worker" }],
  baseURL: async ({ editingBaseURL }, use) => { await use(editingBaseURL); },
});

async function establishedProject(request: APIRequestContext, large = false) {
  const post = async (url: string, data?: unknown) => { const r = await request.post(url, { data }); await expect(r).toBeOK(); return r.json(); };
  const put = async (url: string, data: unknown) => { const r = await request.put(url, { data }); await expect(r).toBeOK(); return r.json(); };
  const created = await post("/api/long-form/projects", { name: "A6 harbor editing" }), id = created.project.id, root = `/api/long-form/projects/${id}`;
  await post(`${root}/brief/approve`, { versionId: created.brief.id }); await post(`${root}/creative-direction/approve`, { versionId: created.creativeDirection.id });
  for (const owner of ["bible", "routes", "endings", "mechanics"]) {
    let version = (await post(`${root}/${owner}`))[owner];
    if (owner === "bible") version = (await put(`${root}/bible`, { ...version.content, characters: ["Mira", "Jules"].map((name) => ({ id: `character-${name.toLowerCase()}`, name, role: "Ally", summary: "", motivations: [], knowledge: [], plannedArc: "" })) })).bible;
    if (owner === "mechanics") version = (await put(`${root}/mechanics`, { ...version.content, choiceEffectPlans: [{ id: "effect-edit", label: "Harbor state", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [...version.content.visibleStats, ...version.content.relationships].map((m: { key: string }) => m.key), effectGuidance: ["Exercise state"] }] })).mechanics;
    await post(`${root}/${owner}/approve`, { versionId: version.id });
  }
  let plan = await post(`${root}/passage-plan`);
  if (large) {
    const routeId = plan.passages.find((p: { content: { routeIds: string[] } }) => p.content.routeIds.length).content.routeIds[0];
    const terminal = plan.passages.find((p: { content: { endingId: string | null; routeIds: string[] } }) => p.content.endingId && p.content.routeIds.includes(routeId)).content;
    const passage = plan.passages[0].content, choice = plan.choices[0].content;
    const ids = Array.from({ length: 300 }, (_, i) => `passage-${String(i).padStart(3, "0")}`);
    plan = await put(`${root}/passage-plan`, { schemaVersion: 1,
      structure: { schemaVersion: 1, title: "Large editing plan", projectWordTarget: 150000, typicalPathWordTarget: 150000, startPassageId: ids[0], characterAvailability: [],
        acts: [{ id: "act-main", label: "Main act", purpose: "", summary: "", wordTarget: 150000, routeIds: [routeId], sequenceIds: ["sequence-main"], position: 0 }],
        sequences: [{ id: "sequence-main", actId: "act-main", label: "Main sequence", purpose: "", summary: "", wordTarget: 150000, routeIds: [routeId], passageIds: ids, entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned" }] },
      passages: ids.map((id, i) => ({ ...passage, id, sequenceId: "sequence-main", title: `Passage ${i}`, kind: i === 299 ? "epilogue" : "scene", purpose: `Plan beat ${i}`, summary: "", wordTarget: 500, routeIds: [routeId], choiceIds: i === 299 ? [] : [`choice-${i}`], terminal: i === 299, endingId: i === 299 ? terminal.endingId : null, planningStatus: "planned", position: i })),
      choices: ids.slice(0, -1).map((id, i) => ({ ...choice, id: `choice-${i}`, sourcePassageId: id, destinationPassageId: ids[i + 1], label: "Continue", effects: [], sourceDecisionIds: [], position: 0 })), threads: [] });
  }
  return { id, root, plan };
}
async function openEditing(page: Page, id: string) {
  await page.goto("/"); await page.evaluate((projectId) => { localStorage.setItem("story-to-cyoa.long-form-project-id", projectId); localStorage.setItem("story-to-cyoa.long-form-stage", "editing"); }, id);
  await page.getByRole("button", { name: "Long-form workspace" }).click(); await expect(page.getByRole("heading", { name: "Conversational editing", exact: true })).toBeVisible();
}

test("A6 exact scope, explicit generation, saved review and transactional Apply work on desktop and mobile", async ({ page, request }, info) => {
  const f = await establishedProject(request); await openEditing(page, f.id);
  const before = await (await request.get(f.root)).json();
  await page.getByLabel("Editing request").fill('Rename Mira to "Ren"'); await page.getByRole("button", { name: "Preview editing scope" }).click();
  const preview = page.getByRole("region", { name: "Editing generation preview" }); await expect(preview).toContainText("character-mira"); await expect(preview).toContainText("$0.00 (offline)");
  await expect(page.getByRole("button", { name: "Generate editing response" })).toBeDisabled();
  expect((await (await request.get(f.root)).json()).bible.id).toBe(before.bible.id);
  await page.getByLabel("Authorize this exact editing generation").check(); await page.getByRole("button", { name: "Generate editing response" }).click();
  await expect(page.getByRole("heading", { name: "Review proposal", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: "Open saved proposal" })).toBeVisible(); await page.getByRole("button", { name: "Open saved proposal" }).click();
  await page.getByRole("button", { name: "Review selected changes" }).click(); const review = page.getByRole("region", { name: "Effective editing changes" }); await expect(review).toContainText("Accepted and locked prose");
  await review.getByText("bible / character-mira: before and after", { exact: true }).click(); await expect(review).toContainText('"name": "Ren"');
  expect((await (await request.get(f.root)).json()).bible.id).toBe(before.bible.id);
  await page.screenshot({ path: info.outputPath("a6-desktop-review.png"), fullPage: true });
  await page.locator(".edit-workspace").evaluate((el) => el.scrollIntoView({ block: "start" })); await page.screenshot({ path: info.outputPath("a6-desktop-viewport.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator(".edit-workspace").evaluate((el) => el.scrollIntoView({ block: "start" })); await page.screenshot({ path: info.outputPath("a6-mobile-review.png"), fullPage: true }); await page.screenshot({ path: info.outputPath("a6-mobile-viewport.png") });
  const heading = await page.getByRole("heading", { name: "Conversational editing", exact: true }).boundingBox(), nav = await page.locator(".app-mode-nav").boundingBox(); expect(heading!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
  const after = await (await request.get(f.root)).json(); expect(after.bible.content.characters[0]).toMatchObject({ id: "character-mira", name: "Ren" }); expect(after.bible.content.characters[1]).toEqual(before.bible.content.characters[1]); expect(after.workflow.bible.status).toBe("draft");
  expect(after.workflow.bible.approvedVersionId).toBe(before.bible.id); expect(after.brief.id).toBe(before.brief.id);
});

test("A6 ambiguous scope, adjusted authorization, discussion and prose candidate routing remain noncanonical", async ({ page, request }) => {
  const f = await establishedProject(request); await openEditing(page, f.id);
  let generations = 0; page.on("request", (r) => { if (r.url().includes("/editing/plans/") && r.url().endsWith("/generate")) generations++; });
  await page.getByLabel("Editing request").fill("Change the ending"); await page.getByRole("button", { name: "Preview editing scope" }).click(); await expect(page.getByRole("heading", { name: "Clarify scope" })).toBeVisible(); expect(generations).toBe(0);
  await page.getByLabel("Find planning records").fill("bible:character-mira"); await page.getByRole("checkbox", { name: /bible \/ Mira/ }).check();
  await page.getByLabel("Editing request").fill("Discuss Mira's motivation"); await page.getByRole("radio", { name: "Discuss", exact: true }).check(); await page.getByRole("button", { name: "Preview editing scope" }).click();
  await page.getByLabel("Authorize this exact editing generation").check(); await page.getByLabel("Editing request").fill("Discuss Mira's choices"); await expect(page.getByRole("button", { name: "Generate editing response" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview editing scope" }).click(); await page.getByLabel("Authorize this exact editing generation").check(); await page.getByRole("button", { name: "Generate editing response" }).click(); await expect(page.getByText(/This is discussion only/).first()).toBeVisible(); expect(generations).toBe(1);
  await page.getByRole("button", { name: "Remove", exact: true }).click(); const passageId = f.plan.passages[0].entityId;
  await page.getByLabel("Find planning records").fill(`passage:${passageId}`); await page.getByRole("checkbox", { name: /passage \// }).first().check();
  await page.getByLabel("Editing request").fill("Rewrite passage prose"); await page.getByRole("button", { name: "Preview editing scope" }).click(); await expect(page.getByRole("button", { name: "Open passage drafting" })).toBeEnabled();
  await page.getByRole("button", { name: "Open passage drafting" }).click(); await expect(page.getByRole("heading", { name: "Passage plan", exact: true })).toBeVisible();
  expect(generations).toBe(1); expect((await (await request.get(`${f.root}/drafts/review-queue`)).json()).items.every((i: { acceptedVersionId: unknown }) => !i.acceptedVersionId)).toBe(true);
});

test("A6 300-passage flow is metadata-first, bounded, and changes one exact entity", async ({ page, request }, info) => {
  const f = await establishedProject(request, true), root = `${f.root}/editing`; await openEditing(page, f.id);
  await page.getByLabel("Find planning records").fill("passage:"); await expect(page.getByRole("region", { name: "Planning records" }).getByRole("checkbox")).toHaveCount(50);
  await page.getByRole("button", { name: "Next records" }).click(); await expect(page.getByText("51-100 of 300", { exact: true })).toBeVisible();
  await page.getByLabel("Find planning records").fill("passage:passage-249"); await page.getByRole("checkbox", { name: /passage \/ Passage 249/ }).check();
  await page.getByLabel("Editing request").fill('Change this passage to "Harbor handoff"');
  const response = page.waitForResponse((r) => r.url().endsWith("/editing/preview")); await page.getByRole("button", { name: "Preview editing scope" }).click(); const plan = (await (await response).json()).plan;
  expect(plan.targets.map((t: { targetId: string }) => t.targetId)).toEqual(["passage-249"]); expect(plan.contextBytes).toBeLessThan(64000); expect(plan.context.targets).toHaveLength(1); expect(plan.context.references.length).toBeLessThanOrEqual(80);
  expect(JSON.stringify(plan.context)).not.toContain('"title":"Passage 299"');
  await page.getByLabel("Authorize this exact editing generation").check(); await page.getByRole("button", { name: "Generate editing response" }).click(); await page.getByRole("button", { name: "Review selected changes" }).click();
  await page.screenshot({ path: info.outputPath("a6-large-project.png"), fullPage: true }); await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
  const after = await (await request.get(`${f.root}/passage-plan`)).json(); expect(after.passages).toHaveLength(300);
  for (const passage of after.passages) { const old = f.plan.passages.find((p: { entityId: string }) => p.entityId === passage.entityId); if (passage.entityId === "passage-249") expect(passage.content.title).toBe("Harbor handoff"); else expect(passage.id).toBe(old.id); }
  const conversation = (await (await request.get(`${root}/conversations`)).json())[0], history = await (await request.get(`${root}/conversations/${conversation.id}`)).json();
  expect(history.proposals[0].status).toBe("applied"); expect(JSON.stringify(history)).not.toContain("headFingerprint");
});

test("A6 review exposes effective passage warnings through HTTP and UI without blocking Apply", async ({ page, request }, info) => {
  const f = await establishedProject(request), passageId = f.plan.passages[0].entityId, threadId = "thread-warning";
  const saved = await request.put(`${f.root}/passage-plan`, { data: { schemaVersion: 1, structure: f.plan.structure.content,
    passages: f.plan.passages.map((v: { content: unknown }) => v.content), choices: f.plan.choices.map((v: { content: unknown }) => v.content),
    threads: [{ id: threadId, label: "Trust", description: passageId, setupPassageIds: [], payoffPassageIds: [], routeIds: [], required: false, status: "planned", waiverRationale: "" }] } }); await expect(saved).toBeOK();
  await openEditing(page, f.id); await page.getByLabel("Find planning records").fill(`thread:${threadId}`);
  await page.getByRole("checkbox", { name: /thread \/ Trust/ }).check(); await page.getByLabel("Editing request").fill("Add setup without payoff");
  await page.getByRole("button", { name: "Preview editing scope" }).click(); await page.getByLabel("Authorize this exact editing generation").check(); await page.getByRole("button", { name: "Generate editing response" }).click();
  const reviewed = page.waitForResponse((r) => r.url().endsWith("/review") && r.url().includes("/editing/proposals/")); await page.getByRole("button", { name: "Review selected changes" }).click();
  const result = await (await reviewed).json(); expect(result.findings).toContainEqual(expect.objectContaining({ code: "continuity.thread.setup-without-payoff", entityType: "thread", entityId: threadId, evidence: [passageId], severity: "warning" }));
  expect(result.validation.totalFindings).toBe(result.findings.length + result.validation.omittedFindings);
  const review = page.getByRole("region", { name: "Effective editing changes" }); await review.getByText("Validation and evidence", { exact: true }).click();
  await expect(review.getByText(`continuity.thread.setup-without-payoff / thread / ${threadId}`, { exact: true })).toBeVisible(); await expect(review.getByText("warning: Narrative thread is set up but has no payoff.", { exact: true })).toBeVisible();
  await expect(review.getByRole("listitem").filter({ hasText: passageId }).first()).toBeVisible(); await page.screenshot({ path: info.outputPath("a6-warning-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
  const after = await (await request.get(`${f.root}/passage-plan`)).json(); expect(after.threads[0].content.setupPassageIds).toEqual([passageId]);
});
