import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RouteErrorFallback } from "../RouteErrorFallback";

describe("RouteErrorFallback", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders the fallback content and retry action", () => {
    const onRetry = vi.fn();

    render(
      <RouteErrorFallback
        title="Stream details unavailable"
        description="We could not load this stream view."
        error={new Error("fetch failed")}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Stream details unavailable")).toBeInTheDocument();
    expect(screen.getByText(/We could not load this stream view/i)).toBeInTheDocument();
    expect(screen.getByText("fetch failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("gives network failures connection guidance", () => {
    render(<RouteErrorFallback error={new TypeError("fetch failed")} />);
    expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument();
  });

  it("gives application errors generic report guidance", () => {
    render(<RouteErrorFallback error={new Error("render exploded")} />);
    expect(screen.getByText(/report the issue if it continues/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your internet connection/i)).not.toBeInTheDocument();
  });

  it("classifies a mixed-case 'Failed to load chunk' message as a network error", () => {
    render(<RouteErrorFallback error={new Error("Failed to load chunk")} />);
    expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument();
    expect(screen.queryByText(/report the issue if it continues/i)).not.toBeInTheDocument();
    expect(screen.getByText("Failed to load chunk")).toBeInTheDocument();
  });
});
