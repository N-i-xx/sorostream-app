import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionExportButton from "@/components/TransactionExportButton";
import * as exportLib from "@/src/lib/export";
import type { StreamHistoryEntry } from "@/src/lib/export";

const entries: StreamHistoryEntry[] = [
  { timestamp: new Date().toISOString(), type: "withdrawal", amount: "10000000", txHash: "0x1" },
];

describe("TransactionExportButton — clicking Export while dropdown open (#936)", () => {
  beforeEach(() => {
    vi.spyOn(exportLib, "exportTransactions").mockResolvedValue({
      filename: "export.json",
      mimeType: "application/json",
    });
  });

  it("still exports with the currently selected format when the format dropdown is open", async () => {
    const onExported = vi.fn();
    render(<TransactionExportButton entries={entries} account="GTEST" onExported={onExported} />);

    // Open the format dropdown and pick JSON.
    fireEvent.click(screen.getByLabelText("Select export format"));
    fireEvent.click(screen.getByRole("option", { name: /JSON/i }));

    // Re-open the dropdown so it is open when we click the main Export button.
    fireEvent.click(screen.getByLabelText("Select export format"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Export \d+ transaction/i }));

    await waitFor(() => expect(exportLib.exportTransactions).toHaveBeenCalledTimes(1));
    expect(exportLib.exportTransactions).toHaveBeenCalledWith(
      entries,
      "json",
      "GTEST",
      undefined,
      expect.any(Function),
    );
    await waitFor(() => expect(onExported).toHaveBeenCalledWith("export.json"));
  });
});
