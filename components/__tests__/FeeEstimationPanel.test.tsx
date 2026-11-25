import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import FeeEstimationPanel from "@/components/FeeEstimationPanel";

// ---------------------------------------------------------------------------
// Mock @/src/lib/sorostream — only simulateTransactionFee is needed here.
// We keep a module-level ref so individual tests can override the resolved
// value or force a rejection without re-running vi.mock.
// ---------------------------------------------------------------------------

const mockSimulate = vi.fn();

vi.mock("@/src/lib/sorostream", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/sorostream")>();
  return {
    ...original,
    simulateTransactionFee: (...args: unknown[]) => mockSimulate(...args),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a resolved FeeEstimate fixture. */
function makeFeeEstimate(
  overrides: Partial<{ inclusionFeeLumens: string; resourceFeeLumens: string; totalFeeLumens: string }> = {},
) {
  return {
    inclusionFeeLumens: "0.0000100",
    resourceFeeLumens: "0.0000500",
    totalFeeLumens: "0.0000600",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeeEstimationPanel", () => {
  beforeEach(() => {
    mockSimulate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── inactive guard ────────────────────────────────────────────────────────

  it("renders nothing when active=false", () => {
    // The promise should never be called, but resolve immediately just in case.
    mockSimulate.mockResolvedValue(makeFeeEstimate());
    const { container } = render(<FeeEstimationPanel active={false} />);
    expect(container.firstChild).toBeNull();
  });

  // ── loading state ─────────────────────────────────────────────────────────

  it("shows loading skeleton while the fee simulation is in flight", async () => {
    // Keep the promise pending for the duration of this test.
    let resolveFee!: (v: ReturnType<typeof makeFeeEstimate>) => void;
    mockSimulate.mockReturnValue(
      new Promise<ReturnType<typeof makeFeeEstimate>>((resolve) => {
        resolveFee = resolve;
      }),
    );

    render(<FeeEstimationPanel active={true} />);

    // Loading region must be visible
    expect(screen.getByLabelText("Loading fee estimate")).toBeInTheDocument();

    // aria-busy should be set while loading
    expect(screen.getByLabelText("Estimated transaction fee")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    // The success/error text should NOT be present yet
    expect(screen.queryByText(/Total fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();

    // Clean up: resolve so useEffect cleanup doesn't leak
    await act(async () => {
      resolveFee(makeFeeEstimate());
    });
  });

  it("hides the fee amount while in the loading state", async () => {
    let resolveFee!: (v: ReturnType<typeof makeFeeEstimate>) => void;
    mockSimulate.mockReturnValue(
      new Promise<ReturnType<typeof makeFeeEstimate>>((resolve) => {
        resolveFee = resolve;
      }),
    );

    render(<FeeEstimationPanel active={true} />);

    // Amount fields are only present in the success state
    expect(screen.queryByText("0.0000100 XLM")).not.toBeInTheDocument();
    expect(screen.queryByText("0.0000500 XLM")).not.toBeInTheDocument();

    await act(async () => {
      resolveFee(makeFeeEstimate());
    });
  });

  // ── error state ───────────────────────────────────────────────────────────

  it("shows the error message when simulateTransactionFee rejects", async () => {
    mockSimulate.mockRejectedValue(new Error("Simulated RPC failure"));

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(
      screen.getByText(/Fee estimate unavailable/i),
    ).toBeInTheDocument();
  });

  it("does not show the loading skeleton after an error", async () => {
    mockSimulate.mockRejectedValue(new Error("RPC down"));

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.queryByLabelText("Loading fee estimate")).not.toBeInTheDocument();
  });

  it("sets aria-busy to false after an error", async () => {
    mockSimulate.mockRejectedValue(new Error("RPC down"));

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.getByLabelText("Estimated transaction fee")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  // ── success state ─────────────────────────────────────────────────────────

  it("displays the inclusion fee after a successful simulation", async () => {
    mockSimulate.mockResolvedValue(
      makeFeeEstimate({ inclusionFeeLumens: "0.0000123" }),
    );

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.getByText("0.0000123 XLM")).toBeInTheDocument();
  });

  it("displays the resource fee after a successful simulation", async () => {
    mockSimulate.mockResolvedValue(
      makeFeeEstimate({ resourceFeeLumens: "0.0000789" }),
    );

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.getByText("0.0000789 XLM")).toBeInTheDocument();
  });

  it("displays the total fee with correct formatting after a successful simulation", async () => {
    mockSimulate.mockResolvedValue(
      makeFeeEstimate({ totalFeeLumens: "0.0000912" }),
    );

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.getByText("0.0000912 XLM")).toBeInTheDocument();
  });

  it("renders all three fee rows with their labels", async () => {
    mockSimulate.mockResolvedValue(makeFeeEstimate());

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.getByText("Inclusion fee")).toBeInTheDocument();
    expect(screen.getByText("Resource fee")).toBeInTheDocument();
    expect(screen.getByText("Total fee")).toBeInTheDocument();
  });

  it("hides the loading skeleton after a successful simulation", async () => {
    mockSimulate.mockResolvedValue(makeFeeEstimate());

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.queryByLabelText("Loading fee estimate")).not.toBeInTheDocument();
  });

  it("sets aria-busy to false after a successful simulation", async () => {
    mockSimulate.mockResolvedValue(makeFeeEstimate());

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(screen.getByLabelText("Estimated transaction fee")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  // ── re-trigger on active toggling ─────────────────────────────────────────

  it("re-runs the simulation when active flips from false to true", async () => {
    mockSimulate.mockResolvedValue(makeFeeEstimate());

    const { rerender } = render(<FeeEstimationPanel active={false} />);
    expect(mockSimulate).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<FeeEstimationPanel active={true} />);
    });

    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("calls simulateTransactionFee exactly once per mount when active=true", async () => {
    mockSimulate.mockResolvedValue(makeFeeEstimate());

    await act(async () => {
      render(<FeeEstimationPanel active={true} />);
    });

    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("discards a previous successful estimate and shows a fresh loading state on re-activation", async () => {
    let resolveFirst!: (estimate: ReturnType<typeof makeFeeEstimate>) => void;
    mockSimulate.mockReturnValueOnce(
      new Promise<ReturnType<typeof makeFeeEstimate>>((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const { rerender } = render(<FeeEstimationPanel active={true} />);
    expect(screen.getByLabelText("Loading fee estimate")).toBeInTheDocument();

    await act(async () => {
      resolveFirst(makeFeeEstimate({ totalFeeLumens: "0.0000600" }));
    });
    expect(screen.getByText("0.0000600 XLM")).toBeInTheDocument();

    let resolveSecond!: (estimate: ReturnType<typeof makeFeeEstimate>) => void;
    mockSimulate.mockReturnValueOnce(
      new Promise<ReturnType<typeof makeFeeEstimate>>((resolve) => {
        resolveSecond = resolve;
      }),
    );

    rerender(<FeeEstimationPanel active={false} />);
    await act(async () => {
      rerender(<FeeEstimationPanel active={true} />);
    });

    expect(mockSimulate).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Loading fee estimate")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated transaction fee")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("0.0000600 XLM")).not.toBeInTheDocument();
    expect(screen.queryByText(/Total fee/i)).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond(makeFeeEstimate({ totalFeeLumens: "0.0000777" }));
    });

    expect(screen.getByText("0.0000777 XLM")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading fee estimate")).not.toBeInTheDocument();
  });
});
