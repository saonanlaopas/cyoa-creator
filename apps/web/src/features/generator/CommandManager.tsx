import { useMemo, useState } from "react";
import type { InstructionCommand } from "../../api/quick-generation.js";

export interface CommandManagerProps {
  projectId: string;
  globalCommands: InstructionCommand[];
  projectCommands: InstructionCommand[];
  onChanged(): Promise<void>;
}

type FormState = { name: string; instruction: string; scope: "global" | "project"; command?: InstructionCommand };

const presets = [
  { name: "Preserve characterization", instruction: "Preserve characterization, established relationships, and the source characters' motivations." },
  { name: "Respect content boundaries", instruction: "Respect the story's stated content boundaries and avoid adding unrequested graphic material." },
];

const emptyForm = (scope: FormState["scope"] = "project"): FormState => ({ name: "", instruction: "", scope });

const ordered = (commands: InstructionCommand[]) => [...commands].sort((a, b) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

async function request(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  if (!response.ok) throw new Error("Could not save command changes.");
}

export function CommandManager({ projectId, globalCommands, projectCommands, onChanged }: CommandManagerProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const groups = useMemo(() => [
    { scope: "global" as const, title: "Global commands", commands: ordered(globalCommands) },
    { scope: "project" as const, title: "This story's commands", commands: ordered(projectCommands) },
  ], [globalCommands, projectCommands]);

  const pathFor = (command: InstructionCommand) => command.scope === "global"
    ? `/api/commands/global/${command.id}`
    : `/api/projects/${projectId}/commands/${command.id}`;

  const perform = async (operation: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await operation();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save command changes.");
    } finally {
      setPending(false);
    }
  };

  const save = () => form && perform(async () => {
    const body = JSON.stringify({ name: form.name, instruction: form.instruction });
    if (form.command) await request(pathFor(form.command), { method: "PATCH", body });
    else if (form.scope === "global") await request("/api/commands/global", { method: "POST", body });
    else await request(`/api/projects/${projectId}/commands`, { method: "POST", body });
    setForm(null);
  });

  const reorder = (scope: "global" | "project", commands: InstructionCommand[], index: number, direction: -1 | 1) => {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= commands.length) return;
    const ids = commands.map((command) => command.id);
    [ids[index], ids[otherIndex]] = [ids[otherIndex], ids[index]];
    void perform(async () => {
      await request(scope === "global" ? "/api/commands/global/reorder" : `/api/projects/${projectId}/commands/reorder`, { method: "PUT", body: JSON.stringify({ ids }) });
    });
  };

  return <section className="commands" aria-labelledby="commands-heading">
    <h3 id="commands-heading">Always apply commands</h3>
    <p>Reusable directions are sent with every generation. New commands apply to this story unless you explicitly make them global.</p>
    <div className="row">
      <button type="button" onClick={() => setForm(emptyForm())}>Add command</button>
      <button type="button" onClick={() => setForm(emptyForm("global"))}>Add global command</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {form && <form onSubmit={(event) => { event.preventDefault(); save(); }}>
      <p>{form.command ? `Editing ${form.command.name}` : form.scope === "global" ? "New global command" : "New story command"}</p>
      <div className="row" aria-label="Command presets">
        {presets.map((preset) => <button key={preset.name} type="button" onClick={() => setForm({ ...form, ...preset })}>Preset: {preset.name}</button>)}
      </div>
      <label>Command name <input aria-label="Command name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
      <label>Instruction <textarea aria-label="Instruction" value={form.instruction} onChange={(event) => setForm({ ...form, instruction: event.target.value })} required /></label>
      <div className="row">
        <button type="submit" disabled={pending}>{form.command ? "Save changes" : form.scope === "global" ? "Save globally" : "Save for this story"}</button>
        <button type="button" onClick={() => setForm(null)} disabled={pending}>Cancel</button>
      </div>
    </form>}
    {groups.map(({ scope, title, commands }) => <section key={scope} aria-label={title}>
      <h4>{title}</h4>
      {commands.length === 0 ? <p>No commands yet.</p> : <ul>
        {commands.map((command, index) => <li key={command.id} aria-label={command.name}>
          <strong>{command.name}</strong> {!command.enabled && <span>(disabled)</span>}
          <p>{command.instruction}</p>
          <div className="row">
            <button type="button" onClick={() => setForm({ name: command.name, instruction: command.instruction, scope: command.scope, command })}>Edit {command.name}</button>
            <button type="button" disabled={pending} onClick={() => void perform(() => request(pathFor(command), { method: "PATCH", body: JSON.stringify({ enabled: !command.enabled }) }))}>{command.enabled ? "Disable" : "Enable"} {command.name}</button>
            {scope === "project" && <button type="button" disabled={pending} onClick={() => void perform(() => request(`/api/projects/${projectId}/commands/${command.id}/promote`, { method: "POST" }))}>Promote {command.name} to global</button>}
            <button type="button" disabled={pending || index === 0} onClick={() => reorder(scope, commands, index, -1)}>Move {command.name} up</button>
            <button type="button" disabled={pending || index === commands.length - 1} onClick={() => reorder(scope, commands, index, 1)}>Move {command.name} down</button>
            <button type="button" disabled={pending} onClick={() => void perform(() => request(pathFor(command), { method: "DELETE" }))}>Delete {command.name}</button>
          </div>
        </li>)}
      </ul>}
    </section>)}
  </section>;
}
