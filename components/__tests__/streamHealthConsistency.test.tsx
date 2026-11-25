import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StreamHealthCard from "@/components/StreamHealthCard";
import { getStreamHealthDetails } from "@/src/lib/streamHealth";
import { claimableNow, type StreamData } from "@/src/lib/sorostream";

/**
 * Cross-component test for #935: a stream whose `status` is still "Active"
 * but whose `endTime` has already passed. StreamHealthCard (via the #717
 * `pastEnd` workaround) and streamHealth.ts's `getStreamHealthDetails` both
 * treat this as ended; this test confirms they agree, and documents how
 * PortfolioSummaryCard's raw `status === "Active"` filter (see
 * PortfolioSummaryCard.test.tsx) diverges from that for the same scenario.
 */

const now = Date.now();

const activePastEndStream: StreamData = {
  id: "s1",
  sender: "GSENDER...1111",
  recipient: "GRECIP...2222",
  flowRate: 10_000_000,
  deposit: 1_000_000_000,
  startTime: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
  // endTime is in the past, but status was never flipped to "Ended".
  endTime: new Date(now - 1000 * 60 * 60).toISOString(),
  lastWithdrawTime: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
  status: "Active",
  token: "USDC",
};

describe("Active stream past endTime — cross-component consistency (#935)", () => {
  it("streamHealth.ts's getStreamHealthDetails classifies it as Expired (ended)", () => {
    const unclaimed = claimableNow(activePastEndStream);
    const { status } = getStreamHealthDetails(activePastEndStream, unclaimed, now);
    expect(status).toBe("Expired");
  });

  it("StreamHealthCard renders it as Completed/ended, matching streamHealth.ts", () => {
    render(<StreamHealthCard stream={activePastEndStream} />);

    // isEnded in StreamHealthCard = healthStatus === "Expired" || status === "Ended" || now >= endMs.
    // All three are true here, so the card shows the ended/settled UI.
    expect(screen.getByTestId("health-status-badge")).toHaveTextContent("Completed");
    expect(screen.getByTestId("health-settled-info")).toBeInTheDocument();
    expect(screen.getByTestId("health-time-remaining")).toHaveTextContent("Stream completed");
  });

  it("PortfolioSummaryCard's raw status==='Active' filter still counts it as a live flow (inconsistency)", () => {
    // This mirrors PortfolioSummaryCard's own useMemo filter exactly:
    // `streams.filter((s) => s.status === "Active")`. It has no endTime
    // check, so a stream StreamHealthCard and streamHealth.ts both consider
    // "ended" is still included in the live outflow/inflow totals.
    const active = [activePastEndStream].filter((s) => s.status === "Active");
    expect(active).toHaveLength(1);
    expect(active[0].flowRate).toBe(activePastEndStream.flowRate);
  });
});
