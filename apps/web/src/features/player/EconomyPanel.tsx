import { useState } from "react";
import { inspectWorldEconomy, type NativeWorld, type RuntimeState, type WorldCommand } from "@story-to-cyoa/runtime";
import "./economy.css";
import { economyFeedback } from "./economy-feedback.js";
export function EconomyPanel({ world, state, disabled, onAction, selectedView }: { world: NativeWorld; state: RuntimeState; disabled: boolean; onAction: (command: WorldCommand, label: string) => void; selectedView?: "inventory" | "shops" | "gifts" }) {
  const [localView, setView] = useState<"inventory" | "shops" | "gifts" | null>(null);
  const view = selectedView ?? localView;
  if (!world.economy) return null;
  const e = world.economy, current = inspectWorldEconomy(world, state), item = (id: string) => e.items.find((i) => i.id === id)!;
  return <section className="economy-panel" aria-label="Inventory and shops">
    <p>{current.currency.name}: <strong>{current.currency.amount}</strong></p>
    {!selectedView && <nav aria-label="Belongings and trade">{(["inventory", "shops", "gifts"] as const).map((key) => <button key={key} aria-pressed={view === key} onClick={() => setView(view === key ? null : key)}>{key === "inventory" ? "Inventory" : key === "shops" ? "Shops here" : "Give a gift"}</button>)}</nav>}
    {view === "inventory" && <section aria-label="Inventory"><h3>Inventory</h3>{!current.items.length && <p>No items held.</p>}
      {current.items.map((i) => <p key={i.id}><strong>{i.name} × {i.quantity}</strong> · {item(i.id).description}</p>)}
      {current.uses.map((a) => { const rule = e.uses.find((r) => r.id === a.id)!; const feedback = economyFeedback(e, undefined, rule.effects); const label = `${a.label} · ${rule.quantity} ${item(rule.itemId).name} · ${rule.minutes} min${feedback ? " · " + feedback : ""}`;
        return <div key={a.id}><button disabled={disabled || !a.enabled} onClick={() => onAction({ kind: "use", id: a.id }, label)}>{label}</button>{a.reason && <small>{a.reason}</small>}</div>; })}
    </section>}
    {view === "shops" && <section aria-label="Local shops"><h3>Shops here</h3>{!current.shops.length && <p>No shops here.</p>}{current.shops.map((s) => {
      const shop = e.shops.find((v) => v.id === s.id)!;
      const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      return <section key={s.id} aria-label={s.name}><h4>{s.name}</h4><p>{shop.hours ? `Daily ${clock(shop.hours.opens)}–${clock(shop.hours.closes)}` : "Open all day"}</p>{s.offers.map((a) => {
        const rule = shop.offers.find((r) => r.id === a.id)!; const label = `Buy ${a.quantity} ${item(a.itemId).name} · ${a.price} ${e.currency.name} · ${rule.minutes} min`;
        return <div key={a.id}><p>Stock: {a.stock}</p><button disabled={disabled || !a.enabled} onClick={() => onAction({ kind: "purchase", id: a.id }, label)}>{label}</button>{a.reason && <small>{a.reason}</small>}</div>;
      })}</section>;
    })}</section>}
    {view === "gifts" && <section aria-label="Gifts"><h3>Give a gift</h3>{!current.gifts.length && <p>No authored gifts for anyone here.</p>}{current.gifts.map((a) => {
      const rule = e.gifts.find((r) => r.id === a.id)!, recipient = world.people!.characters.find((c) => c.id === rule.characterId)!;
      const feedback = economyFeedback(e, undefined, rule.effects); const label = `${a.label} · ${rule.quantity} ${item(rule.itemId).name} to ${recipient.name} · ${rule.minutes} min${feedback ? " · " + feedback : ""}`;
      return <div key={a.id}><button disabled={disabled || !a.enabled} onClick={() => onAction({ kind: "gift", id: a.id }, label)}>{label}</button>{a.reason && <small>{a.reason}</small>}</div>;
    })}</section>}
  </section>;
}
