import { describe, expect, it } from "vitest";
import { consumeNdjson, httpError, type QuickGenerationEvent } from "../src/api/quick-generation.js";

const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> => new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
    controller.close();
  },
});

describe("consumeNdjson", () => {
  it("parses records split across arbitrary chunks", async () => {
    const events: QuickGenerationEvent[] = [];

    await consumeNdjson(streamOf(
      '{"type":"status","stage":"request","message":"Sending","at":"t"}\n{"type":"reason',
      'ing","kind":"summary","at":"t"}\n',
    ), (event) => events.push(event));

    expect(events.map((event) => event.type)).toEqual(["status", "reasoning"]);
  });

  it("rejects a malformed terminal record with its raw line", async () => {
    await expect(consumeNdjson(streamOf('{"type":bad}\n'), () => {}))
      .rejects.toMatchObject({ code: "LOCAL_STREAM_INVALID", rawLine: '{"type":bad}' });
  });

  it("accepts a fixture covering every browser-safe event variant", async () => {
    const events: QuickGenerationEvent[] = [];
    await consumeNdjson(streamOf([
      '{"type":"status","stage":"preparing","message":"Preparing","at":"t"}',
      '{"type":"reasoning","kind":"summary","text":"sk-secret source text","at":"t"}',
      '{"type":"usage","inputTokens":1,"outputTokens":2,"totalTokens":3,"at":"t"}',
      '{"type":"validation","phase":"schema","findings":[],"at":"t"}',
      '{"type":"repair","phase":"structured-output","attempt":1,"at":"t"}',
      '{"type":"result","generation":{"project":{"id":"p","name":"Story","schemaVersion":1,"startPassageId":"start","metadata":{},"mechanics":{"visibleStats":{},"relationships":{},"hiddenFlags":{},"inventory":[],"protagonistTendencies":[],"divergenceMode":"balanced","randomness":false},"passages":[{"id":"start","title":"Start","purpose":"","prose":"","participants":[],"requiredKnowledge":[],"incomingAssumptions":[],"ending":"success","choices":[]}]},"twee":"","html":"","compiler":"","findings":[],"usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3},"cost":null},"at":"t"}',
      '{"type":"error","error":{"code":"GRAPH_INVALID","message":"Invalid graph","retryable":true},"diagnosticId":"d1","at":"t"}',
    ].join("\n")), (event) => events.push(event));

    expect(events.map((event) => event.type)).toEqual(["status", "reasoning", "usage", "validation", "repair", "result", "error"]);
    expect(events[1]).toEqual({ type: "reasoning", kind: "summary", text: "sk-secret source text", at: "t" });
  });

  it("rejects malformed nested result data before it reaches the generator", async () => {
    await expect(consumeNdjson(streamOf('{"type":"result","generation":{"project":{}},"at":"t"}\n'), () => {}))
      .rejects.toMatchObject({ code: "LOCAL_STREAM_INVALID" });
  });

  it("uses a typed browser-safe fallback for non-JSON HTTP errors", async () => {
    await expect(httpError(new Response("upstream unavailable", { status: 503 }))).resolves.toEqual({
      code: "PROVIDER_FAILURE",
      message: "Generation request failed (503).",
      retryable: true,
    });
  });
});
