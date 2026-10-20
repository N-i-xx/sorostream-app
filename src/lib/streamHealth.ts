/**
 * Stream health status utility.
 *
 * Derives a rich health label from raw StreamData. The label drives badge
 * colours, alert banners, and action availability across the app.
 *
 * Priority order (highest wins):
 *   1. Cancelled  – explicit cancellation always overrides everything.
 *   2. Paused     – paused always overrides time-based calculations.
 *   3. Expired    – stream is over (endTime has passed) and not paused.
 *   4. Expiring Soon – stream ends within the next EXPIRING_SOON_THRESHOLD_MS.
 *   5. Active     – stream is running normally.
 *
 * "Expired" covers two different situations for a recipient: nothing left to
 * claim, and funds still waiting to be withdrawn. `getStreamHealthDetails`
 * returns the same status plus a `hasUnclaimedBalance` flag that tells them
 * apart (#717).
 *
 * ## Extending the priority chain (#688)
 *
 * The five statuses above are just the default rule list (`DEFAULT_HEALTH_RULES`).
 * An application-specific status can be slotted into the chain at any position
 * by passing extra rules to `resolveStreamHealth`, without editing this file:
 *
 * ```ts
 * const DISPUTED: HealthStatusRule<"Disputed"> = {
 *   status: "Disputed",
 *   // Between Cancelled (500) and Paused (400) → highest non-terminal override.
 *   priority: HEALTH_STATUS_PRIORITY.Paused + 50,
 *   matches: ({ stream }) => stream.disputed === true,
 * };
 *
 * resolveStreamHealth(stream, now, [DISPUTED]); // "Disputed" | StreamHealthStatus
 * ```
 *
 * Rules are evaluated from highest `priority` to lowest; ties keep registration
 * order (defaults first). With no extra rules the output is identical to the
 * original five-status behaviour.
 */

/** Threshold (ms) before end time when we call a stream "Expiring Soon". */
export const EXPIRING_SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export type StreamHealthStatus =
  | "Active"
  | "Expiring Soon"
  | "Expired"
  | "Paused"
  | "Cancelled";

/**
 * Priority of each built-in status — higher wins.
 *
 * Spread `HEALTH_STATUS_PRIORITY.Cancelled + 1` (or another built-in's value
 * ± an offset) to place a custom rule directly above/below a built-in one.
 */
export const HEALTH_STATUS_PRIORITY = {
  Cancelled: 500,
  Paused: 400,
  Expired: 300,
  "Expiring Soon": 200,
  Active: 100,
} as const satisfies Record<StreamHealthStatus, number>;

/**
 * Minimum shape needed to compute health. Both `StreamData` (sorostream.ts)
 * and any future on-chain type satisfy this interface.
 */
export interface HealthStreamInput {
  status: "Active" | "Cancelled" | "Ended" | "Paused";
  endTime: string; // ISO-8601
  startTime?: string; // ISO-8601 (optional, used for cliff logic)
  cliffTime?: string; // ISO-8601 (optional)
}

/** Everything a status rule needs to decide whether it applies. */
export interface HealthRuleContext {
  /** The stream being evaluated. */
  stream: HealthStreamInput;
  /** Current timestamp in ms. */
  now: number;
  /** `stream.endTime` parsed to ms — `NaN` when unparseable. */
  endMs: number;
}

/**
 * A single step in the health-resolution chain.
 *
 * `priority` decides where the rule sits: higher wins. A rule whose `matches`
 * returns false is skipped and evaluation falls through to the next one.
 */
export interface HealthStatusRule<S extends string = StreamHealthStatus> {
  /** Status reported when this rule matches. */
  status: S;
  /** Higher values are evaluated first. See `HEALTH_STATUS_PRIORITY`. */
  priority: number;
  /** Predicate deciding whether the stream reports `status`. */
  matches: (ctx: HealthRuleContext) => boolean;
}

/**
 * The built-in five-status chain, in default priority order. Exposed so
 * callers can inspect or compose it; treat it as immutable.
 */
export const DEFAULT_HEALTH_RULES: readonly HealthStatusRule[] = [
  {
    status: "Cancelled",
    priority: HEALTH_STATUS_PRIORITY.Cancelled,
    matches: ({ stream }) => stream.status === "Cancelled",
  },
  {
    status: "Paused",
    priority: HEALTH_STATUS_PRIORITY.Paused,
    matches: ({ stream }) => stream.status === "Paused",
  },
  {
    status: "Expired",
    priority: HEALTH_STATUS_PRIORITY.Expired,
    // A guard for unparseable endTime also lands here (treated as Expired to
    // avoid silent bugs); status === "Ended" or a passed endTime likewise.
    matches: ({ stream, now, endMs }) =>
      Number.isNaN(endMs) || stream.status === "Ended" || now >= endMs,
  },
  {
    status: "Expiring Soon",
    priority: HEALTH_STATUS_PRIORITY["Expiring Soon"],
    matches: ({ now, endMs }) => endMs - now < EXPIRING_SOON_THRESHOLD_MS,
  },
  {
    status: "Active",
    priority: HEALTH_STATUS_PRIORITY.Active,
    matches: () => true,
  },
];

/**
 * Resolve a stream's health status, optionally with extra application-specific
 * status rules injected into the priority chain (#688).
 *
 * Extra rules never modify the built-in five: when `extraRules` is empty the
 * result is exactly what `getStreamHealth` returns.
 *
 * @param stream      Raw stream data (any object with the fields above).
 * @param now         Current timestamp in ms — injectable for deterministic
 *                    tests. Defaults to `Date.now()`.
 * @param extraRules  Additional status rules. A rule with a priority between
 *                    two built-ins is checked between them.
 * @returns           The highest-priority matching status.
 */
export function resolveStreamHealth<Extra extends string = never>(
  stream: HealthStreamInput,
  now: number = Date.now(),
  extraRules: readonly HealthStatusRule<Extra>[] = [],
): StreamHealthStatus | Extra {
  const ctx: HealthRuleContext = {
    stream,
    now,
    endMs: new Date(stream.endTime).getTime(),
  };

  const ordered = [...DEFAULT_HEALTH_RULES, ...extraRules]
    .map((rule, index) => ({ rule, index }))
    // Highest priority first; ties keep registration order (built-ins first),
    // and Array.prototype.sort is stable in all supported runtimes anyway.
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index);

  for (const { rule } of ordered) {
    if (rule.matches(ctx)) return rule.status;
  }

  // Unreachable while the default "Active" rule is present, but keeps the
  // return type honest if a caller ever filters the default chain.
  return "Active";
}

/**
 * Compute the display health status for a stream.
 *
 * @param stream  Raw stream data (any object with the fields above).
 * @param now     Current timestamp in ms — injectable for deterministic tests.
 *                Defaults to `Date.now()`.
 * @returns       One of the five StreamHealthStatus values.
 */
export function getStreamHealth(
  stream: HealthStreamInput,
  now: number = Date.now(),
): StreamHealthStatus {
  return resolveStreamHealth(stream, now);
}

export interface StreamHealthDetails<S extends string = StreamHealthStatus> {
  /** Same value `resolveStreamHealth` returns; priority order is unchanged. */
  status: S;
  /**
   * True only when the stream is Expired and the recipient still has a
   * nonzero balance to withdraw. False for every other status.
   */
  hasUnclaimedBalance: boolean;
}

/**
 * Compute the health status together with whether an Expired stream still
 * holds an unclaimed balance (#717).
 *
 * @param stream            Raw stream data (any object with the fields above).
 * @param unclaimedStroops  Amount the recipient can still withdraw, in stroops.
 *                          Accepts a number or a numeric string (as returned
 *                          by `claimableNow`). Invalid values count as zero.
 * @param now               Current timestamp in ms. Defaults to `Date.now()`.
 * @param extraRules        Additional status rules (see `resolveStreamHealth`).
 */
export function getStreamHealthDetails<Extra extends string = never>(
  stream: HealthStreamInput,
  unclaimedStroops: number | string | bigint,
  now: number = Date.now(),
  extraRules: readonly HealthStatusRule<Extra>[] = [],
): StreamHealthDetails<StreamHealthStatus | Extra> {
  const status = resolveStreamHealth(stream, now, extraRules);
  return {
    status,
    hasUnclaimedBalance: status === "Expired" && isPositiveAmount(unclaimedStroops),
  };
}

function isPositiveAmount(value: number | string | bigint): boolean {
  if (typeof value === "bigint") return value > BigInt(0);
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * Badge colour mapping — Tailwind classes keyed by StreamHealthStatus.
 * Import this alongside getStreamHealth to keep badge styling co-located with
 * the logic.
 *
 * Application-specific statuses added via `resolveStreamHealth` need their own
 * styling; look them up with a fallback rather than casting into this record.
 */
export const HEALTH_BADGE_CLASSES: Record<StreamHealthStatus, string> = {
  Active: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400",
  "Expiring Soon": "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-400",
  Expired: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
  Paused: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400",
  Cancelled: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400",
};
