import { describe, expect, it } from "vitest";
import {
  CreativeDirectionSchema,
  compareCreativeDirectionStrings,
  creativeDirectionFingerprints,
  defaultCreativeDirection,
  normalizeCreativeDirection,
  selectCreativeDirectionContext,
} from "../src/index.js";

describe("Creative Direction v1", () => {
  it("normalizes romance direction and keeps material identity stable across ordering", () => {
    const first = normalizeCreativeDirection({
      tone: { descriptors: ["warm", "intimate", "restrained"] },
      pacing: { developmentPace: "slow-burn", sceneTreatment: "scene-focused", quietScenesAllowed: true },
      prose: { treatment: "long-form", descriptiveness: "descriptive", pointOfView: "third-person-close", interiority: "high", dialogueIntegration: "integrated" },
      relationshipPresentation: { profiles: [{
        id: "romance-main", relationshipKind: "romance", relationshipId: "relationship-main",
        participantIds: ["character-b", "character-a"], developmentStyle: "gradual",
        emotionalTension: "high", melodrama: "low", sensuality: "subtle",
        physicalIntimacy: "fade-to-black", mechanicsVisibility: "subtle",
        customGuidance: "Let trust precede intimacy.", contentBoundaries: ["no coercion"],
      }] },
      scopedVariations: [],
      fieldProvenance: [{ fieldPath: "/tone", reference: { kind: "manual-edit", excerpt: "Author configured" } }],
    });
    const reordered = normalizeCreativeDirection({
      ...first,
      tone: { ...first.tone, descriptors: ["restrained", "warm", "intimate"] },
      relationshipPresentation: { profiles: [{ ...first.relationshipPresentation!.profiles[0]!, participantIds: ["character-a", "character-b"] }] },
      fieldProvenance: [{ fieldPath: "/tone", reference: { kind: "manual-edit", excerpt: "Different explanation" } }],
    });
    expect(reordered.materialFingerprint).toBe(first.materialFingerprint);
    expect(reordered.provenanceFingerprint).not.toBe(first.provenanceFingerprint);
    expect(CreativeDirectionSchema.parse(reordered)).toEqual(reordered);
  });

  it("supports non-romance work with no relationship configuration", () => {
    const direction = normalizeCreativeDirection({
      tone: { descriptors: ["tense", "uncanny"] },
      pacing: { developmentPace: "measured", escalationShape: "stepped", customGuidance: "Investigative escalation" },
      prose: { pointOfView: "third-person-close", descriptiveness: "restrained" },
      scopedVariations: [], fieldProvenance: [],
    });
    expect(direction.relationshipPresentation).toBeUndefined();
    expect(CreativeDirectionSchema.parse(direction)).toEqual(direction);
  });

  it("rejects unknown fields and romance-only fields on other relationship kinds", () => {
    expect(() => normalizeCreativeDirection({ ...defaultCreativeDirection(), surprise: true } as never)).toThrow();
    expect(() => normalizeCreativeDirection({
      tone: {}, pacing: {}, prose: {}, scopedVariations: [], fieldProvenance: [],
      relationshipPresentation: { profiles: [{
        id: "friends", relationshipKind: "friendship", participantIds: [], developmentStyle: "steady",
        emotionalTension: "moderate", melodrama: "low", sensuality: "subtle",
        mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [],
      }] },
    })).toThrow(/Romance-specific/);
  });

  it("rejects an unscoped relationship profile and invalid scoped provenance paths", () => {
    expect(() => normalizeCreativeDirection({
      tone: {}, pacing: {}, prose: {}, scopedVariations: [], fieldProvenance: [],
      relationshipPresentation: { profiles: [{
        id: "friends", relationshipKind: "friendship", participantIds: [], developmentStyle: "steady",
        emotionalTension: "moderate", melodrama: "low", mechanicsVisibility: "subtle",
        customGuidance: "", contentBoundaries: [],
      }] },
    })).toThrow(/requires a relationshipId or participantIds/);

    const direction = normalizeCreativeDirection({
      tone: {}, pacing: {}, prose: {},
      relationshipPresentation: { profiles: [{
        id: "friends", relationshipKind: "friendship", relationshipId: "relationship-friends",
        participantIds: [], developmentStyle: "steady", emotionalTension: "moderate", melodrama: "low",
        mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [],
      }] },
      scopedVariations: [], fieldProvenance: [],
    });
    const invalidPath = {
      ...direction,
      fieldProvenance: [{ fieldPath: "/banana", reference: { kind: "manual-edit" as const } }],
    };
    expect(() => CreativeDirectionSchema.parse({
      ...invalidPath,
      ...creativeDirectionFingerprints(invalidPath),
    })).toThrow(/material field/);
    const wrongEntity = {
      ...direction,
      fieldProvenance: [{
        fieldPath: "/relationshipPresentation/profiles/friends/customGuidance",
        stableEntityId: "not-friends",
        reference: { kind: "manual-edit" as const },
      }],
    };
    expect(() => CreativeDirectionSchema.parse({
      ...wrongEntity,
      ...creativeDirectionFingerprints(wrongEntity),
    })).toThrow(/stableEntityId must match/);
  });

  it("uses locale-independent Unicode ordering and fixed SHA-256 golden fingerprints", () => {
    const input = {
      tone: {
        descriptors: ["😀", "日本語", "éclair", "ASCII", "Bahasa Indonesia", "e\u0301clair"],
        exclusions: ["jangan", "naïve"],
      },
      pacing: { customGuidance: "pelan tetapi pasti" },
      prose: { voiceDescriptors: ["声", "voice", "💬"], avoid: ["klisé", "cliche"] },
      scopedVariations: [],
      fieldProvenance: [
        { fieldPath: "/tone/descriptors", reference: { kind: "manual-edit" as const, excerpt: "évidence" } },
        { fieldPath: "/pacing/customGuidance", reference: { kind: "manual-edit" as const, excerpt: "bukti Indonesia" } },
        { fieldPath: "/prose/voiceDescriptors", reference: { kind: "manual-edit" as const, excerpt: "証拠 😀" } },
      ],
    };
    const direction = normalizeCreativeDirection(input);
    expect(direction.tone.descriptors).toEqual([
      "ASCII", "Bahasa Indonesia", "e\u0301clair", "éclair", "日本語", "😀",
    ]);
    expect(direction.materialFingerprint).toBe("7b3c7d8ce752ca97e861c58c9620cc4bc494b93c147dc14478e1fe949c5988c4");
    expect(direction.provenanceFingerprint).toBe("c8e3cc2ce660ddff9114e323aa38d1cbeef1a01e8be00a3f24c660266786070b");
    expect(normalizeCreativeDirection({
      ...input,
      tone: { ...input.tone, descriptors: [...input.tone.descriptors].reverse() },
      fieldProvenance: [...input.fieldProvenance].reverse(),
    })).toMatchObject({
      materialFingerprint: direction.materialFingerprint,
      provenanceFingerprint: direction.provenanceFingerprint,
    });
    expect("e\u0301clair").not.toBe("éclair");
    expect(compareCreativeDirectionStrings("e\u0301clair", "éclair")).toBeLessThan(0);
  });

  it("selects only relevant scoped direction and reports exact omissions", () => {
    const direction = normalizeCreativeDirection({
      tone: {}, pacing: {}, prose: {}, fieldProvenance: [],
      relationshipPresentation: { profiles: [
        { id: "p-a", relationshipKind: "friendship", relationshipId: "rel-a", participantIds: [], developmentStyle: "steady", emotionalTension: "moderate", melodrama: "low", mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [] },
        { id: "p-b", relationshipKind: "rivalry", relationshipId: "rel-b", participantIds: [], developmentStyle: "volatile", emotionalTension: "high", melodrama: "moderate", mechanicsVisibility: "hidden", customGuidance: "", contentBoundaries: [] },
      ] },
      scopedVariations: [
        { id: "v-a", scopeKind: "route", scopeId: "route-a", toneDescriptors: ["warm"], pacingGuidance: "", proseGuidance: "" },
        { id: "v-b", scopeKind: "route", scopeId: "route-b", toneDescriptors: ["bleak"], pacingGuidance: "", proseGuidance: "" },
      ],
    });
    const selected = selectCreativeDirectionContext(direction, { routeIds: ["route-a"], relationshipIds: ["rel-a"] });
    expect(selected.context.relationshipPresentation?.profiles.map((item) => item.id)).toEqual(["p-a"]);
    expect(selected.context.scopedVariations.map((item) => item.id)).toEqual(["v-a"]);
    expect(selected.diagnostics.omittedRelationshipProfileIds).toEqual(["p-b"]);
    expect(selected.diagnostics.omittedScopedVariationIds).toEqual(["v-b"]);
  });

  it("keeps maximum scoped collections deterministic and request-bounded", () => {
    const direction = normalizeCreativeDirection({
      tone: { descriptors: ["tense", "uncanny"] }, pacing: {}, prose: {}, fieldProvenance: [],
      relationshipPresentation: { profiles: Array.from({ length: 200 }, (_, index) => ({
        id: `profile-${index}`, relationshipKind: "rivalry" as const, relationshipId: `relationship-${index}`,
        participantIds: [], developmentStyle: "volatile" as const, emotionalTension: "high" as const,
        melodrama: "low" as const, mechanicsVisibility: "subtle" as const, customGuidance: "", contentBoundaries: [],
      })) },
      scopedVariations: Array.from({ length: 200 }, (_, index) => ({
        id: `variation-${index}`, scopeKind: "route" as const, scopeId: `route-${index}`,
        toneDescriptors: ["restrained"], pacingGuidance: "", proseGuidance: "",
      })),
    });
    const scope = { routeIds: ["route-137"], relationshipIds: ["relationship-137"] };
    const first = selectCreativeDirectionContext(direction, scope);
    const second = selectCreativeDirectionContext(direction, scope);
    expect(first).toEqual(second);
    expect(first.context.relationshipPresentation?.profiles.map((item) => item.id)).toEqual(["profile-137"]);
    expect(first.context.scopedVariations.map((item) => item.id)).toEqual(["variation-137"]);
    expect(first.diagnostics).toMatchObject({
      omittedRelationshipProfiles: 199, omittedScopedVariations: 199,
      hardLimitBytes: 256_000, tokenEstimateKind: "estimated",
    });
    expect(first.diagnostics.serializedBytes).toBeLessThan(first.diagnostics.hardLimitBytes);
  });
});
