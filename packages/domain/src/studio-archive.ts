import { z } from "zod";
import { AnalysisSourceSchema } from "./source-analysis.js";

export const SourceEvidenceMaterialSchema = z.object({ schemaId: z.literal("cyoa.source-evidence-material"), schemaVersion: z.literal(1),
  projectId: z.string().min(1).max(240), sourceVersionId: z.string().min(1).max(240), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  source: AnalysisSourceSchema,
}).strict();

export const StudioArchiveEvidenceSchema = z.object({ schemaId: z.literal("cyoa.studio-archive-evidence"), schemaVersion: z.literal(1),
  projectId: z.string().min(1).max(240), omissions: z.array(z.object({
    kind: z.enum(["conversations", "messages", "change_sets", "conversation_summary_series", "conversation_summary_versions",
      "pinned_decisions", "pinned_decision_versions", "setup_proposals", "adaptation-intent-proposal", "conversational-edit-application", "source-evidence-material"]),
    id: z.string().min(1).max(240), digest: z.string().regex(/^[a-f0-9]{64}$/), availability: z.literal("redacted"),
    status: z.string().max(40).optional(),
  }).strict()).max(1_000_000),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.omissions.map((item) => `${item.kind}:${item.id}`)).size !== value.omissions.length) ctx.addIssue({ code: "custom", message: "Duplicate unavailable history identity" });
});
