import type { NativeEconomy } from "@story-to-cyoa/runtime";
export function economyFeedback(e: NativeEconomy, costs: NativeEconomy["eventEffects"][number]["costs"] | undefined, effects: NativeEconomy["uses"][number]["effects"]): string {
  const item = (id: string) => e.items.find((i) => i.id === id)?.name ?? id;
  return [...(costs?.currency ? [`Spend ${costs.currency} ${e.currency.name}`] : []), ...(costs?.items.map((i) => `Consume ${i.quantity} ${item(i.itemId)}`) ?? []),
    ...(effects.currency ? [`${effects.currency > 0 ? "Gain" : "Spend"} ${Math.abs(effects.currency)} ${e.currency.name}`] : []),
    ...effects.items.map((i) => `${i.delta > 0 ? "Gain" : "Consume"} ${Math.abs(i.delta)} ${item(i.itemId)}`)].join("; ");
}
