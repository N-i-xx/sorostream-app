"use client";
/**
 * /activity — unified chronological activity timeline (#205).
 *
 * Aggregates stream events (subscription/creation, payment/withdrawal &
 * top-up, closure/cancellation, and alerts) into a single feed with
 * type/asset/date filters, cursor-based "load more" pagination, and
 * real-time prepending of new events as they arrive.
 */
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { primePickerToNow } from "@/src/lib/datePickerDefault";
import {
  getActivityEvents,
  getActivityEventsAll,
  getActivityAssets,
  simulateNewEvent,
  buildStreamAuditLog,
  formatUSDC,
  truncateAddress,
  type StreamEvent,
  type ActivityQuery,
} from "@/src/lib/sorostream";
import {
  parseActivitySort,
  sortActivityEvents,
  toggleActivitySort,
  type ActivitySortField,
} from "@/src/lib/activitySort";
import { downloadActivityCsv } from "@/src/lib/export";

const PAGE_SIZE = 10;
/** How often we check for newly-arrived events to prepend (ms). */
const POLL_INTERVAL = 15000;

const TYPE_FILTERS: { value: StreamEvent["type"]; label: string }[] = [
  { value: "creation", label: "Subscription" },
  { value: "withdrawal", label: "Payment" },
  { value: "top-up", label: "Top-up" },
  { value: "alert", label: "Alert" },
  { value: "cancellation", label: "Closure" },
];

const typeConfig: Record<StreamEvent["type"], { label: string; icon: string; colorClass: string }> = {
  creation: { label: "Subscription opened", icon: "◉", colorClass: "text-gray-300 bg-gray-800" },
  withdrawal: { label: "Payment received", icon: "↓", colorClass: "text-green-400 bg-green-900/30" },
  "top-up": { label: "Top-up", icon: "↑", colorClass: "text-blue-400 bg-blue-900/30" },
  cancellation: { label: "Stream closed", icon: "✕", colorClass: "text-red-400 bg-red-900/30" },
  alert: { label: "Alert", icon: "⚠", colorClass: "text-yellow-400 bg-yellow-900/30" },
};

const SORT_COLUMNS: { field: ActivitySortField; label: string; className: string }[] = [
  { field: "type", label: "Type", className: "flex-1 justify-start pl-12" },
  { field: "date", label: "Date", className: "justify-start" },
  { field: "amount", label: "Amount", className: "justify-end w-32" },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ActivityPage() {
  return (
    <Suspense fallback={null}>
      <ActivityPageContent />
    </Suspense>
  );
}

function ActivityPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Sort state lives in the URL (?sort=amount&dir=desc) so it survives reloads
  // and can be shared (#556).
  const sort = parseActivitySort(searchParams.get("sort"), searchParams.get("dir"));

  const setSortField = useCallback(
    (field: ActivitySortField) => {
      const next = toggleActivitySort(sort, field);
      const params = new URLSearchParams(searchParams.toString());
      params.set("sort", next.field);
      params.set("dir", next.dir);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [sort, searchParams, router, pathname],
  );

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter state
  const [activeTypes, setActiveTypes] = useState<Set<StreamEvent["type"]>>(new Set());
  const [assetFilter, setAssetFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const assets = useRef<string[]>([]);
  if (assets.current.length === 0) assets.current = getActivityAssets();

  const buildQuery = useCallback(
    (cur: string | null): ActivityQuery => ({
      cursor: cur,
      limit: PAGE_SIZE,
      types: activeTypes.size > 0 ? Array.from(activeTypes) : undefined,
      asset: assetFilter || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
    }),
    [activeTypes, assetFilter, fromDate, toDate],
  );

  // (Re)load the first page whenever filters change.
  useEffect(() => {
    setLoading(true);
    const { events: firstPage, nextCursor } = getActivityEvents(buildQuery(null));
    setEvents(firstPage);
    setCursor(nextCursor);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTypes, assetFilter, fromDate, toDate]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const { events: nextPage, nextCursor } = getActivityEvents(buildQuery(cursor));
    setEvents((prev) => [...prev, ...nextPage]);
    setCursor(nextCursor);
    setLoadingMore(false);
  }, [cursor, loadingMore, buildQuery]);

  // Real-time prepend: poll for newly-created events and add matching ones to
  // the top of the feed without resetting scroll position or existing pages.
  const lastSeenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (events.length > 0 && lastSeenIdRef.current === null) {
      lastSeenIdRef.current = events[0]?.id ?? null;
    }
  }, [events]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newEvent = simulateNewEvent();
      const matchesTypes = activeTypes.size === 0 || activeTypes.has(newEvent.type);
      const matchesAsset = !assetFilter || newEvent.asset === assetFilter;
      const ts = new Date(newEvent.timestamp).getTime();
      const matchesFrom = !fromDate || ts >= new Date(fromDate).getTime();
      const matchesTo = !toDate || ts <= new Date(toDate).getTime() + 86_400_000 - 1;
      if (matchesTypes && matchesAsset && matchesFrom && matchesTo) {
        setEvents((prev) => [newEvent, ...prev]);
      }
      lastSeenIdRef.current = newEvent.id;
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [activeTypes, assetFilter, fromDate, toDate]);

  function toggleType(type: StreamEvent["type"]) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function clearFilters() {
    setActiveTypes(new Set());
    setAssetFilter("");
    setFromDate("");
    setToDate("");
  }

  const hasFilters = activeTypes.size > 0 || assetFilter || fromDate || toDate;

  const sortedEvents = useMemo(() => sortActivityEvents(events, sort), [events, sort?.field, sort?.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  // CSV export covers every event in the current filter scope (not just the
  // loaded pages), in the current sort order (#555).
  const exportCsv = useCallback(() => {
    const all = getActivityEventsAll({
      types: activeTypes.size > 0 ? Array.from(activeTypes) : undefined,
      asset: assetFilter || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
    });
    downloadActivityCsv(sortActivityEvents(all, sort));
  }, [activeTypes, assetFilter, fromDate, toDate, sort]);

  // Build a compliance audit log (JSON) for the current filter scope and
  // trigger a client-side download. The export honors the same filters as
  // the on-screen feed so what you see is what gets exported.
  const exportAuditLog = useCallback(() => {
    const query: ActivityQuery = {
      types: activeTypes.size > 0 ? Array.from(activeTypes) : undefined,
      asset: assetFilter || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
    };
    const log = buildStreamAuditLog(query);
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const assetTag = assetFilter ? `-${assetFilter}` : "";
    const link = document.createElement("a");
    link.href = url;
    link.download = `sorostream-audit-log${assetTag}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [activeTypes, assetFilter, fromDate, toDate]);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Activity</h1>
            <p className="text-gray-400 text-sm mt-1">
              A unified timeline of subscriptions, payments, alerts, and closures.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || events.length === 0}
              className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              aria-label="Export activity as CSV"
            >
              ⬇ Export CSV
            </button>
            <button
              type="button"
              onClick={exportAuditLog}
              className="px-3 py-2 text-sm rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              aria-label="Export compliance audit log as JSON"
            >
              ⬇ Export audit log
            </button>
            <Link
              href="/dashboard"
              className="text-sm text-green-400 hover:text-green-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 space-y-3">
          {/* Type chips */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by event type">
            {TYPE_FILTERS.map((f) => {
              const active = activeTypes.has(f.value);
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => toggleType(f.value)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                    active
                      ? "bg-green-700 border-green-600 text-white"
                      : "border-gray-700 text-gray-400 hover:bg-gray-800"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            {/* Asset filter */}
            <div>
              <label htmlFor="activity-asset" className="block text-xs text-gray-400 mb-1">
                Asset
              </label>
              <select
                id="activity-asset"
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                <option value="">All assets</option>
                {assets.current.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div>
              <label htmlFor="activity-from" className="block text-xs text-gray-400 mb-1">
                From
              </label>
              <input
                id="activity-from"
                type="date"
                onFocus={primePickerToNow}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                max={toDate || undefined}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              />
            </div>
            <div>
              <label htmlFor="activity-to" className="block text-xs text-gray-400 mb-1">
                To
              </label>
              <input
                id="activity-to"
                type="date"
                onFocus={primePickerToNow}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                min={fromDate || undefined}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              />
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading activity">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse border border-gray-700" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-10 text-center flex flex-col items-center gap-4 border border-gray-700">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No activity yet">
              <circle cx="40" cy="40" r="36" fill="#1f2937" stroke="#374151" strokeWidth="2" />
              <path d="M26 40 L54 40 M40 26 L40 54" stroke="#4b5563" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-gray-400 text-sm">
              {hasFilters
                ? "No activity matches the current filters."
                : "No activity yet. Events will appear here as they happen."}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="text-green-400 hover:text-green-300 text-sm">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Sortable column headers (#556) */}
            <div
              className="hidden sm:flex items-center gap-3 px-4 mb-2 text-xs uppercase tracking-wide text-gray-400"
              role="group"
              aria-label="Sort activity"
            >
              {SORT_COLUMNS.map((col) => {
                const active = sort?.field === col.field;
                const arrow = active ? (sort!.dir === "asc" ? "▲" : "▼") : "";
                return (
                  <button
                    key={col.field}
                    type="button"
                    onClick={() => setSortField(col.field)}
                    aria-pressed={active}
                    aria-label={`Sort by ${col.label.toLowerCase()}${
                      active ? `, currently ${sort!.dir === "asc" ? "ascending" : "descending"}` : ""
                    }`}
                    className={`flex items-center gap-1 rounded px-1 py-0.5 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${col.className} ${
                      active ? "text-white font-semibold" : ""
                    }`}
                  >
                    {col.label}
                    <span aria-hidden="true" className="w-3 text-[10px]">{arrow}</span>
                  </button>
                );
              })}
            </div>
            {/* Compact sort control for narrow screens */}
            <div className="sm:hidden flex flex-wrap gap-2 mb-3" role="group" aria-label="Sort activity">
              {SORT_COLUMNS.map((col) => {
                const active = sort?.field === col.field;
                return (
                  <button
                    key={col.field}
                    type="button"
                    onClick={() => setSortField(col.field)}
                    aria-pressed={active}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                      active ? "border-green-600 text-white" : "border-gray-700 text-gray-400"
                    }`}
                  >
                    {col.label}
                    {active && <span aria-hidden="true"> {sort!.dir === "asc" ? "▲" : "▼"}</span>}
                  </button>
                );
              })}
            </div>
            <ul
              role="list"
              aria-label="Activity timeline"
              aria-live="polite"
              className="space-y-3"
            >
              {sortedEvents.map((event) => {
                const config = typeConfig[event.type];
                return (
                  <li key={event.id}>
                    <Link
                      href={`/stream/${event.streamId}`}
                      className={`flex items-center gap-3 rounded-lg p-4 border transition-colors hover:bg-gray-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${config.colorClass}`}
                    >
                      <span
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm"
                        aria-hidden="true"
                      >
                        {config.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">
                          {config.label}
                          <span className="text-gray-400 font-normal"> · Stream #{event.streamId}</span>
                        </p>
                        <p className="text-xs text-gray-400">
                          {event.message ?? formatDateTime(event.timestamp)}
                          {event.message && ` · ${formatDateTime(event.timestamp)}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {event.amount && (
                          <p className="text-sm font-semibold text-white font-mono">
                            {formatUSDC(BigInt(event.amount))} {event.asset}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 font-mono">{truncateAddress(event.txHash)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Pagination — "load more" preserves scroll since we append in place */}
            {cursor && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
