import { describe, expect, it } from "vitest";
import {
  NATIVE_COMPILATION_INPUT_SCHEMA_ID,
  NATIVE_COMPILATION_INPUT_SCHEMA_VERSION,
  NativeCompilationInputSchema,
  assertNativeCompilationInput,
  sourceInputFingerprint,
  type NativeCompilationInput,
} from "../src/index.js";
import {
  NATIVE_COMPILER_POLICY_ID,
  NATIVE_COMPILER_POLICY_VERSION,
  NATIVE_COMPILER_VERSION,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
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
