/**
 * Tests for configurable expiry notification thresholds (#689).
 *
 * Covers both the pure threshold-resolution helpers and the end-to-end
 * dispatch path through `checkStreamNotifications`, with the service worker
 * push transport mocked out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  normalizeExpiryThresholdHours,
  parseExpiryThresholdHours,
  resolveExpiryThresholdHours,
  saveNotificationPrefs,
  setStreamNotificationPref,
  type NotificationEventPrefs,
  type NotificationPrefs,
} from "../notificationPrefs";
import {
  checkStreamNotifications,
  expiryThresholdKey,
  formatExpiryLeadTime,
  selectDueExpiryThreshold,
} from "../streamNotificationWatcher";
import type { StreamData } from "../sorostream";

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

vi.mock("../pushSubscription", () => ({
  dispatchPushNotification: dispatchMock,
}));

const HOUR = 60 * 60 * 1000;

/** Build a StreamData with `hoursRemaining` hours left before expiry. */
function makeStream(hoursRemaining: number, overrides: Partial<StreamData> = {}): StreamData {
  const now = Date.now();
  return {
    id: "42",
    sender: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    recipient: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    token: "XLM",
    flowRate: 0,
    deposit: 0,
    startTime: new Date(now - 24 * HOUR).toISOString(),
    endTime: new Date(now + hoursRemaining * HOUR).toISOString(),
    lastWithdrawTime: new Date(now).toISOString(),
    status: "Active",
    ...overrides,
  };
}

type PrefsOverrides = Partial<Omit<NotificationPrefs, "events">> & {
  events?: Partial<NotificationEventPrefs>;
};

function savePrefs(overrides: PrefsOverrides = {}) {
  saveNotificationPrefs({
    ...DEFAULT_NOTIFICATION_PREFS,
    pushEnabled: true,
    ...overrides,
    events: { ...DEFAULT_NOTIFICATION_PREFS.events, ...(overrides.events ?? {}) },
    streamPrefs: overrides.streamPrefs ?? {},
  });
}

const originalNotification = globalThis.Notification;

/** Install a minimal Notification stub — the watcher only reads `permission`. */
function stubNotificationPermission(permission: NotificationPermission) {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: { permission } as unknown as typeof Notification,
  });
}

beforeEach(() => {
  localStorage.clear();
  dispatchMock.mockReset();
  stubNotificationPermission("granted");
});

afterEach(() => {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: originalNotification,
  });
});

// ---------------------------------------------------------------------------
// Threshold resolution
// ---------------------------------------------------------------------------

describe("resolveExpiryThresholdHours", () => {
  it("defaults to the 24h and 1h thresholds", () => {
    expect(resolveExpiryThresholdHours(DEFAULT_NOTIFICATION_PREFS)).toEqual([24, 1]);
  });

  it("adds a configured custom threshold alongside the defaults", () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      events: { ...DEFAULT_NOTIFICATION_PREFS.events, expiryThresholdsHours: [168] },
    };
    expect(resolveExpiryThresholdHours(prefs)).toEqual([168, 24, 1]);
  });

  it("yields only the custom threshold when the built-ins are switched off", () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      events: {
        ...DEFAULT_NOTIFICATION_PREFS.events,
        expiring24h: false,
        expiring1h: false,
        expiryThresholdsHours: [168],
      },
    };
    expect(resolveExpiryThresholdHours(prefs)).toEqual([168]);
  });

  it("honours the per-stream 24h/1h toggles", () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS };
    const streamPref = {
      streamId: "42",
      enabled: true,
      notifyExpiry24h: false,
      notifyExpiry1h: true,
    };
    expect(resolveExpiryThresholdHours(prefs, streamPref)).toEqual([1]);
  });

  it("lets a per-stream list replace the global list", () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      events: { ...DEFAULT_NOTIFICATION_PREFS.events, expiryThresholdsHours: [168] },
    };
    const streamPref = {
      streamId: "42",
      enabled: true,
      expiryThresholdsHours: [72],
    };
    expect(resolveExpiryThresholdHours(prefs, streamPref)).toEqual([72, 24, 1]);
  });

  it("drops invalid configured values instead of throwing", () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      events: {
        ...DEFAULT_NOTIFICATION_PREFS.events,
        expiryThresholdsHours: [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 12],
      },
    };
    expect(resolveExpiryThresholdHours(prefs)).toEqual([24, 12, 1]);
  });
});

describe("parseExpiryThresholdHours", () => {
  it("parses comma/space separated input into a deduped, widest-first list", () => {
    expect(parseExpiryThresholdHours("168, 24 1")).toEqual([168, 24, 1]);
    expect(parseExpiryThresholdHours("48;48, 12")).toEqual([48, 12]);
  });

  it("returns an empty list for empty or invalid input", () => {
    expect(parseExpiryThresholdHours("")).toEqual([]);
    expect(parseExpiryThresholdHours("  ")).toEqual([]);
    expect(parseExpiryThresholdHours("abc, -1, 0")).toEqual([]);
  });

  it("caps absurd lead times (more than a year)", () => {
    expect(normalizeExpiryThresholdHours([24 * 366, 24])).toEqual([24]);
  });
});

describe("selectDueExpiryThreshold", () => {
  const thresholds = [168, 24, 1];

  it("returns nothing while the stream is further out than the widest threshold", () => {
    expect(selectDueExpiryThreshold(thresholds, 200)).toBeUndefined();
  });

  it("returns the widest threshold while only it applies", () => {
    expect(selectDueExpiryThreshold(thresholds, 100)).toBe(168);
    expect(selectDueExpiryThreshold([24, 1], 20)).toBe(24);
  });

  it("returns the narrowest applicable threshold so alerts never double-fire", () => {
    expect(selectDueExpiryThreshold(thresholds, 0.5)).toBe(1);
    expect(selectDueExpiryThreshold([24, 1], 0.5)).toBe(1);
  });

  it("is order-independent", () => {
    expect(selectDueExpiryThreshold([1, 24], 0.5)).toBe(1);
    expect(selectDueExpiryThreshold([24, 1], 0.5)).toBe(1);
  });

  it("returns nothing for expired or non-finite values", () => {
    expect(selectDueExpiryThreshold(thresholds, 0)).toBeUndefined();
    expect(selectDueExpiryThreshold(thresholds, -3)).toBeUndefined();
    expect(selectDueExpiryThreshold(thresholds, Number.NaN)).toBeUndefined();
  });
});

describe("threshold formatting", () => {
  it("formats lead times as hours or whole days", () => {
    expect(formatExpiryLeadTime(1)).toBe("1 hour");
    expect(formatExpiryLeadTime(24)).toBe("24 hours");
    expect(formatExpiryLeadTime(168)).toBe("7 days");
    expect(formatExpiryLeadTime(0.5)).toBe("0.5 hours");
  });

  it("keeps the pre-#689 dedupe keys for the default thresholds", () => {
    expect(expiryThresholdKey(24)).toBe("24h");
    expect(expiryThresholdKey(1)).toBe("1h");
  });
});

// ---------------------------------------------------------------------------
// Dispatch behaviour
// ---------------------------------------------------------------------------

describe("checkStreamNotifications — expiry thresholds", () => {
  it("fires the default 24h alert for a stream 20 hours from expiry", async () => {
    savePrefs();
    await checkStreamNotifications([makeStream(20)]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({
      tag: "stream-expiry-24h-42",
      body: expect.stringContaining("in 24 hours"),
    });
  });

  it("fires only the 1h alert when less than an hour remains", async () => {
    savePrefs();
    await checkStreamNotifications([makeStream(0.25)]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({ tag: "stream-expiry-1h-42" });
  });

  it("does not re-notify for the same threshold and stream end time", async () => {
    savePrefs();
    const stream = makeStream(20);

    await checkStreamNotifications([stream]);
    await checkStreamNotifications([stream]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("fires a custom threshold instead of the defaults when they are disabled", async () => {
    savePrefs({
      events: { expiring24h: false, expiring1h: false, expiryThresholdsHours: [168] },
    });
    await checkStreamNotifications([makeStream(100)]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({
      title: "Stream #42 Expiring Soon",
      body: expect.stringContaining("in 7 days"),
      tag: "stream-expiry-168h-42",
    });
  });

  it("fires a custom threshold alongside the defaults", async () => {
    savePrefs({ events: { expiryThresholdsHours: [168] } });

    await checkStreamNotifications([makeStream(100)]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({ tag: "stream-expiry-168h-42" });

    // Later, the 24h default takes over for the same stream.
    const closer = makeStream(20);
    await checkStreamNotifications([closer]);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[1][0]).toMatchObject({ tag: "stream-expiry-24h-42" });
  });

  it("uses the per-stream custom threshold for that stream", async () => {
    savePrefs();
    setStreamNotificationPref("42", { expiryThresholdsHours: [72] });
    savePrefs({ streamPrefs: { "42": { streamId: "42", enabled: true, expiryThresholdsHours: [72] } } });

    await checkStreamNotifications([makeStream(50)]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({ tag: "stream-expiry-72h-42" });
  });

  it("sends nothing when push permission has not been granted", async () => {
    savePrefs();
    stubNotificationPermission("default");

    await checkStreamNotifications([makeStream(20)]);

    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
