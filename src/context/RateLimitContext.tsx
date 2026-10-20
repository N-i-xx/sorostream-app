"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onRateLimit, type RateLimitInfo } from "@/src/lib/rpcClient";

/**
 * Rate-limit state shared with every consumer of the context (banner, debug
 * panels, request loggers, …).
 */
export interface RateLimitContextValue {
  /** True when an RPC 429 backoff is currently counting down. */
  active: boolean;
  /** Seconds remaining in the current backoff. */
  secondsLeft: number;
  /**
   * Zero-based index of the retry attempt currently in progress. It increments
   * on every consecutive retry within one `rpcFetch` call (0 for the first
   * retry, 1 for the second, …) and is 0 while no rate limit is active.
   */
  attempt: number;
}

const RateLimitContext = createContext<RateLimitContextValue | undefined>(undefined);

const INITIAL: RateLimitContextValue = { active: false, secondsLeft: 0, attempt: 0 };

/**
 * Normalize an incoming rate-limit event into context state.
 *
 * When the countdown reaches zero we collapse `active` and `secondsLeft` in a
 * single update so consumers never observe `secondsLeft === 0` while `active`
 * is still true (which would flash a "0s" banner for one render).
 */
function toState(info: RateLimitInfo): RateLimitContextValue {
  const active = info.active && info.secondsLeft > 0;
  return {
    active,
    secondsLeft: active ? info.secondsLeft : 0,
    attempt: info.attempt,
  };
}

export function RateLimitProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RateLimitContextValue>(INITIAL);

  useEffect(() => {
    // Only subscribe in the browser; the emitter is a no-op on the server.
    if (typeof window === "undefined") return;
    return onRateLimit((info: RateLimitInfo) => {
      // Auto-dismiss once the retry window has elapsed. `toState` flips
      // `active` to false and zeroes `secondsLeft` atomically.
      setState(toState(info));
    });
  }, []);

  const value = useMemo(() => state, [state]);

  return (
    <RateLimitContext.Provider value={value}>{children}</RateLimitContext.Provider>
  );
}

/**
 * Access the global RPC rate-limit state.
 *
 * @returns {RateLimitContextValue} Backoff state: whether it is active, seconds left and the retry attempt.
 * @throws {Error} When called outside a `RateLimitProvider`.
 */
export function useRateLimit(): RateLimitContextValue {
  const ctx = useContext(RateLimitContext);
  if (!ctx) throw new Error("useRateLimit must be used within RateLimitProvider");
  return ctx;
}
