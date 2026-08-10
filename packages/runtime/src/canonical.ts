export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function fnv1a64(value: string, offset: bigint): string {
  let hash = offset;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function stableFingerprint(value: unknown): string {
  const serialized = canonical(value);
  return `${fnv1a64(serialized, 0xcbf29ce484222325n)}${fnv1a64(serialized, 0x84222325cbf29ce4n)}`;
}

export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(canonical(value)).byteLength;
}
