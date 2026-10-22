"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSettings } from "@/src/context/SettingsContext";
import { APP_NETWORK } from "@/src/lib/freighter";
import { useTranslations } from "@/src/lib/i18n";

interface TokenBalance {
  symbol: string;
  balance: string;
  issuer?: string;
  /**
   * True for an asset that isn't in SUPPORTED_TOKENS, including one that
   * reuses a supported code under a different issuer. It is shown under its
   * own code with the raw Horizon balance and a short issuer, never as one
   * of the supported tokens.
   */
  unrecognized?: boolean;
}

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

const isCreditAsset = (b: HorizonBalance) =>
  b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12";

const shortIssuer = (issuer: string) => `${issuer.slice(0, 4)}…${issuer.slice(-4)}`;

interface WalletBalanceDisplayProps {
  address: string | null;
  balanceRefreshTrigger?: number;
}

const SUPPORTED_TOKENS = [
  { symbol: "USDC", issuer: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU" },
  { symbol: "XLM", issuer: "native" },
  { symbol: "AQUA", issuer: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" },
  { symbol: "yXLM", issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55" },
];

const HORIZON_URL =
  APP_NETWORK === "public" || APP_NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : APP_NETWORK === "futurenet"
    ? "https://horizon-futurenet.stellar.org"
    : "https://horizon-testnet.stellar.org";

export default function WalletBalanceDisplay({
  address,
  balanceRefreshTrigger,
}: WalletBalanceDisplayProps) {
  const t = useTranslations("nav");
  const { language } = useSettings();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceUpdated, setBalanceUpdated] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const prevBalancesRef = useRef<string>("");

  const fetchBalances = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${addr}`);
      if (!res.ok) throw new Error(`Horizon ${res.status}`);
      const data = await res.json() as { balances?: HorizonBalance[] };

      const tokenBalances: TokenBalance[] = [];

      for (const token of SUPPORTED_TOKENS) {
        if (token.issuer === "native") {
          // Every account has a native XLM balance — always show it, even
          // when it's 0.
          const native = data.balances?.find((b) => b.asset_type === "native");
          tokenBalances.push({
            symbol: token.symbol,
            balance: native ? parseFloat(native.balance).toFixed(2) : "0.00",
            issuer: token.issuer,
          });
        } else {
          // No trustline for this asset means the account doesn't hold it —
          // omit it rather than showing a fabricated 0.00 balance, or every
          // account would appear to hold every entry in SUPPORTED_TOKENS.
          // Codes of up to 4 characters (USDC, AQUA, yXLM) are
          // credit_alphanum4 on Horizon; longer ones are credit_alphanum12.
          const matching = data.balances?.find(
            (b) =>
              isCreditAsset(b) &&
              b.asset_code === token.symbol &&
              b.asset_issuer === token.issuer
          );
          if (matching) {
            tokenBalances.push({
              symbol: token.symbol,
              balance: parseFloat(matching.balance).toFixed(2),
              issuer: token.issuer,
            });
          }
        }
      }

      // Any other asset the account holds: keep it, labelled by its own
      // code and issuer, rather than dropping it or passing it off as a
      // supported token with the same code.
      for (const b of data.balances ?? []) {
        if (!isCreditAsset(b) || !b.asset_code || !b.asset_issuer) continue;
        const supported = SUPPORTED_TOKENS.some(
          (t) => t.symbol === b.asset_code && t.issuer === b.asset_issuer
        );
        if (supported) continue;
        tokenBalances.push({
          symbol: b.asset_code,
          balance: b.balance,
          issuer: b.asset_issuer,
          unrecognized: true,
        });
      }

      const balancesStr = JSON.stringify(tokenBalances);
      if (balancesStr !== prevBalancesRef.current) {
        setBalances(tokenBalances);
        if (prevBalancesRef.current) {
          setBalanceUpdated(true);
          const timer = setTimeout(() => setBalanceUpdated(false), 2000);
          return () => clearTimeout(timer);
        }
        prevBalancesRef.current = balancesStr;
      }
    } catch {
      setBalances([]);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setBalances([]);
      prevBalancesRef.current = "";
      return;
    }

    void fetchBalances(address);
    const interval = setInterval(() => void fetchBalances(address), 60_000);
    return () => clearInterval(interval);
  }, [address, fetchBalances, balanceRefreshTrigger]);

  if (!address) return null;

  const primaryBalance = balances.find((b) => b.symbol === "XLM");
  const otherBalances = balances.filter((b) => b.symbol !== "XLM");

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="text-xs text-gray-600 dark:text-gray-300 font-mono hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        title={t("wallet_balance") || "Wallet balance"}
        aria-label={t("wallet_balance") || "Wallet balance"}
        aria-expanded={showDropdown}
      >
        {balanceLoading && balances.length === 0 ? (
          <span className="inline-block w-16 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" aria-hidden="true" />
        ) : primaryBalance ? (
          <>
            <span>{`${parseFloat(primaryBalance.balance).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`}</span>
            {otherBalances.length > 0 && (
              <span className="text-[10px] bg-green-600 dark:bg-green-500 text-white px-1.5 py-0.5 rounded-full">
                +{otherBalances.length}
              </span>
            )}
            {balanceUpdated && (
              <span className="text-[10px] text-green-400 font-normal" aria-live="polite">
                ✓
              </span>
            )}
          </>
        ) : null}
      </button>

      {showDropdown && otherBalances.length > 0 && (
        <div className="absolute right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg p-3 z-50 min-w-48">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t("wallet_balance") || "Wallet Balance"}
          </div>
          <div className="space-y-2">
            {balances.map((token) =>
              token.unrecognized ? (
                <div
                  key={`${token.symbol}:${token.issuer}`}
                  data-testid="unrecognized-balance"
                  className="flex justify-between items-center gap-3 text-xs text-gray-600 dark:text-gray-400"
                >
                  <span className="font-medium" title={`Issuer ${token.issuer}`}>
                    {token.symbol}{" "}
                    <span className="font-mono text-[10px] text-gray-400">
                      ({shortIssuer(token.issuer ?? "")})
                    </span>
                  </span>
                  <span className="font-mono">
                    {token.balance} {token.symbol}
                  </span>
                </div>
              ) : (
                <div key={`${token.symbol}:${token.issuer}`} className="flex justify-between items-center text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium">{token.symbol}</span>
                  <span className="font-mono">
                    {parseFloat(token.balance).toLocaleString(language, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 7,
                    })}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
