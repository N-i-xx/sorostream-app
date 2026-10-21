import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSnapshot,
  getSnapshots,
  clearSnapshots,
  purgeSnapshots,
  exportSnapshots,
  pruneExpiredSnapshots,
  type BalanceSnapshot,
} from "../balanceCache";

/**
 * Minimal in-memory IndexedDB covering only what balanceCache uses:
 * open + upgrade, readwrite/readonly transactions, put/delete, store and
 * "address" index cursors (with cursor.delete), and IDBKeyRange.only.
 * `rows` is the backing store, so tests can inspect what is physically kept.
 */
type Row = BalanceSnapshot;
const keyOf = (address: string, timestamp: string) => JSON.stringify([address, timestamp]);

let rows: Map<string, Row>;
let created: boolean;

class FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  private pending = 0;
  private finished = false;

  /** Run `fn` asynchronously and deliver its result on `req`. */
  run<T>(req: FakeRequest<T>, fn: () => T): FakeRequest<T> {
    this.pending++;
    setTimeout(() => {
      req.result = fn();
      req.onsuccess?.();
      this.pending--;
      if (this.pending === 0 && !this.finished) {
        this.finished = true;
        setTimeout(() => this.oncomplete?.(), 0);
      }
    }, 0);
    return req;
  }

  objectStore = () => {
    const openCursor = (filter: (r: Row) => boolean) => {
      const req = new FakeRequest<unknown>();
      const items = [...rows.values()].filter(filter);
      let i = 0;
      const cursor = {
        get value() {
          return items[i];
        },
        continue: () => {
          i++;
          step();
        },
        delete: () => {
          const k = keyOf(items[i].address, items[i].timestamp);
          return this.run(new FakeRequest<void>(), () => {
            rows.delete(k);
          });
        },
      };
      const step = () => this.run(req, () => (i < items.length ? cursor : null));
      step();
      return req;
    };
    return {
      put: (value: Row) =>
        this.run(new FakeRequest<void>(), () => {
          rows.set(keyOf(value.address, value.timestamp), structuredClone(value));
        }),
      delete: (key: [string, string]) =>
        this.run(new FakeRequest<void>(), () => {
          rows.delete(keyOf(key[0], key[1]));
        }),
      openCursor: () => openCursor(() => true),
      index: () => ({
        openCursor: (range: { only: string }) => openCursor((r) => r.address === range.only),
      }),
    };
  };
}

const fakeIndexedDB = {
  open() {
    const req = new FakeRequest<unknown>();
    const db = {
      objectStoreNames: { contains: () => created },
      createObjectStore: () => {
        created = true;
        return { createIndex: () => undefined };
      },
      transaction: () => new FakeTransaction(),
      close: () => undefined,
    };
    setTimeout(() => {
      req.result = db;
      if (!created) req.onupgradeneeded?.();
      req.onsuccess?.();
    }, 0);
    return req;
  },
};

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const snap = (address: string, timestamp: string): BalanceSnapshot => ({
  address,
  timestamp,
  balances: { XLM: 1 },
});
const seed = (...snapshots: BalanceSnapshot[]) => {
  for (const s of snapshots) rows.set(keyOf(s.address, s.timestamp), s);
};
const storedKeys = () => [...rows.values()].map((r) => `${r.address}@${r.timestamp}`).sort();

describe("balanceCache expiry (#713)", () => {
  beforeEach(() => {
    rows = new Map();
    created = false;
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    vi.stubGlobal("IDBKeyRange", { only: (v: string) => ({ only: v }) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("physically deletes expired rows for every address when a snapshot is written", async () => {
    const expiredA = snap("GA", daysAgo(120));
    const expiredB = snap("GB", daysAgo(91));
    const freshB = snap("GB", daysAgo(10));
    seed(expiredA, expiredB, freshB);

    const incoming = snap("GA", daysAgo(0));
    await saveSnapshot(incoming);

    expect(storedKeys()).toEqual(
      [`GA@${incoming.timestamp}`, `GB@${freshB.timestamp}`].sort(),
    );
  });

  it("pruneExpiredSnapshots removes expired rows without needing a read", async () => {
    const expired = snap("GA", daysAgo(100));
    const fresh = snap("GA", daysAgo(1));
    seed(expired, fresh);

    await pruneExpiredSnapshots();

    expect(storedKeys()).toEqual([`GA@${fresh.timestamp}`]);
  });

  it("still never returns expired rows on read", async () => {
    const expired = snap("GA", daysAgo(95));
    const fresh = snap("GA", daysAgo(5));
    seed(expired, fresh);

    const result = await getSnapshots("GA");

    expect(result.map((s) => s.timestamp)).toEqual([fresh.timestamp]);
  });

  it("exports every stored snapshot for one address as serializable records", async () => {
    const old = snap("GA", daysAgo(120));
    const recent = snap("GA", daysAgo(2));
    const other = snap("GB", daysAgo(1));
    seed(old, recent, other);

    const exported = await exportSnapshots("GA");

    expect(exported).toEqual([old, recent]);
    expect(JSON.parse(JSON.stringify(exported))).toEqual([old, recent]);
  });

  it("purges every snapshot for one address while preserving other addresses", async () => {
    const a1 = snap("GA", daysAgo(120));
    const a2 = snap("GA", daysAgo(2));
    const b = snap("GB", daysAgo(1));
    seed(a1, a2, b);

    await purgeSnapshots("GA");

    expect(storedKeys()).toEqual([`GB@${b.timestamp}`]);

    // Existing wallet-disconnect callers keep using the compatible name.
    await clearSnapshots("GB");
    expect(storedKeys()).toEqual([]);
  });
});
