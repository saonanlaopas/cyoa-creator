import type { Page } from "playwright/test";

export async function continuePlayerResult(page: Page) {
  const next = page.getByRole("button", { name: "Continue after result", exact: true });
  if (await next.isVisible()) await next.click();
}

export async function showPlayerWorldView(page: Page, name: string) {
  await continuePlayerResult(page);
  const nav = playerRail(page).getByRole("navigation", { name: "World views", exact: true });
  if (name === "Shops here" || name === "Give a gift") {
    await nav.getByRole("button", { name: "Explore", exact: true }).click();
    await page.getByRole("region", { name: "World views", exact: true }).getByRole("button", { name, exact: true }).click();
  } else await nav.getByRole("button", { name, exact: true }).click();
}

export const playerRail = (page: Page) => page.getByRole("complementary", { name: "Player navigation" });

export async function useGameMenu(page: Page, name: "Save game" | "Load game" | "Rewind" | "Restart") {
  const group = page.getByRole("region", { name: "Game controls", exact: true });
  const menu = group.locator("details");
  if ((await menu.getAttribute("open")) === null) await group.getByText("Game menu", { exact: true }).click();
  await group.getByRole("button", { name, exact: true }).click();
}

export async function openPlayerWait(page: Page) {
  const menu = page.locator(".player-wait");
  if ((await menu.getAttribute("open")) === null) await menu.getByText("Wait…", { exact: true }).click();
}
