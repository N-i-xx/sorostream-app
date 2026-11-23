"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { StreamData } from "@/src/lib/sorostream";

interface WalletAnalyticsDashboardProps {
  /** All streams loaded for the connected wallet. */
  streams: StreamData[];
  /** Connected wallet address (used to scope incoming vs outgoing). */
  walletAddress: string;
}

const STROOPS = 10_000_000;

function stroopsToDisplay(stroops: number): string {
  const val = stroops / STROOPS;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(2);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

function MetricCard({ label, value, sub, accent = "text-green-400" }: MetricCardProps) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex flex-col gap-1">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${accent} tabular-nums`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

/**
 * Wallet-scoped analytics dashboard (issue #521).
 *
 * Displays:
 *   - Total value streamed in the last 30 days (outgoing + incoming)
 *   - Number of currently active streams
 *   - Average stream duration across all streams
 *   - Daily earnings chart (incoming value received per day, last 30 days)
 *
 * All data is derived client-side from the streams prop.
 */
export default function WalletAnalyticsDashboard({
  streams,
  walletAddress,
}: WalletAnalyticsDashboardProps) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86_400_000;

  // Identify streams that involve this wallet. Compare full addresses — a
  // short prefix match can collide between two different wallets that merely
  // share the same leading characters (see #847 for the same bug in
  // PortfolioSummaryCard).
  const myStreams = useMemo(
    () =>
      streams.filter(
        (s) => s.sender === walletAddress || s.recipient === walletAddress,
      ),
    [streams, walletAddress],
  );

  /** Metric 1: Total value streamed (outgoing deposits) in the last 30 days. */
  const totalValue30dStroops = useMemo(() => {
    return myStreams.reduce((sum, s) => {
      const start = new Date(s.startTime).getTime();
      if (start >= thirtyDaysAgo) return sum + Number(s.deposit);
      return sum;
    }, 0);
  }, [myStreams, thirtyDaysAgo]);

  /** Metric 2: Number of currently active streams. */
  const activeCount = useMemo(
    () => myStreams.filter((s) => s.status === "Active").length,
    [myStreams],
  );

  /** Metric 3: Average stream duration in seconds (across all streams with a valid range). */
  const avgDurationSeconds = useMemo(() => {
    const durations = myStreams
      .map((s) => {
        const start = new Date(s.startTime).getTime();
        const end = new Date(s.endTime).getTime();
        return (end - start) / 1000;
      })
      .filter((d) => d > 0);
    if (durations.length === 0) return 0;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }, [myStreams]);

  /**
   * Metric 4: Daily earnings chart — for streams where this wallet is the
   * recipient, estimate the value that streamed in per calendar day over the
   * last 30 days.
   */
  const dailyEarnings = useMemo(() => {
    // Build day buckets for the last 30 days.
    const buckets: { date: string; stroops: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000);
      d.setHours(0, 0, 0, 0);
      const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      buckets.push({ date: label, stroops: 0 });
    }

    const incomingStreams = myStreams.filter((s) => s.recipient === walletAddress);

    for (const stream of incomingStreams) {
      const startMs = new Date(stream.startTime).getTime();
      const endMs = new Date(stream.endTime).getTime();
      const rate = Number(stream.flowRate); // stroops / sec

      for (let i = 0; i < buckets.length; i++) {
        // Day window
        const dayStart = now - (29 - i) * 86_400_000;
        const dayEnd = dayStart + 86_400_000;

        // Overlap of stream active period with this day
        const overlapStart = Math.max(startMs, dayStart);
        const overlapEnd = Math.min(
          stream.status === "Cancelled" && stream.cancelledAt
            ? stream.cancelledAt * 1000
            : stream.status === "Paused" && stream.pausedAt
            ? new Date(stream.pausedAt).getTime()
            : endMs,
          dayEnd,
        );
        if (overlapEnd > overlapStart) {
          const seconds = (overlapEnd - overlapStart) / 1000;
          buckets[i].stroops += Math.floor(rate * seconds);
        }
      }
    }

    return buckets;
  }, [myStreams, walletAddress, now]);

  /** Total earnings over the last 30 days for the chart summary. */
  const totalEarnings30d = dailyEarnings.reduce((s, d) => s + d.stroops, 0);

  if (myStreams.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 text-center border border-gray-700">
        <p className="text-gray-400 text-sm">
          No stream data available for this wallet yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary metric cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="30-day streamed value"
          value={stroopsToDisplay(totalValue30dStroops)}
          sub="outgoing deposits started"
          accent="text-green-400"
        />
        <MetricCard
          label="Active streams"
          value={String(activeCount)}
          sub={`of ${myStreams.length} total`}
          accent="text-blue-400"
        />
        <MetricCard
          label="Avg stream duration"
          value={avgDurationSeconds > 0 ? formatDuration(avgDurationSeconds) : "—"}
          sub="across all streams"
          accent="text-purple-400"
        />
        <MetricCard
          label="30-day earnings"
          value={stroopsToDisplay(totalEarnings30d)}
          sub="incoming streamed to you"
          accent="text-yellow-400"
        />
      </div>

      {/* Daily earnings area chart */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h2 className="text-sm font-semibold text-gray-200 mb-1">Daily earnings (last 30 days)</h2>
        <p className="text-xs text-gray-500 mb-4">
          Estimated incoming stream value per calendar day
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={dailyEarnings} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="walletEarningsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              interval={4}
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickFormatter={(v: number) => stroopsToDisplay(v)}
            />
            <Tooltip
              contentStyle={{
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 8,
              }}
              formatter={
                ((value: number) => [
                  stroopsToDisplay(value),
                  "Earnings",
                ]) as any
              }
            />
            <Area
              type="monotone"
              dataKey="stroops"
              name="Earnings"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#walletEarningsGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
