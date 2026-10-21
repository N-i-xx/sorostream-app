/**
 * Stream webhook notifications.
 *
 * When a user has configured a webhook URL, key stream state changes are
 * delivered as HTTP POST requests to that endpoint. The POST is best-effort and
 * fire-and-forget: failures are logged but never throw, so callers in the
 * critical path (e.g. while creating a stream) are never blocked by a slow or
 * broken webhook receiver.
 *
 * A failure is retried a bounded number of times with exponential backoff, so a
 * receiver that is briefly unreachable (e.g. restarting for a second) still
 * gets the event instead of losing it permanently.
 */
import { getWebhookConfig } from "./notificationPrefs";

export type WebhookEventType =
  | "stream.created"
  | "stream.withdrawn"
  | "stream.cancelled"
  | "stream.paused"
  | "stream.resumed"
  | "stream.topped_up"
  | "stream.recipient_transferred";

export interface WebhookEvent {
  type: WebhookEventType;
  streamId: string;
  timestamp: string;
  /** Optional human-readable detail. */
  message?: string;
  /** Optional asset/token code this event relates to. */
  asset?: string;
}

/** Total delivery attempts, including the initial one. */
export const WEBHOOK_MAX_ATTEMPTS = 3;
/** Delay before the first retry; doubled for each subsequent retry. */
export const WEBHOOK_RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a failed response is worth retrying: throttling and server-side
 * failures are transient, whereas most 4xx responses mean the request itself
 * is wrong and would fail again.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

interface DeliveryResult {
  delivered: boolean;
  retryable: boolean;
}

/** One delivery attempt. Never throws; a network error counts as retryable. */
async function postOnce(url: string, event: WebhookEvent): Promise<DeliveryResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SoroStream-Event": event.type,
      },
      body: JSON.stringify(event),
      // Don't let a slow receiver hang the UI thread's async work.
      keepalive: true,
    });
    return { delivered: response.ok, retryable: isRetryableStatus(response.status) };
  } catch {
    // Network-level failure (DNS, connection reset, receiver restarting).
    return { delivered: false, retryable: true };
  }
}

/**
 * POST a stream event to the user-configured webhook, if one is enabled.
 * No-op (resolves immediately) when running on the server, when no webhook is
 * configured, or when the saved URL is invalid. Any network error is swallowed
 * so it can never disrupt the calling transaction flow. Failed deliveries are
 * retried with bounded exponential backoff; callers that fire-and-forget (the
 * critical path) are unaffected because the retries happen in the background.
 */
export async function dispatchWebhook(event: WebhookEvent): Promise<void> {
  if (typeof window === "undefined") return;

  const { enabled, url } = getWebhookConfig();
  if (!enabled || !url) return;

  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    const { delivered, retryable } = await postOnce(url, event);
    if (delivered) return;

    if (!retryable || attempt === WEBHOOK_MAX_ATTEMPTS) {
      console.warn(
        `Webhook delivery failed for ${event.type} after ${attempt} attempt(s).`,
      );
      return;
    }

    await sleep(WEBHOOK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }
}
