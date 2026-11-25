import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotificationBadge from "../NotificationBadge";
import { BADGE_CAP } from "@/src/context/NotificationContext";

describe("NotificationBadge count cap boundary", () => {
  it(`shows exactly ${BADGE_CAP} with no plus suffix`, () => {
    render(<NotificationBadge count={BADGE_CAP} label="dashboard" />);

    expect(screen.getByRole("status").textContent).toBe(String(BADGE_CAP));
  });

  it(`shows ${BADGE_CAP}+ for ${BADGE_CAP + 1}`, () => {
    render(<NotificationBadge count={BADGE_CAP + 1} label="dashboard" />);

    expect(screen.getByRole("status").textContent).toBe(`${BADGE_CAP}+`);
  });
});
