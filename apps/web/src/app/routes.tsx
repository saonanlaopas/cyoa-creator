import { useEffect, useMemo, useState } from "react";

type Effect =
  | { op: "addStat"; key: string; value: number }
  | { op: "addRelationship"; key: string; value: number }
  | { op: "setFlag"; key: string; value: string | number | boolean }
  | { op: "addItem"; itemId: string }
  | { op: "removeItem"; itemId: string };

type Choice = { id: string; label: string; destinationId: string; effects: Effect[] };
type Passage = { id: string; title: string; prose: string; ending?: string | null; choices: Choice[] };
type Project = {
  id: string;
  name: string;
  startPassageId: string;
  passages: Passage[];
  mechanics: {
    visibleStats: Record<string, { label: string; initial: number }>;
    relationships: Record<string, { label: string; initial: number; bands: Array<{ min: number; label: string }> }>;
  };
};
type Generation = {
  project: Project;
  twee: string;
  html: string;
  compiler: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: { total: number } | null;
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function relationshipLabel(definition: Project["mechanics"]["relationships"][string], value: number) {
  return [...definition.bands].sort((a, b) => b.min - a.min).find((band) => value >= band.min)?.label ?? definition.label;
}

function Player({ project }: { project: Project }) {
  const passageMap = useMemo(() => new Map(project.passages.map((passage) => [passage.id, passage])), [project]);
  const initialStats = () => Object.fromEntries(Object.entries(project.mechanics.visibleStats).map(([key, value]) => [key, value.initial]));
  const initialRelationships = () => Object.fromEntries(Object.entries(project.mechanics.relationships).map(([key, value]) => [key, value.initial]));
  const [passageId, setPassageId] = useState(project.startPassageId);
  const [stats, setStats] = useState<Record<string, number>>(initialStats);
  const [relationships, setRelationships] = useState<Record<string, number>>(initialRelationships);
  const passage = passageMap.get(passageId);

  const choose = (choice: Choice) => {
    for (const effect of choice.effects) {
      if (effect.op === "addStat") setStats((current) => ({ ...current, [effect.key]: (current[effect.key] ?? 0) + effect.value }));
      if (effect.op === "addRelationship") setRelationships((current) => ({ ...current, [effect.key]: (current[effect.key] ?? 0) + effect.value }));
    }
    setPassageId(choice.destinationId);
  };
  const restart = () => {
    setStats(initialStats());
    setRelationships(initialRelationships());
    setPassageId(project.startPassageId);
  };

  if (!passage) return <p>Missing passage: {passageId}</p>;
  return <div className="player">
    <aside className="stats">
      <h3>Story state</h3>
      {Object.entries(project.mechanics.visibleStats).map(([key, value]) => <div key={key}>{value.label}: {stats[key] ?? 0}</div>)}
      {Object.entries(project.mechanics.relationships).map(([key, value]) => <div key={key}>{value.label}: {relationshipLabel(value, relationships[key] ?? 0)}</div>)}
      <button onClick={restart}>Restart</button>
    </aside>
    <article>
      <p className="eyebrow">{project.name}</p>
      <h2>{passage.title}</h2>
      {passage.prose.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      <div className="choices">
        {passage.choices.map((choice) => <button key={choice.id} onClick={() => choose(choice)}>{choice.label}</button>)}
      </div>
      {passage.ending && <p className="ending">Ending: {passage.ending}</p>}
    </article>
  </div>;
}

export function App() {
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [source, setSource] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("openrouter/auto");
  const [targetPassages, setTargetPassages] = useState(18);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/settings/openrouter").then((response) => response.json()).then((value) => setConfigured(Boolean(value.configured))).catch(() => undefined);
  }, []);

  const saveKey = async () => {
    setError("");
    const response = await fetch("/api/settings/openrouter", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    if (!response.ok) return setError("Could not save the OpenRouter key.");
    setKey("");
    setConfigured(true);
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    setGeneration(null);
    try {
      const response = await fetch("/api/quick/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, instructions, model, targetPassages }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Generation failed.");
      setGeneration(value as Generation);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
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
      </div>
    </section>

    <section className="panel">
      <h2>2. Source and direction</h2>
      <input type="file" accept=".txt,.html,.htm,text/plain,text/html" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void file.text().then(setSource);
      }} />
      <textarea className="source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Paste the story or selected arc here…" />
      <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional: tone, routes, endings, relationships, content boundaries…" />
      <div className="row">
        <label>Model <input value={model} onChange={(event) => setModel(event.target.value)} /></label>
        <label>Passages <input type="number" min={8} max={40} value={targetPassages} onChange={(event) => setTargetPassages(Number(event.target.value))} /></label>
        <button className="primary" onClick={generate} disabled={busy || !configured || source.trim().length < 100}>
          {busy ? "Designing and writing…" : "Generate CYOA"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
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
