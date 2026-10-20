import { z } from "zod";

const id = z.string().min(1).max(200);
export const IllustratedPresentationSchema = z.object({
  schemaId: z.literal("cyoa.illustrated-presentation"), schemaVersion: z.literal(1),
  assets: z.array(z.object({
    id, dataUrl: z.string().max(10_666_700).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
    altText: z.string().max(1000), credit: z.string().max(300), license: z.string().max(300),
  }).strict()).max(200),
  scenes: z.array(z.object({
    passageId: id, background: id.nullable(),
    portraits: z.array(z.object({ character: z.string().min(1).max(100), expression: z.string().min(1).max(100),
      position: z.enum(["left", "center", "right"]), image: id }).strict()).max(3),
    dialogue: z.array(z.object({ speaker: z.string().min(1).max(100), text: z.string().min(1).max(2000) }).strict()).max(12),
  }).strict()).max(10000),
}).strict();
export type IllustratedPresentation = z.infer<typeof IllustratedPresentationSchema>;
