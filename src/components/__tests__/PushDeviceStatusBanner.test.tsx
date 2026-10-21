/**
 * Tests for the per-device push status banner (#690).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PushDeviceStatusBanner from "@/src/components/PushDeviceStatusBanner";
import type { PushSetupStatus } from "@/src/lib/pushSubscription";

const { getPushSetupStatusMock, subscribeToPushMock, addToastMock } = vi.hoisted(() => ({
  getPushSetupStatusMock: vi.fn(),
  subscribeToPushMock: vi.fn(),
  addToastMock: vi.fn(),
}));

vi.mock("@/src/lib/pushSubscription", () => ({
  getPushSetupStatus: getPushSetupStatusMock,
  subscribeToPush: subscribeToPushMock,
}));

vi.mock("@/src/lib/toast", () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

function status(overrides: Partial<PushSetupStatus> = {}): PushSetupStatus {
  return {
    state: "missing-on-this-device",
    configuredElsewhere: true,
    pushEnabledInPrefs: true,
    hasStoredDeviceRecord: false,
    message:
      "Push notifications aren't set up on this device. Your notification settings show push as enabled, but this browser has no active push subscription.",
    ...overrides,
  };
}

beforeEach(() => {
  getPushSetupStatusMock.mockReset();
  subscribeToPushMock.mockReset();
  addToastMock.mockReset();
});

describe("PushDeviceStatusBanner", () => {
  it("tells the user push is configured but missing on this device", async () => {
    getPushSetupStatusMock.mockResolvedValue(status());

    render(<PushDeviceStatusBanner />);

    expect(
      await screen.findByText(/Push notifications aren't active on this device/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no active push subscription/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enable notifications on this device/i }),
    ).toBeInTheDocument();
  });

  it("re-subscribes on this device and hides once a subscription exists", async () => {
    const user = userEvent.setup();
    getPushSetupStatusMock
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ state: "subscribed", message: null, configuredElsewhere: false }));
    subscribeToPushMock.mockResolvedValue({ endpoint: "https://push.example.com/abc" });

    render(<PushDeviceStatusBanner />);
    await user.click(
      await screen.findByRole("button", { name: /enable notifications on this device/i }),
    );

    await waitFor(() => expect(subscribeToPushMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByText(/Push notifications aren't active on this device/i),
      ).not.toBeInTheDocument(),
    );
    expect(addToastMock).toHaveBeenCalledWith(
      "Push notifications enabled on this device.",
      "success",
    );
  });

  it("surfaces blocked notification permission without offering re-subscribe", async () => {
    getPushSetupStatusMock.mockResolvedValue(
      status({
        state: "permission-denied",
        configuredElsewhere: false,
        message: "Push notifications are blocked for this site in your browser settings.",
      }),
    );

    render(<PushDeviceStatusBanner />);

    expect(
      await screen.findByText(/Push notifications are blocked on this device/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable notifications on this device/i }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when this device is already subscribed", async () => {
    getPushSetupStatusMock.mockResolvedValue(
      status({ state: "subscribed", message: null, configuredElsewhere: false }),
    );

    const { container } = render(<PushDeviceStatusBanner />);

    await waitFor(() => expect(getPushSetupStatusMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("reports the failure if re-subscribing throws", async () => {
    const user = userEvent.setup();
    getPushSetupStatusMock.mockResolvedValue(status());
    subscribeToPushMock.mockRejectedValue(new Error("Notification permission was denied."));

    render(<PushDeviceStatusBanner />);
    await user.click(
      await screen.findByRole("button", { name: /enable notifications on this device/i }),
    );

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith("Notification permission was denied.", "error"),
    );
  });
});
