/**
 * Stream Notification Watcher (#76, #689)
 *
 * Monitors streams in real-time and dispatches browser push notifications
 * via the service worker when:
 *   1. A stream is a configured number of hours before expiry — 24h and 1h by
 *      default, plus any extra lead times the user configures (#689).
 *   2. Claimable balance crosses a user-configured threshold.
 *
 * Honors per-stream and global notification preferences.
 * Notifications are dispatched via the Service Worker so they display
 * reliably even when the tab is in the background.
 */

import {
  getNotificationPrefs,
  getStreamNotificationPref,
  isPushSupported,
  resolveExpiryThresholdHours,
} from "./notificationPrefs";
import { dispatchPushNotification } from "./pushSubscription";
import {
  getStreamsForWallet,
  claimableNow,
  formatStellarAmount,
  type StreamData,
} from "./sorostream";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Format a lead time in hours as human-readable text: `24` → "24 hours",
 * `48` → "2 days", `168` → "7 days", `0.5` → "0.5 hours".
 *
 * Whole days are only used above 24h so the default "24 hours" wording of the
 * pre-#689 24-hour alert is preserved.
 */
export function formatExpiryLeadTime(hours: number): string {
  if (hours > 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * Stable short key for a threshold, used in the localStorage dedupe key and
 * the notification tag. `24` → "24h" — matching the keys written before
 * thresholds were configurable, so already-notified users don't get repeats.
 */
export function expiryThresholdKey(hours: number): string {
  return `${hours}h`;
}

/**
 * Pick the narrowest configured threshold that still covers the time left.
 *
 * With the defaults `[24, 1]`, 20 hours remaining yields `24` while 30 minutes
 * remaining yields `1` — so a stream never fires both alerts in one pass.
 * Returns `undefined` when no threshold applies yet.
 *
 * @param thresholdHours  Threshold list in hours; order does not matter (see
 *                        `resolveExpiryThresholdHours`).
 * @param hoursRemaining  Hours until the stream expires; may be fractional.
 */
export function selectDueExpiryThreshold(
  thresholdHours: readonly number[],
  hoursRemaining: number,
): number | undefined {
  if (!Number.isFinite(hoursRemaining) || hoursRemaining <= 0) return undefined;
  let due: number | undefined;
  for (const hours of thresholdHours) {
    if (hoursRemaining <= hours && (due === undefined || hours < due)) {
      due = hours;
    }
  }
  return due;
}

/**
 * Evaluates all user streams against expiry and claimable threshold criteria,
 * dispatching push notifications via the service worker when criteria are met.
 *
 * Will NOT prompt for permission — only runs if permission is already granted.
 */
export async function checkStreamNotifications(providedStreams?: StreamData[]): Promise<void> {
  if (typeof window === "undefined") return;
  if (!isPushSupported() || Notification.permission !== "granted") return;

  const prefs = getNotificationPrefs();
  if (!prefs.enabled || !prefs.pushEnabled) return;

  const streams = providedStreams ?? getStreamsForWallet(null);
  const now = Date.now();

  for (const stream of streams) {
    if (stream.status === "Cancelled" || stream.status === "Ended") continue;

    const streamPref = getStreamNotificationPref(stream.id);
    if (!streamPref.enabled) continue;

    // 1. Expiry alerts at each configured lead time (#689)
    const endMs = new Date(stream.endTime).getTime();
    if (!isNaN(endMs)) {
      const hoursRemaining = (endMs - now) / HOUR_MS;
      const thresholds = resolveExpiryThresholdHours(prefs, streamPref);
      const dueHours = selectDueExpiryThreshold(thresholds, hoursRemaining);

      if (dueHours !== undefined) {
        const thresholdKey = expiryThresholdKey(dueHours);
        const notifiedKey = `sorostream_notified_${stream.id}_${thresholdKey}_${stream.endTime}`;
        if (!localStorage.getItem(notifiedKey)) {
          localStorage.setItem(notifiedKey, "true");
          void dispatchPushNotification({
            title: `Stream #${stream.id} Expiring Soon`,
            body: `Stream #${stream.id} (${stream.token}) is scheduled to expire in ${formatExpiryLeadTime(dueHours)}.`,
            tag: `stream-expiry-${thresholdKey}-${stream.id}`,
            url: `/stream/${stream.id}`,
          });
        }
      }
    }

    // 2. Claimable balance threshold alerts
    const allowClaimable =
      (streamPref.notifyClaimableThreshold ?? true) &&
      (prefs.events.claimableThresholdEnabled ?? prefs.events.withdrawalAvailable ?? true);

    if (allowClaimable) {
      const threshold =
        streamPref.claimableThreshold ?? prefs.events.claimableThreshold ?? 100;
      const claimableRaw = Number(claimableNow(stream));
      const claimableTokens = claimableRaw / 10_000_000;
      const isCrossed =
        claimableTokens >= threshold || (threshold > 100_000 && claimableRaw >= threshold);

      const keyClaimable = `sorostream_notified_claimable_${stream.id}_${threshold}`;

      if (isCrossed) {
        if (!localStorage.getItem(keyClaimable)) {
          localStorage.setItem(keyClaimable, "true");
          const formatted = formatStellarAmount(claimableRaw);
          void dispatchPushNotification({
            title: "Withdrawal Available",
            body: `Claimable balance on Stream #${stream.id} has reached ${formatted} ${stream.token}.`,
            tag: `stream-claimable-${stream.id}`,
            url: `/stream/${stream.id}`,
          });
        }
      } else {
        // Reset when balance drops below threshold (e.g. following a withdrawal)
        localStorage.removeItem(keyClaimable);
      }
    }
  }
}
