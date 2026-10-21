"use client";
/**
 * PushDeviceStatusBanner (#690)
 *
 * Web Push subscriptions are per-browser/per-device and live in localStorage,
 * so a user who enables push on one device — or clears site data — silently
 * stops receiving alerts elsewhere. This banner checks the live PushManager
 * subscription on mount and tells the user when push is configured but this
 * device is missing it, with a one-tap re-subscribe.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getPushSetupStatus,
  subscribeToPush,
  type PushSetupStatus,
} from "@/src/lib/pushSubscription";
import { useToast } from "@/src/lib/toast";

export default function PushDeviceStatusBanner() {
  const { addToast } = useToast();
  const [status, setStatus] = useState<PushSetupStatus | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await getPushSetupStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleEnableOnThisDevice() {
    setPending(true);
    try {
      await subscribeToPush();
      await refresh();
      addToast("Push notifications enabled on this device.", "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Couldn't enable push notifications on this device.",
        "error",
      );
    } finally {
      setPending(false);
    }
  }

  if (!status || !status.message) return null;
  // "unsupported" is already covered by the push card; only surface problems
  // the user can act on from here.
  if (status.state !== "missing-on-this-device" && status.state !== "permission-denied") {
    return null;
  }

  return (
    <div
      role="alert"
      className="bg-yellow-950/40 border border-yellow-800/60 rounded-xl p-4 mb-6 space-y-3"
    >
      <div>
        <p className="text-sm font-medium text-yellow-200">
          {status.state === "permission-denied"
            ? "Push notifications are blocked on this device"
            : "Push notifications aren't active on this device"}
        </p>
        <p className="text-xs text-yellow-300/90 mt-1">{status.message}</p>
      </div>

      {status.state === "missing-on-this-device" && (
        <button
          type="button"
          onClick={() => void handleEnableOnThisDevice()}
          disabled={pending}
          className="bg-yellow-600 text-yellow-950 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-yellow-500 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
        >
          {pending ? "Enabling…" : "Enable notifications on this device"}
        </button>
      )}
    </div>
  );
}
