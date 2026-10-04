import { z } from "zod";
import { planningArtifactIds } from "@story-to-cyoa/domain";

export const EDIT_LIMITS = Object.freeze({ targets: 12, dependencies: 80, contextBytes: 64_000, outputBytes: 96_000, groups: 12, operations: 48 });
export const EditOwnerSchema = z.enum([...planningArtifactIds, "passage-structure", "passage", "choice", "thread"]);
export type EditOwner = z.infer<typeof EditOwnerSchema>;
const id = z.string().trim().min(1).max(240);
export const EditRequestSchema = z.object({ message: z.string().trim().min(1).max(6000), targetKeys: z.array(id).max(EDIT_LIMITS.targets).default([]),
  conversationId: id.optional(), intent: z.enum(["discuss", "propose"]).default("propose"), providerId: z.enum(["offline-edit", "openrouter-edit"]).default("offline-edit"),
  modelId: id.default("offline-edit-v1") }).strict();
export const EditResponseSchema = z.object({ message: z.string().trim().min(1).max(6000), groups: z.array(z.object({
  id, label: z.string().trim().min(1).max(300), explanation: z.string().trim().min(1).max(2000), dependsOnGroupIds: z.array(id).max(EDIT_LIMITS.groups),
  operations: z.array(z.object({ targetKey: id, kind: z.enum(["set-fields", "add-item", "remove-item", "reorder-items"]),
    changes: z.record(z.unknown()).optional(), collection: id.optional(), item: z.record(z.unknown()).optional(), orderedIds: z.array(id).max(500).optional(),
  }).strict().superRefine((op, ctx) => {
    const fields = op.kind === "set-fields" ? ["changes"] : op.kind === "add-item" ? ["collection", "item"] : op.kind === "reorder-items" ? ["collection", "orderedIds"] : [];
    for (const field of ["changes", "collection", "item", "orderedIds"] as const) {
      if (fields.includes(field) !== (op[field] !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid ${field} for ${op.kind}`, path: [field] });
    }
    if (op.orderedIds && new Set(op.orderedIds).size !== op.orderedIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate reorder IDs" });
  })).min(1).max(EDIT_LIMITS.operations),
}).strict()).max(EDIT_LIMITS.groups) }).strict();
export type EditResponse = z.infer<typeof EditResponseSchema>;
export interface EditTarget { key: string; owner: EditOwner; targetId: string; label: string; path: string; versionId: string; value: unknown }
export interface EditPlan {
  id: string; projectId: string; conversationId: string; request: z.infer<typeof EditRequestSchema>;
  targets: EditTarget[]; context: Record<string, unknown>; contextBytes: number; headFingerprint: string; fingerprint: string;
}
export interface EditProvider { id: "offline-edit" | "openrouter-edit"; generate(plan: EditPlan, signal: AbortSignal): Promise<unknown> }
