/**
 * balanceCache — IndexedDB-backed balance snapshot store.
 *
 * Stores periodic balance snapshots (hourly) so the portfolio chart can show
 * historical balance trends without hitting the Horizon API on every visit.
 *
 * Snapshots are keyed by `(address, timestamp)` and auto-expire after 90 days.
 *
 * ## Purpose & lifecycle
 *
 * This store is the *write-through cache* for the live portfolio view. It is
 * populated opportunistically by the app (see `shouldSnapshot`, which throttles
 * writes to at most one snapshot per hour per address) and read back to render
 * the balance trend chart. Entries are short-lived: they are pruned on read
 * once they fall outside the 90-day lookback window, and can be dropped
 * wholesale via `purgeSnapshots` (e.g. on wallet disconnect or when the user
 * wants to remove local data before handing off a shared computer).
 *
 * ## balanceCache vs. balanceHistory
 *
 * `src/lib/balanceHistory.ts` is a separate store with a different record
 * shape and purpose. This store keeps per-address asset balances for the
 * portfolio cache; balanceHistory keeps aggregate totals, token balances,
 * and stream counts for historical analytics. Both retain data for 90 days,
 * so neither is a durable archive. The two stores are not interchangeable:
 *
 * - Use `balanceCache` for per-account asset balance snapshots.
 * - Use `balanceHistory` for aggregate portfolio history and period changes.
 *
 * The overlap in shape (both expose a `BalanceSnapshot`-like record) is
 * intentional: their records answer different questions. Keep this distinction
 * clear when changing either interface.
 */

const DB_NAME = "sorostream_balance_cache";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface BalanceSnapshot {
  /** Stellar account address. */
  address: string;
  /** ISO-8601 timestamp of the snapshot. */
  timestamp: string;
  /** Balances keyed by asset code (e.g. "XLM", "USDC"). */
  balances: Record<string, number>;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ["address", "timestamp"] });
        store.createIndex("address", "address", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Walk the whole store (every address) and delete rows older than `cutoff`.
 * Runs inside the caller's readwrite transaction.
 */
function deleteExpired(store: IDBObjectStore, cutoff: number): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const snapshot = cursor.value as BalanceSnapshot;
    if (new Date(snapshot.timestamp).getTime() < cutoff) cursor.delete();
    cursor.continue();
  };
}

/**
 * Store a balance snapshot. If a snapshot for the same address+timestamp
 * already exists it is silently replaced.
 *
 * Expired rows for every address are purged in the same transaction, so
 * old snapshots don't pile up in IndexedDB when the chart (which also
 * prunes on read) is rarely opened (#713).
 */
export async function saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(snapshot);
    deleteExpired(store, Date.now() - MAX_AGE_MS);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Delete every snapshot older than `maxAgeMs` (default 90 days) across all
 * addresses. Called on every write; also safe to call as a periodic sweep.
 */
export async function pruneExpiredSnapshots(maxAgeMs: number = MAX_AGE_MS): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    deleteExpired(tx.objectStore(STORE_NAME), Date.now() - maxAgeMs);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Retrieve all snapshots for a given address within the lookback window.
 * Snapshots older than `maxAgeMs` (default 90 days) are pruned on read.
 */
export async function getSnapshots(
  address: string,
  maxAgeMs: number = MAX_AGE_MS,
): Promise<BalanceSnapshot[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("address");
    const range = IDBKeyRange.only(address);
    const request = index.openCursor(range);

    const results: BalanceSnapshot[] = [];
    const cutoff = Date.now() - maxAgeMs;
    const staleKeys: [string, string][] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        // Prune stale entries in a separate write transaction
        if (staleKeys.length > 0) {
          const pruneTx = db.transaction(STORE_NAME, "readwrite");
          const pruneStore = pruneTx.objectStore(STORE_NAME);
          for (const key of staleKeys) pruneStore.delete(key);
          pruneTx.oncomplete = () => { db.close(); resolve(results); };
          pruneTx.onerror = () => { db.close(); resolve(results); };
        } else {
          db.close();
          resolve(results);
        }
        return;
      }

      const snapshot = cursor.value as BalanceSnapshot;
      const ts = new Date(snapshot.timestamp).getTime();
      if (ts < cutoff) {
        staleKeys.push([snapshot.address, snapshot.timestamp]);
      } else {
        results.push(snapshot);
      }
      cursor.continue();
    };

    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * Return the most recent snapshot for an address, or null if none exist.
 */
export async function getLatestSnapshot(address: string): Promise<BalanceSnapshot | null> {
  const snapshots = await getSnapshots(address);
  if (snapshots.length === 0) return null;
  return snapshots[snapshots.length - 1];
}

/**
 * Determine whether a new snapshot should be stored based on the time
 * elapsed since the last snapshot for this address. Returns true if at
 * least `minIntervalMs` have passed (or no snapshot exists yet).
 */
export async function shouldSnapshot(
  address: string,
  minIntervalMs: number = 60 * 60 * 1000, // 1 hour
): Promise<boolean> {
  const latest = await getLatestSnapshot(address);
  if (!latest) return true;
  return Date.now() - new Date(latest.timestamp).getTime() >= minIntervalMs;
}

/**
 * Clear all snapshots for a given address (e.g. on wallet disconnect).
 */
export async function purgeSnapshots(address: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).index("address").openCursor(IDBKeyRange.only(address));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => { db.close(); reject(request.error); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Backwards-compatible name for clearing an address's cached snapshots. */
export async function clearSnapshots(address: string): Promise<void> {
  return purgeSnapshots(address);
}

/** Export every stored snapshot for `address`, including snapshots past the chart lookback. */
export async function exportSnapshots(address: string): Promise<BalanceSnapshot[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).index("address").openCursor(IDBKeyRange.only(address));
    const results: BalanceSnapshot[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        db.close();
        resolve(results);
        return;
      }
      results.push(cursor.value as BalanceSnapshot);
      cursor.continue();
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
