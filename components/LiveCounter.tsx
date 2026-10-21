"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import FiatDisplay from "@/components/FiatDisplay";
import { sorostream } from "@/src/lib/sorostream";
import { useRpcFetch } from "@/src/lib/useRpcFetch";
import { useSettings } from "@/src/context/SettingsContext";
import { useTranslations } from "@/src/lib/i18n";
import { useWallet } from "@/src/context/WalletContext";

interface LiveCounterProps {
  flowRate: number;
  lastWithdrawTime: Date;
  streamId?: string;
  reconcileIntervalMs?: number;
  /**
   * Stream status. When "Paused", the counter freezes at the value it held
   * when the stream was paused instead of continuing to interpolate upward.
   */
  status?: string;
  /** ISO timestamp captured when the stream was paused (used to freeze the value). */
  pausedAt?: string;
  /**
   * When provided, the counter shows this value instead of the live-ticking
   * estimate and renders a visual "pending" indicator to distinguish optimistic
   * state from confirmed on-chain state.
   *
   * Pass `null` to clear the override and resume live ticking.
   */
  optimisticOverride?: number | null;
}

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const ANNOUNCE_THROTTLE_MS = 30_000;
/** Visible display refresh cadence (about two ledgers) instead of every tick. */
const DISPLAY_UPDATE_INTERVAL_MS = 10_000;

/** Pause-aware estimate: freezes at the pause moment when the stream is paused. */
function estimateClaimable(
  flowRate: number,
  lastWithdrawTime: Date,
  status?: string,
  pausedAt?: string,
) {
  const lastWithdrawMs = new Date(lastWithdrawTime).getTime();
  let elapsed = Math.max(0, (Date.now() - lastWithdrawMs) / 1000);
  if (status === "Paused" && pausedAt) {
    const pausedAtMs = new Date(pausedAt).getTime();
    elapsed = Math.max(0, (pausedAtMs - lastWithdrawMs) / 1000);
  }
  return Math.max(0, flowRate * elapsed);
}

/** Stable format for aria-label so screen readers get a consistent value */
function formatUSDCFixed(val: number) {
  return (val / 10_000_000).toFixed(7);
}

function parseClaimable(value: string | number | bigint): number | null {
  const amount = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}


export default function LiveCounter({
  flowRate,
  lastWithdrawTime,
  streamId,
  reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  status,
  pausedAt,
  optimisticOverride,
}: LiveCounterProps) {
  const t = useTranslations("common");
  let language = "en";
  try {
    const settings = useSettings();
    if (settings) language = settings.language;
  } catch {
    // fallback to "en" when context is not available (e.g. in tests)
  }
  const rpcFetch = useRpcFetch();
  const { address: walletAddress } = useWallet();
  const rootRef = useRef<HTMLSpanElement>(null);
  // Off-screen instances skip updates entirely; default true so environments
  // without IntersectionObserver keep working.
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setIsVisible(last.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [baseline, setBaseline] = useState(() => ({
    amount: estimateClaimable(flowRate, lastWithdrawTime, status, pausedAt),
    timestamp: Date.now(),
  }));
  const [claimable, setClaimable] = useState(() =>
    estimateClaimable(flowRate, lastWithdrawTime, status, pausedAt)
  );

  const isOptimistic = optimisticOverride != null;
  const displayValue = isOptimistic ? optimisticOverride : claimable;

  // Throttled aria-label: only update at most once per 30 seconds to avoid
  // spammy screen-reader narration while the counter ticks every second.
  // Initialize to -(throttle interval) so the first update is always immediate.
  const lastAnnounceTimeRef = useRef(-ANNOUNCE_THROTTLE_MS);
  const [ariaLabel, setAriaLabel] = useState(() =>
    formatUSDCFixed(estimateClaimable(flowRate, lastWithdrawTime))
  );
  // Reset baseline when props change (e.g. after a withdrawal).
  useEffect(() => {
    const next = {
      amount: estimateClaimable(flowRate, lastWithdrawTime),
      timestamp: Date.now(),
    };
    setBaseline(next);
    setClaimable(next.amount);
  }, [flowRate, lastWithdrawTime]);

  // A wallet change invalidates this instance's displayed reconciliation cache.
  // Re-seed from the current stream props immediately while the fresh chain read runs.
  useEffect(() => {
    const next = {
      amount: estimateClaimable(flowRate, lastWithdrawTime, status, pausedAt),
      timestamp: Date.now(),
    };
    setBaseline(next);
    setClaimable(next.amount);
  }, [walletAddress, flowRate, lastWithdrawTime, status, pausedAt]);

  // Periodically reconcile against the chain value, with rate-limit handling.
  // Skipped while off-screen; reconciles immediately when it scrolls back in.
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;

    async function reconcileClaimable() {
      if (!streamId) return;

      try {
        const onChainClaimable = parseClaimable(
          await sorostream.getClaimable(streamId)
        );
        if (cancelled || onChainClaimable === null) return;

        const next = { amount: onChainClaimable, timestamp: Date.now() };
        setBaseline(next);
        setClaimable(next.amount);
      } catch {
        // Keep local interpolation running if the chain read fails permanently.
      }
    }

    void reconcileClaimable();
    const interval = setInterval(reconcileClaimable, reconcileIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [streamId, reconcileIntervalMs, rpcFetch, isVisible, walletAddress]);

  // Interpolate locally, committing at most one update per
  // DISPLAY_UPDATE_INTERVAL_MS. The value is computed from the baseline and
  // wall-clock time, so it stays accurate regardless of the cadence.
  useEffect(() => {
    // Off-screen: no timers at all. Catch up once when visible again.
    if (!isVisible) return;
    // Stop ticking while an optimistic override is active — the override value
    // is the source of truth until the transaction resolves. Also stop while
    // the stream is paused so the balance freezes at the paused value.
    if (optimisticOverride != null) return;
    if (status === "Paused") return;

    const update = () => {
      const elapsed = (Date.now() - baseline.timestamp) / 1000;
      setClaimable(Math.max(0, baseline.amount + flowRate * elapsed));
    };
    const interval = setInterval(update, DISPLAY_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [baseline, flowRate, optimisticOverride, status, isVisible]);

  // Catch up immediately when the counter scrolls back into view.
  const wasVisibleRef = useRef(true);
  useEffect(() => {
    if (isVisible && !wasVisibleRef.current && optimisticOverride == null && status !== "Paused") {
      const elapsed = (Date.now() - baseline.timestamp) / 1000;
      setClaimable(Math.max(0, baseline.amount + flowRate * elapsed));
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, baseline, flowRate, optimisticOverride, status]);

  // Locale-aware display: groups thousands, always shows 7 decimal places
  const formatUSDC = (val: number) =>
    (val / 10_000_000).toLocaleString(language, {
      minimumFractionDigits: 7,
      maximumFractionDigits: 7,
    });

  // Stable format for aria-label so screen readers get a consistent value
  const safeFormatUSDCFixed = useCallback(
    (val: number) => (val / 10_000_000).toFixed(7),
    []
  );

  useEffect(() => {
    const isTest =
      typeof process !== "undefined" && process.env.NODE_ENV === "test";
    if (isTest) {
      setAriaLabel(safeFormatUSDCFixed(displayValue));
      return;
    }

    const now = Date.now();
    const timeSinceLast = now - lastAnnounceTimeRef.current;
    if (timeSinceLast >= ANNOUNCE_THROTTLE_MS) {
      lastAnnounceTimeRef.current = now;
      setAriaLabel(safeFormatUSDCFixed(displayValue));
      return;
    }
    const remaining = ANNOUNCE_THROTTLE_MS - timeSinceLast;
    const timer = setTimeout(() => {
      lastAnnounceTimeRef.current = Date.now();
      setAriaLabel(safeFormatUSDCFixed(displayValue));
    }, remaining);
    return () => clearTimeout(timer);
  }, [displayValue, safeFormatUSDCFixed]);

  return (
    <span
      ref={rootRef}
      className="font-mono font-semibold tabular-nums inline-flex items-baseline gap-1.5"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={
        t("claimable", { val: ariaLabel }) +
        (isOptimistic ? t("pending_confirmation") : "")
      }
    >
      <span className={isOptimistic ? "text-yellow-400" : "text-green-600"}>
        {formatUSDC(displayValue)} USDC
      </span>
      {isOptimistic && (
        <span
          className="text-xs font-normal text-yellow-400/80 italic"
          aria-hidden="true"
        >
          ({t("pending")})
        </span>
      )}
      {!isOptimistic && <FiatDisplay usdcAmount={displayValue / 10000000} />}
    </span>
  );
}
