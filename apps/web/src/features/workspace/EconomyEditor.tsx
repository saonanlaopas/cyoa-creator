import { useContext } from "react";
import { emptyWorldEconomy, emptyWorldProgression, type WorldDefinition, type WorldEconomy } from "@story-to-cyoa/domain";
import { Prerequisites, RemovalButton, WorldConditionOptionsContext } from "./ProgressionEditor.js";
import { economyDependencies, hasEconomyPredicates } from "./economy-authoring.js";
import "../player/economy.css";
type Effects = WorldEconomy["uses"][number]["effects"];
const freshEffects = (): Effects => ({ currency: 0, items: [], relationships: [], milestoneIds: [] });
export function EconomyEditor({ world, onChange }: { world: WorldDefinition; onChange: (value: WorldEconomy | undefined) => void }) {
  const e = world.economy, progression = world.progression ?? emptyWorldProgression(), { relationships } = useContext(WorldConditionOptionsContext);
  const number = (label: string, value: number, change: (v: number) => void, min = 0, max = 1_000_000_000, step: number | "any" = 1) => <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(v) => change(Number(v.target.value))} /></label>;
  const text = (label: string, value: string, change: (v: string) => void, maxLength = 200) => <label>{label}<input value={value} maxLength={maxLength} onChange={(v) => change(v.target.value)} /></label>;
  const select = (label: string, value: string, options: Array<{ id: string; name: string }>, change: (v: string) => void) => <label>{label}<select value={value} onChange={(v) => change(v.target.value)}><option value="">Select…</option>{value && !options.some((v) => v.id === value) && <option value={value}>Missing reference: {value}</option>}{options.map((o) => <option value={o.id} key={o.id}>{o.name || "Untitled"}</option>)}</select></label>;
  if (!e) return <section aria-label="Inventory and shops authoring"><h3>Inventory and shops</h3><label className="world-check"><input type="checkbox" checked={false} onChange={() => onChange(emptyWorldEconomy())} />Inventory and shops enabled</label></section>;
  const items = e.items;
  const conditions = (label: string, values: WorldEconomy["uses"][number]["prerequisites"], change: (v: typeof values) => void) => <Prerequisites label={label} conditions={values} onChange={change} progression={progression} locations={world.locations} />;
  const itemAmounts = (label: string, values: Array<{ itemId: string; quantity: number }>, change: (v: typeof values) => void) => <fieldset><legend>{label}</legend>{values.map((v, i) => <div className="world-row" key={i}>
    {select(`${label} item ${i + 1}`, v.itemId, items, (itemId) => change(values.map((x, j) => i === j ? { ...x, itemId } : x)))}
    {number(`${label} quantity ${i + 1}`, v.quantity, (quantity) => change(values.map((x, j) => i === j ? { ...x, quantity } : x)), 1, 10000)}
    <button onClick={() => change(values.filter((_, j) => i !== j))}>Remove {label.toLowerCase()} {i + 1}</button>
  </div>)}<button disabled={!items.length || values.length >= 50} onClick={() => change([...values, { itemId: items[0]!.id, quantity: 1 }])}>Add {label.toLowerCase()}</button></fieldset>;
  const effects = (label: string, value: Effects, change: (v: Effects) => void) => <fieldset><legend>{label} effects</legend>
    {number(`${label} currency change`, value.currency, (currency) => change({ ...value, currency }), -1_000_000_000)}
    {value.items.map((v, i) => <div className="world-row" key={i}>{select(`${label} effect item ${i + 1}`, v.itemId, items, (itemId) => change({ ...value, items: value.items.map((x, j) => i === j ? { ...x, itemId } : x) }))}{number(`${label} item change ${i + 1}`, v.delta, (delta) => change({ ...value, items: value.items.map((x, j) => i === j ? { ...x, delta } : x) }), -10000, 10000)}<button onClick={() => change({ ...value, items: value.items.filter((_, j) => i !== j) })}>Remove {label.toLowerCase()} item effect {i + 1}</button></div>)}
    <button disabled={!items.length || value.items.length >= 50} onClick={() => change({ ...value, items: [...value.items, { itemId: items[0]!.id, delta: 1 }] })}>Add {label.toLowerCase()} item effect</button>
    {value.relationships.map((v, i) => <div className="world-row" key={i}>{select(`${label} relationship ${i + 1}`, v.key, relationships.map((r) => ({ id: r.key, name: r.label })), (key) => change({ ...value, relationships: value.relationships.map((x, j) => i === j ? { ...x, key } : x) }))}{number(`${label} relationship change ${i + 1}`, v.delta, (delta) => change({ ...value, relationships: value.relationships.map((x, j) => i === j ? { ...x, delta } : x) }), -10000, 10000, "any")}<button onClick={() => change({ ...value, relationships: value.relationships.filter((_, j) => i !== j) })}>Remove {label.toLowerCase()} relationship effect {i + 1}</button></div>)}
    <button disabled={!relationships.length || value.relationships.length >= 30} onClick={() => change({ ...value, relationships: [...value.relationships, { key: relationships[0]!.key, delta: 1 }] })}>Add {label.toLowerCase()} relationship effect</button>
    <fieldset><legend>{label} milestone grants</legend>{progression.milestones.map((m) => <label className="world-check" key={m.id}><input type="checkbox" checked={value.milestoneIds.includes(m.id)} onChange={(v) => change({ ...value, milestoneIds: v.target.checked ? [...value.milestoneIds, m.id] : value.milestoneIds.filter((id) => id !== m.id) })} />{label} grants {m.name}</label>)}</fieldset>
  </fieldset>;
  const rules = (kind: "gifts" | "uses") => {
    const patch = (i: number, next: Partial<WorldEconomy["gifts"][number]>) => onChange({ ...e, [kind]: e[kind].map((r, j) => i === j ? { ...r, ...next } : r) });
    const prefix = kind === "gifts" ? "Gift" : "Use";
    return <section aria-label={kind === "gifts" ? "Authored gifts" : "Consumable rules"}><h4>{kind === "gifts" ? "Gifts" : "Consumable use"}</h4>{e[kind].map((r, i) => { const label = `${prefix} ${i + 1}`; return <fieldset key={r.id}><legend>{label}</legend><div className="world-row">
      {text(label + " label", r.label, (label) => patch(i, { label }))}{select(label + " item", r.itemId, items, (itemId) => patch(i, { itemId }))}{number(label + " quantity consumed", r.quantity, (quantity) => patch(i, { quantity }), 1, 10000)}
      {"characterId" in r && select(label + " recipient", r.characterId, world.people?.characters ?? [], (characterId) => patch(i, { characterId }))}
      {number(label + " minutes", r.minutes, (minutes) => patch(i, { minutes }), 0, 1440)}
      <label>{label} repeat<select value={r.repeat.kind} onChange={(v) => patch(i, { repeat: v.target.value === "repeatable" ? { kind: "repeatable", cooldownMinutes: 0 } : { kind: v.target.value as "once" | "once-per-day" | "once-per-chapter" } })}><option value="once">Once</option><option value="repeatable">Repeatable</option><option value="once-per-day">Once per day</option><option value="once-per-chapter" disabled={!progression.chapters.length}>Once per chapter</option></select></label>
      {r.repeat.kind === "repeatable" && number(label + " cooldown minutes", r.repeat.cooldownMinutes, (cooldownMinutes) => patch(i, { repeat: { kind: "repeatable", cooldownMinutes } }), 0, 1440)}
      {text(label + " result", r.result, (result) => patch(i, { result }), 1000)}
    </div>{conditions(label, r.prerequisites, (prerequisites) => patch(i, { prerequisites }))}{effects(label, r.effects, (effects) => patch(i, { effects }))}<button onClick={() => onChange({ ...e, [kind]: e[kind].filter((_, j) => i !== j) })}>Remove {label.toLowerCase()}</button></fieldset>; })}
    <button disabled={e[kind].length >= 60 || !items.length || kind === "gifts" && !world.people?.characters.length || kind === "uses" && !items.some((i) => i.consumable)} onClick={() => {
      const rule = { id: crypto.randomUUID(), label: "", itemId: (kind === "uses" ? items.find((i) => i.consumable)! : items[0]!).id, quantity: 1, minutes: 0, prerequisites: [], repeat: { kind: "once" as const }, effects: freshEffects(), result: "" };
      onChange(kind === "gifts" ? { ...e, gifts: [...e.gifts, { ...rule, characterId: world.people!.characters[0]!.id }] } : { ...e, uses: [...e.uses, rule] });
    }}>Add {prefix.toLowerCase()} rule</button></section>;
  };
  return <section className="economy-editor" aria-label="Inventory and shops authoring"><h3>Inventory and shops</h3>
    <label className="world-check"><input type="checkbox" checked={true} disabled={hasEconomyPredicates(world)} onChange={() => onChange(undefined)} />Inventory and shops enabled</label>
    {hasEconomyPredicates(world) && <p>Clear item/relationship prerequisites in events, transitions and story overrides before disabling inventory.</p>}
    <p>One integer currency, counted items and finite stock. Costs and effects commit together. Relationship changes use the scales configured in Mechanics and must stay within their limits.</p>
    <h4>Currency</h4><div className="world-row">{text("Currency name", e.currency.name, (name) => onChange({ ...e, currency: { ...e.currency, name } }))}{number("Starting currency", e.currency.initial, (initial) => onChange({ ...e, currency: { ...e.currency, initial } }))}{number("Maximum currency", e.currency.maximum, (maximum) => onChange({ ...e, currency: { ...e.currency, maximum } }))}</div>
    <h4>Items</h4>{items.map((v, i) => { const patch = (next: Partial<typeof v>) => onChange({ ...e, items: items.map((r, j) => i === j ? { ...r, ...next } : r) }); return <fieldset key={v.id}><legend>Item {i + 1}</legend><div className="world-row">
      {text(`Item ${i + 1} name`, v.name, (name) => patch({ name }))}{text(`Item ${i + 1} description`, v.description, (description) => patch({ description }), 1000)}{number(`Item ${i + 1} starting quantity`, v.initial, (initial) => patch({ initial }), 0, 10000)}{number(`Item ${i + 1} maximum quantity`, v.maximum, (maximum) => patch({ maximum }), 1, 10000)}
      <label className="world-check"><input type="checkbox" checked={v.consumable} onChange={(x) => patch({ consumable: x.target.checked })} />Item {i + 1} consumable</label>
      <RemovalButton label={`Remove item ${i + 1}`} dependencies={economyDependencies(world, "item", v.id)} instructions="Remove or retarget the listed offers, rules, effects and prerequisites first." onRemove={() => onChange({ ...e, items: items.filter((_, j) => i !== j) })}>Remove item {i + 1}</RemovalButton>
    </div></fieldset>; })}<button disabled={items.length >= 50} onClick={() => onChange({ ...e, items: [...items, { id: crypto.randomUUID(), name: "", description: "", initial: 0, maximum: 99, consumable: false }] })}>Add item</button>
    <h4>Shops</h4>{e.shops.map((shop, i) => { const patch = (next: Partial<typeof shop>) => onChange({ ...e, shops: e.shops.map((s, j) => i === j ? { ...s, ...next } : s) }); return <fieldset key={shop.id}><legend>Shop {i + 1}</legend><div className="world-row">
      {text(`Shop ${i + 1} name`, shop.name, (name) => patch({ name }))}{select(`Shop ${i + 1} location`, shop.locationId, world.locations.filter((l) => l.passage), (locationId) => patch({ locationId }))}
      <label className="world-check"><input type="checkbox" checked={Boolean(shop.hours)} onChange={(v) => patch({ hours: v.target.checked ? { opens: 480, closes: 1320 } : null })} />Shop {i + 1} hours</label>
      {shop.hours && <>{number(`Shop ${i + 1} opens`, shop.hours.opens, (opens) => patch({ hours: { ...shop.hours!, opens } }), 0, 1439)}{number(`Shop ${i + 1} closes`, shop.hours.closes, (closes) => patch({ hours: { ...shop.hours!, closes } }), 0, 1439)}</>}
    </div>{shop.offers.map((offer, j) => { const label = `Shop ${i + 1} offer ${j + 1}`, update = (next: Partial<typeof offer>) => patch({ offers: shop.offers.map((r, k) => j === k ? { ...r, ...next } : r) }); return <fieldset key={offer.id}><legend>{label}</legend><div className="world-row">{select(label + " item", offer.itemId, items, (itemId) => update({ itemId }))}{number(label + " quantity per purchase", offer.quantity, (quantity) => update({ quantity }), 1, 10000)}{number(label + " price", offer.price, (price) => update({ price }))}{number(label + " stock (purchases)", offer.stock, (stock) => update({ stock }), 0, 10000)}{number(label + " minutes", offer.minutes, (minutes) => update({ minutes }), 0, 1440)}</div>{conditions(label, offer.prerequisites, (prerequisites) => update({ prerequisites }))}<button onClick={() => patch({ offers: shop.offers.filter((_, k) => j !== k) })}>Remove {label.toLowerCase()}</button></fieldset>; })}
      <button disabled={!items.length || shop.offers.length >= 30} onClick={() => patch({ offers: [...shop.offers, { id: crypto.randomUUID(), itemId: items[0]!.id, quantity: 1, price: 1, stock: 1, minutes: 0, prerequisites: [] }] })}>Add shop {i + 1} offer</button>
      <button onClick={() => onChange({ ...e, shops: e.shops.filter((_, j) => i !== j) })}>Remove shop {i + 1}</button>
    </fieldset>; })}<button disabled={e.shops.length >= 20 || !world.locations.some((l) => l.passage)} onClick={() => onChange({ ...e, shops: [...e.shops, { id: crypto.randomUUID(), name: "", locationId: world.locations.find((l) => l.passage)!.id, hours: null, offers: [] }] })}>Add shop</button>
    {rules("gifts")}{rules("uses")}
    <h4>Event transactions</h4><p>Optional costs and effects for existing events. Repeated events repeat their transaction; all funds/items must exist before rewards.</p>{e.eventEffects.map((r, i) => { const label = `Event transaction ${i + 1}`, patch = (next: Partial<typeof r>) => onChange({ ...e, eventEffects: e.eventEffects.map((v, j) => i === j ? { ...v, ...next } : v) }); return <fieldset key={i}><legend>{label}</legend>
      {select(label + " event", r.eventId, progression.events.map((r) => ({ id: r.id, name: r.label })), (eventId) => patch({ eventId }))}{number(label + " currency cost", r.costs.currency, (currency) => patch({ costs: { ...r.costs, currency } }))}{itemAmounts(label + " item costs", r.costs.items, (items) => patch({ costs: { ...r.costs, items } }))}{effects(label, r.effects, (effects) => patch({ effects }))}
      <button onClick={() => onChange({ ...e, eventEffects: e.eventEffects.filter((_, j) => i !== j) })}>Remove event transaction {i + 1}</button>
    </fieldset>; })}<button disabled={!progression.events.some((r) => !e.eventEffects.some((v) => v.eventId === r.id)) || e.eventEffects.length >= 100} onClick={() => onChange({ ...e, eventEffects: [...e.eventEffects, { eventId: progression.events.find((r) => !e.eventEffects.some((v) => v.eventId === r.id))!.id, costs: { currency: 0, items: [] }, effects: freshEffects() }] })}>Add event transaction</button>
  </section>;
}
export function EconomySummary({ economy: e, world }: { economy: WorldEconomy; world?: WorldDefinition }) {
  const { relationships } = useContext(WorldConditionOptionsContext);
  const item = (id: string) => e.items.find((i) => i.id === id)?.name || id;
  const location = (id: string) => world?.locations.find((l) => l.id === id)?.name || id;
  const milestone = (id: string) => world?.progression?.milestones.find((m) => m.id === id)?.name || id;
  const condition = (c: WorldEconomy["uses"][number]["prerequisites"][number]) => c.kind === "item" ? `${item(c.itemId)} quantity ${c.minimum}–${c.maximum ?? "unbounded"}`
    : c.kind === "relationship" ? `${relationships.find((r) => r.key === c.key)?.label ?? c.key} (${c.key}) ${c.minimum ?? "unbounded"}–${c.maximum ?? "unbounded"}`
    : c.kind === "time" ? `Minutes ${c.from ?? "start"}–${c.until ?? "unbounded"} (end exclusive)`
    : c.kind === "location" ? `${c.present ? "At" : "Not at"} ${location(c.locationId)}`
    : c.kind === "milestone" ? `${milestone(c.milestoneId)} ${c.achieved ? "achieved" : "not achieved"}` : `Chapter ${world?.progression?.chapters.find((v) => v.id === c.chapterId)?.name ?? c.chapterId} ${c.current ? "current" : "not current"}`;
  const effect = (v: Effects) => [`${e.currency.name}: ${v.currency >= 0 ? "+" : ""}${v.currency}`, ...v.items.map((i) => `${item(i.itemId)}: ${i.delta >= 0 ? "+" : ""}${i.delta}`),
    ...v.relationships.map((r) => `${relationships.find((v) => v.key === r.key)?.label ?? r.key} (${r.key}): ${r.delta >= 0 ? "+" : ""}${r.delta}`), ...v.milestoneIds.map((id) => `Grant ${milestone(id)}`)].join("; ");
  return <section aria-label="Inventory and shops summary"><h4>Inventory and shops</h4><p>{e.currency.name}: initial {e.currency.initial}, maximum {e.currency.maximum}</p>
    {e.items.map((i) => <p key={i.id}>{i.name} · initial {i.initial} / maximum {i.maximum} · {i.consumable ? "Consumable" : "Not consumable"} · {i.description}</p>)}
    {e.shops.map((s) => <section key={s.id}><p>{s.name} · {location(s.locationId)} · {s.hours ? `Daily minutes ${s.hours.opens}–${s.hours.closes} (end exclusive)` : "Always open"}</p>
      {s.offers.map((r) => <p key={r.id}>Buy {r.quantity} {item(r.itemId)} · {r.price} {e.currency.name} · stock {r.stock} purchases · {r.minutes} min · Prerequisites: {r.prerequisites.map(condition).join("; ") || "None"}</p>)}</section>)}
    {[...e.gifts, ...e.uses].map((r) => <p key={r.id}>{r.label} · Consume {r.quantity} {item(r.itemId)}{"characterId" in r ? ` for ${world?.people?.characters.find((v) => v.id === r.characterId)?.name ?? r.characterId}` : ""} · {r.minutes} min · {r.repeat.kind}{r.repeat.kind === "repeatable" ? `, cooldown ${r.repeat.cooldownMinutes} min` : ""} · Prerequisites: {r.prerequisites.map(condition).join("; ") || "None"} · Effects: {effect(r.effects)} · {r.result}</p>)}
    {e.eventEffects.map((r) => <p key={r.eventId}>Event {world?.progression?.events.find((v) => v.id === r.eventId)?.label ?? r.eventId} · Costs: {r.costs.currency} {e.currency.name}; {r.costs.items.map((i) => `${i.quantity} ${item(i.itemId)}`).join("; ") || "No items"} · Effects: {effect(r.effects)}</p>)}
  </section>;
}
