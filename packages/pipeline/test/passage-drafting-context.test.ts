import { describe, expect, it } from "vitest";
import {
  BoundedPassageDraftingContextError,
  buildPassageDraftingContext,
  defaultLongFormEndingPlan,
  defaultLongFormMechanicsPlan,
  defaultLongFormRoutePlan,
  defaultLongFormStoryBible,
  defaultProjectBrief,
  type ChoicePlan,
  type NarrativeThread,
  type PassagePlan,
  type PassageStructure,
} from "../src/index.js";

function fixture() {
  const brief = defaultProjectBrief("Context fixture");
  const bible = defaultLongFormStoryBible({
    title: brief.workingTitle,
    protagonist: "Mara",
    pointOfView: "second-person",
    tone: "Measured urgency",
  });
  bible.characters.push({ id: "character-friend", name: "Ivo", role: "Friend", summary: "An ally", motivations: [], knowledge: [], plannedArc: "" });
  bible.characters.push({ id: "character-unrelated", name: "Elsewhere", role: "Unused", summary: "", motivations: [], knowledge: [], plannedArc: "" });
  bible.relationships.push({ id: "relationship-trust", characterIds: ["character-protagonist", "character-friend"], label: "Trust", currentState: "Fragile", plannedArc: "" });
  bible.settings.push({ id: "location-bridge", label: "Bridge", description: "Rain-slick iron" });
  bible.canonFacts.push({ id: "fact-signal", statement: "The signal repeats at midnight.", sourceExcerptIds: [], confidence: "confirmed" });
  const routes = defaultLongFormRoutePlan(brief);
  const endings = defaultLongFormEndingPlan(routes);
  endings.endings[0]!.characterOutcomes = [{ characterId: "character-friend", outcome: "Ivo stays." }];
  const mechanics = defaultLongFormMechanicsPlan(bible, endings);
  mechanics.flags.push({ id: "flag-signal", key: "signal_known", label: "Signal known", meaning: "The signal was decoded." });
  mechanics.gates.push({ id: "gate-ending", targetType: "ending", targetId: endings.endings[0]!.id, logic: "all", conditions: [{ id: "gate-condition", mechanicKey: "signal_known", operator: "present", value: null }], rationale: "", fallback: "" });
  mechanics.choiceEffectPlans.push({ id: "effect-decision", label: "Decision effect", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: ["signal_known"], effectGuidance: ["Show the signal consequence."] });
  const passageIds = ["passage-a", "passage-b", "passage-c", "passage-unrelated"];
  const structure: PassageStructure = {
    schemaVersion: 1, title: "Structure", projectWordTarget: 100_000, typicalPathWordTarget: 30_000,
    startPassageId: passageIds[0],
    acts: [{ id: "act-a", label: "Act", purpose: "", summary: "", wordTarget: 100_000, routeIds: [routes.routes[0]!.id], sequenceIds: ["sequence-a"], position: 0 }],
    sequences: [{ id: "sequence-a", actId: "act-a", label: "Sequence", purpose: "", summary: "", wordTarget: 10_000, routeIds: [routes.routes[0]!.id], passageIds, entryGoals: ["Enter under pressure"], exitGoals: ["Choose"], requiredDecisionIds: ["decision-route-selection"], endingHookIds: [routes.endingHooks[0]!.id], position: 0, planningStatus: "planned" }],
    characterAvailability: [],
  };
  const base = (id: string, position: number): PassagePlan => ({
    id, sequenceId: "sequence-a", title: id, kind: "scene", purpose: `Purpose ${id}`, summary: `Summary ${id}`,
    wordTarget: 500, routeIds: [routes.routes[0]!.id], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
    requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
    choiceIds: [], terminal: false, endingId: null, draftingNotes: ["Keep close viewpoint."], unresolvedQuestions: [], planningStatus: "planned", position,
  });
  const passages = passageIds.map((id, position) => ({ versionId: `passage-version-${position}`, content: base(id, position) }));
  Object.assign(passages[1]!.content, {
    characterIds: ["character-friend"], relationshipIds: ["relationship-trust"], locationIds: ["location-bridge"],
    requiredFactIds: ["fact-signal"], setupThreadIds: ["thread-signal"], endingId: endings.endings[0]!.id,
  });
  const choices: Array<{ versionId: string; content: ChoicePlan }> = [
    { versionId: "choice-version-in", content: { id: "choice-in", sourcePassageId: "passage-a", destinationPassageId: "passage-b", label: "Enter", narrativeIntent: "", consequencePreview: "", condition: { kind: "compare", mechanicKey: "signal_known", operator: "eq", value: true }, unavailableBehavior: "hidden", unavailableExplanation: "", effects: [], sourceDecisionIds: ["decision-route-selection"], position: 0 } },
    { versionId: "choice-version-out", content: { id: "choice-out", sourcePassageId: "passage-b", destinationPassageId: "passage-c", label: "Leave", narrativeIntent: "", consequencePreview: "", condition: null, unavailableBehavior: "disabled", unavailableExplanation: "Wait", effects: [{ id: "effect-signal", mechanicKey: "signal_known", operation: "set", value: true, feedback: "Known", visibility: "visible" }], sourceDecisionIds: ["decision-route-selection"], position: 0 } },
  ];
  passages[0]!.content.choiceIds = ["choice-in"];
  passages[1]!.content.choiceIds = ["choice-out"];
  const threads: Array<{ versionId: string; content: NarrativeThread }> = [{
    versionId: "thread-version-signal",
    content: { id: "thread-signal", label: "Signal", description: "Set up the midnight signal", setupPassageIds: ["passage-b"], payoffPassageIds: ["passage-c"], routeIds: [routes.routes[0]!.id], required: true, status: "planned", waiverRationale: "" },
  }];
  const input = {
    projectId: "project-a", unitId: "unit-a", snapshotId: "snapshot-a", structureVersionId: "structure-version-a",
    upstreamVersions: { brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1" },
    structure, passages, choices, threads, targetPassageIds: ["passage-b"], brief, bible, routes, endings, mechanics,
    acceptedDrafts: [
      { passageId: "passage-a", draftVersionId: "draft-a", basedOnPassagePlanVersionId: "passage-version-0", proseMarkdown: "Accepted incoming prose.", wordCount: 3, lifecycleStatus: "accepted" as const, stale: false },
      { passageId: "passage-c", draftVersionId: "draft-c", basedOnPassagePlanVersionId: "passage-version-2", proseMarkdown: "Stale outgoing prose.", wordCount: 3, lifecycleStatus: "locked" as const, stale: true },
      { passageId: "passage-unrelated", draftVersionId: "draft-unrelated", basedOnPassagePlanVersionId: "passage-version-3", proseMarkdown: "Never include me.", wordCount: 3, lifecycleStatus: "accepted" as const, stale: false },
    ],
    maximumEstimatedInputTokens: 48_000, requestedMaximumOutputTokens: 2_500,
  };
  return input;
}

describe("bounded passage drafting context", () => {
  it("is deterministic and includes only exact stable-ID-relevant planning data and accepted local prose", () => {
    const input = fixture();
    const first = buildPassageDraftingContext(input);
    const second = buildPassageDraftingContext({
      ...input,
      upstreamVersions: Object.fromEntries(Object.entries(input.upstreamVersions).reverse()),
    });
    expect(second).toEqual(first);
    expect(first.context.targets.map((item) => item.content.id)).toEqual(["passage-b"]);
    expect(first.context.choices.map((item) => item.content.id)).toEqual(["choice-in", "choice-out"]);
    expect(first.context.choices[0]).toMatchObject({ content: { condition: { mechanicKey: "signal_known" }, unavailableBehavior: "hidden" } });
    expect(first.context.choices[1]).toMatchObject({ content: { effects: [{ mechanicKey: "signal_known" }] } });
    expect(first.context.threads.map((item) => item.content.id)).toEqual(["thread-signal"]);
    expect(first.context.upstream.bible.characters?.map((item) => item.id).sort()).toEqual(["character-friend", "character-protagonist"]);
    expect(first.context.upstream.bible.characters?.map((item) => item.id)).not.toContain("character-unrelated");
    expect(first.context.upstream.bible.relationships?.map((item) => item.id)).toEqual(["relationship-trust"]);
    expect(first.context.upstream.bible.settings?.map((item) => item.id)).toEqual(["location-bridge"]);
    expect(first.context.upstream.bible.canonFacts?.map((item) => item.id)).toEqual(["fact-signal"]);
    expect(first.context.upstream.routes.routes?.length).toBe(1);
    expect(first.context.upstream.routes.decisionPoints?.map((item) => item.id)).toContain("decision-route-selection");
    expect(first.context.upstream.endings.endings?.length).toBeGreaterThan(0);
    expect(first.context.upstream.mechanics.flags?.map((item) => item.key)).toContain("signal_known");
    expect(first.context.acceptedNeighborProse).toEqual([expect.objectContaining({ passageId: "passage-a", draftVersionId: "draft-a" })]);
    expect(first.diagnostics.staleNeighborDraftsExcluded).toEqual([{ passageId: "passage-c", draftVersionId: "draft-c" }]);
    expect(JSON.stringify(first.context)).not.toContain("Never include me");
    expect(first.diagnostics.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.diagnostics.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(first.context), "utf8"));
  });

  it("fails locally when required context or required accepted neighbor prose is unavailable", () => {
    const input = fixture();
    expect(() => buildPassageDraftingContext({ ...input, maximumEstimatedInputTokens: 10 }))
      .toThrow(BoundedPassageDraftingContextError);
    expect(() => buildPassageDraftingContext({ ...input, requiredNeighborPassageIds: ["passage-c"] }))
      .toThrow("missing or stale");
  });

  it("trims optional accepted prose deterministically and reports the exact omission", () => {
    const input = fixture();
    input.acceptedDrafts[0]!.proseMarkdown = "continuity ".repeat(4_000);
    const requiredOnly = buildPassageDraftingContext({ ...input, acceptedDrafts: [], maximumEstimatedInputTokens: 48_000 });
    const ceiling = requiredOnly.diagnostics.estimatedInputTokens + 5;
    const first = buildPassageDraftingContext({ ...input, maximumEstimatedInputTokens: ceiling });
    const second = buildPassageDraftingContext({ ...input, maximumEstimatedInputTokens: ceiling });
    expect(second).toEqual(first);
    expect(first.context.acceptedNeighborProse).toEqual([]);
    expect(first.diagnostics.omittedOptionalContext.acceptedNeighborPassageIds).toEqual(["passage-a"]);
  });

  it("keeps a 300-passage corpus bounded to direct local continuity instead of loading whole prose", () => {
    const input = fixture();
    const passages = Array.from({ length: 300 }, (_, index) => {
      const id = `large-${String(index).padStart(3, "0")}`;
      return {
        versionId: `large-version-${index}`,
        content: {
          ...input.passages[0]!.content,
          id,
          title: `Large ${index}`,
          purpose: `Purpose ${index}`,
          position: index,
          choiceIds: index < 299 ? [`large-choice-${index}`] : [],
        },
      };
    });
    const choices = Array.from({ length: 299 }, (_, index) => ({
      versionId: `large-choice-version-${index}`,
      content: {
        ...input.choices[1]!.content,
        id: `large-choice-${index}`,
        sourcePassageId: `large-${String(index).padStart(3, "0")}`,
        destinationPassageId: `large-${String(index + 1).padStart(3, "0")}`,
        effects: [], sourceDecisionIds: [],
      },
    }));
    const acceptedDrafts = passages.map((item, index) => ({
      passageId: item.content.id,
      draftVersionId: `large-draft-${index}`,
      basedOnPassagePlanVersionId: item.versionId,
      proseMarkdown: `UNIQUE-CORPUS-MARKER-${index}`,
      wordCount: 1,
      lifecycleStatus: "accepted" as const,
      stale: false,
    }));
    const context = buildPassageDraftingContext({
      ...input,
      structure: {
        ...input.structure,
        sequences: [{ ...input.structure.sequences[0]!, passageIds: passages.map((item) => item.content.id) }],
      },
      passages,
      choices,
      threads: [],
      targetPassageIds: ["large-150"],
      acceptedDrafts,
    });
    expect(context.context.acceptedNeighborProse.map((item) => item.passageId)).toEqual(["large-149", "large-151"]);
    expect(JSON.stringify(context.context)).not.toContain("UNIQUE-CORPUS-MARKER-0");
    expect(context.diagnostics.estimatedInputTokens).toBeLessThan(48_000);
  });
});
