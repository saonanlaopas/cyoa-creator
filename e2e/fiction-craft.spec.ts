import { expect, test } from "playwright/test";

for (const width of [1280, 390]) for (const mode of ["quick", "long-form"]) {
  test(`Fiction Craft creative preference review, ${mode}, ${width}px`, async ({ page, request }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const created = await (await request.post(mode === "quick" ? "/api/quick/drafts" : "/api/long-form/projects", { data: { name: "Neutral craft settings" } })).json();
    const projectId = mode === "quick" ? created.projectId : created.project.id;
    const workflowBefore = mode === "long-form" ? (await (await request.get(`/api/long-form/projects/${projectId}`)).json()).workflow : null;
    const endpoint = `/api/projects/${projectId}/authoring/`;
    const bootstrapDrafts: string[] = [];
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/quick/drafts") bootstrapDrafts.push(request.url());
    });
    try {
      const read = async () => (await request.post(endpoint+"read_authoring_settings", { data: {} })).json();
      const before = await read(); expect(before.context.enabled).toBe(true);
      const command = await request.post(`/api/projects/${projectId}/commands`, { data: { name: "Neutral voice", instruction: "Use present tense and quiet humor." } }); await expect(command).toBeOK();
      // Establish the origin without mounting Quick: an empty Quick visit creates a
      // draft whose late response can overwrite the fixture's selected project.
      await page.goto("/api/health");
      await page.evaluate(({ projectId, mode }) => localStorage.setItem(mode === "quick" ? "story-to-cyoa.active-project-id" : "story-to-cyoa.long-form-project-id", projectId), { projectId, mode });
      await page.goto(mode === "quick" ? "/" : "/#long-form"); await page.reload();
      if (mode === "long-form") await page.getByRole("button", { name: "Authoring preferences", exact: true }).click();
      const panel = page.locator("details.authoring-settings"); await panel.locator("summary").focus(); await page.keyboard.press("Enter");
      const checkbox = panel.getByRole("checkbox", { name: "Use the shared Fiction Craft Guide for future authoring" });
      await expect(checkbox).toBeChecked();
      expect(await page.evaluate(mode => localStorage.getItem(mode === "quick" ? "story-to-cyoa.active-project-id" : "story-to-cyoa.long-form-project-id"), mode)).toBe(projectId);
      await checkbox.focus(); await page.keyboard.press("Space");
      await panel.getByRole("button", { name: "Review preference change" }).click();
      await expect(panel.getByText("1 custom instructions retained.")).toBeVisible();
      await panel.getByRole("button", { name: "Cancel preference change" }).click(); expect((await read()).context.enabled).toBe(true);
      await panel.getByRole("button", { name: "Review preference change" }).click();
      await expect(panel.getByRole("button", { name: "Apply reviewed preference" })).toBeVisible();
      await panel.screenshot({ path: info.outputPath(`craft-${mode}-${width}-panel.png`) });
      await info.attach("settled-review-panel", { path: info.outputPath(`craft-${mode}-${width}-panel.png`), contentType: "image/png" });
      await page.screenshot({ path: info.outputPath(`craft-${mode}-${width}-review.png`), fullPage: true });
      await info.attach("preference-review", { path: info.outputPath(`craft-${mode}-${width}-review.png`), contentType: "image/png" });
      await panel.getByRole("button", { name: "Apply reviewed preference" }).focus(); await page.keyboard.press("Enter");
      await expect(panel.getByRole("status")).toContainText("Authoring preference saved");
      const after = await read(); expect(after.context.enabled).toBe(false); expect(after.context.appliedGuide).toBeNull(); expect(after.context.customInstructions[0].instruction).toBe("Use present tense and quiet humor.");
      await page.reload(); await panel.locator("summary").click(); await expect(checkbox).not.toBeChecked();
      expect(await panel.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
      await page.screenshot({ path: info.outputPath(`craft-${mode}-${width}-saved.png`), fullPage: true });
      await info.attach("saved-preference", { path: info.outputPath(`craft-${mode}-${width}-saved.png`), contentType: "image/png" });
      if (mode === "long-form") expect((await (await request.get(`/api/long-form/projects/${projectId}`)).json()).workflow).toEqual(workflowBefore);
      expect(bootstrapDrafts).toEqual([]);
    } finally { await request.post(`/api/projects/${projectId}/archive`, { data: {} }); }
  });
}

test("Quick preferences fit a wider local fallback font", async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { projectId } = await (await request.post("/api/quick/drafts", { data: { name: "Neutral font bounds" } })).json();
  try {
    await page.goto("/api/health");
    await page.evaluate(id => localStorage.setItem("story-to-cyoa.active-project-id", id), projectId);
    await page.goto("/");
    // A real installed fallback exposes the native file input's intrinsic width.
    // Do not depend on the runner's default system font to reveal grid overflow.
    await page.addStyleTag({ content: ':root { font-family: "DejaVu Sans", sans-serif; }' });
    const panel = page.locator("details.authoring-settings");
    await panel.locator("summary").click();
    await expect(panel.getByRole("checkbox")).toBeChecked();
    const geometry = await panel.evaluate(el => {
      const box = el.getBoundingClientRect();
      const source = document.querySelector<HTMLInputElement>('input[type="file"]')!.getBoundingClientRect();
      return { viewport: innerWidth, panel: { left: box.left, right: box.right }, source: { left: source.left, right: source.right } };
    });
    await info.attach("fallback-font-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("craft-quick-390-fallback.png"), fullPage: true });
    await info.attach("fallback-font-bounds", { path: info.outputPath("craft-quick-390-fallback.png"), contentType: "image/png" });
    expect(geometry.panel.left >= 0 && geometry.panel.right <= geometry.viewport).toBe(true);
    expect(geometry.source.left >= 0 && geometry.source.right <= geometry.viewport).toBe(true);
  } finally {
    await request.post(`/api/projects/${projectId}/archive`, { data: {} });
  }
});
