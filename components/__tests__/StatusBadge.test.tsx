import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import axe from "axe-core";
import StatusBadge from "../StatusBadge";

afterEach(cleanup);

describe("StatusBadge accessibility", () => {
  it("uses a text label and icon for status and has no axe violations", async () => {
    const { container, getByRole } = render(<StatusBadge status="Active" />);

    expect(getByRole("status")).toHaveTextContent("●Active");
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("uses readable foreground and background classes for lifecycle colors", () => {
    const { container, rerender } = render(<StatusBadge status="Active" />);
    const badge = container.querySelector('[role="status"]')!;
    expect(badge.className).toContain("text-green-900");
    expect(badge.className).toContain("dark:text-green-100");

    rerender(<StatusBadge status="Cancelled" />);
    expect(badge.className).toContain("text-red-900");
    expect(badge.className).toContain("dark:text-red-100");
  });
});
