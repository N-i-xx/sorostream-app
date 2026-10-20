/**
 * XLM/USD price feed with 5-minute in-memory cache.
 *
 * Primary source  : CoinGecko public API (no key required)
 * Fallback source : Stellar Expert ticker
 *
 * Returns `null` when both feeds are unreachable, allowing callers to show
 * "Price unavailable" gracefully.
 */

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CachedPrice {
  price: number;
  fetchedAt: number;
}

let cache: CachedPrice | null = null;

/** Fetch XLM/USD from CoinGecko simple price endpoint. */
async function fetchCoinGecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
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
  if (!res.ok) throw new Error(`Stellar Expert HTTP ${res.status}`);
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

  // Return cached value if still fresh, unless a fresh fetch was requested.
  if (!options.force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.price;
  }

  // Try primary source, then fallback.
  try {
    const price = await fetchCoinGecko();
    cache = { price, fetchedAt: now };
    return price;
  } catch {
    // Primary failed — try fallback silently.
  }

  try {
    const price = await fetchStellarExpert();
    cache = { price, fetchedAt: now };
    return price;
  } catch {
    // Both sources unreachable.
  }

  // Return stale cache if available, rather than showing "unavailable" for a
  // transient network hiccup.
  if (cache) {
    return cache.price;
  }

  return null;
}

/** Exposed for testing: reset the in-memory cache. */
export function _resetPriceCache() {
  cache = null;
}
