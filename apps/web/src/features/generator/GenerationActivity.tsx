import type { QuickGenerationEvent } from "../../api/quick-generation.js";

export interface GenerationActivityProps {
  startedAt: number;
  now: number;
  events: QuickGenerationEvent[];
  onCancel?(): void;
}

export function GenerationActivity({ startedAt, now, events, onCancel }: GenerationActivityProps) {
  return <section className="generation-activity" aria-live="polite" aria-label="Generation activity">
    <div className="activity-head">
      <p>{formatElapsed(now - startedAt)} elapsed</p>
      {onCancel && <button type="button" onClick={onCancel}>Cancel generation</button>}
    </div>
    <ol aria-label="Generation activity timeline">
      {events.map((event, index) => <li key={`${event.at}-${index}`}>{activityLabel(event)}</li>)}
    </ol>
    {events.some((event) => event.type === "reasoning") && <p className="privacy-note">Provider reasoning text is withheld for privacy.</p>}
  </section>;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function activityLabel(event: QuickGenerationEvent): string {
  switch (event.type) {
    case "status": return event.message;
    case "reasoning": return reasoningActivityLabel(event.kind);
    case "usage": return `Usage updated: ${event.inputTokens} input, ${event.outputTokens} output tokens.`;
    case "validation": return `${event.phase === "schema" ? "Schema" : "Graph"} validation: ${event.findings.length} ${event.findings.length === 1 ? "finding" : "findings"}.`;
    case "repair": return `${event.phase === "structured-output" ? "Structured-output" : "Graph"} repair attempt ${event.attempt}.`;
    case "result": return "Generation complete.";
    case "error": return `Generation failed: ${event.error.message}`;
  }
}

function reasoningActivityLabel(kind: Extract<QuickGenerationEvent, { type: "reasoning" }>["kind"]): string {
  return {
    text: "Provider reasoning received; text withheld for privacy.",
    summary: "Provider summary received; text withheld for privacy.",
    encrypted: "Encrypted provider reasoning received; text withheld for privacy.",
    unavailable: "Provider reasoning was unavailable.",
  }[kind];
}
