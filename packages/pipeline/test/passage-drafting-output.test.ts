import { describe, expect, it } from "vitest";
import {
  passageDraftingUnitOutputSchema,
  validatePassageDraftingOutput,
} from "../src/index.js";

const expected = [
  { passageId: "passage-a", passagePlanVersionId: "plan-a", wordTarget: 500 },
  { passageId: "passage-b", passagePlanVersionId: "plan-b", wordTarget: 400 },
];
const output = (passages: unknown[]) => JSON.stringify({
  schemaId: passageDraftingUnitOutputSchema.id,
  schemaVersion: passageDraftingUnitOutputSchema.version,
  passages,
});
const passage = (passageId: string, version: string, proseMarkdown = "Readable candidate prose.") => ({
  passageId, basedOnPassagePlanVersionId: version, proseMarkdown,
});

describe("strict drafting unit output", () => {
  it("accepts every expected passage exactly once and reports local size and word diagnostics", () => {
    const result = validatePassageDraftingOutput({
      raw: output([passage("passage-a", "plan-a"), passage("passage-b", "plan-b")]),
      expectedPassages: expected, maximumOutputTokensPerPassage: 2_500, maximumOutputTokens: 5_000,
    });
    expect(result.output.passages).toHaveLength(2);
    expect(result.diagnostics).toMatchObject({ valid: true, passages: [{ passageId: "passage-a", wordCount: 3, wordTarget: 500 }, { passageId: "passage-b", wordCount: 3, wordTarget: 400 }] });
  });

  it.each([
    ["duplicate", [passage("passage-a", "plan-a"), passage("passage-a", "plan-a")], "Duplicate passage"],
    ["missing", [passage("passage-a", "plan-a")], "Missing expected passage"],
    ["extra", [passage("passage-a", "plan-a"), passage("passage-b", "plan-b"), passage("passage-c", "plan-c")], "Unauthorized passage"],
    ["wrong version", [passage("passage-a", "wrong"), passage("passage-b", "plan-b")], "wrong passage-plan version"],
    ["empty prose", [passage("passage-a", "plan-a", "   "), passage("passage-b", "plan-b")], "empty prose"],
  ])("rejects %s", (_name, passages, message) => {
    expect(() => validatePassageDraftingOutput({
      raw: output(passages as unknown[]), expectedPassages: expected,
      maximumOutputTokensPerPassage: 2_500, maximumOutputTokens: 5_000,
    })).toThrow(String(message));
  });

  it("rejects malformed, unexpected, per-passage, unit, and serialized-size overflow locally", () => {
    const args = { expectedPassages: expected, maximumOutputTokensPerPassage: 10, maximumOutputTokens: 15 };
    expect(() => validatePassageDraftingOutput({ raw: "{ malformed", ...args })).toThrow("not valid JSON");
    expect(() => validatePassageDraftingOutput({ raw: JSON.stringify({ schemaId: passageDraftingUnitOutputSchema.id, schemaVersion: 1, passages: [], extra: true }), ...args }))
      .toThrow("strict unit schema");
    expect(() => validatePassageDraftingOutput({ raw: output([passage("passage-a", "plan-a", "x".repeat(100)), passage("passage-b", "plan-b")]), ...args }))
      .toThrow("per-passage output-token limit");
    expect(() => validatePassageDraftingOutput({ raw: output([passage("passage-a", "plan-a", "x".repeat(40)), passage("passage-b", "plan-b", "x".repeat(40))]), ...args }))
      .toThrow("unit output-token limit");
    expect(() => validatePassageDraftingOutput({ raw: "x".repeat(96_001), ...args })).toThrow("serialized candidate byte limit");
  });
});
