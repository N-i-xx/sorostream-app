import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  verifyAddress,
  type AddressVerification,
} from "../addressVerification";

vi.mock("@/src/lib/federation", () => ({
  resolveFederationName: vi.fn(async () => null),
  LookupAbortedError: class LookupAbortedError extends Error {},
  isLookupAborted: (err: unknown) =>
    err instanceof Error && err.name === "AbortError",
}));

const SLOW_ADDRESS = `G${"B".repeat(55)}`;
const FAST_ADDRESS = `G${"C".repeat(55)}`;

const VERIFY_PREFIX = "sorostream-addr-verify-";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(status: number): Response {
  return {
    ok: status === 200,
    status,
    text: async () => "",
    json: async () => ({}),
  } as unknown as Response;
}

describe("addressVerification stale in-flight results (issue #723)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a slower earlier verification resolving after a faster later one does not overwrite it", async () => {
    // Slow verification starts first; its Horizon check hangs until we decide.
    const slowHorizon = createDeferred<Response>();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(SLOW_ADDRESS)) return slowHorizon.promise;
      // The newer target's check answers immediately.
      return response(200);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Caller semantics from the triggering form (stream/new/page.tsx): apply a
    // result only when it still describes the current target.
    let currentTarget = SLOW_ADDRESS;
    let applied: AddressVerification | null = null;
    const isCurrentTarget = (address: string) => () => currentTarget === address;

    const slowRun = verifyAddress(SLOW_ADDRESS, {
      isCurrentTarget: isCurrentTarget(SLOW_ADDRESS),
    }).then((result) => {
      if (currentTarget === SLOW_ADDRESS) applied = result;
      return result;
    });

    // The user edits the recipient field: a newer, faster verification starts.
    currentTarget = FAST_ADDRESS;
    const fastRun = verifyAddress(FAST_ADDRESS, {
      isCurrentTarget: isCurrentTarget(FAST_ADDRESS),
    }).then((result) => {
      if (currentTarget === FAST_ADDRESS) applied = result;
      return result;
    });

    // The fast (later) verification wins the race.
    const fastResult = await fastRun;
    expect(applied?.address).toBe(FAST_ADDRESS);
    expect(fastResult.status).toBe("active");

    // Only now does the earlier, slower verification resolve — for an address
    // that is no longer the current target.
    slowHorizon.resolve(response(404));
    const slowResult = await slowRun;
    expect(slowResult.address).toBe(SLOW_ADDRESS);

    // The stale result is discarded, not applied: the newer result stands.
    expect(applied?.address).toBe(FAST_ADDRESS);

    // And it was not cached either: the next verification of that address
    // re-runs instead of reading the stale/wrong-target status.
    expect(sessionStorage.getItem(VERIFY_PREFIX + SLOW_ADDRESS)).toBeNull();
    expect(sessionStorage.getItem(VERIFY_PREFIX + FAST_ADDRESS)).not.toBeNull();
  });

  it("a still-current verification behaves exactly as before and caches normally", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200)),
    );

    const result = await verifyAddress(SLOW_ADDRESS, {
      isCurrentTarget: () => true,
    });

    // Account exists, no federation name: same status as the pre-change lib.
    expect(result.status).toBe("active");
    expect(sessionStorage.getItem(VERIFY_PREFIX + SLOW_ADDRESS)).not.toBeNull();
  });
});
