"use client";

import { memo, type ReactNode } from "react";

import CopyButton from "@/components/CopyButton";
import FiatDisplay from "@/components/FiatDisplay";
import { truncateAddress, formatStellarAmount, estimateStreamCompletionTime, formatTimeUntil } from "@/src/lib/sorostream";
import FederationName from "@/components/FederationName";
import { useBookmarks } from "@/src/context/BookmarksContext";
import StreamHealthBadge, {
  calculateHealthScore,
  getHealthTier,
} from "@/components/StreamHealthBadge";
import { getMockStreamHistory } from "@/src/lib/sorostream";
import { formatDateWithTimezone } from "@/src/lib/timezone";
import { formatTimeRemaining, formatEndedAgo } from "@/src/lib/timeRemaining";
import StreamTagChips from "@/components/StreamTagChips";
import { formatDateUtc } from "@/src/lib/timezone";
import StatusBadge from "@/components/StatusBadge";

/** Streamed-out amount (stroops), frozen while the stream is paused. */
function streamedSeconds(
  flowRate: number,
  startTime?: string,
  status?: string,
  pausedAt?: string,
): number {
  if (!startTime) return 0;
  const startMs = new Date(startTime).getTime();
  let elapsed = Math.max(0, (Date.now() - startMs) / 1000);
  if (status === "Paused" && pausedAt) {
    const pausedAtMs = new Date(pausedAt).getTime();
    elapsed = Math.max(0, (pausedAtMs - startMs) / 1000);
  }
  return Math.max(0, flowRate * elapsed);
}

interface StreamCardProps {
  id?: string;
  sender?: string;
  recipient?: string;
  flowRate?: number;
  status?: string;
  deposit?: number;
  /**
   * Amount already withdrawn in stroops. Used by the custom memo comparator so
   * cards only re-render when the recipient has claimed more funds.
   */
  withdrawnStroops?: number;
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** When true, render an in-place skeleton placeholder instead of the card. */
  loading?: boolean;
  /** Invoked when the user clicks the clone action. */
  onClone?: (id: string) => void;
  /** Unix timestamp (seconds). When set and > now, a "Scheduled" badge is shown. */
  scheduledStartTime?: number;
  /** Stream start time ISO string. */
  startTime?: string;
  /** Stream end time ISO string. */
  endTime?: string;
  /** ISO timestamp captured when the stream was paused (freezes remaining balance). */
  pausedAt?: string;
  /** Token type (XLM, USDC, etc.) for proper USD conversion display. */
  token?: string;
  /** True when an on-chain transaction is in-flight for this stream. */
  optimisticPending?: boolean;
  /** Optimistic status override while transaction is pending. */
  optimisticStatus?: string;
  /** Optimistic deposit override while transaction is pending. */
  optimisticDeposit?: number;
  /** Optimistic claimable override while transaction is pending. */
  optimisticClaimable?: number;
  /** Active dashboard search text. Matching cards are highlighted and the matched text is marked. */
  highlightQuery?: string;
}

/** Renders `text` with every case-insensitive occurrence of `query` wrapped in <mark>. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} className="bg-yellow-300 dark:bg-yellow-500/40 text-gray-900 dark:text-yellow-100 rounded-sm">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/**
 * Custom memo comparator — only re-render when data that is visible on the
 * card has actually changed. Polling ticks that leave `id`, `status`, and
 * `withdrawnStroops` unchanged will skip the render entirely.
 */
/** Exported for the #580 render-count guard unit tests. */
export function arePropsEqual(
  prev: StreamCardProps,
  next: StreamCardProps,
): boolean {
  return (
    prev.id === next.id &&
    prev.status === next.status &&
    prev.withdrawnStroops === next.withdrawnStroops &&
    // Propagate optimistic overlay changes immediately
    prev.optimisticPending === next.optimisticPending &&
    prev.optimisticStatus === next.optimisticStatus &&
    prev.optimisticDeposit === next.optimisticDeposit &&
    prev.selected === next.selected &&
    prev.loading === next.loading
  );
}

function StreamCardInner({
  id = "",
  sender = "",
  recipient = "",
  flowRate = 0,
  status = "Active",
  deposit = 0,
  withdrawnStroops = 0,
  selected = false,
  onToggle,
  loading = false,
  onClone,
  scheduledStartTime,
  startTime,
  endTime,
  pausedAt,
  token = "XLM",
  optimisticPending = false,
  optimisticStatus,
  optimisticDeposit,
  optimisticClaimable,
  highlightQuery,
}: StreamCardProps) {
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const bookmarked = isBookmarked(id);

  if (loading) {
    return (
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-3 border border-gray-200 dark:border-gray-700"
        role="status"
        aria-label={id ? `Loading stream ${id}` : "Loading stream"}
        aria-busy="true"
      >
        {/* Header: Stream ID and status badges */}
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-2">
            <div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </span>
          <div className="flex items-center gap-2">
            <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>

        {/* From/To information */}
        <div className="text-sm space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-44 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-36 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-52 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>

        {/* Tags section */}
        <div className="flex gap-2">
          <div className="h-6 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-6 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }


  const isScheduled =
    typeof scheduledStartTime === "number" &&
    scheduledStartTime > Math.floor(Date.now() / 1000);

  // ── Health score calculation ──────────────────────────────────────────
  const healthScore = (() => {
    if (!startTime || !endTime || status === "Cancelled") return null;
    const now = Date.now();
    const totalDuration = new Date(endTime).getTime() - new Date(startTime).getTime();
    const elapsed = now - new Date(startTime).getTime();
    const timeRemainingRatio = totalDuration > 0
      ? Math.max(0, Math.min(1, 1 - elapsed / totalDuration))
      : 0;
    // Estimate deposit remaining based on flow rate (simplified)
    const estimatedStreamed = streamedSeconds(flowRate, startTime, status, pausedAt);
    const depositRemainingRatio = deposit > 0
      ? Math.max(0, Math.min(1, 1 - estimatedStreamed / deposit))
      : 0;
    // Approximate top-up count from mock history
    const history = getMockStreamHistory(id);
    const topUpCount = history.filter((e) => e.type === "top-up").length;
    return calculateHealthScore({
      depositRemainingRatio,
      timeRemainingRatio,
      topUpCount,
    });
  })();
  const healthTier = healthScore !== null ? getHealthTier(healthScore) : null;

  const effectiveStatus = optimisticStatus ?? status;
  const effectiveDeposit = optimisticDeposit ?? deposit;

  /** Convert stroops → XLM/USDC (display value). */
  const toXlm = (val: number) => (val / 10_000_000).toFixed(2);
  const flowXlm = flowRate / 10_000_000;
  const depositXlm = effectiveDeposit / 10_000_000;

  /** Determine if we should display USD equivalents and which type */
  const isUsdcToken = token === "USDC";

  // ── Estimated completion time (#415) ──────────────────────────────────
  // For active streams with a fixed total amount, estimate when the
  // deposit will be fully dripped: startTime + deposit / flowRate.
  const estimatedCompletion = (() => {
    if (status !== "Active" || !startTime || isScheduled) return null;
    return estimateStreamCompletionTime({ startTime, flowRate, deposit });
  })();

  // ── Search highlight (#554) ───────────────────────────────────────────
  const query = highlightQuery?.trim() ?? "";
  const matchedField: { label: string; value: string } | null = (() => {
    if (!query) return null;
    const q = query.toLowerCase();
    if (recipient.toLowerCase().includes(q)) return { label: "Recipient", value: recipient };
    if (sender.toLowerCase().includes(q)) return { label: "Sender", value: sender };
    if (id.toLowerCase().includes(q)) return { label: "Stream ID", value: id };
    return null;
  })();

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg p-4 space-y-3 border ${
        selected
          ? "border-green-500"
          : matchedField
            ? "border-yellow-400 dark:border-yellow-500 ring-1 ring-yellow-400/60 dark:ring-yellow-500/50"
            : "border-gray-200 dark:border-gray-700"
      }`}
      role="article"
      aria-label={`Stream ${id}`}
      aria-current={selected ? "true" : undefined}
      data-search-match={matchedField ? "true" : undefined}
    >
      <div className="flex justify-between items-center min-w-0 gap-2">
        <span className="flex items-center gap-2 min-w-0 shrink-0">
          {onToggle && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(id)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 accent-green-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              aria-label={`Select stream ${id}`}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <span className="text-gray-500 dark:text-gray-400 text-xs truncate">Stream #{id}</span>
          <CopyButton value={id} label="Copy stream ID" />
          <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <CopyButton
              value={typeof window !== "undefined" ? `${window.location.origin}/stream/${id}/public` : `/stream/${id}/public`}
              label="Copy stream link"
              showTooltip
            />
          </span>
        </span>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {onClone && (
            <button
              onClick={(e) => { e.stopPropagation(); onClone(id); }}
              aria-label="Clone stream"
              title="Clone stream"
              className="text-gray-400 dark:text-gray-600 hover:text-green-500 dark:hover:text-green-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); toggleBookmark(id); }}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark stream"}
            aria-pressed={bookmarked}
            className={`text-base leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded ${
              bookmarked ? "text-yellow-500 dark:text-yellow-400" : "text-gray-400 dark:text-gray-600 hover:text-yellow-500 dark:hover:text-yellow-400"
            }`}
          >
            {bookmarked ? "★" : "☆"}
          </button>
          {isScheduled && (
            <span
              className="text-xs px-2 py-1 rounded-full bg-blue-900 text-blue-100 border border-blue-700 flex items-center gap-1"
              aria-label="Scheduled stream"
              title={`Starts ${new Date((scheduledStartTime ?? 0) * 1000).toLocaleString()} (${formatDateUtc(new Date((scheduledStartTime ?? 0) * 1000))})`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" aria-hidden="true" />
              Scheduled
            </span>
          )}
          {optimisticPending && (
            <span
              data-testid="optimistic-confirming"
              className="text-xs px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-700 flex items-center gap-1 font-medium"
              aria-label="Transaction confirming"
              title="Transaction submitted and confirming on-chain"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
              Confirming…
            </span>
          )}
          <StatusBadge status={effectiveStatus} compact />
          {healthScore !== null && healthTier !== null && (() => {
            const now = Date.now();
            const totalDuration = endTime && startTime ? new Date(endTime).getTime() - new Date(startTime).getTime() : 0;
            const elapsed = startTime ? now - new Date(startTime).getTime() : 0;
            const timeRemainingRatio = totalDuration > 0 ? Math.max(0, Math.min(1, 1 - elapsed / totalDuration)) : 0;
            const estimatedStreamed = streamedSeconds(flowRate, startTime, status, pausedAt);
            const depositRemainingRatio = deposit > 0 ? Math.max(0, Math.min(1, 1 - estimatedStreamed / deposit)) : 0;
            const history = getMockStreamHistory(id);
            const topUpCount = history.filter((e) => e.type === "top-up").length;
            return (
              <StreamHealthBadge
                score={healthScore}
                tier={healthTier}
                depositRemainingRatio={depositRemainingRatio}
                timeRemainingRatio={timeRemainingRatio}
                topUpCount={topUpCount}
                compact
              />
            );
          })()}
        </div>
      </div>

      <div className="text-sm">
        <p className="text-gray-600 dark:text-gray-400 flex items-center gap-1 min-w-0">
          From:{" "}
          <span className="text-gray-900 dark:text-white truncate">
            <FederationName address={sender} truncate />
          </span>
          <CopyButton value={sender} label="Copy sender address" />
        </p>
        <p className="text-gray-600 dark:text-gray-400 flex items-center gap-1 min-w-0">
          To:{" "}
          <span className="text-gray-900 dark:text-white truncate">
            <FederationName address={recipient} truncate />
          </span>
          <CopyButton value={recipient} label="Copy recipient address" />
        </p>

        {matchedField && (
          <p
            className="text-xs text-gray-600 dark:text-gray-400 font-mono break-all"
            data-testid="search-match"
          >
            <span className="font-sans">{matchedField.label} match: </span>
            <HighlightedText text={matchedField.value} query={query} />
          </p>
        )}

        <p className="text-gray-600 dark:text-gray-400">
          Flow:{" "}
          <span className="text-green-600 dark:text-green-400">
            {toXlm(flowRate)} {token}/sec
            <FiatDisplay
              {...(isUsdcToken ? { usdcAmount: flowXlm } : { xlmAmount: flowXlm })}
            />
          </span>
        </p>

        <p className="text-gray-600 dark:text-gray-400">
          Total:{" "}
          <span className="text-gray-900 dark:text-white">
            {toXlm(deposit)} {token}
            <FiatDisplay
              {...(isUsdcToken ? { usdcAmount: depositXlm } : { xlmAmount: depositXlm })}
            />
          </span>
        </p>

        {/* Time remaining until stream end (#461, #558) */}
        {effectiveStatus === "Active" && endTime && (() => {
          const remaining = formatTimeRemaining(endTime);
          return (
            <p className="text-gray-600 dark:text-gray-400" data-testid="time-remaining">
              <span
                className="text-blue-600 dark:text-blue-400 font-medium"
                title={`Scheduled end time: ${formatDateWithTimezone(new Date(endTime))}`}
              >
                {remaining ?? formatEndedAgo(endTime)}
              </span>
            </p>
          );
        })()}

        {effectiveStatus === "Ended" && endTime && (
          <p className="text-gray-600 dark:text-gray-400" data-testid="time-ended">
            <span title={`Ended at ${formatDateWithTimezone(new Date(endTime))}`}>
              {formatEndedAgo(endTime)}
            </span>
          </p>
        )}

        {estimatedCompletion && (
          <p className="text-gray-600 dark:text-gray-400">
            Est. completion:{" "}
            <span
              className="text-gray-900 dark:text-white"
              title={`Estimated time when this stream will be fully dripped (${formatTimeUntil(estimatedCompletion)})`}
            >
              {formatDateWithTimezone(estimatedCompletion)}
              <span className="text-green-600 dark:text-green-400 ml-1">
                ({formatTimeUntil(estimatedCompletion)})
              </span>
            </span>
          </p>
        )}
      </div>

      {/* Tag chips */}
      <StreamTagChips streamId={id} />
    </div>
  );
}

/**
 * StreamCard — memoised with a custom comparator so dashboard lists do not
 * re-render cards whose stream data has not changed (e.g. on a polling tick).
 *
 * @see arePropsEqual for the fields used in the comparison.
 */
const StreamCard = memo(StreamCardInner, arePropsEqual);
export default StreamCard;
