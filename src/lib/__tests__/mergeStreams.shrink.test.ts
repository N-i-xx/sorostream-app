/**
 * #939: mergeById when `next` is a strict subset of `prev` (items removed,
 * none added or changed). The size check must make it return the shorter
 * merged list, not the stale `prev` reference, while still reusing the
 * unchanged item objects.
 */
import { describe, expect, it } from "vitest";
import { mergeById } from "../mergeStreams";

type Row = { id: string; amount: number };

describe("mergeById with removed items (#939)", () => {
  const a: Row = { id: "a", amount: 1 };
  const b: Row = { id: "b", amount: 2 };
  const c: Row = { id: "c", amount: 3 };

  it("returns a new, shorter array when trailing items are removed", () => {
    const prev = [a, b, c];
    const next = [{ ...a }, { ...b }];

    const merged = mergeById(prev, next);

    expect(merged).not.toBe(prev);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
    // Unchanged rows keep their previous object references.
    expect(merged[0]).toBe(a);
    expect(merged[1]).toBe(b);
  });

  it("returns a new array when a middle item is removed", () => {
    const prev = [a, b, c];
    const merged = mergeById(prev, [{ ...a }, { ...c }]);

    expect(merged).not.toBe(prev);
    expect(merged).toEqual([a, c]);
    expect(merged[0]).toBe(a);
    expect(merged[1]).toBe(c);
  });

  it("returns an empty array (not prev) when every item is removed", () => {
    const prev = [a, b];
    const merged = mergeById(prev, []);

    expect(merged).not.toBe(prev);
    expect(merged).toEqual([]);
  });

  it("still returns prev itself when nothing changed (contrast)", () => {
    const prev = [a, b];
    expect(mergeById(prev, [{ ...a }, { ...b }])).toBe(prev);
  });
});
