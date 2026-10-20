import { unavailableConversationEvidence, type ArtifactRepository, type ArtifactVersion, type PortableProjectRows, type PortableRow } from "@story-to-cyoa/persistence";
import { resolveIllustrations } from "./illustrated-scene-service.js";
import { CreativeDirectionSchema, sourceCanonicalJson } from "@story-to-cyoa/domain";
import { assertResolvedNativeCompilationInput, compileNativeGame, sourceInputFingerprint, repairProposalFingerprint, type NativeCompilationInput, type ResolvedNativeCompilationInput } from "@story-to-cyoa/pipeline";
import { serializedBytes, stableFingerprint, type NativeGameBundle } from "@story-to-cyoa/runtime";
import type { NativeBuildRecord } from "./native-compilation-service.js";
import type { RepairProposalGenerationAggregate } from "./repair-proposal-service.js";

function redactCreativeDirectionEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCreativeDirectionEvidence);
  if (!value || typeof value !== "object") return value;
  if ((value as { schemaId?: string }).schemaId === "cyoa.creative-direction" && "fieldProvenance" in value) return unavailableConversationEvidence(CreativeDirectionSchema.parse(value));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactCreativeDirectionEvidence(child)]));
}

export function redactStudioArtifactContent(type: string, value: unknown): unknown {
  const redacted = redactCreativeDirectionEvidence(value);
  if (type === "repair-proposal-generation") {
    const original = value as RepairProposalGenerationAggregate, copy = redacted as RepairProposalGenerationAggregate;
    if (sourceCanonicalJson(original.base) !== sourceCanonicalJson(copy.base)) {
      // Older generations bound full bases; retain that historical authorization, not a new provider request.
      copy.freshnessFingerprint ??= original.baseFingerprint;
      copy.baseFingerprint = repairProposalFingerprint(copy.base);
    }
  }
  return redacted;
}

/** Availability changes exact authoring references, not gameplay. Rebind only those captured native seals. */
export function resealRedactedNativeHistory(original: PortableProjectRows, redacted: PortableProjectRows): void {
  const originalArtifacts = new Map(original.tables.artifact_versions.map((row) => [String(row.id), row]));
  const redactedArtifacts = new Map(redacted.tables.artifact_versions.map((row) => [String(row.id), row]));
  const structure = new Map(original.tables.passage_structure_versions.map((row) => [String(row.id), row]));
  const entities = new Map(original.tables.passage_entity_versions.map((row) => [String(row.id), row]));
  const drafts = new Map(original.tables.passage_draft_versions.map((row) => [String(row.id), row]));
  const content = (records: Map<string, PortableRow>, id: string) => {
    const row = records.get(id); if (!row) throw new Error("studio_redaction_native_lineage_missing");
    return JSON.parse(String(row.content_json));
  };
  const builds = new Map<string, { input: NativeCompilationInput; before: NativeGameBundle; after: NativeGameBundle }>();
  const artifact = <T,>(row: PortableRow | undefined): ArtifactVersion<T> | undefined => row ? {
    id: String(row.id), projectId: String(row.project_id), artifactId: String(row.artifact_id), artifactType: String(row.artifact_type),
    version: Number(row.version), schemaVersion: Number(row.schema_version), content: JSON.parse(String(row.content_json)) as T,
    stale: Boolean(row.stale), createdAt: String(row.created_at),
  } : undefined;
  const reader: Pick<ArtifactRepository, "getVersion" | "getCurrent"> = {
    getVersion: <T,>(id: string) => artifact<T>(originalArtifacts.get(id)),
    getCurrent: <T,>(projectId: string, key: string) => artifact<T>([...originalArtifacts.values()].filter((r) => r.project_id === projectId && r.artifact_id === key).sort((a, b) => Number(b.version) - Number(a.version))[0]),
  };
  for (const row of redacted.tables.artifact_versions.filter((row) => row.artifact_type === "native-compilation-input")) {
    const input = content(originalArtifacts, String(row.id)) as NativeCompilationInput;
    if (input.upstreamArtifacts.every((reference) => reference.contentFingerprint === stableFingerprint(content(redactedArtifacts, reference.versionId)))) continue;
    const resolved: ResolvedNativeCompilationInput = { input,
      structure: { versionId: input.structure.versionId, content: content(structure, input.structure.versionId) },
      passages: input.passages.map((reference) => ({ versionId: reference.versionId, content: content(entities, reference.versionId) })),
      choices: input.choices.map((reference) => ({ versionId: reference.versionId, content: content(entities, reference.versionId) })),
      threads: input.threads.map((reference) => ({ versionId: reference.versionId, content: content(entities, reference.versionId) })),
      upstreamArtifacts: input.upstreamArtifacts.map((reference) => ({ ...reference, content: content(originalArtifacts, reference.versionId) })),
      acceptedDrafts: input.acceptedDrafts.map((selection) => {
        const draft = drafts.get(selection.versionId); if (!draft) throw new Error("studio_redaction_native_draft_missing");
        return { selection, proseMarkdown: String(draft.prose_markdown) };
      }),
      ...(input.illustrations ? { illustrations: resolveIllustrations(reader, input.projectId, input.passages, input.illustrations.versions) } : {}),
    };
    assertResolvedNativeCompilationInput(resolved);
    const before = compileNativeGame(resolved);
    resolved.upstreamArtifacts = resolved.upstreamArtifacts.map((reference) => ({ ...reference, content: content(redactedArtifacts, reference.versionId) }));
    input.upstreamArtifacts.forEach((reference) => { reference.contentFingerprint = stableFingerprint(content(redactedArtifacts, reference.versionId)); });
    const { sourceInputFingerprint: _fingerprint, ...identity } = input;
    input.sourceInputFingerprint = sourceInputFingerprint(identity);
    const after = compileNativeGame(resolved);
    builds.set(String(row.id), { input, before, after }); row.content_json = JSON.stringify(input);
  }
  for (const row of redacted.tables.artifact_versions.filter((row) => row.artifact_type === "native-build")) {
    const build = content(originalArtifacts, String(row.id)) as NativeBuildRecord, bound = builds.get(build.compilationInputArtifactVersionId);
    if (!bound) continue;
    if (build.bundleFingerprint !== bound.before.bundleFingerprint || build.runtimeFingerprint !== bound.before.runtimeFingerprint) throw new Error("studio_redaction_native_build_invalid");
    row.content_json = JSON.stringify({ ...build,
      id: `nativebuild_${stableFingerprint({ inputArtifactVersionId: build.compilationInputArtifactVersionId, sourceInputFingerprint: bound.input.sourceInputFingerprint, bundleFingerprint: bound.after.bundleFingerprint })}`,
      sourceInputFingerprint: bound.input.sourceInputFingerprint, bundleFingerprint: bound.after.bundleFingerprint,
      runtimeFingerprint: bound.after.runtimeFingerprint, serializedBytes: serializedBytes(bound.after),
    });
  }
}
