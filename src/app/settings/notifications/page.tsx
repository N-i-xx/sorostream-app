"use client";
/**
 * /settings/notifications — notification preferences (#218, #523).
 *
 * Lets users opt into browser push and email notifications for stream
 * lifecycle events (completion, upcoming expiry, withdrawal availability,
 * stream received, stream cancelled), with a master switch to disable
 * everything at once. Preferences persist in localStorage; push additionally
 * requests OS-level permission via the browser Notification API and
 * registers a Web Push subscription via the service worker.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  requestPushPermission,
  isPushSupported,
  isValidEmail,
  isValidWebhookUrl,
  parseExpiryThresholdHours,
  type NotificationPrefs,
  type NotificationEventPrefs,
} from "@/src/lib/notificationPrefs";
import {
  isWebPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  getActivePushSubscription,
  dispatchPushNotification,
} from "@/src/lib/pushSubscription";
import { dispatchWebhook } from "@/src/lib/webhooks";
import { useToast } from "@/src/lib/toast";
import PerStreamNotificationSettings from "@/src/components/PerStreamNotificationSettings";
import PushDeviceStatusBanner from "@/src/components/PushDeviceStatusBanner";
import { checkStreamNotifications } from "@/src/lib/streamNotificationWatcher";

// claimableThreshold (the numeric threshold value, not the "...Enabled" flag
// that toggles it) and expiryThresholdsHours (the custom expiry lead-time
// list) are the non-boolean fields on NotificationEventPrefs, so they are
// excluded here — every entry below renders as a boolean Toggle.
const EVENT_LABELS: {
  key: keyof Omit<NotificationEventPrefs, "claimableThreshold" | "expiryThresholdsHours">;
  label: string;
  description: string;
}[] = [
  {
    key: "expiring24h",
    label: "24h before expiry",
    description: "Notify 24 hours before a stream you own or receive expires.",
  },
  {
    key: "expiring1h",
    label: "1h before expiry",
    description: "Notify 1 hour before a stream you own or receive expires.",
  },
  {
    key: "claimableThresholdEnabled",
    label: "Claimable balance threshold",
    description: "Notify when available claimable balance crosses your configured threshold.",
  },
  {
    key: "streamReceived",
    label: "Stream received",
    description: "A sender creates a new stream to your wallet address.",
  },
  {
    key: "withdrawalAvailable",
    label: "Withdrawal available",
    description: "New claimable funds are ready to withdraw.",
  },
  {
    key: "streamCancelled",
    label: "Stream cancelled",
    description: "A sender cancels a stream you are receiving.",
  },
  {
    key: "streamCompleted",
    label: "Stream completed",
    description: "A stream you created or receive has fully vested.",
  },
];

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
        checked ? "bg-green-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const { addToast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [pushPending, setPushPending] = useState(false);
  const [webhookInput, setWebhookInput] = useState("");
  const [webhookError, setWebhookError] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  // Free-text list of extra expiry lead times, in hours (#689).
  const [expiryThresholdInput, setExpiryThresholdInput] = useState("");

  useEffect(() => {
    const loaded = getNotificationPrefs();
    setPrefs(loaded);
    setEmailInput(loaded.email);
    setWebhookInput(loaded.webhookUrl);
    setExpiryThresholdInput((loaded.events.expiryThresholdsHours ?? []).join(", "));
  }, []);

  function persist(next: NotificationPrefs) {
    setPrefs(next);
    saveNotificationPrefs(next);
  }

  async function handleTogglePush(next: boolean) {
    if (!prefs) return;
    if (!next) {
      persist({ ...prefs, pushEnabled: false });
      return;
    }
    if (!isPushSupported()) {
      addToast("Browser push notifications aren't supported in this browser.", "error");
      return;
    }
    setPushPending(true);
    try {
      const permission = await requestPushPermission();
      if (permission === "granted") {
        persist({ ...prefs, pushEnabled: true });
        addToast("Browser push notifications enabled.", "success");
        void checkStreamNotifications();
      } else {
        addToast("Push permission was denied. Enable it in your browser settings to opt in.", "error");
      }
    } finally {
      setPushPending(false);
    }
  }

  function handleSaveEmail() {
    if (!prefs) return;
    const trimmed = emailInput.trim();
    if (!trimmed) {
      setEmailError("Email address is required to enable email notifications.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError("");
    persist({ ...prefs, emailEnabled: true, email: trimmed });
    addToast("Email notifications enabled.", "success");
  }

  function handleToggleEmail(next: boolean) {
    if (!prefs) return;
    if (!next) {
      setEmailError("");
      persist({ ...prefs, emailEnabled: false });
      return;
    }
    handleSaveEmail();
  }

  function handleToggleMaster(next: boolean) {
    if (!prefs) return;
    persist({ ...prefs, enabled: next });
    addToast(next ? "Notifications enabled." : "All notifications disabled.", "info");
  }

  function handleToggleEvent(key: keyof NotificationEventPrefs, next: boolean) {
    if (!prefs) return;
    persist({ ...prefs, events: { ...prefs.events, [key]: next } });
  }

  function handleSaveWebhook(enabled: boolean) {
    if (!prefs) return;
    const trimmed = webhookInput.trim();
    if (enabled && !isValidWebhookUrl(trimmed)) {
      setWebhookError("Enter a valid https:// webhook URL to enable webhooks.");
      return;
    }
    setWebhookError("");
    persist({ ...prefs, webhookEnabled: enabled, webhookUrl: trimmed });
    addToast(
      enabled ? "Webhook notifications enabled." : "Webhook notifications disabled.",
      "info",
    );
  }

  function handleToggleWebhook(next: boolean) {
    if (!prefs) return;
    if (!next) {
      setWebhookError("");
      persist({ ...prefs, webhookEnabled: false });
      return;
    }
    handleSaveWebhook(true);
  }

  function handleSaveExpiryThresholds() {
    if (!prefs) return;
    const hours = parseExpiryThresholdHours(expiryThresholdInput);
    setExpiryThresholdInput(hours.join(", "));
    persist({ ...prefs, events: { ...prefs.events, expiryThresholdsHours: hours } });
    addToast(
      hours.length > 0
        ? `Extra expiry alerts saved: ${hours.join("h, ")}h before expiry.`
        : "Extra expiry alerts cleared. The 24h and 1h alerts still apply.",
      "info",
    );
  }

  async function handleSendTestWebhook() {
    if (!prefs) return;
    const trimmed = webhookInput.trim();
    if (!isValidWebhookUrl(trimmed)) {
      setWebhookError("Enter a valid https:// webhook URL before sending a test.");
      return;
    }
    setWebhookError("");
    setSendingTest(true);
    try {
      await dispatchWebhook({
        type: "stream.created",
        streamId: "test",
        timestamp: new Date().toISOString(),
        message: "SoroStream webhook test event",
      });
      addToast("Test event sent to your webhook.", "success");
    } catch {
      addToast("Failed to deliver test event.", "error");
    } finally {
      setSendingTest(false);
    }
  }

  if (!prefs) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
          <div className="h-32 bg-gray-800 rounded-xl animate-pulse" />
        </div>
      </main>
    );
  }

  const subControlsDisabled = !prefs.enabled;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      <div className="max-w-lg mx-auto">
        <div className="mb-4">
          <Link href="/settings" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Settings
          </Link>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold mb-6 sm:mb-8">Notification Preferences</h1>

        {/* Master switch */}
        <div className="bg-gray-800 rounded-xl p-6 mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p className="text-gray-400 text-sm mt-1">
              Turn off to stop all stream notifications, regardless of the settings below.
            </p>
          </div>
          <Toggle checked={prefs.enabled} onChange={handleToggleMaster} label="Enable all notifications" />
        </div>

        {/* Push */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Browser Push</h2>
              <p className="text-gray-400 text-sm mt-1">
                Get on-device alerts even when the app isn&apos;t open.
              </p>
            </div>
            <Toggle
              checked={prefs.pushEnabled}
              onChange={(next) => void handleTogglePush(next)}
              disabled={subControlsDisabled || pushPending}
              label="Enable browser push notifications"
            />
          </div>
          {!isPushSupported() && (
            <p className="text-yellow-400 text-xs">Push notifications aren&apos;t supported in this browser.</p>
          )}
        </div>

        {/* Per-device push setup check (#690) */}
        <PushDeviceStatusBanner />

        {/* Email */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Email</h2>
              <p className="text-gray-400 text-sm mt-1">Receive alerts at an email address.</p>
            </div>
            <Toggle
              checked={prefs.emailEnabled}
              onChange={handleToggleEmail}
              disabled={subControlsDisabled}
              label="Enable email notifications"
            />
          </div>
          <div>
            <label htmlFor="notification-email" className="text-gray-200 text-sm font-medium block mb-1">
              Email address
            </label>
            <div className="flex gap-3">
              <input
                id="notification-email"
                type="email"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
                placeholder="you@example.com"
                disabled={subControlsDisabled}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "notification-email-error" : undefined}
              />
              <button
                type="button"
                onClick={handleSaveEmail}
                disabled={subControlsDisabled}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Save
              </button>
            </div>
            {emailError && (
              <p id="notification-email-error" role="alert" className="text-red-400 text-xs mt-1">
                {emailError}
              </p>
            )}
            {prefs.emailEnabled && !emailError && (
              <p className="text-green-400 text-xs mt-1">Email notifications active for {prefs.email}.</p>
            )}
          </div>
        </div>

        {/* Webhook */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Stream Webhook</h2>
              <p className="text-gray-400 text-sm mt-1">
                Receive a POST request whenever a stream changes state (created, withdrawn, cancelled, …).
              </p>
            </div>
            <Toggle
              checked={prefs.webhookEnabled}
              onChange={handleToggleWebhook}
              disabled={subControlsDisabled}
              label="Enable stream webhook notifications"
            />
          </div>
          <div>
            <label htmlFor="notification-webhook" className="text-gray-200 text-sm font-medium block mb-1">
              Webhook URL
            </label>
            <div className="flex gap-3">
              <input
                id="notification-webhook"
                type="url"
                value={webhookInput}
                onChange={(e) => { setWebhookInput(e.target.value); setWebhookError(""); }}
                placeholder="https://example.com/webhook"
                disabled={subControlsDisabled}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-invalid={!!webhookError}
                aria-describedby={webhookError ? "notification-webhook-error" : undefined}
              />
              <button
                type="button"
                onClick={() => handleSendTestWebhook()}
                disabled={subControlsDisabled || sendingTest}
                className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {sendingTest ? "Sending…" : "Send test"}
              </button>
            </div>
            {webhookError && (
              <p id="notification-webhook-error" role="alert" className="text-red-400 text-xs mt-1">
                {webhookError}
              </p>
            )}
            {prefs.webhookEnabled && !webhookError && (
              <p className="text-green-400 text-xs mt-1">Webhook events will be POSTed to {prefs.webhookUrl}.</p>
            )}
          </div>
        </div>

        {/* Event types */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-8">
          <h2 className="text-lg font-semibold">Events</h2>
          <div className="space-y-4">
            {EVENT_LABELS.map(({ key, label, description }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-200">{label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{description}</p>
                  </div>
                  <Toggle
                    checked={prefs.events[key] ?? true}
                    onChange={(next) => handleToggleEvent(key, next)}
                    disabled={subControlsDisabled}
                    label={label}
                  />
                </div>
                {key === "claimableThresholdEnabled" && (prefs.events.claimableThresholdEnabled ?? true) && (
                  <div className="pt-2 pl-4 border-l-2 border-green-600/50 mt-1 flex items-center gap-3">
                    <label htmlFor="global-claimable-threshold" className="text-gray-300 text-xs font-medium">
                      Threshold amount (tokens/XLM):
                    </label>
                    <input
                      id="global-claimable-threshold"
                      type="number"
                      min="0"
                      step="any"
                      value={prefs.events.claimableThreshold ?? 100}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        persist({
                          ...prefs,
                          events: {
                            ...prefs.events,
                            claimableThreshold: Number.isFinite(val) && val >= 0 ? val : 0,
                          },
                        });
                      }}
                      disabled={subControlsDisabled}
                      className="w-28 bg-gray-700 border border-gray-600 rounded px-2.5 py-1 text-white text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Custom expiry lead times (#689) */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-3 mb-8">
          <div>
            <h2 className="text-lg font-semibold">Custom Expiry Alerts</h2>
            <p className="text-gray-400 text-sm mt-1">
              Add your own heads-up before a stream expires, on top of the 24h and 1h alerts above.
            </p>
          </div>
          <div>
            <label
              htmlFor="custom-expiry-thresholds"
              className="text-gray-200 text-sm font-medium block mb-1"
            >
              Hours before expiry
            </label>
            <div className="flex gap-3">
              <input
                id="custom-expiry-thresholds"
                type="text"
                inputMode="decimal"
                value={expiryThresholdInput}
                onChange={(e) => setExpiryThresholdInput(e.target.value)}
                placeholder="e.g. 168, 48"
                disabled={subControlsDisabled}
                aria-describedby="custom-expiry-thresholds-help"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              />
              <button
                type="button"
                onClick={handleSaveExpiryThresholds}
                disabled={subControlsDisabled}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Save
              </button>
            </div>
            <p id="custom-expiry-thresholds-help" className="text-gray-500 text-xs mt-1">
              Comma-separated hours, e.g. 168 for one week. Leave empty to use only the 24h and 1h alerts.
            </p>
            {(prefs.events.expiryThresholdsHours ?? []).length > 0 && (
              <p className="text-green-400 text-xs mt-1">
                Extra alerts active at{" "}
                {(prefs.events.expiryThresholdsHours ?? []).join("h, ")}h before expiry.
              </p>
            )}
          </div>
        </div>

        {/* Per-Stream Notification Preferences (#76) */}
        <PerStreamNotificationSettings />
      </div>
    </main>
  );
}
