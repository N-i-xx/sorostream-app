import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LookupAbortedError,
  isLookupAborted,
  resolveFederationName,
} from "../federation";

const G_ADDRESS = "G" + "A".repeat(55);
const FED_PREFIX = "sorostream-fed-";

/** Minimal `Response` stand-in: federation code only touches ok/status/text/json. */
function response(
  status = 200,
  body?: unknown,
  text?: string,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text ?? "",
    json: async () => body,
  } as unknown as Response;
}

/** A fetch mock that only settles when its init.signal aborts, like a real
 * in-flight request would. */
function pendingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }),
  );
}

describe("federation lookup cancellation (issue #724)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("an aborted (unmounted) lookup performs no writes to sessionStorage", async () => {
    // Component starts a lookup and unmounts before the network answers.
    const controller = new AbortController();
    const fetchMock = pendingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const lookup = resolveFederationName(G_ADDRESS, {
      signal: controller.signal,
    });

    // The probes are in flight (one stellar.toml request per domain).
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // "component unmounts": the effect cleanup aborts the controller.
    controller.abort();

    await expect(lookup).rejects.toBeInstanceOf(LookupAbortedError);
    // No null result was cached for the aborted lookup.
    expect(sessionStorage.getItem(FED_PREFIX + G_ADDRESS)).toBeNull();
  });

  it("an aborted lookup still rejects even when a probe already answered", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("stellar.org") && url.includes(".well-known")) {
        // First domain answers immediately with a federation server.
        return response(200, undefined, 'FEDERATION_SERVER = "https://fed.example"');
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const lookup = resolveFederationName(G_ADDRESS, {
      signal: controller.signal,
    });

    // One server query for the answered probe is now in flight; abort mid-way.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    controller.abort();

    await expect(lookup).rejects.toBeInstanceOf(LookupAbortedError);
    expect(sessionStorage.getItem(FED_PREFIX + G_ADDRESS)).toBeNull();
  });

  it("lookups that complete normally keep caching their result", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(".well-known")) {
        return response(200, undefined, 'FEDERATION_SERVER = "https://fed.example"');
      }
      return response(200, { stellar_address: "alice*stellar.org" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFederationName(G_ADDRESS);

    expect(result).toBe("alice*stellar.org");
    expect(sessionStorage.getItem(FED_PREFIX + G_ADDRESS)).toBe(
      "alice*stellar.org",
    );
  });

  it("the existing per-domain timeout behaviour is unchanged", async () => {
    // Hung requests are rejected by the 3-second timer exactly as before.
    vi.stubGlobal("fetch", pendingFetch());

    const lookup = resolveFederationName(G_ADDRESS);
    await vi.advanceTimersByTimeAsync(3_001);

    const result = await lookup;
    expect(result).toBeNull();
    // A timed-out lookup is a real "not found" observation: cached, as before.
    expect(sessionStorage.getItem(FED_PREFIX + G_ADDRESS)).toBe("");
  });

  it("isLookupAborted recognises both cancellation shapes", () => {
    expect(isLookupAborted(new LookupAbortedError())).toBe(true);
    expect(isLookupAborted(new DOMException("x", "AbortError"))).toBe(true);
    expect(isLookupAborted(new Error("boom"))).toBe(false);
  });
});
