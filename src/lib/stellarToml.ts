/**
 * SEP-1 stellar.toml account display-name resolution.
 *
 * Some issuers/wallets publish an [[ACCOUNTS]] section in their
 * .well-known/stellar.toml associating public keys with a human-readable
 * alias, e.g.:
 *
 *   [[ACCOUNTS]]
 *   address = "GA..."
 *   alias = "hotwallet-1"
 *
 * resolveTomlDisplayName(address) probes well-known domains (plus any
 * extra domains configured through NEXT_PUBLIC_TOML_EXTRA_DOMAINS) and returns
 * the first alias found for the address (or null). Results are cached in
 * sessionStorage using the same convention as federation.ts.
 */

const SESSION_PREFIX = "sorostream-toml-";
const LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Domains probed by default for a matching [[ACCOUNTS]] entry.
 * Extended at runtime by `NEXT_PUBLIC_TOML_EXTRA_DOMAINS` (#699) so a
 * self-hosted/white-labeled deployment can add its own trusted domain without
 * editing this file.
 */
export const DEFAULT_PROBE_DOMAINS = [
  "stellar.org",
  "lobstr.co",
  "stellarterm.com",
];

/**
 * Normalize a user-supplied domain to a bare hostname.
 * Accepts `example.com`, `https://example.com`, `example.com/path`, and
 * rejects anything that is not a plausible hostname (so a configured value
 * can never alter the URL shape we fetch).
 */
function normalizeDomain(raw: string): string | null {
  let domain = raw.trim().toLowerCase();
  if (!domain) return null;

  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
  domain = domain.split("/")[0]; // strip path
  domain = domain.replace(/:\d+$/, ""); // strip port

  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
    ? domain
    : null;
}

/**
 * Full probe sequence: the default well-known domains followed by any
 * extra domains configured via `NEXT_PUBLIC_TOML_EXTRA_DOMAINS`, deduplicated
 * and in first-seen order. With no env configured the result is exactly
 * `DEFAULT_PROBE_DOMAINS`.
 *
 * The env var is read on every call so tests (and runtime revalidation) see
 * the current value.
 */
export function getProbeDomains(
  // Literal member access so Next.js inlines NEXT_PUBLIC_* at build time.
  raw: string | undefined = process.env.NEXT_PUBLIC_TOML_EXTRA_DOMAINS,
): string[] {
  const extras = (raw ?? "")
    .split(",")
    .map(normalizeDomain)
    .filter((domain): domain is string => domain !== null);

  const seen = new Set<string>();
  const domains: string[] = [];
  for (const domain of [...DEFAULT_PROBE_DOMAINS, ...extras]) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

interface TomlAccount {
  address: string;
  alias: string | null;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse the [[ACCOUNTS]] sections of a stellar.toml document.
 * Only supports plain `key = "value"` pairs inside each block, which covers
 * real-world SEP-1 files without pulling in a full TOML parser.
 */
export function parseTomlAccounts(toml: string): TomlAccount[] {
  const accounts: TomlAccount[] = [];
  let inAccounts = false;
  let current: Partial<TomlAccount> | null = null;

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[[")) {
      if (current?.address) {
        accounts.push({ address: current.address, alias: current.alias ?? null });
      }
      current = null;
      inAccounts = line.replace(/\s/g, "").startsWith("[[ACCOUNTS]]");
      continue;
    }

    if (line.startsWith("[")) {
      // Any other table ends an open ACCOUNTS entry
      if (current?.address) {
        accounts.push({ address: current.address, alias: current.alias ?? null });
      }
      current = null;
      inAccounts = false;
      continue;
    }

    if (!inAccounts) continue;

    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "address" && !current) {
      current = { address: value };
    } else if (key === "alias" && current) {
      current.alias = value;
    }
  }

  if (current?.address) {
    accounts.push({ address: current.address, alias: current.alias ?? null });
  }

  return accounts;
}

function readCache(address: string): string | null | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + address);
    if (raw === null) return undefined;
    return raw === "" ? null : raw;
  } catch {
    return undefined;
  }
}

function writeCache(address: string, result: string | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_PREFIX + address, result ?? "");
  } catch {
    // Ignore quota errors.
  }
}

/**
 * Drop any cached [[ACCOUNTS]] display name for `address` (issue #725).
 *
 * A cached alias is only as trustworthy as the account it decorates: when a
 * later verification pass for the same address fails or flags it unverified
 * (see `addressVerification.ts`), the UI must fall back to the raw address
 * instead of continuing to show the friendly name from an earlier
 * verification of a healthy account. Addresses that keep verifying cleanly
 * are unaffected — their cached alias is simply left alone.
 */
export function invalidateTomlDisplayName(address: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_PREFIX + address);
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Resolve a human-readable display name for `address` from any probed
 * domain's stellar.toml [[ACCOUNTS]] list. Returns null when no entry exists,
 * on timeout, or on any network/parse error.
 */
export async function resolveTomlDisplayName(
  address: string,
): Promise<string | null> {
  if (!address || !address.startsWith("G")) return null;

  const cached = readCache(address);
  if (cached !== undefined) return cached;

  try {
    const results = await Promise.allSettled(
      getProbeDomains().map(async (domain) => {
        const res = await fetchWithTimeout(
          `https://${domain}/.well-known/stellar.toml`,
          LOOKUP_TIMEOUT_MS,
        );
        if (!res.ok) return null;
        const text = await res.text();
        const entry = parseTomlAccounts(text).find((a) => a.address === address);
        return entry?.alias ?? null;
      }),
    );

    const found =
      results
        .filter(
          (r): r is PromiseFulfilledResult<string | null> =>
            r.status === "fulfilled" && r.value !== null,
        )
        .map((r) => r.value)[0] ?? null;

    writeCache(address, found);
    return found;
  } catch {
    writeCache(address, null);
    return null;
  }
}
