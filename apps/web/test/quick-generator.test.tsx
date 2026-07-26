// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandManager } from "../src/features/generator/CommandManager.js";
import type { InstructionCommand } from "../src/api/quick-generation.js";

const command = (overrides: Partial<InstructionCommand> = {}): InstructionCommand => ({
  id: "project-tone",
  scope: "project",
  projectId: "p1",
  name: "Tone",
  instruction: "Use a mature tone.",
  enabled: true,
  position: 1,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  ...overrides,
});

const response = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CommandManager", () => {
  it("creates project commands by default and explicitly promotes globally", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[]} onChanged={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Add command" }));
    await user.type(screen.getByLabelText("Command name"), "Tone");
    await user.type(screen.getByLabelText("Instruction"), "Use a mature tone.");
    await user.click(screen.getByRole("button", { name: "Save for this story" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands", expect.objectContaining({ method: "POST" }));

    render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[command()]} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Promote Tone to global" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone/promote", expect.objectContaining({ method: "POST" }));
  });

  it("edits, toggles, deletes, and deterministically reorders within a scope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CommandManager
      projectId="p1"
      globalCommands={[command({ id: "global-a", scope: "global", projectId: null, name: "Canon", position: 10 }), command({ id: "global-b", scope: "global", projectId: null, name: "Style", position: 20 })]}
      projectCommands={[command()]}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />);

    const projectCommand = screen.getByRole("listitem", { name: /Tone/ });
    await user.click(within(projectCommand).getByRole("button", { name: "Edit Tone" }));
    const name = screen.getByLabelText("Command name");
    await user.clear(name);
    await user.type(name, "Voice");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone", expect.objectContaining({ method: "PATCH" }));

    await user.click(within(projectCommand).getByRole("button", { name: "Disable Tone" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }));

    await user.click(screen.getByRole("button", { name: "Move Style up" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/commands/global/global-b", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ position: 10 }) }));
    expect(fetchMock).toHaveBeenCalledWith("/api/commands/global/global-a", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ position: 20 }) }));

    await user.click(within(projectCommand).getByRole("button", { name: "Delete Tone" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone", expect.objectContaining({ method: "DELETE" }));
  });

  it("uses presets to populate the form without saving", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[]} onChanged={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Add command" }));
    await user.click(screen.getByRole("button", { name: "Preset: Preserve characterization" }));

    expect((screen.getByLabelText("Command name") as HTMLInputElement).value).toBe("Preserve characterization");
    expect((screen.getByLabelText("Instruction") as HTMLTextAreaElement).value).toContain("characterization");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
