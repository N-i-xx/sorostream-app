/**
 * #941: the dense cliff-sampling window is clamped with Math.max/Math.min
 * against startTime/endTime. With a cliff close to either boundary and a
 * huge cliffWindowSeconds, no sample may fall outside [startTime, endTime].
 */
import { describe, expect, it } from "vitest";
import { calculateVestingSchedule } from "../vestingSchedule";

const START = 1_700_000_000;
const END = START + 30 * 86_400; // 30 days
const TOTAL = 1_000_000_000;

function assertWithinBounds(points: { time: number; claimable: number }[]) {
  expect(points.length).toBeGreaterThan(0);
  for (const p of points) {
    expect(p.time).toBeGreaterThanOrEqual(START);
    expect(p.time).toBeLessThanOrEqual(END);
    expect(p.claimable).toBeGreaterThanOrEqual(0);
    expect(p.claimable).toBeLessThanOrEqual(TOTAL);
  }
  // Still ordered and de-duplicated after the extra samples are merged in.
  for (let i = 1; i < points.length; i++) {
    expect(points[i].time).toBeGreaterThan(points[i - 1].time);
  }
}

describe("calculateVestingSchedule cliff window clamping (#941)", () => {
  it("clamps the window at startTime when the cliff is just after the start", () => {
    const cliff = START + 60;
    const { points } = calculateVestingSchedule(TOTAL, START, END, cliff, 50, {
      cliffWindowSeconds: 365 * 86_400,
      cliffSampleCount: 40,
    });

    assertWithinBounds(points);
    expect(points[0].time).toBe(START);
    expect(points.some((p) => p.time === cliff)).toBe(true);
  });

  it("clamps the window at endTime when the cliff is just before the end", () => {
    const cliff = END - 60;
    const { points } = calculateVestingSchedule(TOTAL, START, END, cliff, 50, {
      cliffWindowSeconds: 365 * 86_400,
      cliffSampleCount: 40,
    });

    assertWithinBounds(points);
    expect(points[points.length - 1].time).toBe(END);
    expect(points.some((p) => p.time === cliff)).toBe(true);
  });

  it("keeps the extra samples inside the clamped window and adds them", () => {
    const cliff = START + 1;
    const uniform = calculateVestingSchedule(TOTAL, START, END, cliff, 10).points;
    const dense = calculateVestingSchedule(TOTAL, START, END, cliff, 10, {
      cliffWindowSeconds: Number.MAX_SAFE_INTEGER,
      cliffSampleCount: 25,
    }).points;

    assertWithinBounds(dense);
    expect(dense.length).toBeGreaterThan(uniform.length);
  });
});
