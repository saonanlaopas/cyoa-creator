export const PLAYTEST_PRNG_VERSION = "xorshift32-fnv1a-v1" as const;

function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Xorshift32 has one absorbing state. Keep the mapping explicit and stable.
  return hash === 0 ? 0x6d2b79f5 : hash;
}

/**
 * Small non-cryptographic PRNG for cross-platform deterministic playtesting.
 * The UTF-8 FNV-1a seed mapping and xorshift32 transition are both versioned.
 */
export class DeterministicPlaytestPrng {
  private state: number;

  public constructor(public readonly seed: string) {
    if (!seed.length) throw new Error("A deterministic playtest seed is required");
    this.state = seedToUint32(seed);
  }

  public nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  public nextIndex(length: number): number {
    if (!Number.isSafeInteger(length) || length < 1) throw new Error("PRNG selection length must be positive");
    return this.nextUint32() % length;
  }
}
