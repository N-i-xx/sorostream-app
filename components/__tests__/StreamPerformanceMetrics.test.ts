import { describe, expect, it } from "vitest";
import { calculatePerformanceMetrics } from "@/components/StreamPerformanceMetrics";
import type { StreamData } from "@/src/lib/sorostream";

function stream(overrides: Partial<StreamData> = {}): StreamData {
  return {
    id: "s1", sender: "GBWALLET123", recipient: "GOTHER123", token: "XLM",
    flowRate: 10, deposit: 1_000_000, startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T01:00:00.000Z", lastWithdrawTime: "2026-01-01T00:00:00.000Z",
    status: "Active", ...overrides,
  };
}

describe("calculatePerformanceMetrics active-time average", () => {
  const now = new Date("2026-01-01T00:10:00.000Z");

  it("excludes a known paused window from lifetime average flow rate", () => {
    // Ten wall-clock minutes include five paused minutes; only five minutes
    // contribute to both streamed amount and the active-time denominator.
    const metrics = calculatePerformanceMetrics([
      stream({ status: "Paused", pausedAt: "2026-01-01T00:10:00.000Z", totalPausedSeconds: 300 }),
    ], "GBWALLET123", now);
    expect(metrics.averageRateStroopsPerSec).toBe(10);
  });

  it("keeps a never-paused stream's average flow rate correct", () => {
    const metrics = calculatePerformanceMetrics([stream()], "GBWALLET123", now);
    expect(metrics.averageRateStroopsPerSec).toBe(10);
  });
});

describe("calculatePerformanceMetrics with a stale Active stream", () => {
  const now = new Date("2026-01-01T00:10:00.000Z");

  it("excludes an Active stream whose endTime has already passed", () => {
    const metrics = calculatePerformanceMetrics([
      stream({ endTime: "2026-01-01T00:05:00.000Z" }),
    ], "GBWALLET123", now);

    expect(metrics.activeStreams).toBe(0);
    expect(metrics.totalStreamedStroops).toBe(0);
    expect(metrics.totalReceivedStroops).toBe(0);
    expect(metrics.averageRateStroopsPerSec).toBe(0);
  });

  it("excludes an Active stream whose endTime is exactly now", () => {
    const metrics = calculatePerformanceMetrics([
      stream({ endTime: "2026-01-01T00:10:00.000Z" }),
    ], "GBWALLET123", now);

    expect(metrics.activeStreams).toBe(0);
  });

  it("counts only the live stream when a stale Active stream is also present", () => {
    const metrics = calculatePerformanceMetrics([
      stream({ id: "stale", endTime: "2026-01-01T00:05:00.000Z" }),
      stream({ id: "live", recipient: "GOTHER456" }),
    ], "GBWALLET123", now);

    expect(metrics.activeStreams).toBe(1);
    expect(metrics.totalStreamedStroops).toBe(6_000);
    expect(metrics.averageRateStroopsPerSec).toBe(10);
  });

  it("still represents a Paused stream whose endTime has passed", () => {
    const metrics = calculatePerformanceMetrics([
      stream({
        status: "Paused",
        endTime: "2026-01-01T00:05:00.000Z",
        pausedAt: "2026-01-01T00:04:00.000Z",
        totalPausedSeconds: 60,
      }),
    ], "GBWALLET123", now);

    expect(metrics.activeStreams).toBe(0);
    expect(metrics.totalStreamedStroops).toBe(1_800);
  });
});
