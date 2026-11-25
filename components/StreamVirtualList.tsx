"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import StreamCard from "@/components/StreamCard";
import type { StreamData } from "@/src/lib/sorostream";

interface StreamVirtualListProps {
  streams: StreamData[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Invoked when the user clicks the clone action on a stream card. */
  onClone?: (id: string) => void;
  /** ID of the stream currently focused via keyboard navigation. */
  focusedStreamId?: string;
  /** Active optimistic operations keyed by stream ID. */
  optimisticOps?: Record<string, { type: string; optimisticDeposit?: number; optimisticStatus?: string; optimisticClaimable?: number }>;
  /** Active search text — forwarded to each card so matches are highlighted. */
  highlightQuery?: string;
}

/** Estimated row height in px (two-column grid). Grows if items are taller. */
const BASE_ROW_HEIGHT = 280;
const OVERSCAN_ROWS = 5;

export default function StreamVirtualList({ streams, selectedIds, onToggleSelect, onClone, focusedStreamId, optimisticOps, highlightQuery }: StreamVirtualListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTop = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(760);
  // Actual grid column count: 1 below the `md` breakpoint, 2 at/above it
  // (matches the `md:grid-cols-2` class on the grid below).
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      setContainerHeight(container.clientHeight || 760);
    };

    updateHeight();

    const handleScroll = () => {
      savedScrollTop.current = container.scrollTop;
      setScrollTop(container.scrollTop);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateHeight);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 768px)"); // Tailwind `md`
    const updateColumns = () => setColumnCount(mql.matches ? 2 : 1);
    updateColumns();
    mql.addEventListener("change", updateColumns);
    return () => mql.removeEventListener("change", updateColumns);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (container.scrollTop !== savedScrollTop.current) {
      container.scrollTop = savedScrollTop.current;
    }
  }, [streams]);

  // Restore the scroll position synchronously after a background refresh so
  // the user never loses their place in the list (the visible jump-to-top is
  // avoided because this runs before the browser paints).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const target = savedScrollTop.current;
    if (target > 0 && container.scrollTop !== target) {
      container.scrollTop = target;
    }
  }, [streams]);

  // Scroll focused stream card into view when keyboard-navigated.
  useEffect(() => {
    if (!focusedStreamId || !containerRef.current) return;
    const idx = streams.findIndex((s) => s.id === focusedStreamId);
    if (idx < 0) return;
    const row = Math.floor(idx / columnCount);
    const targetTop = row * BASE_ROW_HEIGHT;
    const container = containerRef.current;
    const visibleBottom = container.scrollTop + container.clientHeight;
    if (targetTop < container.scrollTop || targetTop + BASE_ROW_HEIGHT > visibleBottom) {
      container.scrollTop = Math.max(0, targetTop - container.clientHeight / 2);
    }
  }, [focusedStreamId, streams, columnCount]);

  /** Keyboard navigation inside the virtual list. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const ROW_PX = BASE_ROW_HEIGHT;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          container.scrollTop += ROW_PX / 2;
          break;
        case "ArrowUp":
          e.preventDefault();
          container.scrollTop -= ROW_PX / 2;
          break;
        case "PageDown":
          e.preventDefault();
          container.scrollTop += containerHeight;
          break;
        case "PageUp":
          e.preventDefault();
          container.scrollTop -= containerHeight;
          break;
        case "Home":
          e.preventDefault();
          container.scrollTop = 0;
          break;
        case "End":
          e.preventDefault();
          container.scrollTop = container.scrollHeight;
          break;
      }
    },
    [containerHeight],
  );

  // Roving-focus refs for each visible stream card (#616): lets ArrowUp/Down/
  // Left/Right move real DOM focus between cards, on top of the native Tab
  // order that already works because each card is rendered as an <a>.
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const registerItemRef = useCallback(
    (id: string) => (el: HTMLAnchorElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
    [],
  );

  const focusStreamAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= streams.length) return;
      const el = itemRefs.current.get(streams[index].id);
      el?.focus();
    },
    [streams],
  );

  /** Arrow-key navigation between stream cards, respecting the actual grid
   *  column count (1 column below `md`, 2 at/above it). */
  const handleItemKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLAnchorElement>, streamId: string) => {
      const currentIndex = streams.findIndex((s) => s.id === streamId);
      if (currentIndex < 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          focusStreamAt(
            currentIndex + columnCount < streams.length ? currentIndex + columnCount : currentIndex,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          focusStreamAt(currentIndex - columnCount >= 0 ? currentIndex - columnCount : currentIndex);
          break;
        case "ArrowRight":
          e.preventDefault();
          focusStreamAt(Math.min(currentIndex + 1, streams.length - 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          focusStreamAt(Math.max(currentIndex - 1, 0));
          break;
        // Enter/Space activate the link natively; no handler needed.
      }
    },
    [streams, focusStreamAt, columnCount],
  );

  const rowCount = useMemo(() => Math.ceil(streams.length / columnCount), [streams.length, columnCount]);
  const totalHeight = rowCount * BASE_ROW_HEIGHT;

  const startRow = useMemo(() => {
    return Math.max(0, Math.floor(scrollTop / BASE_ROW_HEIGHT) - OVERSCAN_ROWS);
  }, [scrollTop]);

  const endRow = useMemo(() => {
    return Math.min(
      rowCount,
      Math.ceil((scrollTop + containerHeight) / BASE_ROW_HEIGHT) + OVERSCAN_ROWS,
    );
  }, [scrollTop, containerHeight, rowCount]);

  const visibleStreams = useMemo(
    () => streams.slice(startRow * columnCount, endRow * columnCount),
    [streams, startRow, endRow, columnCount],
  );

  return (
    <div
      ref={containerRef}
      data-testid="stream-list"
      className="relative overflow-y-auto max-h-[calc(100vh-240px)]"
      role="list"
      aria-label="Stream list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div style={{ height: `${totalHeight}px`, position: "relative" }}>
        <div
          style={{
            transform: `translateY(${startRow * BASE_ROW_HEIGHT}px)`,
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {visibleStreams.map((stream, idx) => (
              <div
                key={stream.id}
                className={`block rounded-xl transition-shadow ${
                  stream.id === focusedStreamId
                    ? "ring-2 ring-green-500 ring-offset-2 ring-offset-gray-900"
                    : ""
                }`}
                role="listitem"
              >
                <div className="relative">
                  <Link
                    href={`/stream/${stream.id}`}
                    className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 rounded-xl"
                    ref={registerItemRef(stream.id)}
                    onKeyDown={(e) => handleItemKeyDown(e, stream.id)}
                  >
                    <StreamCard
                      id={stream.id}
                      sender={stream.sender}
                      recipient={stream.recipient}
                      flowRate={stream.flowRate}
                      deposit={stream.deposit}
                      status={stream.status}
                      selected={selectedIds?.has(stream.id)}
                      onToggle={onToggleSelect}
                      onClone={onClone}
                      scheduledStartTime={stream.scheduledStartTime}
                      startTime={stream.startTime}
                      endTime={stream.endTime}
                      pausedAt={stream.pausedAt}
                      optimisticPending={Boolean(optimisticOps?.[stream.id])}
                      optimisticStatus={optimisticOps?.[stream.id]?.optimisticStatus}
                      optimisticDeposit={optimisticOps?.[stream.id]?.optimisticDeposit}
                      optimisticClaimable={optimisticOps?.[stream.id]?.optimisticClaimable}
                      highlightQuery={highlightQuery}
                    />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {streams.length > 0 && (
        <div className="sr-only" aria-live="polite">
          Showing {Math.min(endRow * 2, streams.length)} of {streams.length} streams
        </div>
      )}
    </div>
  );
}
