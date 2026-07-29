import { expect, test } from "playwright/test";

const source = "Mara returns to the flooded station before dawn, carrying the brass key her father hid years ago. She knows the town will blame her if the archive burns, but the last train still waits beyond the broken platform.";

test("complete private adaptation offline smoke", async ({ request }) => {
  const health = await request.get("/api/health");
  await expect(health).toBeOK();
  await expect(health.json()).resolves.toEqual({ ok: true, service: "story-to-cyoa" });
  const app = await request.get("/");
  await expect(app).toBeOK();
  await expect(app.text()).resolves.toContain("Story to CYOA");
});

test("observable quick generation stays offline and shows provider activity", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-e2e-fake-key-0123456789");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByRole("button", { name: "Add command" }).click();
  await page.getByLabel("Command name").fill("Continuity");
  await page.getByLabel("Instruction").fill("Keep Mara's promise central to each choice.");
  await page.getByRole("button", { name: "Save for this story" }).click();
  await expect(page.getByRole("heading", { name: "Always apply commands" })).toBeVisible();

  await page.locator("textarea.source").fill(source);
  await page.getByRole("button", { name: "Generate CYOA" }).click();

  await expect(page.getByText("The offline provider planned the branch structure.")).toBeVisible();
  await expect(page.getByText("Repairing structured output")).toBeVisible();
  await expect(page.getByText("Generated game")).toBeVisible();
  await expect(page.getByText("48 tokens")).toBeVisible();
});

test("offline non-JSON provider failure exposes a redacted diagnostic", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-e2e-fake-key-0123456789");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.locator("textarea.source").fill(source);
  await page.getByLabel("Model").fill("e2e/non-json");
  await page.getByRole("button", { name: "Generate CYOA" }).click();

  await expect(page.getByText("OpenRouter returned a non-JSON response.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View full response" }).click();
  await expect(page.getByText("Bearer [REDACTED]")).toBeVisible();
});
