import { AUTHORING_SETTINGS_ID, AuthoringSettingsSchema, AuthoringInstructionsSchema, legacyAuthoringSettings,
  sourceDigest, sha256, type AuthoringInstructions, type AuthoringSettings } from "@story-to-cyoa/domain";
import { ArtifactRepository } from "./artifact-repository.js";
import { CommandRepository } from "./command-repository.js";
import type { StoryDatabase } from "./database.js";

/** No write-on-read migration: absent legacy settings resolve OFF and retain historical content. */
export class AuthoringInstructionsRepository {
  constructor(private readonly database: StoryDatabase) {}
  settings(projectId: string) {
    if (!this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new Error("Project not found");
    const version = new ArtifactRepository(this.database).getCurrent(projectId, AUTHORING_SETTINGS_ID);
    return { versionId: version?.id ?? null, settings: version ? AuthoringSettingsSchema.parse(version.content) : legacyAuthoringSettings() };
  }
  context(projectId: string): AuthoringInstructions {
    const { versionId, settings } = this.settings(projectId), guide = settings.guide;
    return AuthoringInstructionsSchema.parse({ schemaVersion: 1, policy: "fiction-craft-v1", settingsVersionId: versionId,
      enabled: settings.enabled, origin: settings.origin, selectedGuide: guide ? { id: guide.id, version: guide.version, sha256: guide.sha256 } : null,
      appliedGuide: settings.enabled ? guide : null,
      customInstructions: new CommandRepository(this.database).listEffective(projectId).map(({ id, scope, name, instruction, position }) => ({ id, scope, name, instruction, position, sha256: sha256(instruction) })),
    });
  }
  assertFresh(projectId: string, context: unknown): void {
    if (!context || sourceDigest(context) !== sourceDigest(this.context(projectId))) throw Object.assign(new Error("authoring_instructions_stale_refresh_context"), { code: "authoring_instructions_stale", retryable: false });
  }
  saveInTransaction(projectId: string, settings: AuthoringSettings) {
    return new ArtifactRepository(this.database).saveArtifactInTransaction({ projectId, artifactId: AUTHORING_SETTINGS_ID, artifactType: AUTHORING_SETTINGS_ID,
      schema: AuthoringSettingsSchema, content: settings, markDependentsStale: false });
  }
}
