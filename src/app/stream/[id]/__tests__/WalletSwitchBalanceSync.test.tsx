import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import StreamDetail from "../page";

// Mock router & navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock toast context
vi.mock("@/src/lib/toast", () => ({
  useToast: () => ({
    addToast: vi.fn(),
    upsertPersistentToast: vi.fn(),
    removeToast: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Wallet context mock with a mutable address so we can simulate the user
// switching accounts mid-session (e.g. inside Freighter) without a full
// disconnect/reconnect cycle.
// ---------------------------------------------------------------------------
const WALLET_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const WALLET_B = "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO";

let mockAddress: string | null = WALLET_A;

vi.mock("@/src/context/WalletContext", () => ({
  useWallet: () => ({
    address: mockAddress,
    refetchBalance: vi.fn(),
    triggerStreamRefresh: vi.fn(),
  }),
}));

vi.mock("@/src/context/BookmarksContext", () => ({
  useBookmarks: () => ({
    isBookmarked: () => false,
    toggleBookmark: vi.fn(),
  }),
}));

vi.mock("@/src/context/SettingsContext", () => ({
  useSettings: () => ({
    withdrawThreshold: 10,
  }),
}));

// StreamQrModal on the page reads the selected network.
vi.mock("@/src/lib/network", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/network")>()),
  useNetwork: () => ({ network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org", setNetwork: vi.fn() }),
}));

vi.mock("@/src/context/XlmPriceContext", () => ({
  useSharedXlmPrice: () => ({ price: null, loading: false }),
}));

const getStreamMock = vi.fn();

vi.mock("@/src/lib/sorostream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/sorostream")>();
  return {
    ...actual,
    sorostream: {
      ...actual.sorostream,
      getStream: (...args: unknown[]) => getStreamMock(...args),
      // The page's initial load calls getStreamDetails, not getStream —
      // route it through the same mock so both the initial fetch and the
      // wallet-switch re-fetch are observable via getStreamMock.
      getStreamDetails: async (...args: unknown[]) => {
        const stream = await getStreamMock(...args);
        return { stream, claimable: "0", history: [] };
      },
    },
  };
});

function mockStream(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    id: "100",
    sender: WALLET_A,
    recipient: WALLET_B,
    deposit: 1_000_000_000,
    flowRate: "100",
    startTime: new Date(now - 60_000).toISOString(),
    endTime: new Date(now + 40_000).toISOString(),
    lastWithdrawTime: new Date(now - 60_000).toISOString(),
    status: "Active",
    token: "USDC",
    ...overrides,
  };
}

describe("Stream balance re-sync on mid-session wallet switch (#630)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockAddress = WALLET_A;
    getStreamMock.mockReset();
    getStreamMock.mockResolvedValue(mockStream());
  });

  it("re-fetches the stream when the connected wallet address changes without disconnecting", async () => {
    const { rerender } = render(<StreamDetail params={{ id: "100" }} />);

    await waitFor(() => {
      expect(getStreamMock).toHaveBeenCalledTimes(1);
    });

    // Simulate switching accounts inside Freighter mid-session — address
    // goes straight from WALLET_A to WALLET_B without ever becoming null.
    mockAddress = WALLET_B;
    rerender(<StreamDetail params={{ id: "100" }} />);

    await waitFor(() => {
      expect(getStreamMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not spuriously re-fetch when address stays the same across a re-render", async () => {
    const { rerender } = render(<StreamDetail params={{ id: "100" }} />);

    await waitFor(() => {
      expect(getStreamMock).toHaveBeenCalledTimes(1);
    });

    rerender(<StreamDetail params={{ id: "100" }} />);

    // No address change → no additional fetch triggered by the wallet-switch effect.
    await waitFor(() => {
      expect(screen.getByText("Stream #100")).toBeInTheDocument();
    });
    expect(getStreamMock).toHaveBeenCalledTimes(1);
  });
});
