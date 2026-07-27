// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandManager } from "../src/features/generator/CommandManager.js";
import { GenerationActivity } from "../src/features/generator/GenerationActivity.js";
import { GenerationErrorPanel } from "../src/features/generator/GenerationErrorPanel.js";
import type { InstructionCommand } from "../src/api/quick-generation.js";
import { QuickGenerator } from "../src/features/generator/QuickGenerator.js";

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
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("QuickGenerator draft persistence", () => {
  it("reuses a verified stored draft after refresh", async () => {
    localStorage.setItem("story-to-cyoa.active-project-id", "saved");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/settings/openrouter") return response({ configured: false });
      if (path === "/api/projects/saved") return response({ id: "saved" });
      return response([]);
    });
    render(<QuickGenerator />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/saved"));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/quick/drafts", expect.anything());
  });

  it("replaces a stale stored draft safely", async () => {
    localStorage.setItem("story-to-cyoa.active-project-id", "stale");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/settings/openrouter") return response({ configured: false });
      if (path === "/api/projects/stale") return new Response("", { status: 404 });
      if (path === "/api/quick/drafts") return response({ projectId: "fresh" });
      return response([]);
    });
    render(<QuickGenerator />);
    await waitFor(() => expect(localStorage.getItem("story-to-cyoa.active-project-id")).toBe("fresh"));
    expect(fetchMock).toHaveBeenCalledWith("/api/quick/drafts", expect.objectContaining({ method: "POST" }));
  });
});

describe("generation activity and diagnostics", () => {
  it("labels provider activity without rendering provider reasoning text", () => {
    render(<GenerationActivity startedAt={0} now={65_000} events={[
      { type: "status", stage: "request", message: "Sending generation request", at: "t" },
      { type: "reasoning", kind: "summary", text: "Never render this provider text.", at: "t" },
      { type: "reasoning", kind: "encrypted", at: "t" },
    ]} />);

    expect(screen.getByText("1:05 elapsed")).toBeTruthy();
    expect(screen.getByText("Sending generation request")).toBeTruthy();
    expect(screen.getByText("Provider summary received; text withheld for privacy.")).toBeTruthy();
    expect(screen.getByText("Encrypted provider reasoning received; text withheld for privacy.")).toBeTruthy();
    expect(screen.queryByText("Never render this provider text.")).toBeNull();
  });

  it("loads safe diagnostics and confirms before copying source-containing evidence", async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText: copy } as Clipboard);
    const createObjectURL = vi.fn().mockReturnValue("blob:diagnostic");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const loadDiagnostic = vi.fn().mockResolvedValue({
      containsSourceText: true,
      status: 502,
      contentType: "text/html",
      requestId: "req-1",
      body: { text: "<html>bad gateway</html>", truncated: false, originalBytes: 24 },
    });
    render(<GenerationErrorPanel
      error={{ code: "OPENROUTER_ENVELOPE_INVALID", message: "OpenRouter returned a non-JSON response.", retryable: true, diagnosticId: "diag-1" }}
      loadDiagnostic={loadDiagnostic}
      onRetry={vi.fn()}
      onChangeModel={vi.fn()}
    />);

    await user.click(screen.getByRole("button", { name: "View full response" }));
    expect(await screen.findByText("<html>bad gateway</html>")).toBeTruthy();
    expect(screen.getByText(/may contain submitted source text/i)).toBeTruthy();
    expect(screen.queryByText(/authorization/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("bad gateway"));

    await user.click(screen.getByRole("button", { name: "Download full response" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostic");
  });

  it("offers retry and model-change recovery actions", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const changeModel = vi.fn();
    render(<GenerationErrorPanel
      error={{ code: "RATE_LIMITED", message: "OpenRouter generation failed.", retryable: true }}
      loadDiagnostic={vi.fn()}
      onRetry={retry}
      onChangeModel={changeModel}
    />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Try another model" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(changeModel).toHaveBeenCalledOnce();
  });
});

describe("QuickGenerator generation controls", () => {
  it("appends streamed activity in order and keeps it beside a recoverable error", async () => {
    localStorage.setItem("story-to-cyoa.active-project-id", "saved");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/settings/openrouter") return response({ configured: true });
      if (path === "/api/projects/saved") return response({ id: "saved" });
      if (path === "/api/quick/generate") return new Response([
        '{"type":"status","stage":"request","message":"Sending generation request","at":"t"}',
        '{"type":"status","stage":"receiving","message":"Receiving streamed response","at":"t"}',
        '{"type":"reasoning","kind":"summary","text":"do not expose this","at":"t"}',
        '{"type":"error","error":{"code":"RATE_LIMITED","message":"OpenRouter generation failed.","retryable":true},"at":"t"}',
      ].join("\n"), { headers: { "content-type": "application/x-ndjson" } });
      return response([]);
    });
    const user = userEvent.setup();
    render(<QuickGenerator />);

    await user.type(screen.getByPlaceholderText("Paste the story or selected arc here…"), "x".repeat(100));
    await user.click(await screen.findByRole("button", { name: "Generate CYOA" }));

    const stages = within(await screen.findByRole("list", { name: "Generation stages" })).getAllByRole("listitem");
    expect(stages.map((item) => item.textContent)).toEqual(["Sending generation request", "Receiving streamed response"]);
    expect(screen.getByText("Provider summary received; text withheld for privacy.")).toBeTruthy();
    expect(screen.queryByText("do not expose this")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/quick/generate", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"showReasoning":true'),
    }));
  });

  it("aborts the active generation when cancelled", async () => {
    localStorage.setItem("story-to-cyoa.active-project-id", "saved");
    let generationSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/settings/openrouter") return response({ configured: true });
      if (path === "/api/projects/saved") return response({ id: "saved" });
      if (path === "/api/quick/generate") {
        generationSignal = (init as RequestInit | undefined)?.signal ?? undefined;
        return new Response(new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"type":"status","stage":"request","message":"Sending generation request","at":"t"}\n'));
            generationSignal?.addEventListener("abort", () => stream.error(new Error("aborted")));
          },
        }), { headers: { "content-type": "application/x-ndjson" } });
      }
      return response([]);
    });
    const user = userEvent.setup();
    render(<QuickGenerator />);

    await user.type(screen.getByPlaceholderText("Paste the story or selected arc here…"), "x".repeat(100));
    await user.click(await screen.findByRole("button", { name: "Generate CYOA" }));
    await screen.findByRole("button", { name: "Cancel generation" });
    await user.click(screen.getByRole("button", { name: "Cancel generation" }));

    expect(generationSignal?.aborted).toBe(true);
  });

  it("forgets the configured key without reading it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/settings/openrouter" && (init as RequestInit | undefined)?.method === "DELETE") return response({ configured: false });
      if (path === "/api/settings/openrouter") return response({ configured: true });
      if (path === "/api/quick/drafts") return response({ projectId: "fresh" });
      return response([]);
    });
    const user = userEvent.setup();
    render(<QuickGenerator />);

    await user.click(await screen.findByRole("button", { name: "Forget key" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/openrouter", { method: "DELETE" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Forget key" })).toBeNull());
  });
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
    expect(fetchMock).toHaveBeenCalledWith("/api/commands/global/reorder", expect.objectContaining({ method: "PUT", body: JSON.stringify({ ids: ["global-b", "global-a"] }) }));

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

  it("reloads once after a rejected reorder while retaining the mutation error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Reorder IDs must match command scope" }), { status: 400 }));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CommandManager
      projectId="p1"
      globalCommands={[command({ id: "global-a", scope: "global", projectId: null, name: "Canon", position: 0 }), command({ id: "global-b", scope: "global", projectId: null, name: "Style", position: 1 })]}
      projectCommands={[]}
      onChanged={onChanged}
    />);

    await user.click(screen.getByRole("button", { name: "Move Style up" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert").textContent).toContain("Could not save command changes.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry reload after a successful reorder when normal refresh fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const onChanged = vi.fn().mockRejectedValue(new Error("Commands could not be reloaded."));
    const user = userEvent.setup();
    render(<CommandManager
      projectId="p1"
      globalCommands={[command({ id: "global-a", scope: "global", projectId: null, name: "Canon", position: 0 }), command({ id: "global-b", scope: "global", projectId: null, name: "Style", position: 1 })]}
      projectCommands={[]}
      onChanged={onChanged}
    />);

    await user.click(screen.getByRole("button", { name: "Move Style up" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert").textContent).toContain("Commands could not be reloaded.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
