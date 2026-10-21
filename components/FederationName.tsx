"use client";
/**
 * FederationName — asynchronously resolves a Stellar public key to its
 * federation name and renders it inline alongside the address.
 *
 * - Does NOT block page load; renders the raw address immediately.
 * - Appends the resolved name (e.g. "alice*stellar.org") once available.
 * - Silently omits federation name if lookup fails or finds no record.
 * - Results are cached per session via the federation service.
 *
 * Props:
 *   address  — Stellar public key (G…)
 *   truncate — when true, truncates the address to GBAM…XDRL format (default: false)
 */
import { useEffect, useState } from "react";
import { resolveFederationName } from "@/src/lib/federation";
import { resolveTomlDisplayName } from "@/src/lib/stellarToml";

interface FederationNameProps {
  address: string;
  truncate?: boolean;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  const normalized = addr.toUpperCase();
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

export default function FederationName({
  address,
  truncate = false,
}: FederationNameProps) {
  const [fedName, setFedName] = useState<string | null>(null);
  const [tomlName, setTomlName] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // Cancel the in-flight lookup when this component unmounts (issue #724):
    // otherwise the 3-second-per-domain probe keeps running and can still
    // write to sessionStorage after the consumer is gone.
    const controller = new AbortController();

    resolveFederationName(address, { signal: controller.signal }).then(
      (name) => {
        if (!cancelled) setFedName(name);
      },
    ).catch(() => {
      // Lookup cancelled (or failed) — nothing to display.
    });
    resolveTomlDisplayName(address).then((name) => {
      if (!cancelled) setTomlName(name);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address]);

  const displayAddress = truncate ? truncateAddress(address) : address;

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="font-mono">{displayAddress}</span>
      {(fedName || tomlName) && (
        <span
          className="text-green-600 dark:text-green-400 text-xs font-medium bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded"
          title={tomlName ? `Account alias: ${tomlName}` : `Federation address: ${fedName}`}
          aria-label={tomlName ? `Account alias: ${tomlName}` : `Federation name: ${fedName}`}
        >
          {tomlName ?? fedName}
        </span>
      )}
    </span>
  );
}
