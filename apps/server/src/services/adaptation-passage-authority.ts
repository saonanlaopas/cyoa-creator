import type { ArtifactRepository } from "@story-to-cyoa/persistence";

export function assertPassageFidelityAuthority(artifacts: ArtifactRepository, projectId: string): void {
  // A4 transfers authority immediately; A5 has not yet bound it into passage foundations.
  if (artifacts.getCurrent(projectId, "adaptation-intent")) {
    throw Object.assign(new Error("Adaptation Intent owns fidelity. A5 foundation bootstrap is required before AI passage planning or drafting; manual authoring remains available."), {
      code: "adaptation_foundation_bootstrap_required", retryable: false,
    });
  }
}
