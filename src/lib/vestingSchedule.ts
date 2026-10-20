/**
 * Vesting schedule calculator — pure, UI-free, testable in isolation.
 *
 * Amounts are in stroops (1 XLM = 10_000_000 stroops).
 * Times are Unix timestamps in seconds.
 */

export interface VestingPoint {
  /** Unix timestamp (seconds) at which this sample was taken. */
  time: number;
  /** Cumulative stroops claimable at this point in time. */
  claimable: number;
}

export interface VestingScheduleResult {
  /** Ordered samples across the full vesting window. */
  points: VestingPoint[];
}

export interface VestingScheduleOptions {
  /**
   * Half-width, in seconds, of the window on each side of the cliff boundary
   * that should be sampled more densely (#686). Omitted (or <= 0) keeps the
   * default uniform sampling.
   */
  cliffWindowSeconds?: number;
  /**
   * Number of extra samples spread across that window. Only meaningful when
   * `cliffWindowSeconds` is set. Defaults to 10.
   */
  cliffSampleCount?: number;
}

const DEFAULT_CLIFF_EXTRA_SAMPLES = 10;

/**
 * Calculate a vesting schedule as a series of time/claimable samples.
 *
 * Linear vesting: tokens accrue at a constant rate from `startTime`
 * (or `cliffTime` if a cliff is set) to `endTime`.
 *
 * Before the cliff nothing is claimable. At the cliff the recipient
 * can claim everything accrued from `startTime` to `cliffTime` in one
 * go, then continues to vest linearly until `endTime`.
 *
 * @param totalAmount   Total stroops to vest over the full period.
 * @param startTime     Unix timestamp (s) when vesting begins.
 * @param endTime       Unix timestamp (s) when vesting finishes.
 * @param cliffTime     Unix timestamp (s) of the cliff (0 = no cliff).
 * @param sampleCount   Number of evenly-spaced data points to generate (default 50).
 * @param options       Optional sampling tweaks (#686): denser sampling inside
 *                      a window around the cliff boundary. When omitted, the
 *                      uniform sample set is returned unchanged.
 */
export function calculateVestingSchedule(
  totalAmount: number,
  startTime: number,
  endTime: number,
  cliffTime: number = 0,
  sampleCount: number = 50,
  options: VestingScheduleOptions = {},
): VestingScheduleResult {
  if (totalAmount <= 0 || endTime <= startTime || sampleCount < 2) {
    return { points: [] };
  }

  const duration = endTime - startTime;
  const effectiveCliff = cliffTime > startTime && cliffTime < endTime ? cliffTime : 0;

  /** Cumulative claimable at an exact (unrounded) timestamp. */
  const claimableAt = (time: number): number => {
    if (effectiveCliff > 0 && time < effectiveCliff) return 0;
    return Math.floor((totalAmount * (time - startTime)) / duration);
  };

  const points: VestingPoint[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const time = startTime + (duration * i) / (sampleCount - 1);
    points.push({ time: Math.round(time), claimable: claimableAt(time) });
  }

  // Optional denser sampling around the cliff boundary (#686): the pre-cliff
  // stretch is flat and uninteresting, so extra samples are spent inside a
  // configurable window straddling the cliff where claimable jumps.
  const { cliffWindowSeconds, cliffSampleCount = DEFAULT_CLIFF_EXTRA_SAMPLES } = options;
  if (
    effectiveCliff > 0 &&
    typeof cliffWindowSeconds === "number" &&
    Number.isFinite(cliffWindowSeconds) &&
    cliffWindowSeconds > 0 &&
    cliffSampleCount > 0
  ) {
    const windowStart = Math.max(startTime, effectiveCliff - cliffWindowSeconds);
    const windowEnd = Math.min(endTime, effectiveCliff + cliffWindowSeconds);

    if (windowEnd > windowStart) {
      const extraCount = Math.floor(cliffSampleCount);
      const extraTimes: number[] = [effectiveCliff]; // always sample the boundary itself
      for (let k = 1; k <= extraCount; k++) {
        extraTimes.push(windowStart + ((windowEnd - windowStart) * k) / (extraCount + 1));
      }

      for (const time of extraTimes) {
        points.push({ time: Math.round(time), claimable: claimableAt(time) });
      }

      points.sort((a, b) => a.time - b.time);

      // Uniform and cliff samples can round to the same second; keep the first.
      const deduped: VestingPoint[] = [];
      for (const point of points) {
        if (deduped.length > 0 && deduped[deduped.length - 1].time === point.time) continue;
        deduped.push(point);
      }
      return { points: deduped };
    }
  }

  return { points };
}
