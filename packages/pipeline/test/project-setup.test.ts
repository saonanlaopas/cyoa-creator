import { expect, it } from "vitest";
import { defaultCreativeDirection } from "@story-to-cyoa/domain";
import { defaultProjectBrief } from "../src/schemas/project-brief.js";
import {
  buildSetupContext, materializeSetupProposal, normalizeSetupEvidence, PROJECT_SETUP_LIMITS,
  setupGroupSelectionIssues, SetupProposalResponseSchema,
} from "../src/project-setup.js";

const context = {
  mode: "propose" as const, projectName: "Unknown title", messages: [{ id: "author-1", role: "user" as const, content: "A mystery." }],
  summary: null, decisions: [], brief: null, creativeDirection: null, bible: null, omittedMessageCount: 0,
};

it("fingerprints messages, summaries, pinned versions and exact artifact bases", () => {
  const first = buildSetupContext(context);
  expect(buildSetupContext(context).fingerprint).toBe(first.fingerprint);
  for (const changed of [
    { ...context, messages: [{ ...context.messages[0]!, content: "A horror story." }] },
    { ...context, summary: { versionId: "summary-1", content: "Earlier idea" } },
    { ...context, decisions: [{ versionId: "decision-1", content: "Past tense" }] },
    { ...context, brief: { versionId: "brief-1", content: defaultProjectBrief() } },
  ]) expect(buildSetupContext(changed).fingerprint).not.toBe(first.fingerprint);
  expect(first.diagnostics.maximumOutputTokens).toBe(6000);
  expect(first.diagnostics.serializedBytes).toBe(Buffer.byteLength(first.prompt, "utf8"));
});

it("never promotes missing or fabricated message excerpts to stated evidence", () => {
  const ids = new Set(["author-1"]); const messages = new Map([["author-1", "A mystery."]]);
  expect(normalizeSetupEvidence({ basis: "stated", messageIds: ["unknown"], excerpt: "" }, ids, messages).basis).toBe("inferred");
  expect(normalizeSetupEvidence({ basis: "stated", messageIds: ["author-1"], excerpt: "Warm romance" }, ids, messages)).toEqual({ basis: "inferred", messageIds: [], excerpt: "" });
  expect(normalizeSetupEvidence({ basis: "stated", messageIds: ["author-1"], excerpt: "mystery" }, ids, messages).basis).toBe("stated");
});

it("rejects legacy dual presentation fields and oversized setup response structures", () => {
  const blank = { message: "Review", summary: "Draft", brief: null, creativeDirection: null, bibleSeeds: null };
  expect(() => SetupProposalResponseSchema.parse({ ...blank, brief: { changes: { tone: "warm" } } })).toThrow();
  expect(() => SetupProposalResponseSchema.parse({ ...blank, bibleSeeds: { characters: Array.from({ length: PROJECT_SETUP_LIMITS.maximumCharacters + 1 }, (_, index) => ({ key: `c-${index}`, name: "Name", evidence: { basis: "inferred" } })) } })).toThrow();
});

it("preserves provenance-only confirmation without changing Creative Direction material", () => {
  const direction = defaultCreativeDirection(); const brief = defaultProjectBrief();
  const response = SetupProposalResponseSchema.parse({ message: "Review", summary: "Confirm pacing", brief: null, bibleSeeds: null,
    creativeDirection: { pacing: { quietScenesAllowed: direction.pacing.quietScenesAllowed }, fieldEvidence: [{ field: "pacing.quietScenesAllowed", basis: "stated", messageIds: ["author-1"], excerpt: "Quiet scenes" }] } });
  const result = materializeSetupProposal({ proposalId: "proposal-1", response, authorMessageIds: new Set(["author-1"]),
    authorMessages: new Map([["author-1", "Quiet scenes"]]), brief: { versionId: "brief-1", content: brief },
    creativeDirection: { versionId: "direction-1", content: direction }, bible: null, snapshot: { brief, "creative-direction": direction } });
  const candidate = result.groups[0]!.candidate as typeof direction;
  expect(candidate.materialFingerprint).toBe(direction.materialFingerprint);
  expect(candidate.provenanceFingerprint).not.toBe(direction.provenanceFingerprint);
  expect(result.groups[0]!.changes[0]!.label).toContain("confirm existing value");
});

it("rejects selective application without required seed dependencies", () => {
  const groups = [{ id: "brief", dependsOnGroupIds: [] }, { id: "bible-seeds", dependsOnGroupIds: ["brief"] }] as Parameters<typeof setupGroupSelectionIssues>[0];
  expect(setupGroupSelectionIssues(groups, ["bible-seeds"])).not.toEqual([]);
  expect(setupGroupSelectionIssues(groups, ["brief", "bible-seeds"])).toEqual([]);
});
