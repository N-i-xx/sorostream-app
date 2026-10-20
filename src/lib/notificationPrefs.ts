export interface NotificationEventPrefs {
  /** Notify when a stream finishes fully vesting/streaming. */
  streamCompleted: boolean;
  /** Notify ~24 hours before a stream is scheduled to expire. */
  expiringSoon: boolean;
  /** Notify 24 hours before a stream is scheduled to expire (#76). */
  expiring24h?: boolean;
  /** Notify 1 hour before a stream is scheduled to expire (#76). */
  expiring1h?: boolean;
  /**
   * Extra expiry alert lead times, in hours before expiry (#689).
   * Added on top of the 24h/1h defaults, which stay gated by
   * `expiring24h` / `expiring1h`. Example: `[168]` for a 1-week heads-up.
   */
  expiryThresholdsHours?: number[];
  /** Notify when claimable funds become available to withdraw. */
  withdrawalAvailable: boolean;
  /** Notify when claimable balance crosses a user-configured threshold (#76). */
  claimableThresholdEnabled?: boolean;
  /** User-configured claimable balance threshold in tokens/XLM (#76). */
  claimableThreshold?: number;
  /** Notify when a new incoming stream is received (#523). */
  streamReceived: boolean;
  /** Notify when a sender cancels a stream you are receiving (#523). */
  streamCancelled: boolean;
}

export interface StreamNotificationPref {
  streamId: string;
  enabled: boolean;
  notifyExpiry24h?: boolean;
  notifyExpiry1h?: boolean;
  /**
   * Per-stream override of the extra expiry alert lead times, in hours (#689).
   * When set, it replaces the global `events.expiryThresholdsHours` list for
   * this stream; the 24h/1h defaults still follow their own toggles.
   */
  expiryThresholdsHours?: number[];
  notifyClaimableThreshold?: boolean;
  claimableThreshold?: number;
}

export interface NotificationPrefs {
  /** Master switch — when false, no notifications are sent regardless of the settings below. */
  enabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  email: string;
  events: NotificationEventPrefs;
  /** Per-stream notification preferences keyed by stream ID (#76). */
  streamPrefs?: Record<string, StreamNotificationPref>;
  /** When true, stream state-change events are POSTed to `webhookUrl`. */
  webhookEnabled: boolean;
  /** Destination for webhook POST events (must be an https:// URL). */
  webhookUrl: string;
}

const STORAGE_KEY = "sorostream_notification_prefs";

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  pushEnabled: false,
  emailEnabled: false,
  email: "",
  events: {
    streamCompleted: true,
    expiringSoon: true,
    expiring24h: true,
    expiring1h: true,
    expiryThresholdsHours: [],
    withdrawalAvailable: true,
    claimableThresholdEnabled: true,
    claimableThreshold: 100,
    streamReceived: true,
    streamCancelled: true,
  },
  streamPrefs: {},
  webhookEnabled: false,
  webhookUrl: "",
};

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validate a webhook URL. Requires a secure https:// endpoint (no secrets in
 * plain http), and must be a syntactically valid absolute URL.
 */
export function isValidWebhookUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
}

export function getWebhookConfig(): WebhookConfig {
  const prefs = getNotificationPrefs();
  return { enabled: prefs.webhookEnabled, url: prefs.webhookUrl.trim() };
}

export function setWebhookConfig(next: WebhookConfig): NotificationPrefs {
  const prefs = getNotificationPrefs();
  const updated: NotificationPrefs = {
    ...prefs,
    webhookEnabled: next.enabled && isValidWebhookUrl(next.url),
    webhookUrl: next.url.trim(),
  };
  saveNotificationPrefs(updated);
  return updated;
}

export function getNotificationPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_NOTIFICATION_PREFS;
    return {
      ...DEFAULT_NOTIFICATION_PREFS,
      ...parsed,
      events: { ...DEFAULT_NOTIFICATION_PREFS.events, ...(parsed.events ?? {}) },
      streamPrefs: parsed.streamPrefs ?? {},
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * Get notification preferences for a specific stream (#76).
 * Falls back to global defaults when not explicitly configured.
 */
export function getStreamNotificationPref(streamId: string): StreamNotificationPref {
  const prefs = getNotificationPrefs();
  const existing = prefs.streamPrefs?.[streamId];
  if (existing) return existing;
  return {
    streamId,
    enabled: true,
    notifyExpiry24h: prefs.events.expiring24h ?? true,
    notifyExpiry1h: prefs.events.expiring1h ?? true,
    notifyClaimableThreshold: prefs.events.claimableThresholdEnabled ?? true,
    claimableThreshold: prefs.events.claimableThreshold ?? 100,
    expiryThresholdsHours: prefs.events.expiryThresholdsHours ?? [],
  };
}

/**
 * Update notification preferences for a specific stream (#76).
 */
export function setStreamNotificationPref(
  streamId: string,
  pref: Partial<StreamNotificationPref>,
): NotificationPrefs {
  const prefs = getNotificationPrefs();
  const current = getStreamNotificationPref(streamId);
  const updatedPref: StreamNotificationPref = {
    ...current,
    ...pref,
    streamId,
  };
  const updated: NotificationPrefs = {
    ...prefs,
    streamPrefs: {
      ...(prefs.streamPrefs ?? {}),
      [streamId]: updatedPref,
    },
  };
  saveNotificationPrefs(updated);
  return updated;
}

// ── Expiry alert thresholds (#689) ───────────────────────────────────────────

/** Upper bound for a user-configured lead time — one year. */
export const MAX_EXPIRY_THRESHOLD_HOURS = 24 * 365;

/**
 * Keep only valid, positive, finite hour values, drop duplicates, and sort
 * widest-first (largest lead time first).
 */
export function normalizeExpiryThresholdHours(values: readonly unknown[]): number[] {
  const cleaned: number[] = [];
  for (const raw of values) {
    const hours = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_EXPIRY_THRESHOLD_HOURS) continue;
    if (!cleaned.includes(hours)) cleaned.push(hours);
  }
  return cleaned.sort((a, b) => b - a);
}

/**
 * Parse user input such as `"168, 24, 1"` (commas, spaces, or semicolons) into
 * a clean, de-duplicated, widest-first hour list. Invalid entries are dropped.
 */
export function parseExpiryThresholdHours(input: string): number[] {
  return normalizeExpiryThresholdHours(
    input.split(/[\s,;]+/).filter((token) => token.length > 0),
  );
}

/**
 * Resolve the expiry alert lead times (in hours before expiry) that apply to a
 * stream, widest first (#689).
 *
 * The built-in 24h/1h alerts are included unless their toggles disable them;
 * user-configured thresholds are added on top. A per-stream
 * `expiryThresholdsHours` list replaces the global one for that stream.
 *
 * Returns `[24, 1]` out of the box — identical to the pre-#689 behaviour.
 */
export function resolveExpiryThresholdHours(
  prefs: NotificationPrefs,
  streamPref?: StreamNotificationPref,
): number[] {
  const events = prefs.events;

  const builtIn: number[] = [];
  if ((streamPref?.notifyExpiry24h ?? true) && (events.expiring24h ?? events.expiringSoon ?? true)) {
    builtIn.push(24);
  }
  if ((streamPref?.notifyExpiry1h ?? true) && (events.expiring1h ?? true)) {
    builtIn.push(1);
  }

  const configured = streamPref?.expiryThresholdsHours ?? events.expiryThresholdsHours ?? [];
  return normalizeExpiryThresholdHours([...builtIn, ...configured]);
}

/** True when the browser supports the Notification API at all. */
export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Requests browser push permission. Resolves to the resulting permission state. */
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}
