/**
 * Stellar Federation lookup
 *
 * Resolves between Stellar federation addresses and public keys:
 *  1. Federation address → G-address: resolveFederationAddress()
 *  2. G-address → Federation name: resolveFederationName()
 *
 * Using the Stellar Federation protocol (SEP-2).
 *
 * Flow (federation address to G-address):
 *  1. Parse federation address (alice*stellar.org → domain=stellar.org, name=alice)
 *  2. Fetch <domain>/.well-known/stellar.toml  →  FEDERATION_SERVER url
 *  3. GET <federation_server>?q=<name>*<domain>&type=name
 *
 * Results are cached in sessionStorage to avoid repeated lookups in the same session.
 *
 * Returns `null` when:
 *  - No federation record exists for the address
 *  - The lookup times out (3 s per domain)
 *  - Any network/parse error occurs
 */

const SESSION_PREFIX = "sorostream-fed-";
const LOOKUP_TIMEOUT_MS = 3_000;

/** Per-request options threaded through every HTTP hop of a lookup. */
export interface LookupOptions {
  /** Abort signal — aborted together with the component that triggered the
   * lookup (issue #724). An aborted lookup performs no HTTP work and, unlike
   * a failed one, never writes a `null` result to sessionStorage. */
  signal?: AbortSignal;
}

/** Thrown when a lookup was cancelled by its `signal` (issue #724). */
export class LookupAbortedError extends Error {
  constructor() {
    super("Federation lookup was aborted before completing");
    this.name = "LookupAbortedError";
  }
}

/** True for a cancellation (our own marker or an `AbortError` from fetch). */
export function isLookupAborted(err: unknown): boolean {
  if (err instanceof LookupAbortedError) return true;
  // DOMException("AbortError") from fetch is not an `Error` instance in every
  // runtime, so match on name rather than the prototype chain.
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/** Bail out immediately when the caller's signal is already aborted. */
function throwIfAborted(options?: LookupOptions): void {
  if (options?.signal?.aborted) throw new LookupAbortedError();
}

/**
 * Domains to probe for reverse federation lookup.
 * Add more as needed — only domains with known public federation servers.
 */
const PROBE_DOMAINS = [
  "stellar.org",
  "lobstr.co",
  "stellarterm.com",
  "ultrastellar.com",
  "interstellar.exchange",
];

/** Fetch with a timeout and, optionally, the caller's abort signal. Throws
 * on timeout, cancellation or network error. */
async function fetchWithTimeout(
  url: string,
  ms: number,
  options?: LookupOptions,
): Promise<Response> {
  throwIfAborted(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // A cancellation from the component (issue #724) must abort the local
  // fetch too, not just surface in a later check.
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

/** Retrieve the FEDERATION_SERVER URL from a domain's stellar.toml. */
async function getFederationServer(
  domain: string,
  options?: LookupOptions,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://${domain}/.well-known/stellar.toml`,
      LOOKUP_TIMEOUT_MS,
      options,
    );
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/FEDERATION_SERVER\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (err) {
    // Cancellation is not a "no federation server" answer — propagate so the
    // caller can cancel the whole lookup without poisoning the cache (issue #724).
    if (isLookupAborted(err)) throw err;
    return null;
  }
}

/** Query a federation server for an account-id reverse lookup. */
async function queryFederationServer(
  serverUrl: string,
  address: string,
  options?: LookupOptions,
): Promise<string | null> {
  try {
    const url = `${serverUrl}?q=${encodeURIComponent(address)}&type=id`;
    const res = await fetchWithTimeout(url, LOOKUP_TIMEOUT_MS, options);
    if (!res.ok) return null;
    const json = await res.json();
    const name: unknown = json?.stellar_address;
    return typeof name === "string" && name.includes("*") ? name : null;
  } catch (err) {
    if (isLookupAborted(err)) throw err;
    return null;
  }
}

/** Read cached result from sessionStorage. Returns `undefined` if not cached. */
function readCache(address: string): string | null | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  const key = SESSION_PREFIX + address;
  const raw = sessionStorage.getItem(key);
  if (raw === null) return undefined; // not in cache
  return raw === "" ? null : raw;    // "" encodes a null result
}

/** Write result to sessionStorage. */
function writeCache(address: string, result: string | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_PREFIX + address, result ?? "");
  } catch {
    // Ignore quota errors.
  }
}

/**
 * Resolve a Stellar federation address (e.g. alice*stellar.org) to a G-address.
 * This is the forward lookup.
 *
 * @param federationAddress  e.g. "alice*stellar.org"
 * @returns  e.g. "GAAAAAAA...", or null if not found / unavailable
 */
export async function resolveFederationName(
  addressOrFederation: string,
  options: LookupOptions = {},
): Promise<string | null> {
  // Handle both federation address (forward) and G-address (reverse)
  if (!addressOrFederation) return null;

  // If it looks like a federation address (contains *), do forward lookup
  if (addressOrFederation.includes("*")) {
    return resolveFederationAddress(addressOrFederation, options);
  }

  // If it starts with G, do reverse lookup
  if (addressOrFederation.startsWith("G")) {
    return resolveFederationNameReverse(addressOrFederation, options);
  }

  return null;
}

/**
 * Resolve a Stellar federation address (e.g. alice*stellar.org) to a G-address.
 *
 * @param federationAddress  e.g. "alice*stellar.org"
 * @returns  e.g. "GAAAAAAA...", or null if not found / unavailable
 */
async function resolveFederationAddress(
  federationAddress: string,
  options: LookupOptions = {},
): Promise<string | null> {
  // Check session cache first
  const cached = readCache(federationAddress);
  if (cached !== undefined) return cached;

  throwIfAborted(options);

  try {
    // Extract domain from federation address
    const parts = federationAddress.split("*");
    if (parts.length !== 2 || !parts[1]) return null;

    const domain = parts[1];
    const server = await getFederationServer(domain, options);
    throwIfAborted(options);
    if (!server) {
      writeCache(federationAddress, null);
      return null;
    }

    // Query the federation server for the full federation address
    const result = await queryFederationAddressServer(server, federationAddress, options);
    throwIfAborted(options);
    writeCache(federationAddress, result);
    return result;
  } catch (err) {
    // Cancellation must not write anything to sessionStorage (issue #724).
    if (isLookupAborted(err)) throw err;
    writeCache(federationAddress, null);
    return null;
  }
}

/**
 * Resolve a Stellar public key to a federation address string (reverse lookup), or `null`.
 *
 * @param address  G… Stellar public key
 * @returns  e.g. "alice*stellar.org", or null if not found / unavailable
 */
async function resolveFederationNameReverse(
  address: string,
  options: LookupOptions = {},
): Promise<string | null> {
  if (!address || !address.startsWith("G")) return null;

  // Check session cache first.
  const cached = readCache(address);
  if (cached !== undefined) return cached;

  throwIfAborted(options);

  // Probe each domain concurrently — take the first non-null result.
  const results = await Promise.allSettled(
    PROBE_DOMAINS.map(async (domain) => {
      const server = await getFederationServer(domain, options);
      if (!server) return null;
      return queryFederationServer(server, address, options);
    }),
  );

  // A cancellation that already tripped inside a probe (fetch AbortError is
  // swallowed by allSettled into rejected) must not rewrite the cache (issue #724).
  throwIfAborted(options);

  const found =
    results
      .filter(
        (r): r is PromiseFulfilledResult<string | null> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value)[0] ?? null;

  writeCache(address, found);
  return found;
}

/** Query a federation server for a federation address lookup (forward). */
async function queryFederationAddressServer(
  serverUrl: string,
  federationAddress: string,
  options?: LookupOptions,
): Promise<string | null> {
  try {
    const url = `${serverUrl}?q=${encodeURIComponent(federationAddress)}&type=name`;
    const res = await fetchWithTimeout(url, LOOKUP_TIMEOUT_MS, options);
    if (!res.ok) return null;
    const json = await res.json();
    const address: unknown = json?.account_id;
    return typeof address === "string" && address.startsWith("G") ? address : null;
  } catch (err) {
    if (isLookupAborted(err)) throw err;
    return null;
  }
}
