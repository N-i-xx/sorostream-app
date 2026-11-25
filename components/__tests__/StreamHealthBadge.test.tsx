/**
 * Regression test for issue #934.
 *
 * The non-compact StreamHealthBadge button both toggles `tooltipOpen` on
 * click and closes it on blur. A rapid click → blur → click sequence (the
 * kind that happens when a user clicks the badge, the click also fires a
 * blur on whatever was previously focused/the badge itself loses focus, and
 * then clicks again quickly) must not leave the tooltip in a state that
 * contradicts the last real user action — i.e. the final click should win.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StreamHealthBadge from "../StreamHealthBadge";

function renderBadge() {
  return render(
    <StreamHealthBadge
      score={82}
      tier="healthy"
      depositRemainingRatio={0.8}
      timeRemainingRatio={0.6}
      topUpCount={0}
    />,
  );
}

describe("StreamHealthBadge tooltip open/close race (#934)", () => {
  it("ends up open after click → blur → click fired in rapid succession", () => {
    renderBadge();
    const button = screen.getByRole("button", { name: /stream health/i });

    // First click opens the tooltip.
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // A blur (e.g. from a stale/queued event during rapid interaction)
    // closes it...
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // ...but a second, real click right after must reopen it — the click
    // handler must not be short-circuited or re-closed by a stale blur
    // that arrives out of order.
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("stays closed when blur is the last event in the rapid sequence", () => {
    renderBadge();
    const button = screen.getByRole("button", { name: /stream health/i });

    fireEvent.click(button); // open
    fireEvent.blur(button); // close
    fireEvent.click(button); // open
    fireEvent.blur(button); // close — this is the last event

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
