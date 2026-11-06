let counter = 0;

/**
 * Deterministic-ish ids without a dependency. crypto.randomUUID is available in
 * browsers and Node 19+, but tests may stub it, so keep a fallback.
 */
export function createIdFactory(): (prefix: string) => string {
  return (prefix: string) => {
    const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
      return `${prefix}_${cryptoRef.randomUUID()}`;
    }
    counter += 1;
    return `${prefix}_${Date.now().toString(36)}_${counter}`;
  };
}
