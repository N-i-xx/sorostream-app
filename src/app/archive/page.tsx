"use client";
/**
 * /archive — shows expired and cancelled streams older than 30 days.
 *
 * Features:
 * - Only Ended/Cancelled streams that expired > 30 days ago appear here.
 * - Active streams are never shown.
 * - Date-range filter to bound results by stream end date.
 * - Paginated at PAGE_SIZE rows per page.
 */
import { primePickerToNow } from "@/src/lib/datePickerDefault";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { getArchivedStreams, formatStellarAmount, type StreamData } from "@/src/lib/sorostream";
import { useLocaleDateFormat } from "@/src/lib/dateFormat";
import StatusBadge from "@/components/StatusBadge";

const PAGE_SIZE = 10;

export default function ArchivePage() {
  const { formatDate } = useLocaleDateFormat();
  const [allStreams, setAllStreams] = useState<StreamData[]>([]);
  const [loading, setLoading] = useState(true);

  // Date-range filter state
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Pagination
  const [page, setPage] = useState(1);

  useEffect(() => {
    // Simulate async fetch
    const data = getArchivedStreams();
    setAllStreams(data);
    setLoading(false);
  }, []);

  const filtered = useMemo(() => {
    return allStreams.filter((s) => {
      const endMs = new Date(s.endTime).getTime();
      if (fromDate) {
        const fromMs = new Date(fromDate).getTime();
        if (endMs < fromMs) return false;
      }
      if (toDate) {
        // Include the full end day
        const toMs = new Date(toDate).getTime() + 86400000 - 1;
        if (endMs > toMs) return false;
      }
      return true;
    });
  }, [allStreams, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate]);

  const hasFilters = fromDate || toDate;

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Stream Archive</h1>
            <p className="text-gray-400 text-sm mt-1">
              Ended and cancelled streams older than 30 days.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-green-400 hover:text-green-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Date-range filter */}
        <div className="mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label htmlFor="archive-from" className="block text-xs text-gray-400 mb-1">
              Ended after
            </label>
            <input
              id="archive-from"
              type="date"
              onFocus={primePickerToNow}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              max={toDate || undefined}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            />
          </div>
          <div>
            <label htmlFor="archive-to" className="block text-xs text-gray-400 mb-1">
              Ended before
            </label>
            <input
              id="archive-to"
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
              onClick={() => { setFromDate(""); setToDate(""); }}
              className="px-3 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              Clear filter
            </button>
          )}
          <p className="text-xs text-gray-500 self-end ml-auto">
            {filtered.length} stream{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Table / cards */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-10 text-center flex flex-col items-center gap-4">
            <svg
              width="80"
              height="80"
              viewBox="0 0 80 80"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label={hasFilters ? "No archived streams match your filters" : "No archived streams yet"}
            >
              <circle cx="40" cy="40" r="36" fill="#1f2937" stroke="#374151" strokeWidth="2" />
              <path
                d="M26 55 L40 30 L54 55"
                stroke="#4b5563"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path d="M30 48 L50 48" stroke="#374151" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-gray-400 text-sm">
              {hasFilters
                ? "No archived streams match the selected date range."
                : "No archived streams yet. Ended streams appear here after 30 days."}
            </p>
            {hasFilters && (
              <button
                onClick={() => { setFromDate(""); setToDate(""); }}
                className="text-green-400 hover:text-green-300 text-sm"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800 text-gray-400 text-left">
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Token</th>
                    <th className="px-4 py-3 font-medium">Sender</th>
                    <th className="px-4 py-3 font-medium">Recipient</th>
                    <th className="px-4 py-3 font-medium">Deposit</th>
                    <th className="px-4 py-3 font-medium">Ended</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {paginated.map((s) => (
                    <tr key={s.id} className="bg-gray-900 hover:bg-gray-800/60 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-300">#{s.id}</td>
                      <td className="px-4 py-3 text-white font-medium">{s.token}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{s.sender}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{s.recipient}</td>
                      <td className="px-4 py-3 text-gray-300">
                        {formatStellarAmount(s.deposit)} {s.token}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{formatDate(s.endTime)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.status} compact />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/stream/${s.id}`}
                          className="text-green-400 hover:text-green-300 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {paginated.map((s) => (
                <div
                  key={s.id}
                  className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-300">#{s.id}</span>
                    <StatusBadge status={s.status} compact />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Token</span>
                    <span className="text-white font-medium">{s.token}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Deposit</span>
                    <span className="text-gray-300">
                      {formatStellarAmount(s.deposit)} {s.token}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Ended</span>
                    <span className="text-gray-300">{formatDate(s.endTime)}</span>
                  </div>
                  <Link
                    href={`/stream/${s.id}`}
                    className="block text-center text-sm text-green-400 hover:text-green-300 mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                  >
                    View details →
                  </Link>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav
                aria-label="Archive pagination"
                className="mt-6 flex items-center justify-center gap-2"
              >
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                  className="px-3 py-1.5 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  ← Prev
                </button>

                {Array.from({ length: totalPages }).map((_, i) => {
                  const p = i + 1;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      aria-current={currentPage === p ? "page" : undefined}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                        currentPage === p
                          ? "bg-green-700 border-green-600 text-white"
                          : "border-gray-700 text-gray-400 hover:bg-gray-800"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                  className="px-3 py-1.5 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  Next →
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  );
}
