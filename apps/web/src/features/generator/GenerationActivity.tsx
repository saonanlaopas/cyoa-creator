import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { QuickGenerationEvent } from "../../api/quick-generation.js";

export interface GenerationActivityProps {
  startedAt: number;
  now: number;
  events: QuickGenerationEvent[];
  onCancel?(): void;
}

export function GenerationActivity({ startedAt, now, events, onCancel }: GenerationActivityProps) {
  const timelineRef = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const items = useMemo(() => coalesceReasoning(events), [events]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline && followLatest.current) timeline.scrollTop = timeline.scrollHeight;
  }, [items]);

  return <section className="generation-activity" aria-live="polite" aria-label="Generation activity">
    <div className="activity-head">
      <p>{formatElapsed(now - startedAt)} elapsed</p>
      {onCancel && <button type="button" onClick={onCancel}>Cancel generation</button>}
    </div>
    <ol
      ref={timelineRef}
      className="activity-timeline"
      aria-label="Generation activity timeline"
      onScroll={(event) => {
        const timeline = event.currentTarget;
        followLatest.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 24;
      }}
    >
      {items.map((event, index) =>
        <li className={event.type === "reasoning" ? "reasoning-event" : undefined} key={`${event.at}-${index}`}>
          {activityLabel(event)}
        </li>)}
    </ol>
    {events.some((event) => event.type === "reasoning") &&
      <p className="privacy-note">Provider-supplied reasoning is shown when available and remains session-only.</p>}
  </section>;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function activityLabel(event: QuickGenerationEvent): ReactNode {
  switch (event.type) {
    case "status": return event.message;
    case "reasoning": {
      const label = reasoningActivityLabel(event.kind);
      return event.text ? <><strong>{label}:</strong> <span>{event.text}</span></> : label;
    }
    case "usage": return `Usage updated: ${event.inputTokens} input, ${event.outputTokens} output tokens.`;
    case "validation": return `${event.phase === "schema" ? "Schema" : "Graph"} validation: ${event.findings.length} ${event.findings.length === 1 ? "finding" : "findings"}.`;
    case "repair": return `${event.phase === "structured-output" ? "Structured-output" : "Graph"} repair attempt ${event.attempt}.`;
    case "result": return "Generation complete.";
    case "error": return `Generation failed: ${event.error.message}`;
  }
}

function reasoningActivityLabel(kind: Extract<QuickGenerationEvent, { type: "reasoning" }>["kind"]): string {
  return {
    text: "Provider reasoning",
    summary: "Provider summary",
    encrypted: "Encrypted provider reasoning received; no displayable text.",
    unavailable: "Provider reasoning was unavailable.",
  }[kind];
}

function coalesceReasoning(events: QuickGenerationEvent[]): QuickGenerationEvent[] {
  return events.reduce<QuickGenerationEvent[]>((items, event) => {
    const previous = items.at(-1);
    if (event.type === "reasoning" && previous?.type === "reasoning" &&
      event.kind === previous.kind && event.text !== undefined && previous.text !== undefined) {
      items[items.length - 1] = { ...previous, text: previous.text + event.text };
    } else {
      items.push(event);
    }
    return items;
  }, []);
}
