import { z } from "zod";
import { IllustratedSceneSchema, ImageAssetSchema, sceneAssetReferences, sourceDigest, type IllustratedScene } from "@story-to-cyoa/domain";
import { ArtifactRepository, PassagePlanRepository, ProjectRepository, validateIllustratedScene, validateImageFile, type StoryDatabase } from "@story-to-cyoa/persistence";
import { stableFingerprint, type IllustratedPresentation } from "@story-to-cyoa/runtime";
import type { ResolvedNativeCompilationInput } from "@story-to-cyoa/pipeline";

const project = { projectId: z.string().min(1).max(200) }, passage = { ...project, passageId: z.string().min(1).max(200) };
export const SceneInputs = {
  read_scene: z.object(passage).strict(),
  review_scene: z.object({ ...project, scene: IllustratedSceneSchema }).strict(),
  apply_scene: z.object({ ...project, scene: IllustratedSceneSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.string().uuid(), approved: z.literal(true) }).strict(),
};

export class IllustratedSceneService {
  private readonly artifacts: ArtifactRepository;
  private readonly plans: PassagePlanRepository;
  constructor(private readonly database: StoryDatabase) { this.artifacts = new ArtifactRepository(database); this.plans = new PassagePlanRepository(database); }
  private access(projectId: string) {
    const project = new ProjectRepository(this.database).get(projectId);
    if (!project || project.archived || project.mode !== "long-form") throw new Error("scene_project_unavailable");
  }
  read(projectId: string, passageId: string) {
    this.access(projectId);
    const passage = this.plans.currentEntity(projectId, "passage", passageId);
    if (!passage) throw new Error("scene_passage_not_found");
    const current = this.artifacts.getCurrent<IllustratedScene>(projectId, `illustrated-scene:${passageId}`);
    return { passageVersionId: passage.id, currentVersionId: current?.id ?? null, scene: current?.content ?? {
      schemaId: "cyoa.illustrated-scene", schemaVersion: 1, passageId, passageVersionId: passage.id,
      layout: "text", background: null, portraits: [], dialogue: [],
    }, stale: Boolean(current && current.content.passageVersionId !== passage.id), providerCalls: 0 };
  }
  review(projectId: string, value: unknown) {
    this.access(projectId);
    const scene = validateIllustratedScene(this.database, projectId, value), state = this.read(projectId, scene.passageId);
    if (scene.passageVersionId !== state.passageVersionId) throw new Error("scene_passage_stale_reload_and_review");
    const result = { scene, previous: state.currentVersionId ? state.scene : null, currentVersionId: state.currentVersionId,
      passageVersionId: state.passageVersionId, providerCalls: 0 };
    return { ...result, fingerprint: sourceDigest({ projectId, ...result }) };
  }
  apply(projectId: string, value: unknown, fingerprint: string) {
    const review = this.review(projectId, value);
    if (review.fingerprint !== fingerprint) throw new Error("scene_review_stale_reload_and_review");
    const version = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: `illustrated-scene:${review.scene.passageId}`, artifactType: "illustrated-scene", content: review.scene, markDependentsStale: false });
    return { versionId: version.id, passageId: review.scene.passageId, status: "applied", providerCalls: 0 };
  }
}

// Historical inputs resolve their own exact scene/approved-image versions, never today's library heads.
export function resolveIllustrations(artifacts: Pick<ArtifactRepository, "getVersion" | "getCurrent">, projectId: string, passages: Array<{ entityId: string; versionId: string }>, refs?: Array<{ versionId: string; contentFingerprint: string }>): ResolvedNativeCompilationInput["illustrations"] {
  const versions = refs ? refs.map((ref) => {
    const v = artifacts.getVersion<IllustratedScene>(ref.versionId);
    if (!v || v.projectId !== projectId || stableFingerprint(v.content) !== ref.contentFingerprint) throw new Error("scene_input_lineage_invalid");
    return v;
  }) : passages.flatMap((p) => {
    const v = artifacts.getCurrent<IllustratedScene>(projectId, `illustrated-scene:${p.entityId}`); return v ? [v] : [];
  });
  if (!versions.length) return undefined;
  const presentation: IllustratedPresentation = { schemaId: "cyoa.illustrated-presentation", schemaVersion: 1, scenes: [], assets: [] };
  const seen = new Set<string>();
  for (const version of versions) {
    const scene = IllustratedSceneSchema.parse(version.content);
    if (version.artifactId !== `illustrated-scene:${scene.passageId}` || version.artifactType !== "illustrated-scene" || version.schemaVersion !== 1
      || !passages.some((p) => p.entityId === scene.passageId && p.versionId === scene.passageVersionId)) throw new Error("scene_passage_stale_reload_and_review");
    for (const ref of sceneAssetReferences(scene)) if (!seen.has(ref.versionId)) {
      const asset = artifacts.getVersion(ref.versionId);
      if (!asset || asset.projectId !== projectId || asset.artifactId !== `image-asset:${ref.assetId}` || asset.artifactType !== "image-asset" || asset.schemaVersion !== 1) throw new Error("scene_asset_lineage_invalid");
      const content = ImageAssetSchema.parse(asset.content);
      if (content.assetId !== ref.assetId || content.status !== "approved") throw new Error("scene_approved_asset_required");
      const fileVersion = artifacts.getCurrent(projectId, `image-file:${content.fileSha256}`);
      if (!fileVersion || fileVersion.artifactType !== "image-file" || fileVersion.version !== 1) throw new Error("scene_file_missing");
      const file = validateImageFile(fileVersion.content);
      if (file.sha256 !== content.fileSha256) throw new Error("scene_file_hash_invalid");
      presentation.assets.push({ id: ref.versionId, dataUrl: `data:image/png;base64,${file.base64}`, altText: content.metadata.altText, credit: content.metadata.credit, license: content.metadata.license });
      seen.add(ref.versionId);
    }
    if (scene.layout === "illustrated") presentation.scenes.push({ passageId: scene.passageId, background: scene.background?.versionId ?? null,
      portraits: scene.portraits.map((p) => ({ ...p, image: p.image.versionId })), dialogue: scene.dialogue });
  }
  return { versions: versions.map((v) => ({ versionId: v.id, content: v.content })), presentation };
}
