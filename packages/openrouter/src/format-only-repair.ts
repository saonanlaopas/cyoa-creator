import { OpenRouterError } from "./errors.js";
/** Conservative format recovery, never prose inference. Only fences, trailing commas and missing closing containers. */
export class FormatOnlyRepairError extends OpenRouterError {
  readonly retryable = false;
  constructor(public readonly code: "format_repair_original_unverifiable" | "format_repair_content_changed", message: string) { super(code, message); this.name = "FormatOnlyRepairError"; }
}
export function formatRepairBaseline(raw: string, recover = true): unknown {
  const invalid = (): never => { throw new FormatOnlyRepairError("format_repair_original_unverifiable", "Cannot establish an unambiguous original content baseline; create a separately authorized revision."); };
  if (new TextEncoder().encode(raw).length > 1_000_000) invalid();
  const fence = recover ? /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(raw) : null;
  const text = fence ? fence[1]! : raw;
  let at = 0, nodes = 0;
  const space = () => { while (/\s/.test(text[at] ?? "") && at < text.length) at++; };
  const value = (depth: number): unknown => {
    if (++nodes > 50_000 || depth > 64) invalid();
    space(); const c = text[at];
    if (c === '"') {
      const start = at++;
      for (; at < text.length; at++) {
        if (text[at] === '\\') { at++; continue; }
        if (text[at] === '"') { at++; try { return JSON.parse(text.slice(start, at)); } catch { invalid(); } }
      }
      return invalid();
    }
    if (c === "{" || c === "[") {
      at++; space(); const object = c === "{", close = object ? "}" : "]";
      const result: Record<string, unknown> | unknown[] = object ? Object.create(null) : [];
      const keys = new Set<string>();
      if (text[at] === close) { at++; return result; }
      while (at < text.length) {
        if (object) {
          space(); if (text[at] !== '"') invalid(); const key = value(depth + 1);
          if (typeof key !== "string") return invalid(); if (keys.has(key)) invalid(); keys.add(key);
          space(); if (text[at++] !== ":") invalid();
          (result as Record<string, unknown>)[key] = value(depth + 1);
        } else (result as unknown[]).push(value(depth + 1));
        space();
        if (text[at] === close) { at++; return result; }
        if (at === text.length && recover) return result;
        if (text[at++] !== ",") invalid();
        space(); if (text[at] === close && recover) { at++; return result; }
        if (at === text.length) invalid();
      }
      return invalid();
    }
    for (const [token, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(token, at)) { at += token.length; return result; }
    }
    const n = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (n) { at += n[0].length; const result = Number(n[0]); if (!Number.isFinite(result)) invalid(); return result; }
    return invalid();
  };
  const result = value(0); space(); if (at !== text.length) invalid(); return result;
}
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}` : JSON.stringify(v);
export function assertFormatOnlyRepair(original: string, repaired: string): void {
  const before = formatRepairBaseline(original), after = formatRepairBaseline(repaired, false);
  if (canonical(before) !== canonical(after)) throw new FormatOnlyRepairError("format_repair_content_changed", "Format-only repair changed substantive content; no candidate was saved. Request a separate revision.");
}
