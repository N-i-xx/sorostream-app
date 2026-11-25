import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VestingPreviewChart from "@/components/VestingPreviewChart";

describe("VestingPreviewChart — invalid cliff (#937)", () => {
  it("silently treats cliffSeconds >= durationSeconds as no cliff, without a validation message", () => {
    render(
      <VestingPreviewChart
        amount="100"
        durationSeconds={1000}
        cliffSeconds={1000} // cliff at the very end: cliff >= duration
      />,
    );

    // The chart itself still renders (amount/duration are valid), it just
    // drops the cliff — it does not bail out and render nothing, and it
    // does not surface any validation/error message about the bad cliff.
    expect(screen.getByText("Vesting Preview")).toBeInTheDocument();
    expect(screen.queryByText("Cliff period ends here")).not.toBeInTheDocument();
    expect(screen.queryByText("Cliff Duration")).not.toBeInTheDocument();
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });

  it("also drops the cliff when cliffSeconds is well past durationSeconds", () => {
    render(
      <VestingPreviewChart amount="100" durationSeconds={1000} cliffSeconds={5000} />,
    );

    expect(screen.getByText("Vesting Preview")).toBeInTheDocument();
    expect(screen.queryByText("Cliff period ends here")).not.toBeInTheDocument();
    expect(screen.queryByText("Cliff Duration")).not.toBeInTheDocument();
  });
});
