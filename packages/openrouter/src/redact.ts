const keyPattern = /\b(?:sk-or-v1-|sk-)[A-Za-z0-9_\-.]{8,}\b/g;
const bearerPattern = /(Bearer\s+)[^\s,}"']+/gi;
const envPattern = /(OPENROUTER_API_KEY\s*[=:]\s*)[^\s,}"']+/gi;

export function redactSecret(value: string): string {
  return value
    .replace(bearerPattern, "$1[REDACTED]")
    .replace(envPattern, "$1[REDACTED]")
    .replace(keyPattern, "[REDACTED]");
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecret(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /(?:api.?key|authorization|token|secret)/i.test(key) ? "[REDACTED]" : redactValue(item),
  ]));
}
