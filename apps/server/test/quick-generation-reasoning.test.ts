import { describe, expect, it } from "vitest";
import { createReasoningSafetyBuffer } from "../src/routes/quick-generate.js";

const source = "Mara returns to the flooded station before dawn carrying the brass key her father hid years ago.";

describe("rolling reasoning safety buffer", () => {
  it("suppresses source fragments split across reasoning kinds", () => {
    const events: Array<{ kind: string; text?: string }> = [];
    const buffer = createReasoningSafetyBuffer(source, (event) => events.push(event));

    buffer.push({ kind: "text", text: "Mara returns to the " });
    buffer.push({ kind: "summary", text: "flooded station before dawn" });
    buffer.finish();

    expect(events.map((event) => event.text ?? "").join("")).not.toContain("Mara returns to the flooded station");
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "unavailable" })]));
  });

  it("does not release sub-20 source or secret tails at finish", () => {
    const events: Array<{ kind: string; text?: string }> = [];
    const buffer = createReasoningSafetyBuffer(source, (event) => events.push(event));

    buffer.push({ kind: "summary", text: "Mara return" });
    buffer.push({ kind: "text", text: "sk-or-v1-short" });
    buffer.finish();

    expect(events.map((event) => event.text ?? "").join("")).not.toContain("Mara return");
    expect(events.map((event) => event.text ?? "").join("")).not.toContain("sk-or-v1-short");
  });

  it("preserves kind order while releasing safe reasoning incrementally", () => {
    const events: Array<{ kind: string; text?: string }> = [];
    const buffer = createReasoningSafetyBuffer(source, (event) => events.push(event));

    buffer.push({ kind: "text", text: "A".repeat(80) });
    expect(events).toEqual([expect.objectContaining({ kind: "text", text: "A".repeat(16) })]);
    buffer.push({ kind: "summary", text: "B".repeat(80) });
    buffer.finish();

    expect(events.map((event) => event.kind)).toEqual(["text", "text", "summary", "unavailable"]);
  });
});
