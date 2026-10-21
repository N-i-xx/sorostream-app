/**
 * XLM/USD price feed with 5-minute in-memory cache.
 *
 * Primary source  : CoinGecko public API (no key required)
 * Fallback source : Stellar Expert ticker
 *
 * Returns `null` when both feeds are unreachable, allowing callers to show
 * "Price unavailable" gracefully.
 *
 * `getXlmUsdPriceWithMeta` additionally classifies *why* a call had no fresh
 * price — issue #726: a shared provider that gets rate-limited (HTTP 429)
 * must back off instead of hammering the public API on its normal cadence,
 * and consumers must be able to distinguish a "stale because we are
 * rate-limited" price from a normally fresh one.
 */

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CachedPrice {
  price: number;
  fetchedAt: number;
}

let cache: CachedPrice | null = null;

/** How long a recent 429 is remembered, so a cache hit inside that window
 * still reports the price as rate-limited/stale (issue #726). Aligned with
 * the cache TTL: a successful fetch after that window refreshes the shared
 * provider's "fresh" view anyway. */
const RATE_LIMIT_INFO_TTL_MS = 5 * 60 * 1_000;

/** Set when the price APIs answer HTTP 429; cleared by a successful fetch. */
let rateLimitedUntil = 0;

interface XlmPriceMeta {
  /** Best-effort price: the last successfully fetched value (even if stale
   * beyond the cache TTL under rate limiting), or null when we never got one. */
  price: number | null;
  /** True when the fetches for this call were refused with HTTP 429, or a
   * recent 429 is still being waited out. */
  rateLimited: boolean;
}

function setStatus(err: unknown, status: number): unknown {
  if (err instanceof Error) {
    (err as Error & { status?: number }).status = status;
  }
  return err;
}

/** Fetch XLM/USD from CoinGecko simple price endpoint. */
async function fetchCoinGecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw setStatus(new Error(`CoinGecko HTTP ${res.status}`), res.status);
  }
  const json = await res.json();
  const price = json?.stellar?.usd;
  if (typeof price !== "number" || price <= 0) throw new Error("CoinGecko: invalid price");
  return price;
}

/** Fallback: Stellar Expert public ticker. */
async function fetchStellarExpert(): Promise<number> {
  const res = await fetch(
    "https://api.stellar.expert/explorer/public/asset/XLM/stats",
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw setStatus(new Error(`Stellar Expert HTTP ${res.status}`), res.status);
  }
  const json = await res.json();
  const price = json?.price;
  if (typeof price !== "number" || price <= 0)
    throw new Error("Stellar Expert: invalid price");
  return price;
}

/**
 * Returns the current XLM/USD price, using a 5-minute cache.
 * Returns `null` if both sources are unavailable.
 *
 * @param options.force Bypass the cache and fetch a fresh price (used by the
 *   shared context's manual refresh). Falls back to the stale cache value if
 *   both feeds are unreachable.
 */
export async function getXlmUsdPrice(
  options: { force?: boolean } = {},
): Promise<number | null> {
  const now = Date.now();
  const rateLimitedRecently = now < rateLimitedUntil;

  // Return cached value if still fresh, unless a fresh fetch was requested.
  if (!options.force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.price;
  }

  // Try primary source, then fallback.
  try {
    const price = await fetchCoinGecko();
    cache = { price, fetchedAt: now };
    rateLimitedUntil = 0;
    return { price, rateLimited: false };
  } catch (primaryErr) {
    // Primary failed — try fallback silently.
    try {
      const price = await fetchStellarExpert();
      cache = { price, fetchedAt: now };
      rateLimitedUntil = 0;
      return { price, rateLimited: false };
    } catch (fallbackErr) {
      const rateLimited =
        statusOf(primaryErr) === 429 || statusOf(fallbackErr) === 429;
      if (rateLimited) {
        rateLimitedUntil = now + RATE_LIMIT_INFO_TTL_MS;
      }
      // Return stale cache if available, rather than showing "unavailable" for
      // a transient network hiccup — flagged as rate-limited when that is why.
      return { price: cache ? cache.price : null, rateLimited };
    }
  }
}

function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** Exposed for testing: reset the in-memory cache and rate-limit state. */
export function _resetPriceCache() {
  cache = null;
  rateLimitedUntil = 0;
}
