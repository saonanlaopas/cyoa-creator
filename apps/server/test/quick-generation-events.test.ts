import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createNdjsonWriter } from "../src/routes/quick-generation-events.js";

class FakeRaw extends EventEmitter {
  public writes: string[] = [];
  public ends = 0;
  public destroyed = false;
  public writableEnded = false;

  write(value: string): boolean { this.writes.push(value); return true; }
  end(): void { this.ends += 1; this.writableEnded = true; }
}

describe("NDJSON writer lifecycle", () => {
  it("does not write or end twice after an abort destroys the socket", () => {
    const raw = new FakeRaw();
    const controller = new AbortController();
    const writer = createNdjsonWriter(raw as never, controller.signal);

    writer.send({ type: "status", stage: "request", message: "Sending", at: "t" });
    controller.abort();
    raw.destroyed = true;
    writer.send({ type: "status", stage: "failed", message: "Nope", at: "t" });
    writer.end();
    writer.end();

    expect(raw.writes).toHaveLength(1);
    expect(raw.ends).toBe(0);
  });
});
