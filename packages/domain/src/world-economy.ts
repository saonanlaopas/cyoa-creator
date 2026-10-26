import { z } from "zod";
import { WorldPrerequisiteSchema } from "./world-progression.js";
const id = z.string().trim().min(1).max(200), label = z.string().trim().min(1).max(200);
const amount = z.number().int().min(0).max(1_000_000_000), quantity = z.number().int().min(1).max(10000);
const repeat = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once") }).strict(),
  z.object({ kind: z.literal("repeatable"), cooldownMinutes: z.number().int().min(0).max(1440) }).strict(),
  z.object({ kind: z.literal("once-per-day") }).strict(),
  z.object({ kind: z.literal("once-per-chapter") }).strict(),
]);
export const WorldEconomyEffectsSchema = z.object({ currency: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  items: z.array(z.object({ itemId: id, delta: z.number().int().min(-10000).max(10000).refine((n) => n !== 0) }).strict()).max(50),
  relationships: z.array(z.object({ key: id, delta: z.number().finite().min(-10000).max(10000).refine((n) => n !== 0) }).strict()).max(30),
  milestoneIds: z.array(id).max(100),
}).strict();
export const WorldEconomyCostsSchema = z.object({ currency: amount, items: z.array(z.object({ itemId: id, quantity }).strict()).max(50) }).strict();
const rule = { id, label, minutes: z.number().int().min(0).max(1440), prerequisites: z.array(WorldPrerequisiteSchema).max(20), repeat, effects: WorldEconomyEffectsSchema, result: z.string().trim().min(1).max(1000) };
export const WorldEconomySchema = z.object({
  schemaId: z.literal("cyoa.world-economy"), schemaVersion: z.literal(1),
  currency: z.object({ name: label, initial: amount, maximum: amount }).strict(),
  items: z.array(z.object({ id, name: label, description: z.string().trim().max(1000), maximum: quantity, initial: amount, consumable: z.boolean() }).strict()).max(50),
  shops: z.array(z.object({ id, name: label, locationId: id,
    hours: z.object({ opens: z.number().int().min(0).max(1439), closes: z.number().int().min(0).max(1439) }).strict().nullable(),
    offers: z.array(z.object({ id, itemId: id, quantity, price: amount, stock: z.number().int().min(0).max(10000), minutes: z.number().int().min(0).max(1440), prerequisites: z.array(WorldPrerequisiteSchema).max(20) }).strict()).max(30),
  }).strict()).max(20),
  gifts: z.array(z.object({ ...rule, characterId: id, itemId: id, quantity }).strict()).max(60),
  uses: z.array(z.object({ ...rule, itemId: id, quantity }).strict()).max(60),
  eventEffects: z.array(z.object({ eventId: id, costs: WorldEconomyCostsSchema, effects: WorldEconomyEffectsSchema }).strict()).max(100),
}).strict();

export type WorldEconomy = z.infer<typeof WorldEconomySchema>;
export const emptyWorldEconomy = (): WorldEconomy => ({ schemaId: "cyoa.world-economy", schemaVersion: 1, currency: { name: "Coins", initial: 0, maximum: 1_000_000 }, items: [], shops: [], gifts: [], uses: [], eventEffects: [] });
