import { useCallback, useEffect, useRef, useState } from "react";
import { loadGenerationDiagnostic, streamQuickGeneration, type InstructionCommand, type PublicGenerationError, type QuickGenerationEvent, type QuickGenerationInput, type QuickGenerationResult } from "../../api/quick-generation.js";
import { CommandManager } from "./CommandManager.js";
import { GenerationActivity } from "./GenerationActivity.js";
import { GenerationErrorPanel } from "./GenerationErrorPanel.js";
import { download, Player } from "./Player.js";

type DraftResponse = { projectId?: unknown };
const activeProjectStorageKey = "story-to-cyoa.active-project-id";

const storedProjectId = (): string | null => {
  try { return localStorage.getItem(activeProjectStorageKey); } catch { return null; }
};
const storeProjectId = (id: string): void => {
  try { localStorage.setItem(activeProjectStorageKey, id); } catch { /* storage is optional */ }
};
const clearStoredProjectId = (): void => {
  try { localStorage.removeItem(activeProjectStorageKey); } catch { /* storage is optional */ }
};

const commandsFrom = async (path: string): Promise<InstructionCommand[]> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Could not load saved commands.");
  return response.json() as Promise<InstructionCommand[]>;
};

export function QuickGenerator() {
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [source, setSource] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("openrouter/auto");
  const [targetPassages, setTargetPassages] = useState(18);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [globalCommands, setGlobalCommands] = useState<InstructionCommand[]>([]);
  const [projectCommands, setProjectCommands] = useState<InstructionCommand[]>([]);
  const [generation, setGeneration] = useState<QuickGenerationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [generationError, setGenerationError] = useState<(PublicGenerationError & { diagnosticId?: string }) | null>(null);
  const [activityEvents, setActivityEvents] = useState<QuickGenerationEvent[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showReasoning, setShowReasoning] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelInput = useRef<HTMLInputElement | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setNow(Date.now());
    timer.current = setInterval(() => setNow(Date.now()), 1_000);
  }, [stopTimer]);

  const createDraft = useCallback(async (): Promise<string> => {
    if (projectId) return projectId;
    const response = await fetch("/api/quick/drafts", { method: "POST" });
    const value = await response.json() as DraftResponse;
    if (!response.ok || typeof value.projectId !== "string") throw new Error("Could not create a story draft.");
    setProjectId(value.projectId);
    storeProjectId(value.projectId);
    return value.projectId;
  }, [projectId]);

  const loadCommands = useCallback(async (id = projectId) => {
    if (!id) return;
    const [global, project] = await Promise.all([
      commandsFrom("/api/commands/global"),
      commandsFrom(`/api/projects/${id}/commands`),
    ]);
    setGlobalCommands(global);
    setProjectCommands(project);
  }, [projectId]);

  useEffect(() => {
    void fetch("/api/settings/openrouter").then((response) => response.json()).then((value: { configured?: unknown }) => setConfigured(Boolean(value.configured))).catch(() => undefined);
    void (async () => {
      const stored = storedProjectId();
      if (stored) {
        try {
          const response = await fetch(`/api/projects/${stored}`);
          if (response.ok) {
            setProjectId(stored);
            await loadCommands(stored);
            return;
          }
        } catch {
          // A stored ID is only a convenience; a new local draft remains safe fallback.
        }
        clearStoredProjectId();
      }
      const id = await createDraft();
      await loadCommands(id);
    })().catch((failure: unknown) => setSetupError(failure instanceof Error ? failure.message : "Could not prepare the story draft."));
  }, [createDraft, loadCommands]);

  useEffect(() => () => {
    controller.current?.abort();
    stopTimer();
  }, [stopTimer]);

  const saveKey = async () => {
    setSetupError("");
    const response = await fetch("/api/settings/openrouter", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    if (!response.ok) return setSetupError("Could not save the OpenRouter key.");
    setKey("");
    setConfigured(true);
  };

  const forgetKey = async () => {
    setSetupError("");
    const response = await fetch("/api/settings/openrouter", { method: "DELETE" });
    if (!response.ok) return setSetupError("Could not forget the OpenRouter key.");
    const value = await response.json() as { configured?: unknown };
    setConfigured(Boolean(value.configured));
  };

  const generate = async () => {
    const activeController = new AbortController();
    controller.current = activeController;
    setBusy(true);
    setSetupError("");
    setGenerationError(null);
    setGeneration(null);
    setActivityEvents([]);
    setStartedAt(Date.now());
    startTimer();
    try {
      const id = await createDraft();
      const input: QuickGenerationInput = { projectId: id, source, instructions, model, targetPassages, showReasoning };
      await streamQuickGeneration(input, (event) => {
        setActivityEvents((events) => [...events, event]);
        if (event.type === "result") {
          setGeneration(event.generation);
          stopTimer();
        }
        if (event.type === "error") {
          setGenerationError({ ...event.error, ...(event.diagnosticId ? { diagnosticId: event.diagnosticId } : {}) });
          stopTimer();
        }
      }, activeController.signal);
    } catch (failure) {
      if (!activeController.signal.aborted) {
        setGenerationError({
          code: "LOCAL_STREAM_INVALID",
          message: failure instanceof Error ? failure.message : "Generation failed.",
          retryable: true,
        });
      }
    } finally {
      stopTimer();
      if (controller.current === activeController) controller.current = null;
      setBusy(false);
    }
  };

  const cancelGeneration = () => {
    controller.current?.abort();
    controller.current = null;
    stopTimer();
    setBusy(false);
  };

  return <main className="generator">
    <header>
      <p className="eyebrow">Private story adaptation studio</p>
      <h1>Story → CYOA</h1>
      <p>Paste a story or load an AO3 HTML/TXT download. The app asks OpenRouter to build a stat-driven branching game, then exports it as Twine/Twee and playable HTML.</p>
    </header>

    <section className="panel">
      <h2>1. OpenRouter</h2>
      <p className={configured ? "status good" : "status"}>{configured ? "API key configured for this session." : "Enter your OpenRouter API key. It stays in this local process."}</p>
      <div className="row">
        <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-or-v1-…" aria-label="OpenRouter API key" />
        <button onClick={saveKey} disabled={!key.trim()}>Save key</button>
        {configured && <button type="button" onClick={() => void forgetKey()}>Forget key</button>}
      </div>
      {setupError && <p className="error" role="alert">{setupError}</p>}
    </section>

    <section className="panel">
      <h2>2. Source and direction</h2>
      <input type="file" accept=".txt,.html,.htm,text/plain,text/html" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void file.text().then(setSource);
      }} />
      <textarea className="source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Paste the story or selected arc here…" />
      <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional: tone, routes, endings, relationships, content boundaries…" />
      {projectId && <CommandManager projectId={projectId} globalCommands={globalCommands} projectCommands={projectCommands} onChanged={() => loadCommands(projectId)} />}
      <div className="row">
        <label>Model <input ref={modelInput} value={model} onChange={(event) => setModel(event.target.value)} /></label>
        <label>Passages <input type="number" min={8} max={40} value={targetPassages} onChange={(event) => setTargetPassages(Number(event.target.value))} /></label>
        <label className="checkbox"><input type="checkbox" checked={showReasoning} onChange={(event) => setShowReasoning(event.target.checked)} /> Show provider reasoning activity</label>
        <button className="primary" onClick={() => void generate()} disabled={busy || !configured || source.trim().length < 100}>
          {busy ? "Designing and writing…" : "Generate CYOA"}
        </button>
      </div>
      <p className="cost-note">Reasoning is enabled by default. Provider reasoning tokens can affect generation cost; provider text is withheld for privacy.</p>
      {startedAt !== null && activityEvents.length > 0 && !generation && <GenerationActivity startedAt={startedAt} now={now} events={activityEvents} onCancel={busy ? cancelGeneration : undefined} />}
      {generationError && <GenerationErrorPanel
        error={generationError}
        loadDiagnostic={loadGenerationDiagnostic}
        onRetry={() => void generate()}
        onChangeModel={() => modelInput.current?.focus()}
      />}
    </section>

    {generation && <section className="result">
      <div className="result-head">
        <div>
          <p className="eyebrow">Generated game</p>
          <h2>{generation.project.name}</h2>
          <p>{generation.project.passages.length} passages · {generation.usage.totalTokens.toLocaleString()} tokens · {generation.compiler} HTML compiler</p>
        </div>
        <div className="row">
          <button onClick={() => download(`${generation.project.id}.twee`, generation.twee, "text/plain")}>Download Twee</button>
          <button className="primary" onClick={() => download(`${generation.project.id}.html`, generation.html, "text/html")}>Download playable HTML</button>
        </div>
      </div>
      <Player project={generation.project} />
    </section>}
  </main>;
}
