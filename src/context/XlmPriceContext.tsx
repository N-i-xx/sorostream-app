"use client";
/**
 * XlmPriceContext — shared XLM/USD price cache for the whole app (issue #582).
 *
 * Problem: each FiatDisplay instance previously called useXlmPrice() independently,
 * which caused N simultaneous price API requests when N FiatDisplay components were
 * mounted at once (e.g. 20 stream cards on the dashboard = 20 CoinGecko calls).
 *
 * Solution: a single provider fetches the price once per minute and all consumers
 * read from the shared context value. Zero duplicate network calls.
 *
 * Issue #726: that single shared fetch itself can be rate-limited (HTTP 429).
 * The provider then backs off — the next attempt waits on a growing backoff
 * instead of the normal one-minute cadence — and exposes `rateLimited`/`stale`
 * so consumers can distinguish a "price could not be refreshed because the
 * price API is refusing us" display from a normally fresh one, while keeping
 * the last known price on screen.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getXlmUsdPriceWithMeta } from "@/src/lib/xlmPrice";

/** How often the shared price is refreshed when the API is healthy (1 minute). */
const SHARED_REFRESH_INTERVAL_MS = 60 * 1_000;

/** Backoff after a rate-limited shared fetch (issue #726): 5 minutes after the
 * first 429, doubling on consecutive ones, capped at 30 minutes. Bounded so a
 * permanently rate-limited deployment still resumes fetching eventually. */
const RATE_LIMIT_BACKOFF_BASE_MS = 5 * 60 * 1_000;
const RATE_LIMIT_BACKOFF_MAX_MULTIPLE = 6;

interface XlmPriceContextValue {
  /** Latest XLM/USD price, or null when unavailable. */
  price: number | null;
  /** True only during the very first fetch (no price yet). */
  loading: boolean;
  /** True while the price APIs are refusing us (HTTP 429) or the last fetch
   * was 429'd (issue #726). */
  rateLimited: boolean;
  /** True when `price` may be stale because the shared fetch was rate-limited
   * and could not refresh — distinct from a normally fresh price (issue #726). */
  stale: boolean;
  /** When `price` was last confirmed fresh (ms epoch), or null when no price
   * has ever been fetched successfully. */
  lastUpdatedAt: number | null;
}

const XlmPriceContext = createContext<XlmPriceContextValue | undefined>(undefined);

export function XlmPriceProvider({ children }: { children: ReactNode }) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // Track whether the component is still mounted to avoid state updates after unmount.
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive rate-limit events (1, 2, 4, ... × backoff base) — reset on success.
  const backoffMultipleRef = useRef(1);

  useEffect(() => {
    cancelledRef.current = false;

    function scheduleNext(delayMs: number): void {
      timerRef.current = setTimeout(() => {
        void attempt();
      }, delayMs);
    }

    async function attempt(): Promise<void> {
      const meta = await getXlmUsdPriceWithMeta();
      if (cancelledRef.current) return;

      if (meta.rateLimited) {
        // Backoff before the next attempt instead of retrying at the normal
        // one-minute cadence immediately (issue #726). The last known price
        // stays displayed and is flagged stale by the derived `stale` flag.
        const delay = RATE_LIMIT_BACKOFF_BASE_MS * backoffMultipleRef.current;
        backoffMultipleRef.current = Math.min(
          backoffMultipleRef.current * 2,
          RATE_LIMIT_BACKOFF_MAX_MULTIPLE,
        );
        setRateLimited(true);
        setLoading(false);
        scheduleNext(delay);
        return;
      }

      backoffMultipleRef.current = 1;
      setRateLimited(false);
      if (meta.price !== null) {
        setPrice(meta.price);
        setLastUpdatedAt(Date.now());
      }
      setLoading(false);
      scheduleNext(SHARED_REFRESH_INTERVAL_MS);
    }

    void attempt();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <XlmPriceContext.Provider
      value={{
        price,
        loading,
        rateLimited,
        // A rate-limited fetch cannot refresh the price: whatever is displayed
        // now is stale until a later attempt succeeds (issue #726).
        stale: rateLimited && price !== null,
        lastUpdatedAt,
      }}
    >
      {children}
    </XlmPriceContext.Provider>
  );
}

/**
 * Read the shared XLM/USD price.
 * Must be called inside a component tree wrapped by XlmPriceProvider.
 */
export function useSharedXlmPrice(): XlmPriceContextValue {
  const ctx = useContext(XlmPriceContext);
  if (ctx === undefined) {
    throw new Error("useSharedXlmPrice must be used within XlmPriceProvider");
  }
  return ctx;
}
