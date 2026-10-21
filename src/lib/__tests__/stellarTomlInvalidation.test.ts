import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAddress } from "../addressVerification";
import { invalidateTomlDisplayName, resolveTomlDisplayName } from "../stellarToml";

vi.mock("@/src/lib/federation", () => ({
  resolveFederationName: vi.fn(async () => null),
  LookupAbortedError: class LookupAbortedError extends Error {},
  isLookupAborted: (err: unknown) =>
    err instanceof Error && err.name === "AbortError",
}));

const ADDRESS = `G${"D".repeat(55)}`;
const TOML_PREFIX = "sorostream-toml-";

function response(status: number): Response {
  return {
    ok: status === 200,
    status,
    text: async () => "",
    json: async () => ({}),
  } as unknown as Response;
}

describe("stellarToml display-name invalidation on failed verification (issue #725)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a failed verification clears the cached display name for that address", async () => {
    // An earlier pass resolved a friendly alias and cached it, SEP-1-style.
    sessionStorage.setItem(TOML_PREFIX + ADDRESS, "hotwallet-1");

    // The address later fails verification: Horizon says it does not exist.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(404)),
    );

    const result = await verifyAddress(ADDRESS);

    expect(result.status).toBe("unverified");
    // The untrustworthy alias is gone, so the UI cannot keep showing the
    // friendly name for an address flagged unverified.
    expect(sessionStorage.getItem(TOML_PREFIX + ADDRESS)).toBeNull();
  });

  it("a still-verified address keeps its cached display name", async () => {
    sessionStorage.setItem(TOML_PREFIX + ADDRESS, "hotwallet-1");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200)),
    );

    const result = await verifyAddress(ADDRESS);

    expect(result.status).toBe("active");
    // No change to caching behaviour for addresses that remain verified.
    expect(sessionStorage.getItem(TOML_PREFIX + ADDRESS)).toBe("hotwallet-1");
  });

  it("invalidateTomlDisplayName is a no-op for uncached addresses", () => {
    expect(() => invalidateTomlDisplayName(ADDRESS)).not.toThrow();
    expect(sessionStorage.getItem(TOML_PREFIX + ADDRESS)).toBeNull();
  });

  it("resolveTomlDisplayName caching convention is unchanged", async () => {
    const toml = `[[ACCOUNTS]]\naddress = "${ADDRESS}"\nalias = "treasury"`;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => toml,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const name = await resolveTomlDisplayName(ADDRESS);
    expect(name).toBe("treasury");
    expect(sessionStorage.getItem(TOML_PREFIX + ADDRESS)).toBe("treasury");
  });
});
