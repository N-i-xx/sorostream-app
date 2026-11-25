import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClaimableTooltip from "../ClaimableTooltip";
import type { StreamData } from "@/src/lib/sorostream";

const NOW = new Date("2026-06-25T00:00:00.000Z");

const stream: StreamData = {
  id: "42",
  sender: "GSENDER",
  recipient: "GRECIPIENT",
  token: "USDC",
  flowRate: 10_000_000, // 1 unit per second
  deposit: 100_000_000_000,
  startTime: new Date(NOW.getTime() - 60_000).toISOString(),
  endTime: new Date(NOW.getTime() + 86_400_000).toISOString(),
  lastWithdrawTime: new Date(NOW.getTime() - 10_000).toISOString(),
  status: "Active",
};

function tooltipValue() {
  return screen.getByTestId("claimable-tooltip-42").textContent;
}

describe("ClaimableTooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tooltip value increases over time while the modal is open", () => {
    render(<ClaimableTooltip stream={stream} active label="Claimable" />);
    const initial = tooltipValue();
    expect(initial).toContain("10.0000000");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    const after5s = tooltipValue();
    expect(after5s).toContain("15.0000000");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(tooltipValue()).toContain("20.0000000");
  });

  it("does not update before the 5 second interval elapses", () => {
    render(<ClaimableTooltip stream={stream} active label="Claimable" />);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(tooltipValue()).toContain("10.0000000");
  });

  it("stops updating after the modal is closed", () => {
    const { rerender } = render(<ClaimableTooltip stream={stream} active label="Claimable" />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(tooltipValue()).toContain("15.0000000");

    rerender(<ClaimableTooltip stream={stream} active={false} label="Claimable" />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(tooltipValue()).toContain("15.0000000");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the periodic refresh when active transitions to false mid-interval (#932)", () => {
    const { rerender } = render(<ClaimableTooltip stream={stream} active label="Claimable" />);

    // Let a couple of ticks happen first, then flip active to false partway
    // through a new interval window (not right after a tick), confirming
    // the component-level wiring (not just the hook in isolation) actually
    // tears the interval down instead of letting a stale one fire later.
    act(() => {
      vi.advanceTimersByTime(12_000); // two full 5s ticks + 2s into the third
    });
    const valueAtTransition = tooltipValue();
    expect(valueAtTransition).toContain("20.0000000");

    rerender(<ClaimableTooltip stream={stream} active={false} label="Claimable" />);

    // Advance well past where the next tick(s) would have landed had the
    // interval kept running.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(tooltipValue()).toBe(valueAtTransition);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes immediately when reopened", () => {
    const { rerender } = render(
      <ClaimableTooltip stream={stream} active={false} label="Claimable" />,
    );
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(tooltipValue()).toContain("10.0000000");

    rerender(<ClaimableTooltip stream={stream} active label="Claimable" />);
    expect(tooltipValue()).toContain("30.0000000");
  });
});
