import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getWebhookConfig } = vi.hoisted(() => ({ getWebhookConfig: vi.fn() }));

vi.mock("../notificationPrefs", () => ({ getWebhookConfig }));

import {
  dispatchWebhook,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_BASE_DELAY_MS,
  type WebhookEvent,
} from "../webhooks";

const event: WebhookEvent = {
  type: "stream.created",
  streamId: "42",
  timestamp: "2026-01-01T00:00:00.000Z",
};

const response = (status: number, ok = status >= 200 && status < 300) =>
  ({ ok, status }) as Response;

describe("dispatchWebhook", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    getWebhookConfig.mockReturnValue({
      enabled: true,
      url: "https://example.com/hooks/sorostream",
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Flush microtasks, then let the pending backoff timer fire. */
  async function runRetries(attempts: number) {
    let delay = 0;
    for (let i = 1; i < attempts; i += 1) {
      delay += WEBHOOK_RETRY_BASE_DELAY_MS * 2 ** (i - 1);
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(delay);
  }

  it("retries a transient failure and succeeds on the retry", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(response(204));

    const promise = dispatchWebhook(event);
    await runRetries(2);

    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://example.com/hooks/sorostream",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("retries a 5xx response", async () => {
    fetchMock
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));

    const promise = dispatchWebhook(event);
    await runRetries(2);

    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded number of attempts without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("offline"));

    const promise = dispatchWebhook(event);
    await runRetries(WEBHOOK_MAX_ATTEMPTS);

    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(WEBHOOK_MAX_ATTEMPTS);
    expect(warn).toHaveBeenCalled();
  });

  it("does not retry a non-retryable 4xx response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(response(400, false));

    const promise = dispatchWebhook(event);
    await vi.advanceTimersByTimeAsync(WEBHOOK_RETRY_BASE_DELAY_MS * 4);

    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("does nothing when no webhook is enabled", async () => {
    getWebhookConfig.mockReturnValue({ enabled: false, url: "https://example.com" });

    await dispatchWebhook(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
