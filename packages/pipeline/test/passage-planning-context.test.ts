import { describe, expect, it } from "vitest";
import {
  BoundedPassagePlanningContextError,
  LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema,
  LongFormRoutePlanSchema,
  LongFormStoryBibleSchema,
  PassagePlanningCandidateError,
  ProjectBriefSchema,
  buildPassagePlanningContext,
  normalizeCreativeDirection,
  deterministicCandidateId,
  passagePlanningCandidateSchema,
  validatePassagePlanningCandidate,
  type PassagePlanningContextInput,
} from "../src/index.js";

function fixture(): PassagePlanningContextInput {
  const brief = ProjectBriefSchema.parse({ workingTitle: "Bounded", premise: "A promise has consequences." });
  const bible = LongFormStoryBibleSchema.parse({
    title: "Bible",
    characters: [
      { id: "character-a", name: "A" },
      { id: "character-b", name: "B" },
      { id: "character-unrelated", name: "Unrelated" },
    ],
    relationships: [{ id: "relationship-a", characterIds: ["character-a", "character-b"] }],
    settings: [{ id: "location-a", label: "Station" }, { id: "location-unrelated", label: "Moon" }],
    canonFacts: [{ id: "fact-a", statement: "The key is brass." }, { id: "fact-unrelated", statement: "Unused." }],
  });
  const routes = LongFormRoutePlanSchema.parse({
    title: "Routes", totalWordTarget: 150_000,
    acts: [{ id: "act-a", routeId: null, label: "Act", wordTarget: 30_000 }],
    routes: [
      { id: "route-a", name: "A", relationshipArcs: [{ relationshipId: "relationship-a" }] },
      { id: "route-unrelated", name: "Unused" },
    ],
    decisionPoints: [{
      id: "decision-a", label: "Choose", actId: "act-a", choices: [
        { id: "route-choice-a", label: "A", destinationActId: "act-a", routeId: "route-a" },
        { id: "route-choice-b", label: "B", destinationActId: "act-a", routeId: null },
      ],
    }],
    endingHooks: [{ id: "hook-a", label: "End", routeId: "route-a", type: "partial" }],
  });
  const endings = LongFormEndingPlanSchema.parse({
    title: "Endings", projectWordTarget: 150_000, endingWordTarget: 10_000,
    endings: [{
      id: "ending-a", hookId: "hook-a", routeId: "route-a", title: "End", type: "partial",
      wordTarget: 1_000, characterOutcomes: [{ characterId: "character-a", outcome: "Changed" }],
      relationshipOutcomes: [{ relationshipId: "relationship-a", outcome: "Closer" }],
    }],
  });
  const mechanics = LongFormMechanicsPlanSchema.parse({
    title: "Mechanics",
    visibleStats: [{ id: "stat-resolve", key: "resolve", label: "Resolve", minimum: -5, maximum: 10, initial: 0 }],
    flags: [{ id: "flag-unused", key: "unused", label: "Unused" }],
    choiceEffectPlans: [{ id: "effect-a", label: "Effect", sourceDecisionIds: ["decision-a"], mechanicKeys: ["resolve"], effectGuidance: ["Make it matter"] }],
  });
  const passage = (id: string, position: number, extra: Record<string, unknown> = {}) => ({
    id, sequenceId: "sequence-a", title: id, kind: "scene" as const, purpose: "", summary: "",
    wordTarget: 500, routeIds: [], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
    requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
    choiceIds: [], terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [],
    planningStatus: "planned" as const, position, ...extra,
  });
  return {
    projectId: "project-a", snapshotId: "snapshot-a", structureVersionId: "structure-v1",
    upstreamVersions: { brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1" },
    scope: { kind: "route-segment", routeId: "route-a", passageIds: ["passage-a"] },
    selectedPassageIds: ["passage-a"],
    structure: {
      schemaVersion: 1, title: "Structure", projectWordTarget: 150_000, typicalPathWordTarget: 50_000,
      startPassageId: "passage-before",
      acts: [{ id: "act-structure", label: "Act", purpose: "", summary: "", wordTarget: 150_000, routeIds: ["route-a"], sequenceIds: ["sequence-a"], position: 0 }],
      sequences: [{ id: "sequence-a", actId: "act-structure", label: "Sequence", purpose: "", summary: "", wordTarget: 150_000, routeIds: ["route-a"], passageIds: ["passage-before", "passage-a", "passage-after", "passage-unrelated"], entryGoals: [], exitGoals: [], requiredDecisionIds: ["decision-a"], endingHookIds: ["hook-a"], position: 0, planningStatus: "planned" }],
      characterAvailability: [],
    },
    passages: [
      { versionId: "pv-before", content: passage("passage-before", 0) },
      { versionId: "pv-a", content: passage("passage-a", 1, { characterIds: ["character-a"], relationshipIds: ["relationship-a"], locationIds: ["location-a"], requiredFactIds: ["fact-a"], setupThreadIds: ["thread-a"], choiceIds: ["choice-a"] }) },
      { versionId: "pv-after", content: passage("passage-after", 2) },
      { versionId: "pv-unrelated", content: passage("passage-unrelated", 3) },
    ],
    choices: [{ versionId: "cv-a", content: {
      id: "choice-a", sourcePassageId: "passage-a", destinationPassageId: "passage-after", label: "Continue",
      narrativeIntent: "", consequencePreview: "", condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 1 },
      unavailableBehavior: "disabled", unavailableExplanation: "", effects: [], sourceDecisionIds: ["decision-a"], position: 0,
    } }],
    threads: [
      { versionId: "tv-a", content: { id: "thread-a", label: "Key", description: "", setupPassageIds: ["passage-a"], payoffPassageIds: ["passage-after"], routeIds: [], required: true, status: "planned", waiverRationale: "" } },
      { versionId: "tv-unrelated", content: { id: "thread-unrelated", label: "Unused", description: "", setupPassageIds: [], payoffPassageIds: [], routeIds: [], required: false, status: "planned", waiverRationale: "" } },
    ],
    brief, bible, routes, endings, mechanics,
    outputSchema: passagePlanningCandidateSchema,
    requestedMaximumOutputTokens: 8_000,
    maximumEstimatedInputTokens: 32_000,
  };
}

describe("bounded passage-planning context", () => {
  it("is deterministic, includes exact selected/referenced/neighborhood records, and excludes unrelated data", () => {
    const first = buildPassagePlanningContext(fixture());
    const second = buildPassagePlanningContext(fixture());
    expect(first).toEqual(second);
    expect(first.diagnostics.contextFingerprint).toHaveLength(64);
    expect(first.diagnostics.includedRecords.passages).toEqual({ ids: ["passage-a"], versionIds: ["pv-a"] });
    expect(first.diagnostics.includedRecords.neighboringPassages.ids).toEqual(["passage-after", "passage-before"]);
    expect(first.diagnostics.includedRecords.choices.ids).toEqual(["choice-a"]);
    expect(first.diagnostics.includedRecords.threads.ids).toEqual(["thread-a"]);
    expect(first.diagnostics.includedRecords.characters.ids).toEqual(["character-a"]);
    expect(first.diagnostics.excludedRecordCounts).toMatchObject({ passages: 1, threads: 1, routes: 1, locations: 1, facts: 1 });
    expect(JSON.stringify(first.context)).not.toContain("character-unrelated");
    expect(JSON.stringify(first.context)).not.toContain("route-unrelated");
  });

  it("rejects oversized context locally instead of falling back to a whole-project dump", () => {
    const input = fixture();
    input.maximumEstimatedInputTokens = 1;
    expect(() => buildPassagePlanningContext(input)).toThrow(BoundedPassagePlanningContextError);
  });

  it("uses Creative Direction as bounded presentation authority and omits unrelated profiles", () => {
    const input = fixture();
    input.creativeDirection = normalizeCreativeDirection({
      tone: { descriptors: ["intimate", "warm"] }, pacing: { developmentPace: "slow-burn" }, prose: { pointOfView: "third-person-close" }, fieldProvenance: [],
      relationshipPresentation: { profiles: [
        { id: "profile-a", relationshipKind: "friendship", relationshipId: "relationship-a", participantIds: [], developmentStyle: "gradual", emotionalTension: "high", melodrama: "low", mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [] },
        { id: "profile-other", relationshipKind: "rivalry", relationshipId: "relationship-other", participantIds: [], developmentStyle: "volatile", emotionalTension: "high", melodrama: "moderate", mechanicsVisibility: "hidden", customGuidance: "", contentBoundaries: [] },
      ] }, scopedVariations: [],
    });
    input.upstreamVersions["creative-direction"] = "direction-v1";
    const built = buildPassagePlanningContext(input);
    expect(built.context.upstream.creativeDirection?.relationshipPresentation?.profiles.map((item) => item.id)).toEqual(["profile-a"]);
    expect(built.context.upstream.brief).not.toHaveProperty("tone");
    expect(built.context.upstream.bible).not.toHaveProperty("proseGuidance");
    expect(built.diagnostics.excludedRecordCounts.creativeDirectionProfiles).toBe(1);
  });

  it("includes a non-adjacent direct inbound choice and its exact source passage while excluding unrelated passages", () => {
    const input = fixture();
    const inbound = {
      ...input.passages[0]!,
      versionId: "pv-inbound",
      content: {
        ...input.passages[0]!.content,
        id: "passage-inbound",
        title: "Inbound",
        position: 4,
        choiceIds: ["choice-inbound"],
      },
    };
    input.passages.push(inbound);
    input.structure.sequences[0]!.passageIds.push("passage-inbound");
    input.choices.push({
      versionId: "cv-inbound",
      content: {
        ...input.choices[0]!.content,
        id: "choice-inbound",
        sourcePassageId: "passage-inbound",
        destinationPassageId: "passage-a",
      },
    });

    const built = buildPassagePlanningContext(input);
    expect(built.diagnostics.includedRecords.choices.ids).toEqual(["choice-a", "choice-inbound"]);
    expect(built.diagnostics.includedRecords.neighboringPassages).toEqual({
      ids: ["passage-after", "passage-before", "passage-inbound"],
      versionIds: ["pv-after", "pv-before", "pv-inbound"],
    });
    expect(built.context.neighboringPassages.find((item) => item.content.id === "passage-inbound")?.versionId).toBe("pv-inbound");
    expect(built.context.selectedPassages.some((item) => item.content.id === "passage-unrelated")).toBe(false);
    expect(built.context.neighboringPassages.some((item) => item.content.id === "passage-unrelated")).toBe(false);
  });

  it("accepts a strict shared-route candidate and enforces references and deterministic generated IDs", () => {
    const built = buildPassagePlanningContext(fixture());
    const selected = built.context.selectedPassages[0]!.content;
    const base = {
      schemaId: passagePlanningCandidateSchema.id,
      schemaVersion: passagePlanningCandidateSchema.version,
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64),
      passages: [selected],
      choices: [built.context.choices[0]!.content],
      threads: [built.context.threads[0]!.content],
      generatedIds: [],
    };
    expect(validatePassagePlanningCandidate({
      raw: JSON.stringify(base), jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    }).diagnostics.valid).toBe(true);

    const logicalKey = "new-branch-choice";
    const generatedId = deterministicCandidateId("a".repeat(64), "choice", logicalKey);
    const withGenerated = {
      ...base,
      passages: [{ ...selected, choiceIds: [...selected.choiceIds, generatedId] }],
      choices: [...base.choices, { ...base.choices[0], id: generatedId }],
      generatedIds: [{ entityKind: "choice", logicalKey, id: generatedId }],
    };
    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify(withGenerated), jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).not.toThrow();

    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({ ...base, passages: [{ ...selected, choiceIds: [] }], choices: [] }),
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("must have an outgoing choice");

    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({ ...base, passages: [{ ...selected, endingId: "ending-a" }] }),
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("cannot reference an ending unless it is terminal");

    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({
        ...base,
        choices: [{ ...base.choices[0]!, sourcePassageId: "passage-after" }],
      }),
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("does not originate from passage");

    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({ ...withGenerated, passages: [selected] }),
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("is not represented in source passage");

    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({
        ...base,
        choices: [{ ...base.choices[0]!, sourceDecisionIds: ["decision-unauthorized"] }],
      }),
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("Unauthorized source decision");

    const invalid = { ...base, passages: [{ ...selected, characterIds: ["character-unrelated"] }] };
    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify(invalid), jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow(PassagePlanningCandidateError);

    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({ ...base, unexpected: true }), jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow(PassagePlanningCandidateError);
    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({ ...base, passages: Array.from({ length: 26 }, () => selected) }), jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow(PassagePlanningCandidateError);
    expect(() => validatePassagePlanningCandidate({
      raw: "x".repeat(1_048_577), jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("serialized-size limit");

    let nested: Record<string, unknown> = { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 1 };
    for (let index = 0; index < 13; index += 1) nested = { kind: "not", item: nested };
    expect(() => validatePassagePlanningCandidate({
      raw: JSON.stringify({ ...base, choices: [{ ...base.choices[0], condition: nested }] }),
      jobId: "job-a", unitId: "unit-a", inputFingerprint: "a".repeat(64), context: built.context,
    })).toThrow("nesting exceeds");
  });
});
