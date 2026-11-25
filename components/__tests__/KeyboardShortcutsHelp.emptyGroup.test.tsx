import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import KeyboardShortcutsHelp from "../KeyboardShortcutsHelp";

vi.mock("@/src/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));

describe("KeyboardShortcutsHelp with an empty shortcut group", () => {
  it("renders the group header with no shortcut rows", () => {
    render(
      <KeyboardShortcutsHelp
        open
        onClose={vi.fn()}
        groups={[{ title: "Navigation", shortcuts: [] }]}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Navigation" });
    expect(heading).toBeInTheDocument();
    expect(heading.parentElement?.children).toHaveLength(2);
    expect(heading.parentElement?.querySelector("kbd")).toBeNull();
  });

  it("does not prevent other groups from rendering", () => {
    render(
      <KeyboardShortcutsHelp
        open
        onClose={vi.fn()}
        groups={[
          { title: "Empty", shortcuts: [] },
          { title: "Navigation", shortcuts: [{ key: "k", description: "Open menu", action: vi.fn() }] },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Navigation" })).toBeInTheDocument();
    expect(screen.getByText("Open menu")).toBeInTheDocument();
  });
});
