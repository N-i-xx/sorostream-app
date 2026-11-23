/**
 * Regression test for issue #933.
 *
 * SchedulingToggle sets `min={minDateTime}` on its datetime-local input, but
 * browser enforcement of `min` on datetime-local inputs is inconsistent
 * across browsers/OSes — some accept an out-of-range (past) value anyway.
 * The create-stream form must not rely on that HTML attribute alone: it has
 * to re-validate the selected start time is actually in the future before
 * letting the user advance or submit.
 *
 * This test simulates exactly that "browser let it through" scenario by
 * firing a change event with a past datetime-local value directly (the same
 * thing a non-conforming browser would do), bypassing the `min` attribute
 * entirely, and asserts the form still catches it.
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

/** A past datetime-local string — what a non-conforming browser might let
 * through despite the input's `min` attribute pointing to the future. */
const PAST_DATETIME = "2000-01-01T00:00";

async function goToAmountStep() {
  const recipientInput = screen.getByTestId("recipient-input");
  fireEvent.change(recipientInput, { target: { value: VALID_RECIPIENT } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByLabelText(/amount/i);
}

describe("Create stream form — scheduled start re-validated beyond the min attribute (#933)", () => {
  beforeEach(() => {
    push.mockReset();
    triggerStreamRefresh.mockReset();
    createStream.mockReset();
    window.sessionStorage.clear();
  });

  it("rejects an out-of-range scheduled start even though the input accepted it", async () => {
    render(<NewStreamPage />);
    await goToAmountStep();

    const amountInput = screen.getByLabelText(/amount/i);
    fireEvent.change(amountInput, { target: { value: "100" } });

    // Enable scheduling.
    const toggle = screen.getByRole("switch", { name: /scheduled start|start immediately/i });
    fireEvent.click(toggle);

    // Simulate a browser that accepted a past value despite min being set to
    // the future — the component must not have trusted the attribute alone.
    const scheduledInput = screen.getByLabelText(/scheduled start date and time/i);
    fireEvent.change(scheduledInput, { target: { value: PAST_DATETIME } });

    await waitFor(() =>
      expect(screen.getByText(/must be in the future/i)).toBeInTheDocument(),
    );

    // Attempting to advance must be blocked by the app's own re-validation,
    // not just the (unreliable) HTML attribute.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
    expect(createStream).not.toHaveBeenCalled();
  });
});
