/**
 * Web Push subscription management (#523, #690)
 *
 * Handles the full lifecycle of a Web Push subscription:
 *   1. Register (or retrieve) the service worker.
 *   2. Subscribe to push messages using the server's VAPID public key.
 *   3. Store the subscription in localStorage for later reference.
 *   4. Provide helpers to unsubscribe and to send a local push via the SW.
 *   5. Detect when push is configured but missing on the current device (#690).
 *
 * In production, the PushSubscription object would be sent to a back-end
 * endpoint that stores it and later calls `webpush.sendNotification()`.  For
 * the current mock implementation we rely on the service worker's
 * `showNotification()` directly via the broadcast channel so the full code
 * path is exercisable without a server.
 *
 * ## Per-device limitation (#690)
 *
 * A push subscription is inherently per-browser/per-device: it is created by
 * the device's `PushManager`, tied to that browser's push service endpoint,
 * and here persisted only in that browser's `localStorage`
 * (`SUBSCRIPTION_STORAGE_KEY`). It does NOT follow the user across devices,
 * browsers, private windows, or after site data is cleared — unlike the
 * notification *preferences*, which only record the user's intent.
 *
 * Consequences:
 *   - Every new device needs its own "enable push" step.
 *   - Clearing site data silently drops the subscription while the preference
 *     still says push is on, so the user stops receiving alerts without any
 *     error.
 *   - There is no account-level registry of devices here: true cross-device
 *     sync requires a server-side `account → [subscriptions]` table (the
 *     production `/api/push/subscribe` endpoint).
 *
 * Until that exists, `getPushSetupStatus()` compares the saved preference and
 * this device's stored subscription record against the live `PushManager`
 * subscription, so the UI can tell the user "push is configured, but not on
 * this device" and offer a one-tap re-subscribe. `notifyPushNotConfiguredOnDevice`
 * message copy lives in `PUSH_NOT_ON_THIS_DEVICE_MESSAGE`.
 */

import { getNotificationPrefs } from "./notificationPrefs";

const SW_PATH = "/sw.js";
const SUBSCRIPTION_STORAGE_KEY = "sorostream_push_subscription";
/** Metadata about the subscription created by *this* browser (#690). */
const DEVICE_RECORD_STORAGE_KEY = "sorostream_push_device";
/** Stable id for this browser instance, used to tell devices apart (#690). */
const DEVICE_ID_STORAGE_KEY = "sorostream_push_device_id";

/** VAPID public key from environment. Defaults to an empty string when absent. */
export const VAPID_PUBLIC_KEY =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")
    : "";

/** True when the browser supports all the APIs required for Web Push. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Convert a URL-safe base64 VAPID public key to the Uint8Array that
 *  PushManager.subscribe() expects as `applicationServerKey`. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Register the service worker (idempotent) and return its registration.
 * Throws if service workers are not supported.
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  // Use an existing registration if available, otherwise register.
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH);
}

/**
 * Subscribe the current browser to Web Push notifications.
 *
 * Returns the serialised PushSubscription so callers can POST it to the
 * server.  In the mock implementation we just persist it locally.
 *
 * Throws when:
 *   - The browser doesn't support Web Push.
 *   - Notification permission is denied.
 *   - No VAPID public key is configured.
 */
export async function subscribeToPush(): Promise<PushSubscription> {
  if (!isWebPushSupported()) {
    throw new Error("Web Push is not supported in this browser.");
  }
  if (Notification.permission === "denied") {
    throw new Error(
      "Notification permission was denied. Enable it in your browser settings.",
    );
  }
  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      throw new Error(
        "Notification permission was denied. Enable it in your browser settings.",
      );
    }
  }

  const registration = await getServiceWorkerRegistration();

  // Unsubscribe any stale subscription before creating a fresh one.
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();

  const subscribeOptions: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    ...(VAPID_PUBLIC_KEY
      ? { applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource }
      : {}),
  };

  const subscription = await registration.pushManager.subscribe(subscribeOptions);

  // Persist locally (production would POST to /api/push/subscribe).
  try {
    localStorage.setItem(
      SUBSCRIPTION_STORAGE_KEY,
      JSON.stringify(subscription.toJSON()),
    );
  } catch {
    // Non-fatal — the active subscription object is what matters.
  }

  // Record that *this* device is subscribed, so a later visit can tell that
  // push is configured here (#690).
  storePushDeviceRecord(subscription.endpoint);

  return subscription;
}

/**
 * Unsubscribe the current browser from Web Push notifications and clear the
 * locally stored subscription.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  try {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY);
    localStorage.removeItem(DEVICE_RECORD_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Returns the active PushSubscription for this browser, or null when not
 * subscribed.
 */
export async function getActivePushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

// ── Per-device push setup detection (#690) ───────────────────────────────────

/** Message shown when push is configured but this device has no subscription. */
export const PUSH_NOT_ON_THIS_DEVICE_MESSAGE =
  "Push notifications aren't set up on this device. Your notification settings " +
  "show push as enabled, but this browser has no active push subscription — " +
  "this happens on a new device, in a different browser, or after clearing " +
  "site data.";

/** Message shown when the browser has blocked notifications for the site. */
export const PUSH_PERMISSION_BLOCKED_MESSAGE =
  "Push notifications are blocked for this site in your browser settings, so " +
  "alerts won't arrive on this device.";

/** Metadata about the subscription this browser created. */
export interface PushDeviceRecord {
  /** Stable id for this browser; changes only when local storage is cleared. */
  deviceId: string;
  /** Push endpoint the browser was subscribed to. */
  endpoint: string;
  /** ISO timestamp of when this device subscribed. */
  subscribedAt: string;
}

/**
 * Why push is (or isn't) active on this device.
 *
 * - `unsupported`             – the browser lacks the Web Push APIs.
 * - `permission-denied`       – the user blocked notifications for the site.
 * - `subscribed`              – this device has a live push subscription.
 * - `missing-on-this-device`  – push is enabled in preferences (or was set up
 *                               before) but this device has no subscription.
 * - `not-configured`          – push has never been enabled.
 */
export type PushSetupState =
  | "unsupported"
  | "permission-denied"
  | "subscribed"
  | "missing-on-this-device"
  | "not-configured";

export interface PushSetupStatus {
  state: PushSetupState;
  /**
   * True when something (preferences, or a previously stored subscription
   * record) indicates push was set up somewhere, yet this device has no live
   * subscription.
   */
  configuredElsewhere: boolean;
  /** `prefs.pushEnabled` at the time of the check. */
  pushEnabledInPrefs: boolean;
  /** Whether a subscription record from an earlier visit exists locally. */
  hasStoredDeviceRecord: boolean;
  /** Copy suitable for a banner/toast; null when nothing needs surfacing. */
  message: string | null;
}

/** Read the device record written the last time this browser subscribed. */
export function getPushDeviceRecord(): PushDeviceRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DEVICE_RECORD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PushDeviceRecord> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.endpoint !== "string") {
      return null;
    }
    return {
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : "unknown-device",
      endpoint: parsed.endpoint,
      subscribedAt:
        typeof parsed.subscribedAt === "string" ? parsed.subscribedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Clear the device record without touching the push subscription itself. */
export function clearPushDeviceRecord(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DEVICE_RECORD_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/** Stable id for this browser, created on first use. */
export function getOrCreatePushDeviceId(): string {
  if (typeof window === "undefined") return "unknown-device";
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "unknown-device";
  }
}

/** Persist the record for the subscription this browser just created. */
function storePushDeviceRecord(endpoint: string): void {
  try {
    const record: PushDeviceRecord = {
      deviceId: getOrCreatePushDeviceId(),
      endpoint,
      subscribedAt: new Date().toISOString(),
    };
    localStorage.setItem(DEVICE_RECORD_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Non-fatal — detection degrades to "preference only".
  }
}

/**
 * Determine whether push notifications are actually working on *this* device.
 *
 * Reads the saved notification preference (intent) and this browser's stored
 * subscription record, then checks the live `PushManager` subscription — the
 * only thing that actually delivers notifications here. Never prompts for
 * permission. See the per-device limitation note in the module header.
 */
export async function getPushSetupStatus(): Promise<PushSetupStatus> {
  const pushEnabledInPrefs = getNotificationPrefs().pushEnabled;
  const hasStoredDeviceRecord = getPushDeviceRecord() !== null;

  if (!isWebPushSupported()) {
    return {
      state: "unsupported",
      configuredElsewhere: false,
      pushEnabledInPrefs,
      hasStoredDeviceRecord,
      message: "Push notifications aren't supported in this browser.",
    };
  }

  if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    return {
      state: "permission-denied",
      configuredElsewhere: false,
      pushEnabledInPrefs,
      hasStoredDeviceRecord,
      message: PUSH_PERMISSION_BLOCKED_MESSAGE,
    };
  }

  const subscription = await getActivePushSubscription();
  if (subscription) {
    return {
      state: "subscribed",
      configuredElsewhere: false,
      pushEnabledInPrefs,
      hasStoredDeviceRecord,
      message: null,
    };
  }

  // No live subscription: distinguish "never enabled" from "enabled, but
  // this device is missing it". The preference can legitimately be on while
  // this browser never subscribed (new device / synced prefs).
  const configuredElsewhere = pushEnabledInPrefs || hasStoredDeviceRecord;
  return {
    state: configuredElsewhere ? "missing-on-this-device" : "not-configured",
    configuredElsewhere,
    pushEnabledInPrefs,
    hasStoredDeviceRecord,
    message: configuredElsewhere ? PUSH_NOT_ON_THIS_DEVICE_MESSAGE : null,
  };
}

// ── Local notification dispatch ──────────────────────────────────────────────
// In the absence of a real push server, we send notifications by posting a
// message directly to the service worker, which then calls showNotification().

export interface PushPayload {
  title: string;
  body: string;
  /** Icon path relative to the public directory. */
  icon?: string;
  /** Badge path relative to the public directory. */
  badge?: string;
  /** Absolute or relative URL to open when the notification is clicked. */
  url?: string;
  /** Arbitrary tag used to deduplicate or replace a previous notification. */
  tag?: string;
  renotify?: boolean;
}

/**
 * Dispatch a visible notification via the service worker (#76).
 * The SW listens for `sorostream-show-notification` messages and calls `self.registration.showNotification()`.
 * This allows notifications to be displayed even when the tab is in the background.
 *
 * Falls back to direct service worker registration showNotification or Notification API.
 */
export async function dispatchPushNotification(payload: PushPayload): Promise<void> {
  if (typeof window === "undefined") return;
  if (!isWebPushSupported()) return;
  if (Notification.permission !== "granted") return;

  try {
    const registration =
      (await navigator.serviceWorker.ready.catch(() => null)) ??
      (await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null));

    if (registration) {
      if (registration.active) {
        registration.active.postMessage({
          type: "sorostream-show-notification",
          payload,
        });
        return;
      }
      // Show notification directly on the service worker registration (works in background)
      await registration.showNotification(payload.title, {
        body: payload.body,
        icon: payload.icon ?? "/icons/icon-192.png",
        badge: payload.badge ?? "/icons/icon-192.png",
        tag: payload.tag,
        data: { url: payload.url ?? "/dashboard" },
      });
      return;
    }
  } catch (err) {
    // Non-fatal — proceed to Notification fallback
  }

  // Fallback: direct Notification API (tab must be in focus for this to work).
  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? "/icons/icon-192.png",
      tag: payload.tag,
    });
  } catch {
    // Silently ignore — notifications are non-critical.
  }
}
