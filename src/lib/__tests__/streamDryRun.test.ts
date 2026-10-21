import { describe, expect, it } from "vitest";
import { DRY_RUN_PROGRESS_MARKERS, simulateStreamDryRun } from "../streamDryRun";

const STROOPS = 10_000_000;
const START = 1_700_000_000; // fixed epoch seconds for determinism

describe("simulateStreamDryRun (#430)", () => {
  it("rejects non-positive amounts", () => {
    const result = simulateStreamDryRun({
      amountStroops: 0,
      durationSeconds: 1000,
      startTime: START,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/amount/i);
    expect(result.checkpoints).toHaveLength(0);
  });

  it("rejects non-positive durations", () => {
    const result = simulateStreamDryRun({
      amountStroops: STROOPS,
      durationSeconds: 0,
      startTime: START,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/duration/i);
  });

  it("produces five checkpoints at even progress markers", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      feeBasisPoints: 50,
      startTime: START,
    });

    expect(result.ok).toBe(true);
    expect(result.checkpoints.map((c) => c.progress)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(result.checkpoints[0].time).toBe(START);
    expect(result.checkpoints[4].time).toBe(START + 1000);
  });

  it("vests linearly with no cliff and nothing at start", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      startTime: START,
    });

    const [start, q1, q2, q3, end] = result.checkpoints;
    expect(start.vestedStroops).toBe(0);
    expect(q1.vestedStroops).toBe(25 * STROOPS);
    expect(q2.vestedStroops).toBe(50 * STROOPS);
    expect(q3.vestedStroops).toBe(75 * STROOPS);
    expect(end.vestedStroops).toBe(100 * STROOPS);
  });

  it("holds vesting at zero before the cliff", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      cliffSeconds: 400, // 40% in
      startTime: START,
    });

    // At 25% we are still pre-cliff
    expect(result.checkpoints[1].vestedStroops).toBe(0);
    // At 50% everything accrued up to that point unlocks
    expect(result.checkpoints[2].vestedStroops).toBe(50 * STROOPS);
  });

  it("applies the protocol fee to each checkpoint and totals", () => {
    const result = simulateStreamDryRun({
      amountStroops: 1000 * STROOPS,
      durationSeconds: 1000,
      feeBasisPoints: 50, // 0.5%
      startTime: START,
    });

    const end = result.checkpoints[4];
    expect(end.feeStroops).toBe(Math.floor((1000 * STROOPS * 50) / 10_000)); // 5 tokens
    expect(end.netStroops).toBe(end.vestedStroops - end.feeStroops);

    expect(result.totalFeeStroops).toBe(5 * STROOPS);
    expect(result.netTotalStroops).toBe(995 * STROOPS);

    // Fee is proportional at mid-stream too
    const half = result.checkpoints[2];
    expect(half.feeStroops).toBe(Math.floor((500 * STROOPS * 50) / 10_000));
  });

  it("charges no fee when basis points are zero", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      feeBasisPoints: 0,
      startTime: START,
    });

    expect(result.totalFeeStroops).toBe(0);
    expect(result.netTotalStroops).toBe(100 * STROOPS);
    expect(result.checkpoints.every((c) => c.feeStroops === 0)).toBe(true);
  });

  it("deducts the protocol fee exactly once at each post-cliff checkpoint (#716)", () => {
    const bps = 50; // 0.5%
    const result = simulateStreamDryRun({
      amountStroops: 1000 * STROOPS,
      durationSeconds: 1000,
      cliffSeconds: 400, // cliff at 40%: the 50/75/100% checkpoints are post-cliff
      feeBasisPoints: bps,
      startTime: START,
    });
    expect(result.ok).toBe(true);

    const [start, q1, q2, q3, end] = result.checkpoints;

    // Pre-cliff: nothing vested, nothing charged.
    for (const c of [start, q1]) {
      expect(c.vestedStroops).toBe(0);
      expect(c.feeStroops).toBe(0);
      expect(c.netStroops).toBe(0);
    }

    // Post-cliff: one fee on the cumulative vested amount, including the
    // part released at the cliff.
    const expected = [
      [q2, 500 * STROOPS],
      [q3, 750 * STROOPS],
      [end, 1000 * STROOPS],
    ] as const;
    for (const [c, vested] of expected) {
      const singleFee = Math.floor((vested * bps) / 10_000);
      expect(c.vestedStroops).toBe(vested);
      expect(c.feeStroops).toBe(singleFee);
      expect(c.netStroops).toBe(vested - singleFee);
    }

    // The final checkpoint matches the whole-deposit totals.
    expect(end.feeStroops).toBe(result.totalFeeStroops);
    expect(end.netStroops).toBe(result.netTotalStroops);
  });

  it("gives the same post-cliff fees as a no-cliff stream at the same checkpoints", () => {
    const base = {
      amountStroops: 1000 * STROOPS,
      durationSeconds: 1000,
      feeBasisPoints: 50,
      startTime: START,
    };
    const noCliff = simulateStreamDryRun(base);
    const withCliff = simulateStreamDryRun({ ...base, cliffSeconds: 400 });

    for (const i of [2, 3, 4]) {
      expect(withCliff.checkpoints[i].feeStroops).toBe(noCliff.checkpoints[i].feeStroops);
      expect(withCliff.checkpoints[i].netStroops).toBe(noCliff.checkpoints[i].netStroops);
    }
  });
});

describe("simulateStreamDryRun — custom progress markers (#687)", () => {
  it("falls back to DRY_RUN_PROGRESS_MARKERS when none are supplied", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      startTime: START,
    });

    expect(result.ok).toBe(true);
    expect(result.checkpoints.map((c) => c.progress)).toEqual([...DRY_RUN_PROGRESS_MARKERS]);
  });

  it("samples a custom marker set including a cliff-adjacent fraction", () => {
    const result = simulateStreamDryRun({
      amountStroops: 1000 * STROOPS,
      durationSeconds: 1000,
      cliffSeconds: 120, // cliff at 12% — no default marker lands near it
      feeBasisPoints: 50,
      startTime: START,
      progressMarkers: [0, 0.11, 0.12, 0.5, 1],
    });

    expect(result.ok).toBe(true);
    expect(result.checkpoints.map((c) => c.progress)).toEqual([0, 0.11, 0.12, 0.5, 1]);

    const [start, justBeforeCliff, atCliff, half, end] = result.checkpoints;

    expect(start.time).toBe(START);
    expect(start.vestedStroops).toBe(0);

    // 11% is still pre-cliff: nothing unlocked.
    expect(justBeforeCliff.time).toBe(START + 110);
    expect(justBeforeCliff.vestedStroops).toBe(0);
    expect(justBeforeCliff.feeStroops).toBe(0);

    // The marker on the cliff sees the whole accrued amount, fee charged once.
    expect(atCliff.time).toBe(START + 120);
    expect(atCliff.vestedStroops).toBe(120 * STROOPS);
    expect(atCliff.feeStroops).toBe(Math.floor((120 * STROOPS * 50) / 10_000));
    expect(atCliff.netStroops).toBe(atCliff.vestedStroops - atCliff.feeStroops);

    expect(half.vestedStroops).toBe(500 * STROOPS);
    expect(end.time).toBe(START + 1000);
    expect(end.vestedStroops).toBe(1000 * STROOPS);
  });

  it("deduplicates and orders the supplied markers", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      startTime: START,
      progressMarkers: [1, 0.5, 0.5, 0],
    });

    expect(result.ok).toBe(true);
    expect(result.checkpoints.map((c) => c.progress)).toEqual([0, 0.5, 1]);
  });

  it("rejects markers outside 0..1", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      startTime: START,
      progressMarkers: [0, 1.5],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/progress markers/i);
    expect(result.checkpoints).toHaveLength(0);
  });

  it("rejects an empty marker list", () => {
    const result = simulateStreamDryRun({
      amountStroops: 100 * STROOPS,
      durationSeconds: 1000,
      startTime: START,
      progressMarkers: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/progress markers/i);
  });
});
