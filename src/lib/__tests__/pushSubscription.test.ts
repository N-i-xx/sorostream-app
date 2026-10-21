/**
 * Tests for per-device push subscription detection (#690).
 *
 * The Web Push APIs don't exist in jsdom, so each test installs the smallest
 * set of fakes needed: navigator.serviceWorker, PushManager and Notification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PUSH_NOT_ON_THIS_DEVICE_MESSAGE,
  PUSH_PERMISSION_BLOCKED_MESSAGE,
  clearPushDeviceRecord,
  getOrCreatePushDeviceId,
  getPushDeviceRecord,
  getPushSetupStatus,
  subscribeToPush,
  unsubscribeFromPush,
} from "../pushSubscription";
import { DEFAULT_NOTIFICATION_PREFS, saveNotificationPrefs } from "../notificationPrefs";

interface PushApisOptions {
  permission?: NotificationPermission;
  /** Result of navigator.serviceWorker.getRegistration(). */
  registration?: unknown;
  /** Result of registration.pushManager.getSubscription(). */
  subscription?: unknown;
  /** When false, PushManager is removed to simulate an unsupported browser. */
  supported?: boolean;
}

const originalNotification = globalThis.Notification;
const originalPushManager = (window as unknown as { PushManager?: unknown }).PushManager;
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

function fakeSubscription(endpoint = "https://push.example.com/abc") {
  return {
    endpoint,
    toJSON: () => ({ endpoint }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

function installPushApis({
  permission = "granted",
  registration = null,
  subscription = null,
  supported = true,
}: PushApisOptions = {}) {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: { permission, requestPermission: vi.fn().mockResolvedValue(permission) },
  });

  if (supported) {
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      writable: true,
      value: class PushManager {},
    });
  } else {
    Reflect.deleteProperty(window, "PushManager");
  }

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      register: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    },
  });
}

/** A service worker registration whose push manager already has a subscription. */
function registrationWith(subscription: unknown) {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn().mockResolvedValue(subscription),
    },
  };
}

function savePrefs(pushEnabled: boolean) {
  saveNotificationPrefs({ ...DEFAULT_NOTIFICATION_PREFS, pushEnabled });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: originalNotification,
  });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    writable: true,
    value: originalPushManager,
  });
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("getPushSetupStatus", () => {
  it("reports 'unsupported' when the browser lacks the Web Push APIs", async () => {
    installPushApis({ supported: false });

    const status = await getPushSetupStatus();

    expect(status.state).toBe("unsupported");
    expect(status.configuredElsewhere).toBe(false);
    expect(status.message).toMatch(/aren't supported/i);
  });

  it("reports 'permission-denied' when notifications are blocked", async () => {
    installPushApis({ permission: "denied", registration: registrationWith(null) });

    const status = await getPushSetupStatus();

    expect(status.state).toBe("permission-denied");
    expect(status.message).toBe(PUSH_PERMISSION_BLOCKED_MESSAGE);
  });

  it("reports 'subscribed' when this device has a live push subscription", async () => {
    installPushApis({ registration: registrationWith(fakeSubscription()) });
    savePrefs(true);

    const status = await getPushSetupStatus();

    expect(status.state).toBe("subscribed");
    expect(status.configuredElsewhere).toBe(false);
    expect(status.message).toBeNull();
  });

  it("reports 'not-configured' when push was never enabled anywhere", async () => {
    installPushApis({ registration: registrationWith(null) });
    savePrefs(false);

    const status = await getPushSetupStatus();

    expect(status.state).toBe("not-configured");
    expect(status.configuredElsewhere).toBe(false);
    expect(status.hasStoredDeviceRecord).toBe(false);
    expect(status.message).toBeNull();
  });

  it("surfaces the missing-device state when preferences say push is on", async () => {
    // Simulates a new device / cleared site data: the preference travelled,
    // but this browser never subscribed.
    installPushApis({ registration: registrationWith(null) });
    savePrefs(true);

    const status = await getPushSetupStatus();

    expect(status.state).toBe("missing-on-this-device");
    expect(status.configuredElsewhere).toBe(true);
    expect(status.pushEnabledInPrefs).toBe(true);
    expect(status.hasStoredDeviceRecord).toBe(false);
    expect(status.message).toBe(PUSH_NOT_ON_THIS_DEVICE_MESSAGE);
  });

  it("surfaces the missing-device state when a stored subscription record is gone", async () => {
    installPushApis({ registration: registrationWith(null) });
    savePrefs(false);
    localStorage.setItem(
      "sorostream_push_device",
      JSON.stringify({
        deviceId: "device-1",
        endpoint: "https://push.example.com/old",
        subscribedAt: new Date(0).toISOString(),
      }),
    );

    const status = await getPushSetupStatus();

    expect(status.state).toBe("missing-on-this-device");
    expect(status.configuredElsewhere).toBe(true);
    expect(status.hasStoredDeviceRecord).toBe(true);
    expect(status.pushEnabledInPrefs).toBe(false);
  });

  it("treats a missing service worker registration as 'not subscribed'", async () => {
    installPushApis({ registration: undefined });
    savePrefs(false);

    await expect(getPushSetupStatus()).resolves.toMatchObject({
      state: "not-configured",
    });
  });
});

describe("device record lifecycle", () => {
  it("records this device's subscription when subscribing", async () => {
    const subscription = fakeSubscription("https://push.example.com/new");
    installPushApis({ registration: registrationWith(subscription) });

    await subscribeToPush();

    const record = getPushDeviceRecord();
    expect(record).not.toBeNull();
    expect(record?.endpoint).toBe("https://push.example.com/new");
    expect(record?.deviceId).toBeTruthy();
    expect(Number.isNaN(Date.parse(record!.subscribedAt))).toBe(false);

    // …and detection now reports a live subscription on this device.
    await expect(getPushSetupStatus()).resolves.toMatchObject({ state: "subscribed" });
  });

  it("clears the record when unsubscribing", async () => {
    const subscription = fakeSubscription();
    installPushApis({ registration: registrationWith(subscription) });
    localStorage.setItem(
      "sorostream_push_device",
      JSON.stringify({
        deviceId: "device-1",
        endpoint: subscription.endpoint,
        subscribedAt: new Date().toISOString(),
      }),
    );

    await unsubscribeFromPush();

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(getPushDeviceRecord()).toBeNull();
  });

  it("ignores a corrupt stored record", () => {
    localStorage.setItem("sorostream_push_device", "{not json");
    expect(getPushDeviceRecord()).toBeNull();
  });

  it("clearPushDeviceRecord removes only the record", () => {
    localStorage.setItem(
      "sorostream_push_device",
      JSON.stringify({ deviceId: "d", endpoint: "e", subscribedAt: new Date().toISOString() }),
    );
    localStorage.setItem("sorostream_push_subscription", JSON.stringify({ endpoint: "e" }));

    clearPushDeviceRecord();

    expect(getPushDeviceRecord()).toBeNull();
    expect(localStorage.getItem("sorostream_push_subscription")).not.toBeNull();
  });

  it("keeps a stable device id across calls", () => {
    const first = getOrCreatePushDeviceId();
    const second = getOrCreatePushDeviceId();
    expect(first).toBe(second);
    expect(first).not.toBe("");
  });
});
