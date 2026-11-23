/**
 * Regression test for issue #931.
 *
 * BatchCreateTab's handleSubmit catch block (entire-batch-failure path)
 * builds `failedResults` from `rows`, not from `validRows`. A row that
 * failed CSV validation (`row.errors.length > 0`) must keep its original
 * "Skipped: ..." message, while a row that was valid and submitted (but the
 * whole batch transaction failed) should get the generic batch error
 * message. This test forces `sorostream.batch_create` to reject and asserts
 * the invalid row still shows its own validation reason, not the batch
 * failure message.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BatchCreateTab from "../BatchCreateTab";

const { batch_create } = vi.hoisted(() => ({ batch_create: vi.fn() }));

vi.mock("@/src/lib/sorostream", () => ({
  sorostream: { batch_create },
}));

const VALID_RECIPIENT = "GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL1";

const CSV = `recipient,amount,duration,cliff_days,token
${VALID_RECIPIENT},100,2592000,0,USDC
not-a-valid-key,50,86400,0,USDC
`;

function uploadCsv() {
  const file = new File([CSV], "batch.csv", { type: "text/csv" });
  const input = screen.getByLabelText(/csv file input/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("BatchCreateTab — entire-batch-failure path preserves skip reasons (#931)", () => {
  beforeEach(() => {
    batch_create.mockReset();
  });

  it("keeps the invalid row's original validation error instead of the batch error message", async () => {
    batch_create.mockRejectedValue(new Error("Batch transaction failed on-chain."));

    render(<BatchCreateTab />);
    uploadCsv();

    await waitFor(() => expect(screen.getByText("2").closest("tr")).toBeTruthy());

    // Sanity: one valid row, one invalid row parsed.
    await waitFor(() =>
      expect(screen.getByText(/valid Stellar public key/i)).toBeInTheDocument(),
    );

    const submitButton = screen.getByRole("button", { name: /create 1 stream/i });
    fireEvent.click(submitButton);

    await waitFor(() => expect(batch_create).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByText(/all 1 rows failed/i)).toBeInTheDocument(),
    );

    // The invalid row must still show its own "Skipped: ..." validation
    // reason, not the generic batch failure message.
    expect(
      screen.getByText(/skipped: recipient must be a valid stellar public key/i),
    ).toBeInTheDocument();

    // The generic batch error message must apply only to the row that was
    // actually submitted (the valid one), never overwrite the invalid row's
    // own reason.
    expect(screen.getByText(/batch transaction failed on-chain\./i)).toBeInTheDocument();
    expect(
      screen.queryAllByText(/batch transaction failed on-chain\./i).length,
    ).toBe(1);
  });
});
