// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { PlayPreview } from "../src/features/play/PlayPreview.js";

afterEach(cleanup);

test("shows a locked gate choice after advancing to the gate", async () => {
  const user = userEvent.setup();
  render(<PlayPreview />);

  expect(screen.getByText("The orchard waits in rain.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Continue" }));

  expect((screen.getByRole("button", { name: "Locked: Enter without a token" }) as HTMLButtonElement).disabled).toBe(true);
});
