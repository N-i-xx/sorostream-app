/**
 * Stellar Address Verification
 *
 * Performs background verification of Stellar addresses:
 * 1. Checks account existence on Stellar Horizon
 * 2. Performs federation resolution (forward and reverse lookup)
 *
 * Returns verification status:
 * - "verified" (green): Account exists + federation name resolved
 * - "active" (blue): Account exists, no federation name
 * - "unverified" (red): Account not found or verification failed
 * - "pending" (gray): Verification in progress
 */

import { isLookupAborted, LookupAbortedError, resolveFederationName } from "./federation";
import { invalidateTomlDisplayName } from "./stellarToml";

export type VerificationStatus = "pending" | "verified" | "active" | "unverified";

export interface AddressVerification {
  status: VerificationStatus;
  address: string;
  federationName: string | null;
  accountExists: boolean | null;
  error: string | null;
  lastCheckedAt: number;
}

// Stellar Horizon URL (using public testnet by default, override with env var)
const HORIZON_URL = process.env.NEXT_PUBLIC_RPC_URL
  ? process.env.NEXT_PUBLIC_RPC_URL.replace("/rpc/v1", "")
  : "https://horizon-testnet.stellar.org";

// Cache verification results in sessionStorage
const VERIFICATION_CACHE_PREFIX = "sorostream-addr-verify-";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read verification result from cache if still valid.
 */
function readVerificationCache(address: string): AddressVerification | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const key = VERIFICATION_CACHE_PREFIX + address;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as AddressVerification;
    // Return if less than 5 minutes old
    if (Date.now() - cached.lastCheckedAt < CACHE_TTL_MS) {
      return cached;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Write verification result to cache.
 */
function writeVerificationCache(verification: AddressVerification): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const key = VERIFICATION_CACHE_PREFIX + verification.address;
    sessionStorage.setItem(key, JSON.stringify(verification));
  } catch {
    // Ignore quota errors
  }
}

/** G-address shape shared by the Horizon check and the TOML invalidation path. */
function isGAddress(address: string): boolean {
  return address.startsWith("G") && address.length === 56;
}

/**
 * Check if an account exists on Stellar Horizon.
 * Returns true if account exists, false if not found, null if check failed.
 */
async function checkAccountExists(
  address: string,
  signal?: AbortSignal,
): Promise<boolean | null> {
  try {
    // Only check G-addresses (not federation addresses)
    if (!isGAddress(address)) {
      return null;
    }

    const response = await fetch(`${HORIZON_URL}/accounts/${address}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal,
    });

    if (response.status === 200) {
      return true; // Account exists
    }
    if (response.status === 404) {
      return false; // Account not found
    }
    // For other status codes, consider it a check failure
    return null;
  } catch {
    // Network error or timeout
    return null;
  }
}

/** Options for a single verification run (issue #723/#724). */
export interface VerifyAddressOptions {
  /** Cancellation for the in-flight verification, including every Horizon and
   * federation HTTP hop underneath it (issue #724). An aborted verification
   * does not cache anything and rejects with [`LookupAbortedError`]. */
  signal?: AbortSignal;
  /** Called when the verification completes. Returning `false` — the user has
   * already moved on to another address (issue #723) — discards this result:
   * it is neither written to the verification cache nor applied by callers
   * that guard on it, so a slow, stale result can never overwrite the newer
   * target's status. */
  isCurrentTarget?: () => boolean;
}

/**
 * Verify a Stellar address (G-address or federation address).
 *
 * Returns:
 * - "verified": Federation name found + account exists
 * - "active": Account exists, no federation name
 * - "unverified": Account not found or check failed
 * - "pending": Should not be returned (only internal state)
 */
export async function verifyAddress(
  address: string,
  options: VerifyAddressOptions = {},
): Promise<AddressVerification> {
  // Return cached result if available
  const cached = readVerificationCache(address);
  if (cached) return cached;

  // An already-aborted signal means the triggering component is gone (issue #724).
  if (options.signal?.aborted) throw new LookupAbortedError();

  // Start with pending status
  let accountExists: boolean | null = null;
  let federationName: string | null = null;
  let error: string | null = null;
  // Hoisted so the status/invalidation logic below can see the address the
  // Horizon checks actually ran against (the G-address behind a federation
  // address input).
  let resolvedAddress = address;

  try {
    // If federation address, resolve it first
    if (address.includes("*")) {
      try {
        const resolved = await resolveFederationName(address, { signal: options.signal });
        if (resolved) {
          federationName = address; // Store the federation name that was entered
          resolvedAddress = resolved;
        } else {
          error = "Federation address could not be resolved";
        }
      } catch (err) {
        if (isLookupAborted(err)) throw err;
        error = err instanceof Error ? err.message : "Federation resolution failed";
      }
    }

    // A cancellation between hops must stop the run before it caches anything.
    if (options.signal?.aborted) throw new LookupAbortedError();

    // Check if resolved address exists on Horizon
    if (resolvedAddress.startsWith("G")) {
      accountExists = await checkAccountExists(resolvedAddress, options.signal);
      if (options.signal?.aborted) throw new LookupAbortedError();
      if (accountExists === false) {
        error = "Account not found on Stellar network";
      } else if (accountExists === null && !error) {
        error = "Could not verify account status";
      }
    }

    // If no federation name from input, try reverse lookup
    if (!federationName && resolvedAddress.startsWith("G")) {
      try {
        const reverse = await resolveFederationName(resolvedAddress, { signal: options.signal });
        if (options.signal?.aborted) throw new LookupAbortedError();
        if (reverse) {
          federationName = reverse;
        }
      } catch (err) {
        if (isLookupAborted(err)) throw err;
        // Reverse lookup is optional, don't fail on error
      }
    }
  } catch (err) {
    // Cancellation is not a verification outcome — propagate it so the caller
    // can ignore the run entirely instead of recording "unverified" (issue #724).
    if (isLookupAborted(err)) throw err;
    error = err instanceof Error ? err.message : "Verification failed";
  }

  // Determine status
  let status: VerificationStatus = "unverified";
  if (accountExists === true) {
    status = federationName ? "verified" : "active";
  }

  const verification: AddressVerification = {
    status,
    address,
    federationName,
    accountExists,
    error,
    lastCheckedAt: Date.now(),
  };

  // Stale run (issue #723): the caller has already moved on to another address.
  // The result describes the wrong target, so it must not poison the 5-minute
  // verification cache — and callers guard on `isCurrentTarget` (or the
  // result's address) before applying it.
  if (options.isCurrentTarget?.() === false) {
    return verification;
  }

  // Failed or unverified verification (issue #725): any [[ACCOUNTS]] alias a
  // domain published for this address earlier is no longer trustworthy —
  // invalidate the cached TOML display name so the UI cannot keep showing a
  // friendly label for an address that just failed verification.
  if (status === "unverified") {
    if (isGAddress(resolvedAddress)) invalidateTomlDisplayName(resolvedAddress);
    if (isGAddress(address) && address !== resolvedAddress) {
      invalidateTomlDisplayName(address);
    }
  }

  writeVerificationCache(verification);
  return verification;
}

/**
 * Get human-readable status message for display.
 */
export function getStatusMessage(status: VerificationStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "active":
      return "Active";
    case "unverified":
      return "Unverified";
    case "pending":
      return "Verifying…";
    default:
      return "Unknown";
  }
}

/**
 * Check if address verification should allow stream creation.
 * Returns false only for unverified addresses.
 */
export function canCreateStream(verification: AddressVerification | null): boolean {
  if (!verification) return false;
  return verification.status !== "unverified";
}
