import type { Page } from "playwright/test";

export async function continuePlayerResult(page: Page) {
  const next = page.getByRole("button", { name: "Continue after result", exact: true });
  if (await next.isVisible()) await next.click();
}

export async function showPlayerWorldView(page: Page, name: string) {
  await continuePlayerResult(page);
  await page.getByRole("navigation", { name: "World views", exact: true }).getByRole("button", { name, exact: true }).click();
}
