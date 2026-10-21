/**
 * Regression tests for #599 — "Create stream form validation does not clear
 * error messages on correction".
 *
 * The create-stream wizard keeps a single `errors` object. Before the fix,
 * several code paths set an error for a field *without* marking that field as
 * touched, and several input paths (notably pasting into the amount field)
 * never re-validated the value. The result was a stale error message that
 * stayed on screen after the user had already corrected the input, and — in
 * the opposite direction — a message that vanished as soon as the next
 * character was typed even though the value was still invalid.
 *
 * These tests pin the behaviour down:
 *
 *   1. An error is cleared as soon as the field becomes valid.
 *   2. Validation re-runs on every input change, so the message keeps
 *      describing the *current* value.
 *   3. Pasting into the amount field re-validates just like typing does.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewStreamPage from "@/src/app/stream/new/page";

const push = vi.fn();
const triggerStreamRefresh = vi.fn();
const { createStream } = vi.hoisted(() => ({ createStream: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/src/context/WalletContext", () => ({
  useWallet: () => ({
    address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    isConnecting: false,
    error: null,
    triggerStreamRefresh,
  }),
}));

vi.mock("@/src/context/PreferencesContext", () => ({
  usePreferences: () => ({
    defaultToken: "USDC",
    defaultDuration: 3600,
    defaultCliffDuration: 0,
  }),
}));

vi.mock("@/src/context/SettingsContext", () => ({
  useSettings: () => ({ streamThreshold: 10000, language: "en" }),
}));

vi.mock("@/src/context/XlmPriceContext", () => ({
  useSharedXlmPrice: () => ({ price: null, loading: false }),
}));

vi.mock("@/src/lib/addressVerification", () => ({
  verifyAddress: vi.fn().mockResolvedValue({
    status: "verified",
    address: "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO",
    federationName: null,
    accountExists: true,
    error: null,
    lastCheckedAt: Date.now(),
  }),
  canCreateStream: vi.fn((verification) => verification?.status !== "unverified"),
}));

vi.mock("@/src/lib/sorostream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/sorostream")>();
  return {
    ...actual,
    sorostream: { ...actual.sorostream, createStream },
    getStreamCapConfig: vi.fn().mockResolvedValue({ maxDepositStroops: 10_000_000_000 }),
    getCollateralConfig: vi.fn().mockResolvedValue({ basisPoints: 0 }),
    checkIsNewSender: vi.fn().mockResolvedValue(false),
    getGasFeeEstimate: vi.fn().mockResolvedValue({ gasFee: "100", fee: "100" }),
    validateMetadataUri: vi.fn().mockReturnValue(""),
  };
});

const VALID_RECIPIENT = "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO";
const INVALID_RECIPIENT_ERROR = /valid Stellar public key/i;
const INVALID_AMOUNT_ERROR = /greater than 0/i;

/** Fill in a valid recipient and advance to the amount step. */
async function goToAmountStep() {
  const recipientInput = screen.getByTestId("recipient-input");
  fireEvent.change(recipientInput, { target: { value: VALID_RECIPIENT } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  return await screen.findByLabelText(/amount/i);
}

describe("Create stream form — error clearing on correction (#599)", () => {
  beforeEach(() => {
    push.mockReset();
    triggerStreamRefresh.mockReset();
    createStream.mockReset();
    window.sessionStorage.clear();
  });

  // ── Recipient ──────────────────────────────────────────────────────────────

  it("clears the recipient error once the address is corrected", async () => {
    render(<NewStreamPage />);

    const recipientInput = screen.getByTestId("recipient-input");
    fireEvent.change(recipientInput, { target: { value: "NOT-A-VALID-KEY" } });
    fireEvent.blur(recipientInput);

    await waitFor(() =>
      expect(screen.getByText(INVALID_RECIPIENT_ERROR)).toBeInTheDocument(),
    );

    // The user corrects the address: the error must go away.
    fireEvent.change(recipientInput, { target: { value: VALID_RECIPIENT } });

    await waitFor(() =>
      expect(screen.queryByText(INVALID_RECIPIENT_ERROR)).not.toBeInTheDocument(),
    );
  });

  it("re-runs recipient validation on every input change", async () => {
    render(<NewStreamPage />);

    const recipientInput = screen.getByTestId("recipient-input");
    fireEvent.change(recipientInput, { target: { value: "NOT-A-VALID-KEY" } });
    fireEvent.blur(recipientInput);

    await waitFor(() =>
      expect(screen.getByText(INVALID_RECIPIENT_ERROR)).toBeInTheDocument(),
    );

    // Still invalid after another keystroke: the message must stay on screen
    // and keep describing the current value, rather than disappearing and
    // leaving the user with a false sense of correctness.
    fireEvent.change(recipientInput, { target: { value: "NOT-A-VALID-KEY-EITHER" } });

    await waitFor(() =>
      expect(screen.getByText(INVALID_RECIPIENT_ERROR)).toBeInTheDocument(),
    );

    // …and it clears as soon as the value becomes valid.
    fireEvent.change(recipientInput, { target: { value: VALID_RECIPIENT } });

    await waitFor(() =>
      expect(screen.queryByText(INVALID_RECIPIENT_ERROR)).not.toBeInTheDocument(),
    );
  });

  it("does not raise a recipient error before the field has been left", async () => {
    render(<NewStreamPage />);

    const recipientInput = screen.getByTestId("recipient-input");
    fireEvent.change(recipientInput, { target: { value: "G" } });

    // The user is still typing — no error is thrown at them mid-edit.
    expect(screen.queryByText(INVALID_RECIPIENT_ERROR)).not.toBeInTheDocument();
  });

  // ── Amount ─────────────────────────────────────────────────────────────────

  it("clears the amount error once the amount is corrected", async () => {
    render(<NewStreamPage />);
    const amountInput = await goToAmountStep();

    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.blur(amountInput);

    await waitFor(() =>
      expect(screen.getByText(INVALID_AMOUNT_ERROR)).toBeInTheDocument(),
    );

    fireEvent.change(amountInput, { target: { value: "100" } });

    await waitFor(() =>
      expect(screen.queryByText(INVALID_AMOUNT_ERROR)).not.toBeInTheDocument(),
    );
  });

  it("clears an amount error raised by 'Next' once the amount is corrected", async () => {
    render(<NewStreamPage />);
    const amountInput = await goToAmountStep();

    fireEvent.change(amountInput, { target: { value: "0" } });
    // Clicking "Next" raises the validation error. The field is marked as
    // touched by that same interaction, so the next edit re-validates it.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(screen.getByText(INVALID_AMOUNT_ERROR)).toBeInTheDocument(),
    );

    fireEvent.change(amountInput, { target: { value: "100" } });

    await waitFor(() =>
      expect(screen.queryByText(INVALID_AMOUNT_ERROR)).not.toBeInTheDocument(),
    );
  });

  it("re-validates a pasted amount so a stale error does not survive", async () => {
    render(<NewStreamPage />);
    const amountInput = await goToAmountStep();

    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(screen.getByText(INVALID_AMOUNT_ERROR)).toBeInTheDocument(),
    );

    // Pasting is an edit like any other and must re-validate the field.
    // "1,000" is cleaned to "1000" by the paste handler, which is what makes
    // the handler run at all.
    fireEvent.paste(amountInput, { clipboardData: { getData: () => "1,000" } });

    await waitFor(() =>
      expect((amountInput as HTMLInputElement).value).toBe("1000"),
    );
    await waitFor(() =>
      expect(screen.queryByText(INVALID_AMOUNT_ERROR)).not.toBeInTheDocument(),
    );
  });

  it("keeps the amount error visible while the amount is still invalid", async () => {
    render(<NewStreamPage />);
    const amountInput = await goToAmountStep();

    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.blur(amountInput);

    await waitFor(() =>
      expect(screen.getByText(INVALID_AMOUNT_ERROR)).toBeInTheDocument(),
    );

    // "abc" is not a number: the message must be updated, not dropped.
    fireEvent.change(amountInput, { target: { value: "abc" } });

    await waitFor(() =>
      expect(screen.getByText(/only numbers/i)).toBeInTheDocument(),
    );
  });

  it("keeps the amount error accurate when it was raised by 'Next'", async () => {
    render(<NewStreamPage />);
    const amountInput = await goToAmountStep();

    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(screen.getByText(INVALID_AMOUNT_ERROR)).toBeInTheDocument(),
    );

    // The error was raised by "Next", not by a blur. The next edit must still
    // re-validate: "abc" is invalid, so the message has to change rather than
    // disappear or keep claiming the amount is out of range.
    fireEvent.change(amountInput, { target: { value: "abc" } });

    await waitFor(() =>
      expect(screen.getByText(/only numbers/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(INVALID_AMOUNT_ERROR)).not.toBeInTheDocument();
  });
});
