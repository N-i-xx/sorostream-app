import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_PAGE_SIZE,
  clampPage,
  clampPageWithInfo,
  getTotalPages,
  usePagination,
} from "@/src/lib/pagination";
import { getStreamsForWallet, getStreamsPageForWallet } from "@/src/lib/sorostream";

describe("getTotalPages", () => {
  it("rounds up and never returns less than 1", () => {
    expect(getTotalPages(0, 20)).toBe(1);
    expect(getTotalPages(20, 20)).toBe(1);
    expect(getTotalPages(21, 20)).toBe(2);
    expect(getTotalPages(45, 20)).toBe(3);
  });

  it("returns 1 for a non-finite page size", () => {
    expect(getTotalPages(45, Number.NaN)).toBe(1);
    expect(getTotalPages(45, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("clampPage", () => {
  it("keeps the page inside [1, totalPages]", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(Number.NaN, 3)).toBe(1);
  });
});

describe("clampPageWithInfo", () => {
  it("reports when it clamps an out-of-range page", () => {
    expect(clampPageWithInfo(8, 3)).toEqual({ page: 3, wasClamped: true });
  });

  it("reports when the requested page is already valid", () => {
    expect(clampPageWithInfo(2, 3)).toEqual({ page: 2, wasClamped: false });
  });
});

describe("usePagination", () => {
  it("uses a page size of 20 for the dashboard", () => {
    expect(DASHBOARD_PAGE_SIZE).toBe(20);
  });

  it("filter + sort on page 2 stays on page 2 and recalculates the page count", () => {
    // Simulates the dashboard: 60 streams, then a filter reduces them to 45,
    // then a sort reorders the same 45.
    const { result, rerender } = renderHook(
      ({ count }) => usePagination(count, 20),
      { initialProps: { count: 60 } },
    );
    expect(result.current.totalPages).toBe(3);

    act(() => result.current.setPage(2));
    expect(result.current.currentPage).toBe(2);

    // Filter applied — fewer items, but page 2 still exists.
    rerender({ count: 45 });
    expect(result.current.currentPage).toBe(2);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageStart).toBe(20);
    expect(result.current.pageEnd).toBe(40);

    // Sort applied — count unchanged, page preserved.
    rerender({ count: 45 });
    expect(result.current.currentPage).toBe(2);
    expect(result.current.totalPages).toBe(3);
  });

  it("moves to the new last page when a filter removes the current page", () => {
    const { result, rerender } = renderHook(
      ({ count }) => usePagination(count, 20),
      { initialProps: { count: 60 } },
    );
    act(() => result.current.setPage(3));

    rerender({ count: 30 });
    expect(result.current.totalPages).toBe(2);
    expect(result.current.currentPage).toBe(2);
    expect(result.current.hasNext).toBe(false);
  });

  it("re-clamps a stored page when the page size grows mid-session (#715)", () => {
    // 60 items at 10 per page → 6 pages; the user is on page 6.
    const { result, rerender } = renderHook(
      ({ size }) => usePagination(60, size),
      { initialProps: { size: 10 } },
    );
    act(() => result.current.setPage(6));
    expect(result.current.currentPage).toBe(6);

    // Page size changes to 20 → only 3 pages. Page 6 is out of range.
    rerender({ size: 20 });
    expect(result.current.totalPages).toBe(3);
    expect(result.current.currentPage).toBe(3);
    expect(result.current.pageStart).toBe(40);
    expect(result.current.pageEnd).toBe(60);
    expect(result.current.hasNext).toBe(false);

    // The stored page itself was clamped, not just the derived value:
    // going back to 10 per page keeps page 3 instead of jumping to 6.
    rerender({ size: 10 });
    expect(result.current.totalPages).toBe(6);
    expect(result.current.currentPage).toBe(3);
  });

  it("keeps the page usable when the page size is invalid", () => {
    const { result } = renderHook(() => usePagination(45, Number.NaN));
    expect(result.current.totalPages).toBe(Math.ceil(45 / DASHBOARD_PAGE_SIZE));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageEnd).toBe(DASHBOARD_PAGE_SIZE);
  });

  it("does not go past the first or last page", () => {
    const { result } = renderHook(() => usePagination(25, 20));
    act(() => result.current.prevPage());
    expect(result.current.currentPage).toBe(1);
    act(() => result.current.nextPage());
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(2);
  });
});

describe("getStreamsPageForWallet", () => {
  it("returns only the requested slice plus the total", () => {
    const all = getStreamsForWallet(null);
    const first = getStreamsPageForWallet(null, { limit: 2 });
    expect(first.total).toBe(all.length);
    expect(first.streams.length).toBe(Math.min(2, all.length));

    const rest = getStreamsPageForWallet(null, { offset: 2, limit: all.length });
    const ids = [...first.streams, ...rest.streams].map((s) => s.id);
    expect(new Set(ids).size).toBe(all.length);
  });

  it("orders streams newest first", () => {
    const { streams } = getStreamsPageForWallet(null, { limit: 100 });
    for (let i = 1; i < streams.length; i++) {
      expect(new Date(streams[i - 1].startTime).getTime()).toBeGreaterThanOrEqual(
        new Date(streams[i].startTime).getTime(),
      );
    }
  });
});
