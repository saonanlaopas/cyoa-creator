import { expect, test } from "playwright/test";

test("complete private adaptation offline smoke", async ({ request }) => {
  const health = await request.get("/api/health");
  await expect(health).toBeOK();
  await expect(health.json()).resolves.toEqual({ ok: true, service: "story-to-cyoa" });
  const app = await request.get("/");
  await expect(app).toBeOK();
  await expect(app.text()).resolves.toContain("Story to CYOA");
});
