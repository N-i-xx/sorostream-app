import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StreamEventFeed from "../StreamEventFeed";

const { getEvents } = vi.hoisted(() => ({ getEvents: vi.fn() }));

vi.mock("@/src/lib/sorostream", () => ({
  sorostream: { getEvents },
  truncateAddress: (address: string) => address,
}));

describe("StreamEventFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getEvents.mockResolvedValue([{
      id: "real-event-1",
      type: "withdrawal",
      streamId: "42",
      amount: "12",
      asset: "XLM",
      timestamp: new Date().toISOString(),
      txHash: "real-tx-hash",
    }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("continues to render fetched events without injecting fabricated events", async () => {
    render(<StreamEventFeed />);
    await act(async () => {});

    expect(screen.getByText("on Stream #42")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("on Stream #42")).toBeInTheDocument();
    expect(screen.getAllByRole("log")[0].querySelectorAll(":scope > div")).toHaveLength(1);
  });

  it("re-enables auto-scroll after the user scrolls back within 50px of the top", async () => {
    render(<StreamEventFeed />);
    await act(async () => {});

    const feed = screen.getByRole("log");
    const scrollTo = (scrollTop: number) => {
      Object.defineProperty(feed, "scrollTop", { value: scrollTop, writable: true, configurable: true });
      fireEvent.scroll(feed);
    };

    scrollTo(200);
    expect(feed.scrollTop).toBe(200);

    scrollTo(50);
    expect(feed.scrollTop).toBe(50);

    scrollTo(49);
    expect(feed.scrollTop).toBe(0);
  });
});
