/**
 * #942: getXlmUsdPriceWithMeta's rate-limit window ends exactly at
 * rateLimitedUntil (= time of the 429 + RATE_LIMIT_INFO_TTL_MS). The
 * cache-hit branch uses a strict `now < rateLimitedUntil`.
 *
 * The price is cached at the same tick as the 429, so both windows start
 * together. That pins down both sides of the boundary:
 *   - at rateLimitedUntil - 1 the call is a cache hit and is still
 *     rate-limited;
 *   - at now === rateLimitedUntil the call is no longer rate-limited, not
 *     one check late. CACHE_TTL_MS equals RATE_LIMIT_INFO_TTL_MS, so the
 *     cache has also just expired and the call refetches. A non-429 failure
 *     then reports the stale price as not rate-limited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetPriceCache, getXlmUsdPriceWithMeta } from "../xlmPrice";

const RATE_LIMIT_INFO_TTL_MS = 5 * 60 * 1_000;
const T0 = Date.UTC(2026, 0, 1);

function response(status: number, body?: Record<string, unknown>): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body ?? {} } as unknown as Response;
}

async function seedPriceThenRateLimitAt(t: number) {
  vi.setSystemTime(t);
  vi.stubGlobal("fetch", vi.fn(async () => response(200, { stellar: { usd: 0.1 } })));
  await getXlmUsdPriceWithMeta(); // cached at t

  vi.stubGlobal("fetch", vi.fn(async () => response(429)));
  // Forced refresh refused with 429 at the same tick: rateLimitedUntil = t + TTL.
  expect(await getXlmUsdPriceWithMeta({ force: true })).toEqual({ price: 0.1, rateLimited: true });
  return t + RATE_LIMIT_INFO_TTL_MS;
}

describe("getXlmUsdPriceWithMeta rate-limit boundary (#942)", () => {
  beforeEach(() => {
    _resetPriceCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is still rate-limited one millisecond before rateLimitedUntil (cache hit)", async () => {
    const rateLimitedUntil = await seedPriceThenRateLimitAt(T0);
    const fetchMock = vi.fn(async () => response(500));
    vi.stubGlobal("fetch", fetchMock);

    vi.setSystemTime(rateLimitedUntil - 1);
    expect(await getXlmUsdPriceWithMeta()).toEqual({ price: 0.1, rateLimited: true });
    expect(fetchMock).not.toHaveBeenCalled(); // served from cache
  });

  it("is no longer rate-limited exactly at now === rateLimitedUntil", async () => {
    const rateLimitedUntil = await seedPriceThenRateLimitAt(T0);
    // Feeds fail without a 429 (e.g. 503): nothing new rate-limits us.
    vi.stubGlobal("fetch", vi.fn(async () => response(503)));

    vi.setSystemTime(rateLimitedUntil);
    expect(await getXlmUsdPriceWithMeta()).toEqual({ price: 0.1, rateLimited: false });
  });

  it("reports a fresh price as not rate-limited when the feeds recover at the boundary", async () => {
    const rateLimitedUntil = await seedPriceThenRateLimitAt(T0);
    vi.stubGlobal("fetch", vi.fn(async () => response(200, { stellar: { usd: 0.25 } })));

    vi.setSystemTime(rateLimitedUntil);
    expect(await getXlmUsdPriceWithMeta()).toEqual({ price: 0.25, rateLimited: false });
  });
});
