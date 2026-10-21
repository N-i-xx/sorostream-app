import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XlmPriceProvider, useSharedXlmPrice } from "../XlmPriceContext";

const { mockGetMeta } = vi.hoisted(() => ({ mockGetMeta: vi.fn() }));

vi.mock("@/src/lib/xlmPrice", () => ({
  getXlmUsdPriceWithMeta: mockGetMeta,
}));

function Consumer() {
  const { price, loading, rateLimited, stale } = useSharedXlmPrice();
  return (
    <div>
      <span data-testid="price">{price === null ? "none" : String(price)}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="rateLimited">{String(rateLimited)}</span>
      <span data-testid="stale">{String(stale)}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <XlmPriceProvider>
      <Consumer />
    </XlmPriceProvider>,
  );
}

/** Flush the in-flight provider attempt (microtask level) without timers. */
async function flushAttempt() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("XlmPriceContext rate-limit handling (issue #726)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetMeta.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a 429 backoff replaces the normal one-minute retry cadence", async () => {
    // Every attempt is refused: the shared provider is rate-limited.
    mockGetMeta.mockResolvedValue({ price: null, rateLimited: true });

    renderProvider();
    await flushAttempt();
    expect(mockGetMeta).toHaveBeenCalledTimes(1);

    // The normal cadence (1 minute) would retry immediately — it must not.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockGetMeta).toHaveBeenCalledTimes(1);

    // Backoff: 5 minutes after the first 429 the next attempt happens.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 60_000);
    });
    await flushAttempt();
    expect(mockGetMeta).toHaveBeenCalledTimes(2);

    // Consecutive 429s double the backoff (capped), instead of a fixed minute.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(mockGetMeta).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    await flushAttempt();
    expect(mockGetMeta).toHaveBeenCalledTimes(3);
  });

  it("consumers can distinguish a stale, rate-limited price from a fresh one", async () => {
    mockGetMeta.mockResolvedValue({ price: 0.21, rateLimited: false });

    renderProvider();
    await flushAttempt();
    expect(screen.getByTestId("price").textContent).toBe("0.21");
    expect(screen.getByTestId("rateLimited").textContent).toBe("false");
    expect(screen.getByTestId("stale").textContent).toBe("false");

    // The refresh attempt is refused, but no price replaces the shown one.
    mockGetMeta.mockResolvedValue({ price: null, rateLimited: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushAttempt();

    expect(screen.getByTestId("price").textContent).toBe("0.21"); // kept
    expect(screen.getByTestId("rateLimited").textContent).toBe("true");
    expect(screen.getByTestId("stale").textContent).toBe("true");

    // A later recovery goes back to a normally-fresh price.
    mockGetMeta.mockResolvedValue({ price: 0.22, rateLimited: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    await flushAttempt();

    expect(screen.getByTestId("price").textContent).toBe("0.22");
    expect(screen.getByTestId("rateLimited").textContent).toBe("false");
    expect(screen.getByTestId("stale").textContent).toBe("false");
  });

  it("the very first fetch being rate limited still ends loading with no price", async () => {
    mockGetMeta.mockResolvedValue({ price: null, rateLimited: true });

    renderProvider();
    await flushAttempt();

    expect(screen.getByTestId("price").textContent).toBe("none");
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("rateLimited").textContent).toBe("true");
    expect(screen.getByTestId("stale").textContent).toBe("false");
  });

  it("successful refreshes resume the normal cadence after recovery", async () => {
    mockGetMeta.mockResolvedValue({ price: null, rateLimited: true });
    renderProvider();
    await flushAttempt();
    expect(mockGetMeta).toHaveBeenCalledTimes(1);

    mockGetMeta.mockResolvedValue({ price: 0.3, rateLimited: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    await flushAttempt();
    expect(screen.getByTestId("price").textContent).toBe("0.3");
    const afterRecovery = mockGetMeta.mock.calls.length;

    // One more normal minute-cadence refresh happens after recovery.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushAttempt();
    expect(mockGetMeta.mock.calls.length).toBeGreaterThan(afterRecovery);
    await waitFor(() => {
      expect(screen.getByTestId("stale").textContent).toBe("false");
    });
  });
});
