import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StreamDryRunPreview from "../StreamDryRunPreview";
import type { StreamDryRunInput, StreamDryRunResult } from "@/src/lib/streamDryRun";

const { simulate } = vi.hoisted(() => ({ simulate: vi.fn() }));

vi.mock("@/src/lib/streamDryRun", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/streamDryRun")>();
  return {
    ...actual,
    simulateStreamDryRun: (input: StreamDryRunInput) => simulate(input),
  };
});

const STROOPS = 10_000_000;

describe("StreamDryRunPreview pending simulation cancellation (#956)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    simulate.mockReset();
    simulate.mockImplementation((input: StreamDryRunInput): StreamDryRunResult => {
      const feeStroops = Math.round(input.amountStroops * 0.01);
      return {
        ok: true,
        checkpoints: [],
        totalFeeStroops: feeStroops,
        netTotalStroops: input.amountStroops - feeStroops,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies only the final amount's result when props change twice before the 600ms delay elapses", async () => {
    const { rerender } = render(
      <StreamDryRunPreview amount="100" durationSeconds={3600} />,
    );

    rerender(<StreamDryRunPreview amount="200" durationSeconds={3600} />);
    rerender(<StreamDryRunPreview amount="300" durationSeconds={3600} />);

    expect(simulate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate).toHaveBeenCalledWith(
      expect.objectContaining({ amountStroops: 300 * STROOPS }),
    );
    expect(screen.getByTestId("dry-run-total-fee")).toHaveTextContent("3.00 tokens");
    expect(screen.getByTestId("dry-run-net-total")).toHaveTextContent("297.00 tokens");
    expect(screen.getByTestId("dry-run-net-total")).not.toHaveTextContent("1.00 tokens");
    expect(screen.getByTestId("dry-run-net-total")).not.toHaveTextContent("2.00 tokens");
  });
});
