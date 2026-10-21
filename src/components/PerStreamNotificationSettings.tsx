"use client";
/**
 * PerStreamNotificationSettings (#76)
 *
 * Lets users configure notification alerts on a per-stream basis.
 * Supports:
 *   - Opting into browser push notifications with permission prompted only on user action.
 *   - 24-hour and 1-hour expiry notifications.
 *   - Claimable balance threshold notifications with per-stream custom threshold overrides.
 */
import { useEffect, useState, useCallback } from "react";
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  getStreamNotificationPref,
  setStreamNotificationPref,
  requestPushPermission,
  isPushSupported,
  parseExpiryThresholdHours,
  type NotificationPrefs,
  type StreamNotificationPref,
} from "@/src/lib/notificationPrefs";
import { getStreamsForWallet, type StreamData } from "@/src/lib/sorostream";
import { useWallet } from "@/src/context/WalletContext";
import { useToast } from "@/src/lib/toast";
import { checkStreamNotifications } from "@/src/lib/streamNotificationWatcher";

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

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function PerStreamNotificationSettings() {
  const { address } = useWallet();
  const { addToast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [streams, setStreams] = useState<StreamData[]>([]);
  const [streamPrefsMap, setStreamPrefsMap] = useState<Record<string, StreamNotificationPref>>({});
  const [expandedStreamId, setExpandedStreamId] = useState<string | null>(null);

  const loadData = useCallback(() => {
    const loadedPrefs = getNotificationPrefs();
    setPrefs(loadedPrefs);
    const userStreams = getStreamsForWallet(address);
    setStreams(userStreams);

    const map: Record<string, StreamNotificationPref> = {};
    for (const s of userStreams) {
      map[s.id] = getStreamNotificationPref(s.id);
    }
    setStreamPrefsMap(map);
  }, [address]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function ensurePushPermission(): Promise<boolean> {
    if (!isPushSupported()) {
      addToast("Browser push notifications are not supported in this browser.", "error");
      return false;
    }
    if (Notification.permission === "granted") return true;

    // Show permission prompt ONLY when user triggers this action in settings (#76)
    const result = await requestPushPermission();
    if (result === "granted") {
      if (prefs) {
        const next = { ...prefs, pushEnabled: true };
        setPrefs(next);
        saveNotificationPrefs(next);
      }
      addToast("Browser push notification permission granted.", "success");
      return true;
    } else {
      addToast("Browser push permission was denied. Please allow notifications in browser settings.", "error");
      return false;
    }
  }

  async function handleToggleStreamEnabled(streamId: string, next: boolean) {
    if (next) {
      const ok = await ensurePushPermission();
      if (!ok) return;
    }
    const updated = setStreamNotificationPref(streamId, { enabled: next });
    setPrefs(updated);
    setStreamPrefsMap((prev) => ({
      ...prev,
      [streamId]: {
        ...getStreamNotificationPref(streamId),
        enabled: next,
      },
    }));
    addToast(
      next
        ? `Notifications enabled for Stream #${streamId}.`
        : `Notifications muted for Stream #${streamId}.`,
      "info",
    );
    void checkStreamNotifications();
  }

  function handleUpdateField<K extends keyof StreamNotificationPref>(
    streamId: string,
    field: K,
    value: StreamNotificationPref[K],
  ) {
    const updated = setStreamNotificationPref(streamId, { [field]: value });
    setPrefs(updated);
    setStreamPrefsMap((prev) => ({
      ...prev,
      [streamId]: {
        ...getStreamNotificationPref(streamId),
        [field]: value,
      },
    }));
    void checkStreamNotifications();
  }

  if (!prefs) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 mb-6">
        <div className="h-6 w-48 bg-gray-700 rounded animate-pulse mb-4" />
        <div className="h-20 bg-gray-700 rounded-lg animate-pulse" />
      </div>
    );
  }

  const isGlobalDisabled = !prefs.enabled;

  return (
    <div className="bg-gray-800 rounded-xl p-6 mb-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-gray-700 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Per-Stream Notification Preferences</h2>
          <p className="text-gray-400 text-sm mt-1">
            Choose which streams send browser push alerts before expiry and when claimable funds accumulate.
          </p>
        </div>
        <span className="text-xs font-medium text-gray-400 self-start sm:self-center bg-gray-700 px-2.5 py-1 rounded-full">
          {streams.length} {streams.length === 1 ? "stream" : "streams"}
        </span>
      </div>

      {isGlobalDisabled && (
        <div className="p-3 bg-yellow-950/40 border border-yellow-800/60 rounded-lg text-yellow-300 text-xs">
          Notifications are currently disabled globally. Turn on master notifications above to receive stream alerts.
        </div>
      )}

      {streams.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">
          No streams found for this wallet. Create or receive a stream to configure its alerts.
        </p>
      ) : (
        <div className="space-y-4">
          {streams.map((stream) => {
            const currentPref = streamPrefsMap[stream.id] ?? getStreamNotificationPref(stream.id);
            const isExpanded = expandedStreamId === stream.id;
            const globalThreshold = prefs.events.claimableThreshold ?? 100;

            return (
              <div
                key={stream.id}
                className="bg-gray-750/70 border border-gray-700 rounded-xl p-4 transition-all"
              >
                {/* Header row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white text-sm">
                        Stream #{stream.id}
                      </span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-700 text-green-400">
                        {stream.token}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${
                          stream.status === "Active"
                            ? "bg-green-900/50 text-green-300"
                            : stream.status === "Paused"
                            ? "bg-yellow-900/50 text-yellow-300"
                            : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {stream.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>Recipient: {truncateAddress(stream.recipient)}</span>
                      <span>
                        Expires: {new Date(stream.endTime).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedStreamId(isExpanded ? null : stream.id)}
                      className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded bg-gray-700/60"
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} stream #${stream.id} alert options`}
                    >
                      {isExpanded ? "Hide Options ▲" : "Configure ▼"}
                    </button>
                    <Toggle
                      checked={currentPref.enabled}
                      onChange={(next) => void handleToggleStreamEnabled(stream.id, next)}
                      disabled={isGlobalDisabled}
                      label={`Enable notifications for stream #${stream.id}`}
                    />
                  </div>
                </div>

                {/* Expanded configuration options */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-700/80 space-y-3.5 pl-1 sm:pl-2">
                    <p className="text-xs font-medium text-gray-300">
                      Alert triggers for Stream #{stream.id}:
                    </p>

                    {/* 24 hours before expiry */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-200">24 hours before expiry</p>
                        <p className="text-xs text-gray-500">
                          Receive browser alert 24 hours prior to stream conclusion.
                        </p>
                      </div>
                      <Toggle
                        checked={currentPref.notifyExpiry24h ?? true}
                        onChange={(next) => handleUpdateField(stream.id, "notifyExpiry24h", next)}
                        disabled={isGlobalDisabled || !currentPref.enabled}
                        label={`Notify 24h before expiry for stream #${stream.id}`}
                      />
                    </div>

                    {/* 1 hour before expiry */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-200">1 hour before expiry</p>
                        <p className="text-xs text-gray-500">
                          Receive browser alert 1 hour prior to stream conclusion.
                        </p>
                      </div>
                      <Toggle
                        checked={currentPref.notifyExpiry1h ?? true}
                        onChange={(next) => handleUpdateField(stream.id, "notifyExpiry1h", next)}
                        disabled={isGlobalDisabled || !currentPref.enabled}
                        label={`Notify 1h before expiry for stream #${stream.id}`}
                      />
                    </div>

                    {/* Custom expiry lead times (#689) */}
                    <div className="pt-1 space-y-1.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <label
                          htmlFor={`expiry-thresholds-input-${stream.id}`}
                          className="text-xs text-gray-300"
                        >
                          Extra alerts, hours before expiry:
                        </label>
                        <input
                          id={`expiry-thresholds-input-${stream.id}`}
                          type="text"
                          inputMode="decimal"
                          defaultValue={(currentPref.expiryThresholdsHours ?? []).join(", ")}
                          onBlur={(e) =>
                            handleUpdateField(
                              stream.id,
                              "expiryThresholdsHours",
                              parseExpiryThresholdHours(e.target.value),
                            )
                          }
                          placeholder="e.g. 168"
                          disabled={isGlobalDisabled || !currentPref.enabled}
                          className="w-32 bg-gray-700 border border-gray-600 rounded px-2.5 py-1 text-white text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        Added on top of the 24h and 1h alerts for this stream. Comma-separated; no extra
                        alerts when empty.
                      </p>
                    </div>

                    {/* Claimable balance threshold */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-200">Claimable balance threshold</p>
                        <p className="text-xs text-gray-500">
                          Alert when claimable withdrawal reaches or crosses configured amount.
                        </p>
                      </div>
                      <Toggle
                        checked={currentPref.notifyClaimableThreshold ?? true}
                        onChange={(next) => handleUpdateField(stream.id, "notifyClaimableThreshold", next)}
                        disabled={isGlobalDisabled || !currentPref.enabled}
                        label={`Notify on claimable threshold for stream #${stream.id}`}
                      />
                    </div>

                    {/* Custom threshold input */}
                    {(currentPref.notifyClaimableThreshold ?? true) && (
                      <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <label
                          htmlFor={`threshold-input-${stream.id}`}
                          className="text-xs text-gray-300"
                        >
                          Threshold amount ({stream.token}):
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id={`threshold-input-${stream.id}`}
                            type="number"
                            min="0"
                            step="any"
                            value={currentPref.claimableThreshold ?? globalThreshold}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              handleUpdateField(
                                stream.id,
                                "claimableThreshold",
                                Number.isFinite(val) && val >= 0 ? val : 0,
                              );
                            }}
                            disabled={isGlobalDisabled || !currentPref.enabled}
                            className="w-28 bg-gray-700 border border-gray-600 rounded px-2.5 py-1 text-white text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                          />
                          <span className="text-xs text-gray-400">{stream.token}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
