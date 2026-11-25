import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import OnboardingWizard from "../OnboardingWizard";
import { useRouter } from "next/navigation";

vi.mock("@/src/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

const mockConnect = vi.fn();
let mockAddress: string | null = null;

vi.mock("@/src/context/WalletContext", () => ({
  useWallet: () => ({
    address: mockAddress,
    publicKey: mockAddress,
    isConnecting: false,
    error: null,
    networkMismatch: false,
    connect: mockConnect,
    disconnect: vi.fn(),
  }),
}));

const routerPush = vi.fn();

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value.toString(); }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.removeItem("sorostream-onboarding-complete");
    mockAddress = null;
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens automatically on first visit and starts on step 1", () => {
    render(<OnboardingWizard />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /welcome to sorostream/i })).toBeInTheDocument();
  });

  it("advances from step 1 to step 2 when the primary action is clicked", () => {
    render(<OnboardingWizard />);

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /connect your wallet/i })).toBeInTheDocument();
    expect(screen.queryByText("Step 1 of 5")).not.toBeInTheDocument();
  });

  it("jumps to the final step when Skip is clicked", () => {
    render(<OnboardingWizard />);

    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /all set/i })).toBeInTheDocument();
  });

  it("fires onComplete and navigates to the dashboard after the final step", () => {
    mockAddress = "GB7TJKR6KZ3L3LYPZNAZQJR4HGLJ4E7MSTFJZXQZ2RL4QJKZKSX6JQJ5";
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);

    // Walk through all four action steps, then finish on the final step.
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick a template" }));
    fireEvent.click(screen.getByRole("button", { name: "Create first stream" }));

    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not advance when wallet connection is not completed", async () => {
    mockConnect.mockResolvedValue(null);
    render(<OnboardingWizard />);

    // Reach the connect-wallet step.
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();

    // Required wallet connection fails → the wizard stays on step 2.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    });

    expect(mockConnect).toHaveBeenCalled();
    expect(screen.getByText(/wallet connection was not completed/i)).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /connect your wallet/i })).toBeInTheDocument();
  });

  it("stays on connect-wallet with an error when connect() resolves false without throwing", async () => {
    mockConnect.mockResolvedValueOnce(false);
    render(<OnboardingWizard />);

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/wallet connection was not completed/i)).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /connect your wallet/i })).toBeInTheDocument();
    expect(screen.queryByText("Step 3 of 5")).not.toBeInTheDocument();
  });
});