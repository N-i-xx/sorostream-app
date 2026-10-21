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
 * resolveTomlDisplayName(address) probes well-known domains and returns the
 * first alias found for the address (or null). Results are cached in
 * sessionStorage using the same convention as federation.ts.
 */

const SESSION_PREFIX = "sorostream-toml-";
const LOOKUP_TIMEOUT_MS = 3_000;

/** Domains probed for a matching [[ACCOUNTS]] entry. */
const PROBE_DOMAINS = [
  "stellar.org",
  "lobstr.co",
  "stellarterm.com",
];

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
      PROBE_DOMAINS.map(async (domain) => {
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
