"use client";

/**
 * StatusBadge
 *
 * A colour-coded pill badge that communicates the lifecycle state of a stream
 * at a glance. Extracted from StreamCard so it can also be used in tables,
 * lists, and other summary views without pulling in the full card.
 *
 * Supported statuses and their colour semantics:
 *   Active    → green  (funds are flowing)
 *   Paused    → amber  (temporarily frozen)
 *   Completed → blue   (all funds distributed)
 *   Ended     → blue   (alias for Completed)
 *   Cancelled → red    (stream terminated early)
 *   Scheduled → blue/pulse (stream is queued but not yet started)
 *   default   → gray   (unknown / unrecognised status)
 */

export type StreamStatus =
  | "Active"
  | "Paused"
  | "Completed"
  | "Ended"
  | "Cancelled"
  | "Scheduled"
  | "Not Started"
  | (string & Record<never, never>); // allow arbitrary strings while keeping IntelliSense

export interface StatusBadgeProps {
  /** Stream lifecycle status string. */
  status: StreamStatus;
  /**
   * When true, renders a slightly smaller badge suitable for compact layouts
   * such as tables or list items.
   * @default false
   */
  compact?: boolean;
}

const STATUS_CLASSES: Record<string, string> = {
  Active:
    "bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100",
  Paused:
    "bg-amber-100 dark:bg-amber-900 text-amber-950 dark:text-amber-100",
  Completed:
    "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100",
  Ended:
    "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100",
  Cancelled:
    "bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100",
  Scheduled:
    "bg-blue-900 text-blue-100 border border-blue-700",
  "Not Started":
    "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100",
};

const STATUS_ICONS: Record<string, string> = {
  Active: "●",
  Paused: "⏸",
  Completed: "✓",
  Ended: "✓",
  Cancelled: "✕",
  Scheduled: "◷",
  "Not Started": "◷",
};

/** Return the Tailwind classes for a given status, falling back to gray. */
function badgeClasses(status: string): string {
  return (
    STATUS_CLASSES[status] ??
    "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
  );
}

export default function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  const icon = STATUS_ICONS[status] ?? "";
  const sizeClasses = compact ? "text-xs px-1.5 py-0.5" : "text-xs px-2 py-1";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses} ${badgeClasses(status)}`}
      aria-label={`Status: ${status}`}
      role="status"
    >
      {icon && (
        <span aria-hidden="true" className="leading-none">
          {icon}
        </span>
      )}
      {status}
    </span>
  );
}
