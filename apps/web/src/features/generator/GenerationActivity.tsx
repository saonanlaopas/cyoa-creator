import type { QuickGenerationEvent } from "../../api/quick-generation.js";

export interface GenerationActivityProps {
  startedAt: number;
  now: number;
  events: QuickGenerationEvent[];
  onCancel?(): void;
}

export function GenerationActivity({ startedAt, now, events, onCancel }: GenerationActivityProps) {
  const statuses = events.filter((event): event is Extract<QuickGenerationEvent, { type: "status" }> => event.type === "status");
  const reasoning = events.filter((event): event is Extract<QuickGenerationEvent, { type: "reasoning" }> => event.type === "reasoning");

  return <section className="generation-activity" aria-live="polite" aria-label="Generation activity">
    <div className="activity-head">
      <p>{formatElapsed(now - startedAt)} elapsed</p>
      {onCancel && <button type="button" onClick={onCancel}>Cancel generation</button>}
    </div>
    <ol aria-label="Generation stages">
      {statuses.map((event, index) => <li key={`${event.at}-${index}`}>{event.message}</li>)}
    </ol>
    {reasoning.length > 0 && <details open>
      <summary>Provider reasoning activity</summary>
      <ul>
        {reasoning.map((event, index) => <li key={`${event.at}-${index}`}>{reasoningActivityLabel(event.kind)}</li>)}
      </ul>
      <p className="privacy-note">Provider reasoning text is withheld for privacy.</p>
    </details>}
  </section>;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function reasoningActivityLabel(kind: Extract<QuickGenerationEvent, { type: "reasoning" }>["kind"]): string {
  return {
    text: "Provider reasoning received; text withheld for privacy.",
    summary: "Provider summary received; text withheld for privacy.",
    encrypted: "Encrypted provider reasoning received; text withheld for privacy.",
    unavailable: "Provider reasoning was unavailable.",
  }[kind];
}
