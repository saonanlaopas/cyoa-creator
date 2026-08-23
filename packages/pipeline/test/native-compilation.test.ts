import { describe, expect, it } from "vitest";
import {
  NATIVE_COMPILATION_INPUT_SCHEMA_ID,
  NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
  NativeCompilationInputSchema,
  NativeCompilationInputError,
  assertNativeCompilationInput,
  compileNativeGame,
  defaultLongFormEndingPlan,
  defaultLongFormMechanicsPlan,
  defaultLongFormRoutePlan,
  defaultLongFormStoryBible,
  defaultProjectBrief,
  sourceInputFingerprint,
  type NativeCompilationInput,
  type ResolvedNativeCompilationInput,
} from "../src/index.js";
import {
  NATIVE_COMPILER_POLICY_ID,
  NATIVE_COMPILER_POLICY_VERSION,
  NATIVE_COMPILER_VERSION,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  stableFingerprint,
} from "@story-to-cyoa/runtime";

const fingerprint = (character: string) => character.repeat(32);

function exactInput(): NativeCompilationInput {
  const identity: Omit<NativeCompilationInput, "sourceInputFingerprint"> = {
    schemaId: NATIVE_COMPILATION_INPUT_SCHEMA_ID,
    schemaVersion: NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
    projectId: "project-immutable",
    gameId: "project-immutable",
    snapshot: {
      id: "snapshot-v1", version: 1, structureVersionId: "structure-v1",
      upstreamVersions: {
        brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1",
      },
      validationFingerprint: fingerprint("a"),
    },
    structure: { versionId: "structure-v1", contentFingerprint: fingerprint("b") },
    passages: [{ entityId: "passage-start", versionId: "passage-v1", contentFingerprint: fingerprint("c") }],
    choices: [],
    threads: [],
    upstreamArtifacts: [
      ["bible", "bible-v1", "d"],
      ["brief", "brief-v1", "e"],
      ["endings", "endings-v1", "f"],
      ["mechanics", "mechanics-v1", "1"],
      ["routes", "routes-v1", "2"],
    ].map(([artifactId, versionId, marker]) => ({
      artifactId: artifactId as "brief" | "bible" | "routes" | "endings" | "mechanics",
      versionId,
      schemaVersion: 1,
      contentFingerprint: fingerprint(marker),
    })),
    acceptedDrafts: [{
      passageId: "passage-start", versionId: "draft-v1", basedOnPassagePlanVersionId: "passage-v1",
      lifecycleStatus: "accepted", acceptedLocked: false, stale: false, sourceKind: "manual",
      wordCount: 4, proseBytes: 24, proseFingerprint: fingerprint("3"), generationProvenanceFingerprint: null,
      upstreamVersions: {
        brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1",
      },
      neighboringDraftVersions: {},
    }],
    warnings: [],
    compilerPolicy: {
      id: NATIVE_COMPILER_POLICY_ID, version: NATIVE_COMPILER_POLICY_VERSION,
      compilerVersion: NATIVE_COMPILER_VERSION, includeDebugProvenance: true,
    },
    runtimeContract: { schemaVersion: 1, version: NATIVE_RUNTIME_CONTRACT_VERSION },
    bundleContract: { schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID, schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION },
  };
  return NativeCompilationInputSchema.parse({ ...identity, sourceInputFingerprint: sourceInputFingerprint(identity) });
}

describe("native compilation input", () => {
  it("fingerprints exact semantic references canonically and deterministically", () => {
    const first = exactInput();
    const { sourceInputFingerprint: _firstFingerprint, ...firstIdentity } = first;
    const reordered = structuredClone(firstIdentity);
    reordered.snapshot.upstreamVersions = Object.fromEntries(Object.entries(reordered.snapshot.upstreamVersions).reverse());
    reordered.acceptedDrafts[0]!.upstreamVersions = Object.fromEntries(
      Object.entries(reordered.acceptedDrafts[0]!.upstreamVersions).reverse(),
    );
    expect(sourceInputFingerprint(reordered)).toBe(first.sourceInputFingerprint);
    expect(assertNativeCompilationInput(structuredClone(first))).toEqual(first);
  });

  it("changes identity for accepted prose or mechanics meaning", () => {
    const first = exactInput();
    const { sourceInputFingerprint: _firstFingerprint, ...firstIdentity } = first;
    const changedDraft = structuredClone(firstIdentity);
    changedDraft.acceptedDrafts[0]!.versionId = "draft-v2";
    changedDraft.acceptedDrafts[0]!.proseFingerprint = fingerprint("4");
    expect(sourceInputFingerprint(changedDraft)).not.toBe(first.sourceInputFingerprint);

    const changedMechanic = structuredClone(firstIdentity);
    const reference = changedMechanic.upstreamArtifacts.find((item) => item.artifactId === "mechanics")!;
    reference.versionId = "mechanics-v2";
    reference.contentFingerprint = fingerprint("5");
    changedMechanic.snapshot.upstreamVersions.mechanics = "mechanics-v2";
    expect(sourceInputFingerprint(changedMechanic)).not.toBe(first.sourceInputFingerprint);
  });

  it("rejects non-semantic build time and machine path fields instead of fingerprinting them", () => {
    const first = exactInput();
    expect(() => NativeCompilationInputSchema.parse({ ...first, generatedAt: "2026-08-23T00:00:00Z" })).toThrow();
    expect(() => NativeCompilationInputSchema.parse({ ...first, temporaryPath: "C:\\temp\\native.sqlite" })).toThrow();
    expect(() => assertNativeCompilationInput({ ...first, sourceInputFingerprint: fingerprint("0") })).toThrow(
      "fingerprint does not match",
    );
  });
});

function resolvedFixture(): ResolvedNativeCompilationInput {
  const brief = defaultProjectBrief("Exact compiler fixture");
  const bible = defaultLongFormStoryBible({ title: brief.workingTitle, protagonist: brief.protagonist });
  const routes = defaultLongFormRoutePlan(brief);
  const endings = defaultLongFormEndingPlan(routes);
  const mechanics = defaultLongFormMechanicsPlan(bible, endings);
  const routeId = routes.routes[0]!.id;
  const endingId = endings.endings.find((ending) => ending.routeId === routeId)!.id;
  const structure = {
    schemaVersion: 1 as const,
    title: "Exact native structure",
    projectWordTarget: 2_000,
    typicalPathWordTarget: 2_000,
    startPassageId: "passage-start",
    acts: [{
      id: "act-main", label: "Main", purpose: "", summary: "", wordTarget: 2_000,
      routeIds: [routeId], sequenceIds: ["sequence-main"], position: 0,
    }],
    sequences: [{
      id: "sequence-main", actId: "act-main", label: "Main sequence", purpose: "", summary: "",
      wordTarget: 2_000, routeIds: [routeId], passageIds: ["passage-start", "passage-end"],
      entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0,
      planningStatus: "planned" as const,
    }],
    characterAvailability: [],
  };
  const passages = [{
    versionId: "passage-start-v1",
    content: {
      id: "passage-start", sequenceId: "sequence-main", title: "Opening", kind: "scene" as const,
      purpose: "Begin", summary: "", wordTarget: 1_000, routeIds: [routeId], tags: [], characterIds: [],
      relationshipIds: [], locationIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [],
      payoffThreadIds: [], preservedDifferenceIds: [], choiceIds: ["choice-finish"], terminal: false,
      endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned" as const, position: 0,
    },
  }, {
    versionId: "passage-end-v1",
    content: {
      id: "passage-end", sequenceId: "sequence-main", title: "Ending", kind: "epilogue" as const,
      purpose: "Finish", summary: "", wordTarget: 1_000, routeIds: [routeId], tags: [], characterIds: [],
      relationshipIds: [], locationIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [],
      payoffThreadIds: [], preservedDifferenceIds: [], choiceIds: [], terminal: true, endingId,
      draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned" as const, position: 1,
    },
  }];
  const choices = [{
    versionId: "choice-finish-v1",
    content: {
      id: "choice-finish", sourcePassageId: "passage-start", label: "Finish",
      destinationPassageId: "passage-end", narrativeIntent: "", consequencePreview: "", condition: null,
      unavailableBehavior: "disabled" as const, unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
    },
  }];
  const upstreamArtifacts: ResolvedNativeCompilationInput["upstreamArtifacts"] = [
    { artifactId: "brief", versionId: "brief-v1", schemaVersion: 1, content: brief },
    { artifactId: "bible", versionId: "bible-v1", schemaVersion: 1, content: bible },
    { artifactId: "routes", versionId: "routes-v1", schemaVersion: 1, content: routes },
    { artifactId: "endings", versionId: "endings-v1", schemaVersion: 1, content: endings },
    { artifactId: "mechanics", versionId: "mechanics-v1", schemaVersion: 1, content: mechanics },
  ];
  const prose = new Map([
    ["passage-start", "Exact opening prose."],
    ["passage-end", "Exact ending prose."],
  ]);
  const acceptedDrafts = passages.map((passage) => {
    const proseMarkdown = prose.get(passage.content.id)!;
    return {
      selection: {
        passageId: passage.content.id,
        versionId: `draft-${passage.content.id}-v1`,
        basedOnPassagePlanVersionId: passage.versionId,
        lifecycleStatus: "accepted" as const,
        acceptedLocked: false,
        stale: false as const,
        sourceKind: "manual" as const,
        wordCount: proseMarkdown.split(/\s+/u).length,
        proseBytes: new TextEncoder().encode(proseMarkdown).byteLength,
        proseFingerprint: stableFingerprint(proseMarkdown),
        generationProvenanceFingerprint: null,
        upstreamVersions: Object.fromEntries(upstreamArtifacts.map((item) => [item.artifactId, item.versionId])),
        neighboringDraftVersions: {},
      },
      proseMarkdown,
    };
  });
  const identity: Omit<NativeCompilationInput, "sourceInputFingerprint"> = {
    schemaId: NATIVE_COMPILATION_INPUT_SCHEMA_ID,
    schemaVersion: NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
    projectId: "project-compiler",
    gameId: "project-compiler",
    snapshot: {
      id: "snapshot-v1", version: 1, structureVersionId: "structure-v1",
      upstreamVersions: Object.fromEntries(upstreamArtifacts.map((item) => [item.artifactId, item.versionId])),
      validationFingerprint: stableFingerprint({ valid: true }),
    },
    structure: { versionId: "structure-v1", contentFingerprint: stableFingerprint(structure) },
    passages: passages.map((item) => ({
      entityId: item.content.id, versionId: item.versionId, contentFingerprint: stableFingerprint(item.content),
    })),
    choices: choices.map((item) => ({
      entityId: item.content.id, versionId: item.versionId, contentFingerprint: stableFingerprint(item.content),
    })),
    threads: [],
    upstreamArtifacts: upstreamArtifacts.map(({ content, ...reference }) => ({
      ...reference, contentFingerprint: stableFingerprint(content),
    })),
    acceptedDrafts: acceptedDrafts.map((item) => item.selection),
    warnings: [],
    compilerPolicy: {
      id: NATIVE_COMPILER_POLICY_ID, version: NATIVE_COMPILER_POLICY_VERSION,
      compilerVersion: NATIVE_COMPILER_VERSION, includeDebugProvenance: true,
    },
    runtimeContract: { schemaVersion: 1, version: NATIVE_RUNTIME_CONTRACT_VERSION },
    bundleContract: { schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID, schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION },
  };
  return {
    input: NativeCompilationInputSchema.parse({ ...identity, sourceInputFingerprint: sourceInputFingerprint(identity) }),
    structure: { versionId: "structure-v1", content: structure },
    passages,
    choices,
    threads: [],
    upstreamArtifacts,
    acceptedDrafts,
  };
}

describe("native pure compiler resolved-input lineage", () => {
  it("compiles exact resolved input and accepts canonical collection reordering", () => {
    const exact = resolvedFixture();
    const first = compileNativeGame(exact);
    const reordered = structuredClone(exact);
    reordered.passages.reverse();
    reordered.acceptedDrafts.reverse();
    reordered.upstreamArtifacts.reverse();
    expect(compileNativeGame(reordered)).toEqual(first);
  });

  it.each([
    ["changed passage content", (value: ResolvedNativeCompilationInput) => { value.passages[0]!.content.title = "Tampered"; }],
    ["malformed resolved passage", (value: ResolvedNativeCompilationInput) => {
      (value.passages[0] as { content: unknown }).content = null;
    }],
    ["changed choice content", (value: ResolvedNativeCompilationInput) => { value.choices[0]!.content.label = "Tampered"; }],
    ["wrong passage version", (value: ResolvedNativeCompilationInput) => { value.passages[0]!.versionId = "wrong-version"; }],
    ["wrong structure version", (value: ResolvedNativeCompilationInput) => { value.structure.versionId = "wrong-version"; }],
    ["changed structure content", (value: ResolvedNativeCompilationInput) => { value.structure.content.title = "Tampered"; }],
    ["changed mechanics content", (value: ResolvedNativeCompilationInput) => {
      const mechanics = value.upstreamArtifacts.find((item) => item.artifactId === "mechanics")!.content as any;
      mechanics.visibleStats[0].label = "Tampered";
    }],
    ["changed accepted prose", (value: ResolvedNativeCompilationInput) => { value.acceptedDrafts[0]!.proseMarkdown = "Tampered prose."; }],
    ["missing accepted draft", (value: ResolvedNativeCompilationInput) => { value.acceptedDrafts.pop(); }],
    ["extra accepted draft", (value: ResolvedNativeCompilationInput) => {
      const extra = structuredClone(value.acceptedDrafts[0]!);
      extra.selection.passageId = "passage-extra";
      value.acceptedDrafts.push(extra);
    }],
    ["duplicate accepted passage", (value: ResolvedNativeCompilationInput) => {
      value.acceptedDrafts.push(structuredClone(value.acceptedDrafts[0]!));
    }],
  ])("rejects %s with a normalized input error", (_label, mutate) => {
    const value = resolvedFixture();
    mutate(value);
    expect(() => compileNativeGame(value)).toThrow(NativeCompilationInputError);
  });
});
