import { describe, expect, it } from "vitest";
import { calculateVestingSchedule } from "../vestingSchedule";

const START = 1_000_000; // arbitrary unix epoch seconds
const END = START + 1_000; // 1 000-second window
const TOTAL = 1_000_000_000; // 100 XLM in stroops

describe("calculateVestingSchedule", () => {
  // ── 1. Linear, no cliff ────────────────────────────────────────────────────
  it("linear no-cliff: first point is 0, last point equals totalAmount", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, 0);

    expect(points.length).toBeGreaterThan(0);
    expect(points[0].claimable).toBe(0);
    expect(points[points.length - 1].claimable).toBe(TOTAL);
  });

  it("linear no-cliff: claimable increases monotonically", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, 0);

    for (let i = 1; i < points.length; i++) {
      expect(points[i].claimable).toBeGreaterThanOrEqual(points[i - 1].claimable);
    }
  });

  // ── 2. Cliff at 25 % ───────────────────────────────────────────────────────
  it("cliff at 25%: nothing claimable before cliff, then lump-sum at cliff", () => {
    const cliffTime = START + 250; // 25 % of 1 000 s
    const { points } = calculateVestingSchedule(TOTAL, START, END, cliffTime);

    const beforeCliff = points.filter((p) => p.time < cliffTime);
    const atOrAfterCliff = points.filter((p) => p.time >= cliffTime);

    expect(beforeCliff.every((p) => p.claimable === 0)).toBe(true);
    // At cliff the full 25 % that accrued since start becomes available.
    expect(atOrAfterCliff[0].claimable).toBeGreaterThan(0);
  });

  // ── 3. Cliff at end_time ───────────────────────────────────────────────────
  it("cliff at end_time: all points before end have 0 claimable", () => {
    // A cliff at or after endTime means the entire window is locked — treat as
    // no effective cliff (cliff >= endTime is out of range), so vesting is linear.
    const { points } = calculateVestingSchedule(TOTAL, START, END, END);

    // cliff === endTime is outside the (startTime, endTime) range, so it is
    // treated the same as no cliff — linear vesting.
    expect(points[0].claimable).toBe(0);
    expect(points[points.length - 1].claimable).toBe(TOTAL);
  });

  // ── 4. Zero amount ─────────────────────────────────────────────────────────
  it("zero totalAmount: returns empty points array", () => {
    const { points } = calculateVestingSchedule(0, START, END, 0);
    expect(points).toHaveLength(0);
  });

  // ── 5. Single-second duration ──────────────────────────────────────────────
  it("single-second duration: first point is 0, last is totalAmount", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, START + 1, 0);

    expect(points[0].claimable).toBe(0);
    expect(points[points.length - 1].claimable).toBe(TOTAL);
  });

  // ── 6. sampleCount propagates correctly ───────────────────────────────────
  it("respects custom sampleCount", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, 0, 10);
    expect(points).toHaveLength(10);
  });

  // ── 7. Times are within [startTime, endTime] ──────────────────────────────
  it("all point times are within [startTime, endTime]", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, 0);

    for (const p of points) {
      expect(p.time).toBeGreaterThanOrEqual(START);
      expect(p.time).toBeLessThanOrEqual(END);
    }
  });
});

describe("calculateVestingSchedule — denser sampling around the cliff (#686)", () => {
  const CLIFF = START + 250; // 25% into the 1 000-second window

  const countBetween = (points: { time: number }[], from: number, to: number) =>
    points.filter((p) => p.time >= from && p.time <= to).length;

  it("uniform sampling is unchanged when no options are passed", () => {
    const plain = calculateVestingSchedule(TOTAL, START, END, CLIFF, 50);
    const explicit = calculateVestingSchedule(TOTAL, START, END, CLIFF, 50, {});

    expect(plain.points).toHaveLength(50);
    expect(explicit.points).toEqual(plain.points);
  });

  it("adds samples only inside the configured cliff window", () => {
    const windowSeconds = 100;
    const opts = { cliffWindowSeconds: windowSeconds, cliffSampleCount: 20 };

    const uniform = calculateVestingSchedule(TOTAL, START, END, CLIFF, 50);
    const dense = calculateVestingSchedule(TOTAL, START, END, CLIFF, 50, opts);

    expect(dense.points.length).toBeGreaterThan(uniform.points.length);
    expect(countBetween(dense.points, CLIFF - windowSeconds, CLIFF + windowSeconds)).toBeGreaterThan(
      countBetween(uniform.points, CLIFF - windowSeconds, CLIFF + windowSeconds),
    );
    // Everything outside the window is exactly the uniform set.
    expect(countBetween(dense.points, START, CLIFF - windowSeconds)).toBe(
      countBetween(uniform.points, START, CLIFF - windowSeconds),
    );
    expect(countBetween(dense.points, CLIFF + windowSeconds, END)).toBe(
      countBetween(uniform.points, CLIFF + windowSeconds, END),
    );
  });

  it("always samples the cliff boundary itself", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, CLIFF, 50, {
      cliffWindowSeconds: 60,
      cliffSampleCount: 8,
    });

    const atCliff = points.find((p) => p.time === CLIFF);
    expect(atCliff).toBeDefined();
    expect(atCliff!.claimable).toBeGreaterThan(0);
    expect(points.filter((p) => p.time < CLIFF).every((p) => p.claimable === 0)).toBe(true);
  });

  it("keeps points ordered, in range and monotonically vesting", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, CLIFF, 50, {
      cliffWindowSeconds: 100,
      cliffSampleCount: 20,
    });

    expect(points[0].time).toBe(START);
    expect(points[points.length - 1].time).toBe(END);

    for (let i = 1; i < points.length; i++) {
      expect(points[i].time).toBeGreaterThanOrEqual(points[i - 1].time);
      expect(points[i].claimable).toBeGreaterThanOrEqual(points[i - 1].claimable);
    }
  });

  it("ignores the window option when there is no cliff", () => {
    const { points } = calculateVestingSchedule(TOTAL, START, END, 0, 50, {
      cliffWindowSeconds: 100,
      cliffSampleCount: 20,
    });

    expect(points).toHaveLength(50);
  });
});
