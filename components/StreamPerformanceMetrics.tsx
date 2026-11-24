"use client";

import { useMemo } from "react";
import type { StreamData } from "@/src/lib/sorostream";

interface StreamPerformanceMetricsProps {
  streams: StreamData[];
  walletAddress: string | null;
}

export interface PerformanceMetrics {
  /** Cumulative amount streamed out by this wallet so far, in stroops. */
  totalStreamedStroops: number;
  /** Cumulative amount received by this wallet so far, in stroops. */
  totalReceivedStroops: number;
  /** Number of active streams involving this wallet (in or out). */
  activeStreams: number;
  /** Average flow rate across those active streams, in stroops/sec. */
  averageRateStroopsPerSec: number;
}

const STROOPS_PER_UNIT = 10_000_000;

/**
 * Aggregate lifetime performance metrics for the connected wallet (#419).
 * Mirrors PortfolioSummaryCard's wallet matching (mock addresses are
 * truncated prefixes). Flow-rate averages use active seconds, excluding
 * `totalPausedSeconds` and any current pause interval (`pausedAt`). This uses
 * the same pause boundary as `getStreamHealth` in `src/lib/streamHealth.ts`:
 * a currently Paused stream is not counted as active, but its lifetime rate
 * remains represented in the rate.
 */
export function calculatePerformanceMetrics(
  streams: StreamData[],
  walletAddress: string | null,
  now: Date = new Date(),
): PerformanceMetrics {
  const empty: PerformanceMetrics = {
    totalStreamedStroops: 0,
    totalReceivedStroops: 0,
    activeStreams: 0,
    averageRateStroopsPerSec: 0,
  };
  if (!walletAddress || streams.length === 0) return empty;

  const prefix = walletAddress.slice(0, 5);
  let totalStreamed = 0;
  let totalReceived = 0;
  let activeSecondsSum = 0;
  let activeStreamCount = 0;
  let lifetimeRateAmount = 0;

  for (const s of streams) {
    if (s.status !== "Active" && s.status !== "Paused") continue;

    // A stale "Active" row past its endTime is really expired: getStreamHealth
    // reports it as Expired (#717). Exclude it from every active-stream metric
    // so these tiles agree with the health card.
    const endMs = new Date(s.endTime).getTime();
    if (s.status === "Active" && (Number.isNaN(endMs) || now.getTime() >= endMs)) continue;

    const isSender = s.sender.includes(prefix);
    const isRecipient = s.recipient.includes(prefix);
    if (!isSender && !isRecipient) continue;

    // Amount dripped so far: flow rate × elapsed seconds, capped at deposit.
    const startMs = new Date(s.startTime).getTime();
    const stopMs = s.status === "Paused" && s.pausedAt
      ? Math.min(now.getTime(), new Date(s.pausedAt).getTime())
      : now.getTime();
    const elapsedSeconds = Math.max(0, (stopMs - startMs) / 1000 - (s.totalPausedSeconds ?? 0));
    const streamedSoFar = Math.min(s.deposit, s.flowRate * elapsedSeconds);

    if (isSender) totalStreamed += streamedSoFar;
    else totalReceived += streamedSoFar;

    if (s.status === "Active") activeStreamCount += 1;
    activeSecondsSum += elapsedSeconds;
    // A paused stream has no active time since pausedAt; accumulated pause
    // time is subtracted above. The current pause interval is already excluded
    // by stopping the active clock at pausedAt.
    lifetimeRateAmount += streamedSoFar;
  }

  return {
    totalStreamedStroops: totalStreamed,
    totalReceivedStroops: totalReceived,
    activeStreams: activeStreamCount,
    averageRateStroopsPerSec: activeSecondsSum > 0 ? lifetimeRateAmount / activeSecondsSum : 0,
  };
}

function formatUnits(stroops: number): string {
  return (stroops / STROOPS_PER_UNIT).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDailyRate(stroopsPerSecond: number): string {
  const perDay = (stroopsPerSecond * 86_400) / STROOPS_PER_UNIT;
  if (perDay >= 1_000_000) return `${(perDay / 1_000_000).toFixed(2)}M`;
  if (perDay >= 1_000) return `${(perDay / 1_000).toFixed(1)}K`;
  return perDay.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function StreamPerformanceMetrics({ streams, walletAddress }: StreamPerformanceMetricsProps) {
  const metrics = useMemo(
    () => calculatePerformanceMetrics(streams, walletAddress),
    [streams, walletAddress],
  );

  if (!walletAddress) return null;

  const tiles = [
    {
      label: "Total Streamed",
      value: formatUnits(metrics.totalStreamedStroops),
      tone: "text-orange-400",
      hint: "Amount you have dripped out across your active streams to date",
    },
    {
      label: "Total Received",
      value: formatUnits(metrics.totalReceivedStroops),
      tone: "text-green-400",
      hint: "Amount you have received across your active streams to date",
    },
    {
      label: "Active Streams",
      value: metrics.activeStreams.toLocaleString(),
      tone: "text-blue-400",
      hint: "Streams where this wallet is sender or recipient",
    },
    {
      label: "Avg Rate / Day",
      value: formatDailyRate(metrics.averageRateStroopsPerSec),
      tone: "text-purple-400",
      hint: "Mean flow rate across your active streams, per day",
    },
  ];

  return (
    <section
      className="bg-gray-800 rounded-xl p-5 mb-6 border border-gray-700"
      aria-label="Stream performance metrics"
    >
      <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wide">
        Performance Metrics
      </h2>
      {metrics.activeStreams === 0 ? (
        <p className="text-sm text-gray-500">
          No active streams yet — metrics will appear once streams are running.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              title={tile.hint}
              className="flex flex-col items-start p-3 rounded-lg bg-gray-700/50 border border-transparent"
            >
              <span className="text-xs text-gray-400 mb-1">{tile.label}</span>
              <span className={`text-lg font-bold font-mono ${tile.tone}`}>{tile.value}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-500 mt-3">
        Aggregated from active streams only. Amounts accumulate in real time based on each stream&apos;s flow rate.
      </p>
    </section>
  );
}
