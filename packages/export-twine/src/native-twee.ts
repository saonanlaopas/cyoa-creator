import { createHash } from "node:crypto";
import { assertNativePlayerConfig, loadNativeGame, stableFingerprint, type NativeGameBundle, type NativePlayerConfig } from "@story-to-cyoa/runtime";
import { escapeTweeText } from "./escape.js";

export interface TweeCompatibilityDiagnostic { code: string; message: string; path?: string }
export interface NativeTweeResult {
  compatible: boolean;
  diagnostics: TweeCompatibilityDiagnostic[];
  twee: string | null;
  ifid: string;
  passageNames: Record<string, string>;
  warnings: TweeCompatibilityDiagnostic[];
  referencedEntityIds: string[];
  compatibilityFingerprint: string;
}

const js = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function nativeTweeIfid(gameId: string): string {
  const chars = createHash("sha256").update(`cyoa-native:${gameId}`).digest("hex").slice(0, 32).split("");
  chars[12] = "5"; chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const value = chars.join("").toUpperCase();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function passageName(title: string, id: string): string {
  const safe = title.normalize("NFKC").replace(/[\[\]{}|<>\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Passage";
  return `${safe} -- ${createHash("sha256").update(id).digest("hex").slice(0, 10)}`;
}

const escapeNativeTweeProse = (value: string) => escapeTweeText(value).replace(/^::/gm, "&#58;:");

export function analyzeNativeTweeCompatibility(bundleValue: unknown): TweeCompatibilityDiagnostic[] {
  try { loadNativeGame(bundleValue); return []; }
  catch (error) { return [{ code: "twee.native-bundle-invalid", message: (error as Error).message }]; }
}

export function renderNativeTwee(bundleValue: unknown, config: NativePlayerConfig, storyTitle?: string): NativeTweeResult {
  const diagnostics = analyzeNativeTweeCompatibility(bundleValue);
  const fallbackGameId = typeof bundleValue === "object" && bundleValue && "gameId" in bundleValue
    ? String((bundleValue as { gameId: unknown }).gameId) : "invalid";
  if (diagnostics.length) return compatibilityResult(false, diagnostics, null, fallbackGameId, {}, []);
  const bundle = loadNativeGame(bundleValue).bundle;
  try { assertNativePlayerConfig(config, bundle); }
  catch (error) { diagnostics.push({ code: "twee.player-config-invalid", message: (error as Error).message }); }
  if (diagnostics.length) return compatibilityResult(false, diagnostics, null, bundle.gameId, {}, []);
  const names = Object.fromEntries(bundle.passages.map((passage) => [passage.id, passageName(passage.presentation.title, passage.id)]));
  const choices = new Map(bundle.choices.map((choice) => [choice.id, choice]));
  const passages = bundle.passages.map((passage) => {
    const prose = passage.proseMarkdown.split(/\r?\n\s*\r?\n/).map(escapeNativeTweeProse).join("\n\n");
    const renderedChoices = passage.choiceIds.map((id) => choices.get(id)).filter(Boolean).map((choice) => {
      const destination = names[choice!.destinationPassageId]!;
      const enabled = `setup.cyoa.available($cyoa,${js(choice)}).enabled`;
      const link = `<<link ${js(choice!.text)}>><<if setup.cyoa.choose($cyoa,${js(choice)},${js(bundle.passages.find((p) => p.id === choice!.destinationPassageId))})>><<goto ${js(destination)}>><</if>><</link>>`;
      return choice!.unavailableBehavior === "hidden"
        ? `<<if ${enabled}>>${link}<</if>>`
        : `<<if ${enabled}>>${link}<<else>><span class="cyoa-disabled" title=${js(choice!.unavailableExplanation || "Requirements are not satisfied")}>${escapeTweeText(choice!.text)}</span><</if>>`;
    }).join("\n");
    const ending = passage.terminal ? `\n\n<<if setup.cyoa.ending($cyoa,${js(bundle.endings.find((e) => e.id === passage.endingId))})>><strong>Ending complete.</strong><<else>><strong>This ending is not eligible.</strong><</if>>` : "";
    return `:: ${names[passage.id]} [passage${passage.terminal ? " ending" : ""}]\n${prose}${renderedChoices ? `\n\n${renderedChoices}` : ""}${ending}`;
  });
  const runtimeScript = `setup.cyoa=(()=>{const defs=${js(Object.fromEntries(bundle.mechanics.map((item) => [item.key, item])))};const value=(s,k)=>s.stats[k]??s.relationships[k]??s.flags[k]??s.resources[k];const cmp=(a,o,b)=>o==='eq'?a===b:o==='neq'?a!==b:o==='gt'?a>b:o==='gte'?a>=b:o==='lt'?a<b:a<=b;const test=(s,c)=>!c?true:c.kind==='all'?c.items.every(x=>test(s,x)):c.kind==='any'?c.items.some(x=>test(s,x)):c.kind==='not'?!test(s,c.item):c.kind==='visit-count'?cmp(s.visitCounts[c.passageId]||0,c.operator,c.value):cmp(value(s,c.mechanicKey),c.operator,c.value);const uniq=a=>[...new Set(a)].sort();const effect=(s,e)=>{const groups=[s.stats,s.relationships,s.flags,s.resources],g=groups.find(x=>Object.prototype.hasOwnProperty.call(x,e.mechanicKey)),d=defs[e.mechanicKey];if(!g||!d)return false;const before=g[e.mechanicKey],after=e.operation==='clear'?false:e.operation==='set'?e.value:e.operation==='add'?before+e.value:before-e.value;if(typeof after==='number'&&((d.minimum!==undefined&&after<d.minimum)||(d.maximum!==undefined&&after>d.maximum)))return false;g[e.mechanicKey]=after;return true};return{available:(s,c)=>{const enabled=test(s,c.condition)&&c.routeGateConditions.every(x=>test(s,x));return{enabled,visible:enabled||c.unavailableBehavior!=='hidden'}},choose:(s,c,p)=>{const n=JSON.parse(JSON.stringify(s));if(!c.effects.every(e=>effect(n,e)))return false;n.decisions=uniq(n.decisions.concat(c.sourceDecisionIds));n.turn++;n.currentPassageId=p.id;n.visitCounts[p.id]=(n.visitCounts[p.id]||0)+1;if(!p.terminal)n.routes=uniq(n.routes.concat(p.routeIds));n.knownFacts=uniq(n.knownFacts.concat(p.revealedFactIds));Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,n);return true},ending:(s,e)=>!!e&&(!e.routeId||s.routes.includes(e.routeId))&&e.gateConditions.every(x=>test(s,x))}})();`;
  const title = storyTitle?.trim() || bundle.passages.find((item) => item.id === bundle.startPassageId)?.presentation.title || "CYOA";
  const storyData = { ifid: nativeTweeIfid(bundle.gameId), format: "SugarCube", "format-version": "2.30.0", start: names[bundle.startPassageId] };
  const twee = [
    `:: StoryTitle\n${escapeTweeText(title)}`,
    `:: StoryData\n${js(storyData)}`,
    `:: StoryInit\n<<set $cyoa = ${js(bundle.initialState)}>>`,
    `:: CYOA Runtime [script]\n${runtimeScript}`,
    `:: StoryStylesheet [stylesheet]\n.cyoa-disabled{display:block;opacity:.55;margin:.5rem 0;cursor:not-allowed}`,
    ...passages,
  ].join("\n\n") + "\n";
  return compatibilityResult(true, [], twee, bundle.gameId, names,
    [...bundle.passages.map((item) => item.id), ...bundle.choices.map((item) => item.id), ...bundle.endings.map((item) => item.id)].sort());
}

function compatibilityResult(compatible: boolean, diagnostics: TweeCompatibilityDiagnostic[], twee: string | null, gameId: string, passageNames: Record<string, string>, referencedEntityIds: string[]): NativeTweeResult {
  const meaning = { adapter: "cyoa.native-twee3-sugarcube/v1", compatible, diagnostics, gameId, referencedEntityIds };
  return { compatible, diagnostics, warnings: [], twee, ifid: nativeTweeIfid(gameId), passageNames, referencedEntityIds,
    compatibilityFingerprint: stableFingerprint(meaning) };
}
