/**
 * @vitest-environment node
 *
 * Tests for src/lib/activitySort.ts (#852).
 *
 * Key scenario: sorting by "amount" previously called BigInt() directly on
 * the amount string. BigInt() throws a SyntaxError for decimal strings such
 * as "12.5", which would crash the page whenever a StreamEvent carried a
 * non-integer amount. The fix truncates to the integer part before converting.
 */

import type { StreamEvent } from "../src/lib/sorostream";
import {
  parseActivitySort,
  sortActivityEvents,
  toggleActivitySort,
} from "../src/lib/activitySort";

// Minimal StreamEvent factory — only the fields the sort logic touches.
function makeEvent(overrides: Partial<StreamEvent>): StreamEvent {
  return {
    id: "e0",
    type: "withdrawal",
    streamId: "1",
    timestamp: new Date().toISOString(),
    txHash: "0x0",
    ...overrides,
  };
}

describe("sortActivityEvents — amount column (#852)", () => {
  it("does not throw when an event has a decimal amount string", () => {
    const events = [
      makeEvent({ id: "e1", amount: "12.5" }),
      makeEvent({ id: "e2", amount: "5.9" }),
    ];
    const sort = { field: "amount" as const, dir: "desc" as const };

    expect(() => sortActivityEvents(events, sort)).not.toThrow();
  });

  it("sorts decimal amounts by their integer parts descending", () => {
    const events = [
      makeEvent({ id: "e1", amount: "5.9" }),
      makeEvent({ id: "e2", amount: "12.5" }),
      makeEvent({ id: "e3", amount: "3.1" }),
    ];
    const sort = { field: "amount" as const, dir: "desc" as const };
    const sorted = sortActivityEvents(events, sort);

    expect(sorted.map((e) => e.id)).toEqual(["e2", "e1", "e3"]);
  });

  it("sorts decimal amounts ascending", () => {
    const events = [
      makeEvent({ id: "e1", amount: "100.99" }),
      makeEvent({ id: "e2", amount: "0.01" }),
      makeEvent({ id: "e3", amount: "50.5" }),
    ];
    const sort = { field: "amount" as const, dir: "asc" as const };
    const sorted = sortActivityEvents(events, sort);

    expect(sorted.map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
  });

  it("treats missing amount as zero", () => {
    const events = [
      makeEvent({ id: "e1", amount: undefined }),
      makeEvent({ id: "e2", amount: "10" }),
    ];
    const sort = { field: "amount" as const, dir: "desc" as const };
    const sorted = sortActivityEvents(events, sort);

    expect(sorted.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("preserves insertion order for two events that both lack an amount (#938)", () => {
    const events = [
      makeEvent({ id: "e1", type: "alert", amount: undefined }),
      makeEvent({ id: "e2", type: "alert", amount: undefined }),
    ];
    const sort = { field: "amount" as const, dir: "desc" as const };
    const sorted = sortActivityEvents(events, sort);

    // Both default to BigInt(0) and compare equal, so the stable sort must
    // keep their original relative order.
    expect(sorted.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("handles integer strings correctly alongside decimal strings", () => {
    const events = [
      makeEvent({ id: "e1", amount: "7" }),
      makeEvent({ id: "e2", amount: "7.9" }),  // truncates to 7, ties keep insertion order
      makeEvent({ id: "e3", amount: "8.0" }),
    ];
    const sort = { field: "amount" as const, dir: "desc" as const };
    const sorted = sortActivityEvents(events, sort);

    // e3 (8) > e1 (7) == e2 (7, truncated); ties preserve insertion order
    expect(sorted[0].id).toBe("e3");
    expect(sorted.slice(1).map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});

describe("parseActivitySort", () => {
  it("returns null for missing sort param", () => {
    expect(parseActivitySort(null, null)).toBeNull();
    expect(parseActivitySort(undefined, undefined)).toBeNull();
  });

  it("returns null for an unknown sort field", () => {
    expect(parseActivitySort("unknown", "asc")).toBeNull();
  });

  it("parses valid sort params", () => {
    expect(parseActivitySort("date", "asc")).toEqual({ field: "date", dir: "asc" });
    expect(parseActivitySort("amount", "desc")).toEqual({ field: "amount", dir: "desc" });
  });

  it("defaults dir to desc when dir is unrecognised", () => {
    expect(parseActivitySort("type", "bogus")).toEqual({ field: "type", dir: "desc" });
  });
});

describe("toggleActivitySort", () => {
  it("starts a new column at desc", () => {
    expect(toggleActivitySort(null, "amount")).toEqual({ field: "amount", dir: "desc" });
  });

  it("flips direction when clicking the active column", () => {
    const current = { field: "date" as const, dir: "asc" as const };
    expect(toggleActivitySort(current, "date")).toEqual({ field: "date", dir: "desc" });
  });
});
