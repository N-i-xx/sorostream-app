/**
 * Stream creation dry-run simulator (#430) — pure, UI-free, testable.
 *
 * Simulates what a proposed stream will look like over time before the
 * user signs the creation transaction: cumulative vesting checkpoints,
 * protocol-fee impact, and net receivable amounts.
 *
 * Amounts are in stroops (1 token = 10_000_000 stroops).
 * Times are Unix timestamps in seconds.
 */

import { calculateVestingSchedule } from "./vestingSchedule";
import { calcWithdrawBreakdown } from "./sorostream";

/** Progress markers sampled by the dry run when the caller supplies none. */
export const DRY_RUN_PROGRESS_MARKERS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * Vesting samples behind the checkpoint lookup: 1001 points = 0.1% of the
 * stream, so a custom marker resolves to the nearest 0.1% of the timeline
 * and cliff-adjacent markers land on the correct side of the cliff (#687).
 */
const DRY_RUN_SAMPLE_COUNT = 1001;

export interface DryRunCheckpoint {
  /** Fraction of the stream elapsed at this checkpoint (0..1). */
  progress: number;
  /** Unix timestamp (seconds) of the checkpoint. */
  time: number;
  /** Cumulative gross vested amount (stroops) at this point. */
  vestedStroops: number;
  /** Protocol fee (stroops) if the full vested amount were withdrawn here. */
  feeStroops: number;
  /** Net receivable (stroops) after protocol fee. */
  netStroops: number;
}

export interface StreamDryRunInput {
  /** Total deposit in stroops. */
  amountStroops: number;
  /** Stream duration in seconds (> 0). */
  durationSeconds: number;
  /** Optional cliff offset from start, in seconds (0 = no cliff). */
  cliffSeconds?: number;
  /** Protocol fee rate in basis points (e.g. 50 = 0.50%). */
  feeBasisPoints?: number;
  /** Stream start time (Unix seconds). Defaults to now. */
  startTime?: number;
  /**
   * Custom progress markers (fractions in 0..1) at which to emit checkpoints
   * (#687) — e.g. a set clustered just before/after an early cliff. Defaults to
   * `DRY_RUN_PROGRESS_MARKERS` when omitted. Markers are deduplicated and
   * ordered ascending; any non-finite or out-of-range value fails the run.
   */
  progressMarkers?: readonly number[];
}

export interface StreamDryRunResult {
  /** Whether the simulated creation would succeed. */
  ok: boolean;
  /** Failure reason when `ok` is false. */
  error?: string;
  /** Ordered checkpoints across the stream lifetime. */
  checkpoints: DryRunCheckpoint[];
  /** Total protocol fee (stroops) on the full deposit. */
  totalFeeStroops: number;
  /** Net total receivable (stroops) after fees. */
  netTotalStroops: number;
}

const FAIL: Omit<StreamDryRunResult, "error"> = {
  ok: false,
  checkpoints: [],
  totalFeeStroops: 0,
  netTotalStroops: 0,
};

/**
 * Simulate a stream over its lifetime without submitting a transaction.
 *
 * Samples the vesting curve (via calculateVestingSchedule, so cliff
 * semantics are identical to on-chain behaviour) at the caller's progress
 * markers (or the default set), applying the protocol fee to each
 * checkpoint's vested amount.
 */
export function simulateStreamDryRun(input: StreamDryRunInput): StreamDryRunResult {
  const {
    amountStroops,
    durationSeconds,
    cliffSeconds = 0,
    feeBasisPoints = 0,
    startTime = Math.floor(Date.now() / 1000),
    progressMarkers,
  } = input;

  if (!Number.isFinite(amountStroops) || amountStroops <= 0) {
    return { ...FAIL, error: "Amount must be greater than 0." };
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ...FAIL, error: "Duration must be greater than 0." };
  }

  let markers: readonly number[] = DRY_RUN_PROGRESS_MARKERS;
  if (progressMarkers !== undefined) {
    if (progressMarkers.length === 0) {
      return { ...FAIL, error: "Progress markers must not be empty." };
    }
    if (progressMarkers.some((m) => !Number.isFinite(m) || m < 0 || m > 1)) {
      return { ...FAIL, error: "Progress markers must be numbers between 0 and 1." };
    }
    markers = [...new Set(progressMarkers)].sort((a, b) => a - b);
  }

  const endTime = startTime + durationSeconds;
  const cliffTime = cliffSeconds > 0 ? startTime + cliffSeconds : 0;

  // Densely sample the vesting curve (every 0.1% of duration) so that each
  // progress marker — default or custom — lands on a nearby sample.
  const { points } = calculateVestingSchedule(
    amountStroops,
    startTime,
    endTime,
    cliffTime,
    DRY_RUN_SAMPLE_COUNT,
  );
  if (points.length === 0) {
    return { ...FAIL, error: "Unable to simulate the requested stream." };
  }

  const checkpoints: DryRunCheckpoint[] = markers.map((progress) => {
    const idx = Math.min(points.length - 1, Math.round(progress * (points.length - 1)));
    const point = points[idx];
    // The fee is charged exactly once, on the cumulative amount claimable at
    // this checkpoint (#716). With a cliff, the amount released at the cliff
    // is already part of `point.claimable`, so it must not be charged again
    // as a separate pre-cliff chunk.
    const { fee, net } = calcWithdrawBreakdown(point.claimable, feeBasisPoints);
    return {
      progress,
      time: point.time,
      vestedStroops: point.claimable,
      feeStroops: fee,
      netStroops: net,
    };
  });

  const { fee, net } = calcWithdrawBreakdown(amountStroops, feeBasisPoints);

  return {
    ok: true,
    checkpoints,
    totalFeeStroops: fee,
    netTotalStroops: net,
  };
}
