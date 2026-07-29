import { z } from "zod";

const Text = z.string().trim().min(1).max(10_000);
const ProposedOperationSchema = z.object({
  kind: z.enum(["set-fields", "add-item", "remove-item", "reorder-items"]),
  targetId: z.string().trim().min(1).max(200),
  collection: z.string().trim().min(1).max(100).optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
  item: z.record(z.string(), z.unknown()).optional(),
  orderedIds: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
}).superRefine((operation, context) => {
  if (operation.kind === "set-fields" && !operation.changes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["changes"], message: "set-fields requires changes" });
  }
  if (operation.kind === "add-item" && (!operation.collection || !operation.item)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["item"], message: "add-item requires collection and item" });
  }
  if (operation.kind === "reorder-items" && (!operation.collection || !operation.orderedIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["orderedIds"], message: "reorder-items requires collection and orderedIds" });
  }
});

export const PlanningAssistantResponseSchema = z.object({
  message: Text,
  proposal: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rationale: z.string().trim().min(1).max(5_000),
    groups: z.array(z.object({
      id: z.string().trim().min(1).max(200),
      label: z.string().trim().min(1).max(300),
      summary: z.string().trim().min(1).max(2_000),
      dependsOnGroupIds: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      safeToApplyIndependently: z.boolean().default(true),
      operations: z.array(ProposedOperationSchema).min(1).max(100),
    })).min(1).max(30),
  }).nullable(),
});

export type PlanningAssistantResponse = z.infer<typeof PlanningAssistantResponseSchema>;

