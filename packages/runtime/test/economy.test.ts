import { describe, expect, it } from "vitest";
import { NativeWorldSchema, createNativePlayerSave, loadNativePlayerSave, stableFingerprint, nativeBundleFingerprint, validateNativeGameBundle, progressionEventAvailability, progressionDiagnostics, previewChapterTransition, rewindNativePlayerSession, restartNativePlayerSession, chooseNativePlayerSession, inspectWorldEconomy, economyActionAvailability, loadNativeGame, compiledRuntimeFingerprint, initialWorldState, createNativePlayerConfig, createNativePlayerSession, actNativePlayerWorld } from "../src/index.js";
import { economyFixture } from "./economy-fixture.js";
import { progressionFixture } from "./progression-fixture.js";

describe("W4 atomic inventory, trade and canonical relationship predicates", () => {
  it("purchases, gifts, changes prerequisites and pays event costs/rewards as deterministic atomic actions", () => {
    const f = economyFixture(), initial = structuredClone(f.initial);
    expect(progressionEventAvailability(f.world, f.initial.state, "hello").visible).toBe(false);
    const buy = f.act(f.initial, { kind: "purchase", id: "buy-tea" });
    expect(buy.state.world!.economy).toMatchObject({ currency: 16, items: { tea: 1 }, receipts: { "buy-tea": { count: 1 } } });
    let next = f.act(buy, { kind: "purchase", id: "buy-tea" });
    next = f.act(next, { kind: "gift", id: "gift-tea" });
    expect(next.state.relationships.trust).toBe(1); expect(next.state.world!.economy!.items.tea).toBe(1);
    expect(progressionEventAvailability(f.world, next.state, "hello")).toMatchObject({ visible: true, enabled: true });
    next = f.act(next, { kind: "event", id: "hello" });
    expect(next.state.world).toMatchObject({ minutes: 1435, economy: { currency: 17, items: { tea: 0 } }, progression: { milestones: ["clue"] } });
    expect(progressionEventAvailability(f.world, next.state, "hello").enabled).toBe(false);
    const resumed = loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next));
    const replay = f.act(f.act(f.act(f.act(f.initial, { kind: "purchase", id: "buy-tea" }), { kind: "purchase", id: "buy-tea" }), { kind: "gift", id: "gift-tea" }), { kind: "event", id: "hello" });
    expect(resumed).toEqual(next); expect(replay).toEqual(next); expect(f.initial).toEqual(initial);
    expect(rewindNativePlayerSession(f.bundle, f.config, buy).state.world!.economy).toEqual(initial.state.world!.economy);
    expect(restartNativePlayerSession(f.bundle, f.config).state).toEqual(initial.state);
  });
  it.each(["funds", "stock", "capacity", "closed", "prerequisite"] as const)("rejects %s without changing money, stock, discoveries, time or saves", (kind) => {
    const f = economyFixture(), offer = f.economy.shops[0]!.offers[0]!;
    if (kind === "funds") f.economy.currency.initial = 3;
    if (kind === "stock") offer.stock = 0;
    if (kind === "capacity") f.economy.items[0]!.initial = 20;
    if (kind === "closed") f.economy.shops[0]!.hours = { opens: 60, closes: 120 };
    if (kind === "prerequisite") offer.prerequisites = [{ kind: "relationship", key: "trust", minimum: 1, maximum: null }];
    const initial = f.refresh(), copy = structuredClone(initial);
    expect(economyActionAvailability(f.world, initial.state, { kind: "purchase", id: offer.id }).enabled).toBe(false);
    expect(() => f.act(initial, { kind: "purchase", id: offer.id })).toThrow(); expect(initial).toEqual(copy);
  });
  it("uses own receipt entries for inherited-name IDs and exhausts finite stock after repeated purchases", () => {
    const f = economyFixture(), offer = f.economy.shops[0]!.offers[0]!; offer.id = "toString"; offer.stock = 2; offer.price = 0;
    let next = f.refresh(); next = f.act(next, { kind: "purchase", id: "toString" }); next = f.act(next, { kind: "purchase", id: "toString" });
    expect(next.state.world!.economy!.receipts.toString).toMatchObject({ count: 2 });
    expect(inspectWorldEconomy(f.world, next.state).shops[0]!.offers[0]!.stock).toBe(0);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
    const copy = structuredClone(next); expect(() => f.act(next, { kind: "purchase", id: "toString" })).toThrow("Out of stock"); expect(next).toEqual(copy);
  });
  it.each(["closing", "ancestor", "whole-day"] as const)("checks shop hours throughout a purchase (%s)", (kind) => {
    const f = economyFixture(); f.economy.shops[0]!.offers[0]!.minutes = kind === "whole-day" ? 1440 : 2;
    if (kind === "closing") f.economy.shops[0]!.hours = { opens: 1320, closes: 1431 };
    if (kind === "ancestor") { f.world.locations.push({ id: "area", name: "Area", parentId: null, passageId: null, mapImage: null, marker: null, hours: { opens: 1320, closes: 1431 } }); f.world.locations[0]!.parentId = "area"; f.economy.shops[0]!.hours = null; }
    const initial = f.refresh(); expect(() => f.act(initial, { kind: "purchase", id: "buy-tea" })).toThrow("closed");
  });
  it("allows an overnight shop purchase across midnight and rejects completion exactly at closing", () => {
    const f = economyFixture(); f.economy.shops[0]!.offers[0]!.minutes = 15;
    const next = f.act(f.refresh(), { kind: "purchase", id: "buy-tea" }); expect(next.state.world!.minutes).toBe(1445);
    f.economy.shops[0]!.hours = { opens: 1320, closes: 5 };
    expect(() => f.act(f.refresh(), { kind: "purchase", id: "buy-tea" })).toThrow("closed");
  });
  it("repeats gifts and consumable use only while costs and canonical relationship bounds allow", () => {
    const f = economyFixture(); f.economy.items[0]!.initial = 8;
    let next = f.refresh();
    for (let n = 0; n < 5; n++) next = f.act(next, { kind: "gift", id: "gift-tea" });
    const before = structuredClone(next); expect(() => f.act(next, { kind: "gift", id: "gift-tea" })).toThrow("Relationship"); expect(next).toEqual(before);
    for (let n = 0; n < 3; n++) next = f.act(next, { kind: "use", id: "drink-tea" });
    expect(next.state.world!.economy).toMatchObject({ currency: 23, items: { tea: 0 }, receipts: { "gift-tea": { count: 5 }, "drink-tea": { count: 3 } } });
    expect(() => f.act(next, { kind: "use", id: "drink-tea" })).toThrow("Insufficient");
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
  });
  it.each(["once", "once-per-day", "once-per-chapter", "repeatable"] as const)("enforces authored %s gift repeat policy", (kind) => {
    const f = economyFixture(); f.economy.items[0]!.initial = 5;
    f.economy.gifts[0]!.repeat = kind === "repeatable" ? { kind, cooldownMinutes: 5 } : { kind };
    let next = f.act(f.refresh(), { kind: "gift", id: "gift-tea" });
    expect(() => f.act(next, { kind: "gift", id: "gift-tea" })).toThrow();
    if (kind === "repeatable") { next = f.act(next, { kind: "wait", minutes: 5 }); next = f.act(next, { kind: "gift", id: "gift-tea" }); }
    if (kind === "once-per-day") { next = f.act(next, { kind: "wait", minutes: 15 }); next = f.act(next, { kind: "gift", id: "gift-tea" }); }
    if (kind === "once-per-chapter") {
      f.progression.transitions[0]!.passageId = null; f.progression.transitions[0]!.prerequisites = [];
      // Rebuild the fixture before playing with this immutable transition definition.
      next = f.act(f.refresh(), { kind: "gift", id: "gift-tea" });
      const preview = previewChapterTransition(f.world, next.state, "next"); next = f.act(next, { kind: "chapter-transition", id: "next", previewFingerprint: preview.fingerprint }); next = f.act(next, { kind: "gift", id: "gift-tea" });
    }
    expect(next.state.world!.economy!.receipts["gift-tea"]!.count).toBe(kind === "once" ? 1 : 2);
  });
  it("rejects a recipient's intermediate absence, even when present at both action endpoints", () => {
    const f = economyFixture(); f.economy.items[0]!.initial = 1; f.economy.gifts[0]!.minutes = 15;
    f.people.overrides.push({ id: "absence", characterId: "mara", locationId: null, priority: 20, prerequisites: [{ kind: "time", from: 1435, until: 1440 }] });
    const initial = f.refresh(), copy = structuredClone(initial);
    expect(() => f.act(initial, { kind: "gift", id: "gift-tea" })).toThrow("Recipient unavailable"); expect(initial).toEqual(copy);
  });
  it("rejects a skipped mandatory boundary atomically and resumes through waiting", () => {
    const f = economyFixture(); f.people.events[1]!.mandatory = true; f.economy.shops[0]!.offers[0]!.minutes = 15;
    const initial = f.refresh(), copy = structuredClone(initial); expect(() => f.act(initial, { kind: "purchase", id: "buy-tea" })).toThrow("boundary_use_wait"); expect(initial).toEqual(copy);
    const next = f.act(initial, { kind: "wait", minutes: 15 }); expect(next.state.world!.minutes).toBe(1440);
  });
  it("uses the same canonical relationships after a narrative choice and keeps inventory history isolated", () => {
    const f = economyFixture(), bought = f.act(f.initial, { kind: "purchase", id: "buy-tea" }), before = structuredClone(bought);
    const next = chooseNativePlayerSession(f.bundle, f.config, bought, "choice-0").session;
    expect(next.state.relationships.trust).toBe(1); expect(next.state.world!.economy).toEqual(before.state.world!.economy); expect(bought).toEqual(before);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
  });
  it.each(["currency", "quantity", "receipt", "missing", "version", "unknown-item"] as const)("rejects resealed invalid %s saves", (kind) => {
    const f = economyFixture(), next = f.act(f.initial, { kind: "purchase", id: "buy-tea" }), save = createNativePlayerSave(f.bundle, f.config, next), v = save.state.world!.economy!;
    if (kind === "currency") v.currency++;
    if (kind === "quantity") v.items.tea!++;
    if (kind === "receipt") v.receipts["buy-tea"]!.count++;
    if (kind === "missing") delete save.state.world!.economy;
    if (kind === "version") (v as any).schemaVersion = 2;
    if (kind === "unknown-item") v.items.unknown = 0;
    const { saveFingerprint: _old, ...body } = save; save.saveFingerprint = stableFingerprint(body);
    expect(() => loadNativePlayerSave(f.bundle, f.config, save)).toThrow();
  });
  it.each(["missing-item", "not-consumable", "missing-person", "duplicate", "reserved", "bad-condition", "bad-relationship", "bad-currency"] as const)("rejects invalid %s definitions", (kind) => {
    const f = economyFixture();
    if (kind === "missing-item") f.economy.shops[0]!.offers[0]!.itemId = "missing";
    if (kind === "not-consumable") f.economy.uses[0]!.itemId = "ticket";
    if (kind === "missing-person") f.economy.gifts[0]!.characterId = "missing";
    if (kind === "duplicate") f.economy.uses[0]!.id = "buy-tea";
    if (kind === "reserved") f.economy.items[0]!.id = "__proto__";
    if (kind === "bad-condition") f.economy.gifts[0]!.prerequisites = [{ kind: "item", itemId: "tea", minimum: 5, maximum: 2 }];
    if (kind === "bad-relationship") f.economy.gifts[0]!.effects.relationships[0]!.key = "unknown";
    if (kind === "bad-currency") f.economy.currency.initial = 101;
    expect(NativeWorldSchema.safeParse(f.world).success).toBe(false);
  });
  it("rejects forged canonical bindings and retains old worlds without the extension", () => {
    const f = economyFixture(); f.economy.relationships[0]!.maximum = 6;
    f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle); expect(() => validateNativeGameBundle(f.bundle)).toThrow("canonical");
    const old = progressionFixture(); expect(old.initial.state.world).not.toHaveProperty("economy"); expect(loadNativePlayerSave(old.bundle, old.config, createNativePlayerSave(old.bundle, old.config, old.initial))).toEqual(old.initial);
  });
  it("makes a required event eligible only once its authored transaction can be paid, then blocks other actions", () => {
    const f = economyFixture(); f.economy.currency.initial = 0; f.economy.items[0]!.initial = 2; f.economy.shops[0]!.offers[0]!.price = 0; f.people.events[0]!.mandatory = true;
    let next = f.act(f.refresh(), { kind: "gift", id: "gift-tea" });
    expect(progressionEventAvailability(f.world, next.state, "hello")).toMatchObject({ enabled: false, reason: "Insufficient funds or items" });
    next = f.act(next, { kind: "use", id: "drink-tea" }); next = f.act(next, { kind: "purchase", id: "buy-tea" });
    expect(progressionEventAvailability(f.world, next.state, "hello").enabled).toBe(true);
    expect(() => f.act(next, { kind: "purchase", id: "buy-tea" })).toThrow("pending");
    next = f.act(next, { kind: "event", id: "hello" }); expect(next.state.world!.economy!.currency).toBe(6);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
  });
  it.each(["item", "relationship"] as const)("uses %s range contradictions when checking competing mandatory events", (kind) => {
    const f = economyFixture(); f.people.events[1]!.mandatory = true; f.people.events[2]!.mandatory = true; f.people.events[2]!.priority = 20;
    f.progression.events[1]!.prerequisites = kind === "item" ? [{ kind, itemId: "tea", minimum: 1, maximum: null }] : [{ kind, key: "trust", minimum: 1, maximum: null }];
    f.progression.events[2]!.prerequisites = kind === "item" ? [{ kind, itemId: "tea", minimum: 0, maximum: 0 }] : [{ kind, key: "trust", minimum: null, maximum: 0 }];
    expect(NativeWorldSchema.safeParse(f.world).success).toBe(true);
    f.progression.events[2]!.prerequisites = []; expect(NativeWorldSchema.safeParse(f.world).success).toBe(false);
  });
  it("works without chapters/events or people when only shops and consumables are authored", () => {
    const f = economyFixture(); delete f.world.people; delete f.world.progression; f.economy.gifts = []; f.economy.eventEffects = [];
    let next = f.act(f.refresh(), { kind: "purchase", id: "buy-tea" }); next = f.act(next, { kind: "use", id: "drink-tea" });
    expect(next.state.world).not.toHaveProperty("people"); expect(next.state.world).not.toHaveProperty("progression");
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
  });
  it("counts offer stock as purchases while transferring authored multi-item quantities", () => {
    const f = economyFixture(); Object.assign(f.economy.shops[0]!.offers[0]!, { quantity: 2, price: 3, stock: 2 }); f.economy.gifts[0]!.quantity = 2; f.economy.uses[0]!.quantity = 2;
    let next = f.refresh(); for (let n = 0; n < 2; n++) next = f.act(next, { kind: "purchase", id: "buy-tea" });
    expect(inspectWorldEconomy(f.world, next.state).shops[0]!.offers[0]!.stock).toBe(0);
    next = f.act(next, { kind: "gift", id: "gift-tea" }); next = f.act(next, { kind: "use", id: "drink-tea" });
    expect(next.state.world!.economy).toMatchObject({ currency: 15, items: { tea: 0 } });
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
  });
  it.each(["currency", "item", "relationship"] as const)("rolls back the complete gift when its %s effect exceeds authored bounds", (kind) => {
    const f = economyFixture(); f.economy.items[0]!.initial = 2;
    if (kind === "currency") { f.economy.currency.initial = 100; f.economy.gifts[0]!.effects.currency = 1; }
    if (kind === "item") f.economy.gifts[0]!.effects.items = [{ itemId: "tea", delta: 20 }];
    if (kind === "relationship") f.economy.gifts[0]!.effects.relationships[0]!.delta = 10;
    const initial = f.refresh(), before = structuredClone(initial); expect(() => f.act(initial, { kind: "gift", id: "gift-tea" })).toThrow("bounds"); expect(initial).toEqual(before);
  });
  it("recognizes economic milestone producers in limited progression diagnostics and saved state", () => {
    const f = economyFixture(); f.economy.items[0]!.initial = 1;
    f.progression.events.forEach((r) => { r.milestoneIds = []; }); f.economy.eventEffects[0]!.effects.milestoneIds = [];
    f.economy.gifts[0]!.effects.milestoneIds = ["clue"];
    expect(progressionDiagnostics(f.progression, f.world.initialMinutes, f.economy).some((d) => d.code === "progression.milestone-may-be-unobtainable" && d.entityId === "clue")).toBe(false);
    const next = f.act(f.refresh(), { kind: "gift", id: "gift-tea" }); expect(next.state.world!.progression!.milestones).toContain("clue");
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next))).toEqual(next);
  });
  it.each(["time-before-start", "unknown-location", "mismatched-location", "unvisited-chapter"] as const)("rejects logically invalid %s economy saves", (kind) => {
    const f = economyFixture(); f.economy.items[0]!.initial = 1;
    if (kind !== "unvisited-chapter") { delete f.world.people; delete f.world.progression; f.economy.gifts = []; f.economy.eventEffects = []; }
    const initial = f.refresh(), session = kind === "unvisited-chapter" ? f.act(initial, { kind: "gift", id: "gift-tea" }) : initial;
    const save = createNativePlayerSave(f.bundle, f.config, session);
    if (kind === "time-before-start") save.state.world!.minutes = 0;
    if (kind === "unknown-location") save.state.world!.locationId = "unknown";
    if (kind === "mismatched-location") save.state.world!.locationId = "cafe";
    if (kind === "unvisited-chapter") save.state.world!.economy!.receipts["gift-tea"]!.chapterIds = ["second"];
    const { saveFingerprint: _old, ...body } = save; save.saveFingerprint = stableFingerprint(body);
    expect(() => loadNativePlayerSave(f.bundle, f.config, save)).toThrow();
  });
  it("retains valid canonical relationship keys even when they name an inherited property", () => {
    const f = economyFixture(), runtime = loadNativeGame(f.bundle).runtime;
    const definition = runtime.mechanics.trust!;
    runtime.mechanics = Object.fromEntries([...Object.entries(runtime.mechanics).filter(([key]) => key !== "trust"), ["constructor", { ...definition, key: "constructor" }]]);
    for (const choice of Object.values(runtime.choices)) for (const effect of choice.effects) if (effect.mechanicKey === "trust") effect.mechanicKey = "constructor";
    f.bundle.runtimeFingerprint = compiledRuntimeFingerprint(runtime);
    f.bundle.mechanics.find((m) => m.key === "trust")!.key = "constructor";
    for (const choice of f.bundle.choices) for (const effect of choice.effects) if (effect.mechanicKey === "trust") effect.mechanicKey = "constructor";
    f.bundle.initialState.relationships = Object.fromEntries([["constructor", 0]]);
    const legacy = structuredClone(f.bundle); delete legacy.world; delete legacy.initialState.world; legacy.bundleFingerprint = nativeBundleFingerprint(legacy);
    expect(() => validateNativeGameBundle(legacy)).not.toThrow();
    f.economy.relationships[0]!.key = "constructor"; f.economy.gifts[0]!.effects.relationships[0]!.key = "constructor"; f.economy.items[0]!.initial = 1;
    f.progression.events[0]!.prerequisites = [{ kind: "relationship", key: "constructor", minimum: 1, maximum: null }];
    f.bundle.initialState.world = initialWorldState(f.world); f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle);
    const config = createNativePlayerConfig({ gameId: f.bundle.gameId }, f.bundle), initial = createNativePlayerSession(f.bundle, config), before = structuredClone(initial);
    const next = actNativePlayerWorld(f.bundle, config, initial, { kind: "gift", id: "gift-tea" }).session;
    expect(next.state.relationships.constructor).toBe(1); expect(initial).toEqual(before);
    expect(loadNativePlayerSave(f.bundle, config, createNativePlayerSave(f.bundle, config, next))).toEqual(next);
  });
});
