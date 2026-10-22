import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StreamDetail from "../page";
import { getMockStream } from "@/src/lib/sorostream";

// Mock router & navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock toast context
const mockAddToast = vi.fn();
vi.mock("@/src/lib/toast", () => ({
  useToast: () => ({
    addToast: mockAddToast,
    upsertPersistentToast: vi.fn(),
    removeToast: vi.fn(),
  }),
}));

// Mock wallet context
vi.mock("@/src/context/WalletContext", () => ({
  useWallet: () => ({
    address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    refetchBalance: vi.fn(),
    triggerStreamRefresh: vi.fn(),
  }),
}));

// Mock bookmarks context
vi.mock("@/src/context/BookmarksContext", () => ({
  useBookmarks: () => ({
    isBookmarked: () => false,
    toggleBookmark: vi.fn(),
  }),
}));

// Mock settings context
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

// Mock sorostream SDK
vi.mock("@/src/lib/sorostream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/sorostream")>();
  const now = Date.now();
  return {
    ...actual,
    sorostream: {
      getStream: vi.fn().mockResolvedValue({
        id: "100",
        sender: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        recipient: "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO",
        deposit: 1000000000,
        flowRate: "100",
        startTime: new Date(now - 60000).toISOString(), // 60s elapsed out of 100s -> 60%
        endTime: new Date(now + 40000).toISOString(),
        lastWithdrawTime: new Date(now - 60000).toISOString(),
        status: "Active",
        token: "USDC",
      }),
      getStreamDetails: vi.fn().mockResolvedValue({ stream: {
        id: "100",
        sender: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        recipient: "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO",
        deposit: 1000000000,
        flowRate: "100",
        startTime: new Date(now - 60000).toISOString(), // 60s elapsed out of 100s -> 60%
        endTime: new Date(now + 40000).toISOString(),
        lastWithdrawTime: new Date(now - 60000).toISOString(),
        status: "Active",
        token: "USDC",
      }, claimable: "0", history: [] }),
    },
  };
});

describe("Vesting Milestone Notifications", () => {
  beforeEach(() => {
    localStorage.clear();
    mockAddToast.mockClear();
  });

  it("fires toast notifications when stream crosses 25% and 50% milestones", async () => {
    render(<StreamDetail params={{ id: "100" }} />);

    await waitFor(() => {
      expect(screen.getByText("Stream #100")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("Milestone reached: Stream #100 is 25% completed!"),
        "success",
      );
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("Milestone reached: Stream #100 is 50% completed!"),
        "success",
      );
    });
  });

  it("toggles browser push notification opt-in button on stream detail page", async () => {
    render(<StreamDetail params={{ id: "100" }} />);

    await waitFor(() => {
      expect(screen.getByTestId("milestone-push-toggle")).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId("milestone-push-toggle");
    expect(toggleBtn).toHaveTextContent("Enable Push");

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(toggleBtn).toHaveTextContent("Push Enabled");
    });

    expect(localStorage.getItem("sorostream_milestones_push_100")).toBe("true");
  });
});
