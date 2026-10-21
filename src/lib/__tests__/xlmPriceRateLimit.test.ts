import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPriceCache,
  getXlmUsdPrice,
  getXlmUsdPriceWithMeta,
} from "../xlmPrice";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";
const EXPERT_URL =
  "https://api.stellar.expert/explorer/public/asset/XLM/stats";

function response(status: number, body?: Record<string, unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? {},
  } as unknown as Response;
}

describe("xlmPrice rate-limit metadata (issue #726)", () => {
  beforeEach(() => {
    _resetPriceCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a mocked 429 from both feeds is classified as rate-limited", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === COINGECKO_URL) return response(429);
      if (url === EXPERT_URL) return response(429);
      throw new Error("unexpected fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await getXlmUsdPriceWithMeta();

    // No price to show, and the reason is explicit: the provider is refusing us.
    expect(meta).toEqual({ price: null, rateLimited: true });
  });

  it("a fallback success that needed no 429 path stays rateLimited=false", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === COINGECKO_URL) return response(429);
      // The fallback succeeds — the price is fresh, not stale.
      return response(200, { price: 0.4 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await getXlmUsdPriceWithMeta();

    expect(meta).toEqual({ price: 0.4, rateLimited: false });
  });

  it("keeps the last known price on a 429 and flags it rate-limited", async () => {
    vi.useFakeTimers();
    // First fetch succeeds: the shared provider has a fresh price.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(COINGECKO_URL);
        return response(200, { stellar: { usd: 0.4 } });
      }),
    );
    expect(await getXlmUsdPrice()).toBe(0.4);

    // Past the cache TTL the provider fetches again and is refused (429).
    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(429)),
    );

    const meta = await getXlmUsdPriceWithMeta();
    // The last known price is still returned (not wiped to "unavailable") but
    // explicitly flagged: consumers can show "stale: rate limited".
    expect(meta).toEqual({ price: 0.4, rateLimited: true });
    expect(await getXlmUsdPrice()).toBe(0.4);
  });

  it("a 429 followed by a successful fetch reports the fresh price again", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (url: string) => {
        expect(url).toBe(COINGECKO_URL);
        return response(429);
      })
      .mockImplementationOnce(async (url: string) => {
        expect(url).toBe(EXPERT_URL);
        return response(429);
      })
      .mockImplementation(async (url: string) => {
        expect(url).toBe(COINGECKO_URL);
        return response(200, { stellar: { usd: 0.42 } });
      });
    vi.stubGlobal("fetch", fetchMock);

    expect((await getXlmUsdPriceWithMeta()).rateLimited).toBe(true);

    const meta = await getXlmUsdPriceWithMeta();
    expect(meta).toEqual({ price: 0.42, rateLimited: false });
    // A fresh success clears the rate-limit state.
    expect(await getXlmUsdPrice()).toBe(0.42);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("non-429 failures still fall back to the stale cache without claiming rate limiting", async () => {
    // Network outages (no status) → same graceful behaviour as before, but the
    // rate-limited flag stays false: the fetches did not get refused.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("network down");
      })
      .mockImplementationOnce(async () => {
        throw new Error("network down");
      });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await getXlmUsdPriceWithMeta();
    expect(meta).toEqual({ price: null, rateLimited: false });
  });
});
