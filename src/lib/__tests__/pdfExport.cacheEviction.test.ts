/**
 * #940: generatePdfDocument's cache (limit 5) evicts the *oldest inserted*
 * entry when a 6th distinct request arrives. It relies on Map iterating
 * keys in insertion order.
 *
 * Detecting a hit vs. a rebuild: with no streams, the report period falls
 * back to "today". Each entry is generated on its own fake day, and the clock
 * is then moved to a later day. A cache hit returns the original day's
 * document; a rebuilt (evicted) entry contains the new day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PdfModule = typeof import("../pdfExport");
let generatePdfDocument: PdfModule["generatePdfDocument"];

const LIMIT = 5; // PDF_DOCUMENT_CACHE_LIMIT
const wallet = (i: number) => `WALLET${i}`;
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i, 12));
const isoDay = (i: number) => day(i).toISOString().split("T")[0];

beforeEach(async () => {
  // Fresh module, so the cache starts empty regardless of other tests.
  vi.resetModules();
  ({ generatePdfDocument } = await import("../pdfExport"));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generatePdfDocument cache eviction (#940)", () => {
  it("evicts exactly the first inserted entry when the limit is exceeded", () => {
    // Insert LIMIT + 1 distinct requests, each generated on its own day.
    for (let i = 0; i <= LIMIT; i++) {
      vi.setSystemTime(day(i));
      expect(generatePdfDocument([], wallet(i))).toContain(isoDay(i));
    }

    // Later day: a cache hit still shows its original day; a rebuild shows today.
    vi.setSystemTime(day(30));

    // Entries 1..LIMIT survived and are served from the cache. Check these
    // before re-requesting entry 0, since rebuilding entry 0 evicts again.
    for (let i = 1; i <= LIMIT; i++) {
      const doc = generatePdfDocument([], wallet(i));
      expect(doc).toContain(isoDay(i));
      expect(doc).not.toContain(isoDay(30));
    }

    // Entry 0, the first inserted, was evicted and is rebuilt today.
    const rebuilt = generatePdfDocument([], wallet(0));
    expect(rebuilt).toContain(isoDay(30));
    expect(rebuilt).not.toContain(isoDay(0));
  });

  it("does not evict anything while at or under the limit", () => {
    for (let i = 0; i < LIMIT; i++) {
      vi.setSystemTime(day(i));
      generatePdfDocument([], wallet(i));
    }
    vi.setSystemTime(day(30));
    for (let i = 0; i < LIMIT; i++) {
      expect(generatePdfDocument([], wallet(i))).toContain(isoDay(i));
    }
  });
});
