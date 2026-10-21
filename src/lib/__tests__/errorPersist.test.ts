import { describe, expect, it, beforeEach } from "vitest";
import {
  readPersistedStreamError,
  writePersistedStreamError,
  clearPersistedStreamError,
  clearPersistedStreamErrorOnSuccess,
  MAX_PERSISTED_STREAM_ERRORS,
} from "../errorPersist";

const STREAM_A = "stream-a";
const STREAM_B = "stream-b";

beforeEach(() => {
  sessionStorage.clear();
});

describe("errorPersist", () => {
  it("returns null when nothing has been persisted", () => {
    expect(readPersistedStreamError(STREAM_A)).toBeNull();
  });

  it("persists and reads back an error message for a given stream id", () => {
    writePersistedStreamError(STREAM_A, "Stream not found.");
    expect(readPersistedStreamError(STREAM_A)).toBe("Stream not found.");
  });

  it("keeps errors for different stream ids isolated", () => {
    writePersistedStreamError(STREAM_A, "Stream not found.");
    writePersistedStreamError(STREAM_B, "Network timeout.");
    expect(readPersistedStreamError(STREAM_A)).toBe("Stream not found.");
    expect(readPersistedStreamError(STREAM_B)).toBe("Network timeout.");
  });

  it("survives a simulated remount (sessionStorage persists across navigation)", () => {
    writePersistedStreamError(STREAM_A, "Network timeout: stream data could not be loaded.");
    // A remount just re-reads from sessionStorage — nothing to reset here,
    // which is exactly the point: the error is not lost.
    expect(readPersistedStreamError(STREAM_A)).toBe(
      "Network timeout: stream data could not be loaded.",
    );
  });

  it("clears a persisted error", () => {
    writePersistedStreamError(STREAM_A, "Stream not found.");
    clearPersistedStreamError(STREAM_A);
    expect(readPersistedStreamError(STREAM_A)).toBeNull();
  });

  it("ignores an empty stream id", () => {
    writePersistedStreamError("", "should not be stored");
    expect(readPersistedStreamError("")).toBeNull();
  });

  it("evicts the least recently used persisted error when the limit is exceeded", () => {
    writePersistedStreamError("oldest", "Old error.");
    for (let i = 1; i < MAX_PERSISTED_STREAM_ERRORS; i++) {
      writePersistedStreamError(`stream-${i}`, `Error ${i}.`);
    }

    // Reading an entry makes it recent, so the next write evicts the next-oldest.
    expect(readPersistedStreamError("oldest")).toBe("Old error.");
    writePersistedStreamError("newest", "Newest error.");

    expect(readPersistedStreamError("stream-1")).toBeNull();
    expect(readPersistedStreamError("oldest")).toBe("Old error.");
    expect(readPersistedStreamError("newest")).toBe("Newest error.");
    const persistedCount = Object.keys(sessionStorage).filter((key) =>
      key.startsWith("sorostream_stream_error_"),
    ).length;
    expect(persistedCount).toBe(MAX_PERSISTED_STREAM_ERRORS);
  });
});

describe("clearPersistedStreamErrorOnSuccess (#714)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("clears the error when a retry resolves after the component has unmounted", async () => {
    writePersistedStreamError(STREAM_A, "Network timeout.");

    // Mount: the retry starts and the component tracks a `cancelled` flag.
    const fetch = deferred<{ stream: { id: string } | null }>();
    let cancelled = false;
    const load = clearPersistedStreamErrorOnSuccess(
      STREAM_A,
      fetch.promise,
      (result) => Boolean(result.stream),
    );
    void load.then(() => {
      if (cancelled) return; // what the unmounted page does with the result
    });

    // Unmount before the retry settles.
    cancelled = true;
    expect(readPersistedStreamError(STREAM_A)).toBe("Network timeout.");

    // The retry now succeeds while nothing is mounted.
    fetch.resolve({ stream: { id: STREAM_A } });
    await load;
    await Promise.resolve();

    expect(readPersistedStreamError(STREAM_A)).toBeNull();
  });

  it("still clears when the retry resolves while mounted", async () => {
    writePersistedStreamError(STREAM_A, "Network timeout.");
    await clearPersistedStreamErrorOnSuccess(STREAM_A, Promise.resolve({ ok: true }));
    await Promise.resolve();
    expect(readPersistedStreamError(STREAM_A)).toBeNull();
  });

  it("keeps the error when the result is not a success", async () => {
    writePersistedStreamError(STREAM_A, "Stream not found.");
    await clearPersistedStreamErrorOnSuccess(
      STREAM_A,
      Promise.resolve({ stream: null }),
      (result) => Boolean(result.stream),
    );
    await Promise.resolve();
    expect(readPersistedStreamError(STREAM_A)).toBe("Stream not found.");
  });

  it("keeps the error and passes the rejection through when the retry fails", async () => {
    writePersistedStreamError(STREAM_A, "Network timeout.");
    const load = clearPersistedStreamErrorOnSuccess(STREAM_A, Promise.reject(new Error("boom")));
    await expect(load).rejects.toThrow("boom");
    expect(readPersistedStreamError(STREAM_A)).toBe("Network timeout.");
  });

  it("only clears the stream id it was given", async () => {
    writePersistedStreamError(STREAM_A, "A failed.");
    writePersistedStreamError(STREAM_B, "B failed.");
    await clearPersistedStreamErrorOnSuccess(STREAM_A, Promise.resolve(true));
    await Promise.resolve();
    expect(readPersistedStreamError(STREAM_A)).toBeNull();
    expect(readPersistedStreamError(STREAM_B)).toBe("B failed.");
  });
});
