/**
 * Tests for #699: the probed SEP-1 domain list can be extended through
 * NEXT_PUBLIC_TOML_EXTRA_DOMAINS without editing the source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROBE_DOMAINS,
  getProbeDomains,
  resolveTomlDisplayName,
} from "../stellarToml";

const ENV_KEY = "NEXT_PUBLIC_TOML_EXTRA_DOMAINS";

const TOML = `[[ACCOUNTS]]
address = "GHEXATOMLADDRESS"
alias = "custom-issuer-wallet"
`;

function probedUrls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((call) => call[0] as string);
}

describe("getProbeDomains (#699)", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("returns exactly the default domains when nothing is configured", () => {
    expect(getProbeDomains()).toEqual(DEFAULT_PROBE_DOMAINS);
    expect(getProbeDomains(undefined)).toEqual([...DEFAULT_PROBE_DOMAINS]);
    expect(getProbeDomains("")).toEqual([...DEFAULT_PROBE_DOMAINS]);
    expect(getProbeDomains("   ")).toEqual([...DEFAULT_PROBE_DOMAINS]);
  });

  it("appends configured extra domains after the defaults", () => {
    const domains = getProbeDomains("selfhosted.example,issuer.example.org");

    expect(domains.slice(0, DEFAULT_PROBE_DOMAINS.length)).toEqual(DEFAULT_PROBE_DOMAINS);
    expect(domains).toContain("selfhosted.example");
    expect(domains).toContain("issuer.example.org");
    expect(domains).toHaveLength(DEFAULT_PROBE_DOMAINS.length + 2);
  });

  it("normalizes schemes, paths and ports, and drops duplicates", () => {
    const domains = getProbeDomains(
      " https://SelfHosted.Example/, issuer.example.org:8080/path, stellar.org, not a domain ",
    );

    expect(domains).toEqual([...DEFAULT_PROBE_DOMAINS, "selfhosted.example", "issuer.example.org"]);
  });

  it("reads the environment variable at call time", () => {
    expect(getProbeDomains()).not.toContain("env-configured.example.com");

    process.env[ENV_KEY] = "env-configured.example.com";
    expect(getProbeDomains()).toContain("env-configured.example.com");
  });
});

describe("resolveTomlDisplayName probe sequence (#699)", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
    sessionStorage.clear();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("probes a configured extra domain in addition to the defaults", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, text: async () => TOML }));
    vi.stubGlobal("fetch", fetchMock);
    process.env[ENV_KEY] = "selfhosted.example";

    const alias = await resolveTomlDisplayName("GHEXATOMLADDRESS");

    expect(alias).toBe("custom-issuer-wallet");
    expect(probedUrls(fetchMock)).toContain("https://selfhosted.example/.well-known/stellar.toml");
    for (const domain of DEFAULT_PROBE_DOMAINS) {
      expect(probedUrls(fetchMock)).toContain(`https://${domain}/.well-known/stellar.toml`);
    }
    expect(probedUrls(fetchMock)).toHaveLength(DEFAULT_PROBE_DOMAINS.length + 1);
  });

  it("probes only the default domains when no extra domains are configured", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    const alias = await resolveTomlDisplayName("GPROBEDEFAULTONLY001");

    expect(alias).toBeNull();
    expect(probedUrls(fetchMock).sort()).toEqual(
      DEFAULT_PROBE_DOMAINS.map((d) => `https://${d}/.well-known/stellar.toml`).sort(),
    );
  });
});
