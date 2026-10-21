"use client";

import { useCallback, useMemo, useState } from "react";

/** Number of streams shown per dashboard page (and fetched on initial load). */
export const DASHBOARD_PAGE_SIZE = 20;

/** Total number of pages for `itemCount` items; always at least 1. */
export function getTotalPages(itemCount: number, pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  if (!Number.isFinite(itemCount) || itemCount <= 0) return 1;
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

/** Clamp `page` into the valid range `[1, totalPages]`. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, totalPages));
}

/** Clamp a page and report whether the resulting page differs from the input. */
export function clampPageWithInfo(
  page: number,
  totalPages: number,
): { page: number; wasClamped: boolean } {
  const clampedPage = clampPage(page, totalPages);
  return { page: clampedPage, wasClamped: clampedPage !== page };
}

/**
 * Page-based pagination state.
 *
 * The current page is preserved when `itemCount` or `pageSize` changes
 * (e.g. after a filter, a sort, or a settings change to the page size) and
 * the page count is recalculated. The page is only moved if it would fall
 * past the new last page.
 */
export function usePagination(itemCount: number, pageSize: number = DASHBOARD_PAGE_SIZE) {
  // An invalid page size (below 1, or NaN from a bad setting) would make
  // every slice empty, so fall back to the dashboard default.
  const effectivePageSize =
    Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : DASHBOARD_PAGE_SIZE;

  const [rawPage, setRawPage] = useState(1);
  const totalPages = useMemo(
    () => getTotalPages(itemCount, effectivePageSize),
    [itemCount, effectivePageSize],
  );
  const currentPage = clampPage(rawPage, totalPages);

  // Re-clamp the stored page in the same render whenever the total shrinks
  // (#715). Doing this during render rather than in an effect means the
  // stored value never points past the last page, so no frame or callback
  // ever sees an out-of-range page after a page-size or item-count change.
  if (rawPage !== currentPage) setRawPage(currentPage);

  const setPage = useCallback(
    (page: number) => setRawPage(clampPage(page, totalPages)),
    [totalPages],
  );
  const nextPage = useCallback(() => setPage(currentPage + 1), [setPage, currentPage]);
  const prevPage = useCallback(() => setPage(currentPage - 1), [setPage, currentPage]);

  const pageStart = (currentPage - 1) * effectivePageSize;
  const pageEnd = pageStart + effectivePageSize;

  return {
    currentPage,
    totalPages,
    pageStart,
    pageEnd,
    setPage,
    nextPage,
    prevPage,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
}
