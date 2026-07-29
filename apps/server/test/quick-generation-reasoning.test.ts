import { describe, expect, it } from "vitest";
import { createReasoningActivityQueue } from "../src/routes/quick-generate.js";

const source = "Mara returns to the flooded station before dawn carrying the brass key her father hid years ago.";

describe("reasoning activity queue", () => {
  it("shows provider text while redacting key-shaped secrets", () => {
    const events: Array<{ kind: string; text?: string }> = [];
    const queue = createReasoningActivityQueue((event) => events.push(event));

    queue.push({ kind: "text", text: source });
    queue.push({ kind: "summary", text: "sk-or-v1-test-secret-key-0123456789" });

    expect(events).toEqual([
      { kind: "text", text: source },
      { kind: "summary", text: "[REDACTED]" },
    ]);
    expect(JSON.stringify(events)).toContain(source);
    expect(JSON.stringify(events)).not.toContain("sk-or-v1-test-secret-key-0123456789");
  });

  it("preserves cross-kind provider order and encrypted semantics", () => {
    const events: Array<{ kind: string; text?: string }> = [];
    const queue = createReasoningActivityQueue((event) => events.push(event));

    queue.push({ kind: "summary", text: "first" });
    queue.push({ kind: "encrypted" });
    queue.push({ kind: "text", text: "second" });
    queue.push({ kind: "unavailable" });

    expect(events).toEqual([
      { kind: "summary", text: "first" },
      { kind: "encrypted" },
      { kind: "text", text: "second" },
      { kind: "unavailable" },
    ]);
  });

  it("emits activity synchronously before generation resolves", () => {
    const events: Array<{ kind: string; text?: string }> = [];
    const queue = createReasoningActivityQueue((event) => events.push(event));

    queue.push({ kind: "text", text: "provider is working" });
    expect(events).toEqual([{ kind: "text", text: "provider is working" }]);

    queue.finish();
    expect(events).toEqual([{ kind: "text", text: "provider is working" }]);
  });
});
