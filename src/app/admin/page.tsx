"use client";
/**
 * /admin — Admin dashboard.
 *
 * Gated to the configured admin wallets (#211, #559): only addresses listed in
 * NEXT_PUBLIC_ADMIN_ADDRESSES may view the page. Connected non-admin wallets
 * and visitors with no wallet are redirected to / with an "Access denied"
 * toast. When no admin addresses are configured, every wallet is denied.
 *
 * Sections:
 * - Contract Status: paused/active, current fee rate, whitelist size
 * - Emergency Pause: toggle contract-wide pause, admin only
 * - Token Whitelist: add/remove whitelisted token symbols
 * - Fee Rate: view/update the protocol fee (basis points)
 * - Treasury Balances: accumulated fees per token, with sweep action
 *   (USD equivalent via XLM price feed for XLM, 1:1 for USDC; last sweep
 *   date/amount; zero-balance tokens show "No fees collected")
 * Treasury Stats widget:
 * - Shows accumulated fee balance per supported token
 * - USD equivalent via XLM price feed (XLM tokens) or 1:1 assumption for USDC
 * - Last sweep date and amount
 * - Sweep button visible only to the admin wallet address
 * - Zero-balance tokens show "No fees collected"
 * - Sweep triggers a balance refresh
 *
 * Stream Management widget:
 * - Filter by status and token
 * - Paginated list (PAGE_SIZE rows per page)
 * - Pagination resets to page 1 on every filter change
 * - Per-page limit preserved across filter changes
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocaleDateFormat } from "@/src/lib/dateFormat";
import {
  getTreasuryBalances,
  sweepTreasuryFees,
  formatStellarAmount,
  getContractState,
  setContractPaused,
  setFeeRate,
  addWhitelistToken,
  removeWhitelistToken,
  type TreasuryBalance,
  type ContractState,
  getMockStreams,
  type StreamData,
} from "@/src/lib/sorostream";
import { useXlmPrice } from "@/src/lib/useXlmPrice";
import { useWallet } from "@/src/context/WalletContext";
import { formatCurrency } from "@/src/lib/formatCurrency";
import { useToast } from "@/src/lib/toast";
import StatusBadge from "@/components/StatusBadge";

// ── Env-configurable admin wallet addresses ─────────────────────────────────
// NEXT_PUBLIC_ADMIN_ADDRESSES is a comma-separated list of admin wallets.
// NEXT_PUBLIC_ADMIN_ADDRESS and NEXT_PUBLIC_ADMIN_WALLET remain
// backward-compatible aliases. Each var is referenced literally so Next.js
// inlines it into the client bundle.
const ADMIN_ADDRESS_SOURCE =
  process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ||
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS ||
  process.env.NEXT_PUBLIC_ADMIN_WALLET ||
  "";

const ADMIN_ADDRESSES = ADMIN_ADDRESS_SOURCE.split(/[\s,]+/)
  .map((address) => address.trim())
  .filter(Boolean);

/**
 * How long to wait for a previously connected wallet to be restored after a
 * page load before treating the visitor as unauthenticated.
 */
const WALLET_RESTORE_GRACE_MS = 1500;

const STREAM_PAGE_SIZES = [10, 25, 50] as const;
type StreamPageSize = (typeof STREAM_PAGE_SIZES)[number];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the approximate USD value of a treasury balance.
 * - USDC is treated as 1:1 with USD.
 * - XLM uses the live price feed.
 * - Other tokens: shown as "—" when price is unavailable.
 */
function toUsd(
  token: string,
  stroops: number,
  xlmPrice: number | null,
): string | null {
  const amount = stroops / 10_000_000;
  if (token === "USDC") return formatCurrency(amount);
  if (token === "XLM" && xlmPrice !== null) {
    const usd = amount * xlmPrice;
    return formatCurrency(usd);
  }
  return null;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 inline-block align-middle"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

interface TreasuryRowProps {
  entry: TreasuryBalance;
  isAdmin: boolean;
  xlmPrice: number | null;
  onSweep: (token: string) => Promise<void>;
  sweeping: boolean;
}

function TreasuryRow({ entry, isAdmin, xlmPrice, onSweep, sweeping }: TreasuryRowProps) {
  const { formatDate } = useLocaleDateFormat();
  const hasBalance = entry.balanceStroops > 0;
  const usdValue = hasBalance ? toUsd(entry.token, entry.balanceStroops, xlmPrice) : null;
  const lastSweepLabel = entry.lastSweepAt ? formatDate(entry.lastSweepAt) : "—";

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 flex flex-col gap-3">
      {/* Token name + balance */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Token</p>
          <p className="text-lg font-bold text-white">{entry.token}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Balance</p>
          {hasBalance ? (
            <p className="text-lg font-bold text-green-400 font-mono">
              {formatStellarAmount(entry.balanceStroops)}
            </p>
          ) : (
            <p className="text-sm text-gray-500 italic">No fees collected</p>
          )}
        </div>
      </div>

      {/* USD equivalent */}
      {hasBalance && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">≈</span>
          <span className="text-gray-300">
            {usdValue ?? <span className="text-gray-500 text-xs">Price unavailable</span>}
          </span>
          {entry.token === "XLM" && xlmPrice !== null && (
            <span className="text-xs text-gray-500">@ ${xlmPrice.toFixed(4)}/XLM</span>
          )}
        </div>
      )}

      {/* Last sweep info */}
      <div className="text-xs text-gray-400 space-y-0.5 border-t border-gray-700 pt-3">
        <div className="flex justify-between">
          <span>Last sweep</span>
          <span className="text-gray-300">{lastSweepLabel}</span>
        </div>
        {entry.lastSweepAmountStroops !== null && (
          <div className="flex justify-between">
            <span>Last swept amount</span>
            <span className="text-gray-300 font-mono">
              {formatStellarAmount(entry.lastSweepAmountStroops)} {entry.token}
            </span>
          </div>
        )}
      </div>

      {/* Sweep button — admin only */}
      {isAdmin && (
        <button
          onClick={() => onSweep(entry.token)}
          disabled={sweeping || !hasBalance}
          aria-busy={sweeping}
          className="mt-1 w-full py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-40 disabled:cursor-not-allowed bg-green-700 text-white hover:bg-green-600"
          title={!hasBalance ? "No fees to sweep" : undefined}
        >
          {sweeping ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner /> Sweeping…
            </span>
          ) : (
            "Sweep Fees"
          )}
        </button>
      )}
    </div>
  );
}

interface WhitelistSectionProps {
  tokens: string[];
  isAdmin: boolean;
  onAdd: (token: string) => Promise<void>;
  onRemove: (token: string) => Promise<void>;
  pending: boolean;
}

function WhitelistSection({ tokens, isAdmin, onAdd, onRemove, pending }: WhitelistSectionProps) {
  const [newToken, setNewToken] = useState("");

  return (
    <section aria-labelledby="whitelist-heading" className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <h2 id="whitelist-heading" className="text-lg font-semibold mb-1">
        Token Whitelist
      </h2>
      <p className="text-gray-400 text-sm mb-4">{tokens.length} token(s) currently whitelisted.</p>

      {isAdmin && (
        <form
          className="flex gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            const symbol = newToken.trim();
            if (!symbol) return;
            void onAdd(symbol).then(() => setNewToken(""));
          }}
        >
          <label htmlFor="whitelist-add-input" className="sr-only">
            Token symbol to whitelist
          </label>
          <input
            id="whitelist-add-input"
            type="text"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="e.g. USDC"
            disabled={pending}
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          />
          <button
            type="submit"
            disabled={pending || !newToken.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            Add
          </button>
        </form>
      )}

      {tokens.length === 0 ? (
        <p className="text-gray-500 text-sm">No tokens whitelisted.</p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((token) => (
            <li
              key={token}
              className="flex items-center justify-between bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2"
            >
              <span className="text-white font-mono text-sm">{token}</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void onRemove(token)}
                  disabled={pending}
                  className="text-red-400 hover:text-red-300 text-xs disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded px-1"
                  aria-label={`Remove ${token} from whitelist`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const { address, isConnecting } = useWallet();
  const { price: xlmPrice } = useXlmPrice();
  const { addToast } = useToast();

  const [balances, setBalances] = useState<TreasuryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [sweepingToken, setSweepingToken] = useState<string | null>(null);

  const [contractState, setContractStateData] = useState<ContractState | null>(null);
  const [contractLoading, setContractLoading] = useState(true);
  const [pauseSubmitting, setPauseSubmitting] = useState(false);
  const [whitelistSubmitting, setWhitelistSubmitting] = useState(false);
  const [feeInput, setFeeInput] = useState("");
  const [feeError, setFeeError] = useState("");
  const [feeSubmitting, setFeeSubmitting] = useState(false);
  // ── Stream management state ───────────────────────────────────────────────
  const [allStreams] = useState<StreamData[]>(() => getMockStreams());
  const [statusFilter, setStatusFilter] = useState("");
  const [tokenFilter, setTokenFilter] = useState("");
  const [streamPage, setStreamPage] = useState(1);
  const [pageSize, setPageSize] = useState<StreamPageSize>(10);

  // Unique token list for the filter dropdown
  const uniqueTokens = useMemo(
    () => Array.from(new Set(allStreams.map((s) => s.token))).sort(),
    [allStreams],
  );

  const filteredStreams = useMemo(() => {
    return allStreams.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (tokenFilter && s.token !== tokenFilter) return false;
      return true;
    });
  }, [allStreams, statusFilter, tokenFilter]);

  const totalStreamPages = Math.max(1, Math.ceil(filteredStreams.length / pageSize));
  // Clamp currentPage so it never exceeds totalStreamPages
  const currentStreamPage = Math.min(streamPage, totalStreamPages);
  const paginatedStreams = filteredStreams.slice(
    (currentStreamPage - 1) * pageSize,
    currentStreamPage * pageSize,
  );

  // Reset to page 1 whenever a filter changes; preserve pageSize
  useEffect(() => {
    setStreamPage(1);
  }, [statusFilter, tokenFilter]);

  // An admin is any connected wallet that matches one of the configured
  // client-side addresses.
  const isAdmin = Boolean(address && ADMIN_ADDRESSES.includes(address));

  // Non-admin wallets are redirected immediately. Visitors with no wallet get
  // a short grace period so a session being restored on reload isn't bounced.
  useEffect(() => {
    if (isAdmin || isConnecting) return;

    const deny = () => {
      addToast("Access denied", "error");
      router.replace("/");
    };

    if (address) {
      deny();
      return;
    }

    const timer = setTimeout(deny, WALLET_RESTORE_GRACE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isAdmin, isConnecting]);

  const fetchBalances = useCallback(async () => {
    try {
      const data = await getTreasuryBalances();
      setBalances(data);
    } catch {
      addToast("Failed to load treasury balances.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const fetchContractState = useCallback(async () => {
    try {
      const state = await getContractState();
      setContractStateData(state);
      setFeeInput(String(state.feeBasisPoints));
    } catch {
      addToast("Failed to load contract state.", "error");
    } finally {
      setContractLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void fetchBalances();
    void fetchContractState();
  }, [fetchBalances, fetchContractState]);

  const handleSweep = useCallback(
    async (token: string) => {
      if (sweepingToken) return;
      setSweepingToken(token);
      try {
        const result = await sweepTreasuryFees(token);
        addToast(`Swept ${token} fees. TX: ${result.txHash}`, "success");
        // Refresh balances after a successful sweep
        await fetchBalances();
      } catch {
        addToast(`Failed to sweep ${token} fees. Please try again.`, "error");
      } finally {
        setSweepingToken(null);
      }
    },
    [sweepingToken, addToast, fetchBalances],
  );

  const handleTogglePause = useCallback(async () => {
    if (!contractState || pauseSubmitting) return;
    const next = !contractState.paused;
    setPauseSubmitting(true);
    // Optimistic update
    setContractStateData({ ...contractState, paused: next });
    try {
      await setContractPaused(next);
      addToast(next ? "Contract paused." : "Contract unpaused.", "success");
    } catch {
      setContractStateData(contractState); // revert
      addToast("Failed to update pause state. Please try again.", "error");
    } finally {
      setPauseSubmitting(false);
    }
  }, [contractState, pauseSubmitting, addToast]);

  const handleAddWhitelist = useCallback(
    async (token: string) => {
      setWhitelistSubmitting(true);
      try {
        await addWhitelistToken(token);
        await fetchContractState();
        addToast(`${token.toUpperCase()} added to whitelist.`, "success");
      } catch {
        addToast("Failed to add token to whitelist.", "error");
      } finally {
        setWhitelistSubmitting(false);
      }
    },
    [addToast, fetchContractState],
  );

  const handleRemoveWhitelist = useCallback(
    async (token: string) => {
      setWhitelistSubmitting(true);
      try {
        await removeWhitelistToken(token);
        await fetchContractState();
        addToast(`${token} removed from whitelist.`, "info");
      } catch {
        addToast("Failed to remove token from whitelist.", "error");
      } finally {
        setWhitelistSubmitting(false);
      }
    },
    [addToast, fetchContractState],
  );

  const handleSaveFeeRate = useCallback(async () => {
    const parsed = Number(feeInput);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
      setFeeError("Fee rate must be a whole number between 0 and 1000 basis points (0–10%).");
      return;
    }
    setFeeError("");
    setFeeSubmitting(true);
    try {
      await setFeeRate(parsed);
      await fetchContractState();
      addToast(`Fee rate updated to ${(parsed / 100).toFixed(2)}%.`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to update fee rate.", "error");
    } finally {
      setFeeSubmitting(false);
    }
  }, [feeInput, addToast, fetchContractState]);

  // Anyone who isn't a configured admin sees nothing while the redirect above
  // takes effect.
  if (!isAdmin) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">
              Contract controls, whitelist, fee configuration, and treasury management.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-green-400 hover:text-green-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            ← Dashboard
          </Link>
        </div>

        {/* Contract status summary */}
        <section aria-labelledby="status-heading" className="mb-6 bg-gray-800 rounded-xl border border-gray-700 px-5 py-4">
          <h2 id="status-heading" className="sr-only">
            Contract Status
          </h2>
          {contractLoading || !contractState ? (
            <div className="h-6 bg-gray-700 rounded animate-pulse w-2/3" />
          ) : (
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-gray-400 mb-1">Contract state</p>
                <p className={`font-semibold ${contractState.paused ? "text-red-400" : "text-green-400"}`}>
                  {contractState.paused ? "Paused" : "Active"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Fee rate</p>
                <p className="text-white font-semibold font-mono">
                  {(contractState.feeBasisPoints / 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Whitelisted tokens</p>
                <p className="text-white font-semibold">{contractState.whitelistedTokens.length}</p>
              </div>
            </div>
          )}
        </section>

        {/* Emergency Pause */}
        <section aria-labelledby="pause-heading" className="mb-6 bg-gray-800 rounded-xl border border-gray-700 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="pause-heading" className="text-lg font-semibold">
                Emergency Pause
              </h2>
              <p className="text-gray-400 text-sm mt-1">
                Pausing halts all stream creation, withdrawals, and top-ups contract-wide.
              </p>
            </div>
            {isAdmin && contractState && (
              <button
                type="button"
                role="switch"
                aria-label={contractState.paused ? "Unpause contract" : "Pause contract"}
                aria-checked={contractState.paused}
                onClick={handleTogglePause}
                disabled={pauseSubmitting || contractLoading}
                className={`shrink-0 relative inline-flex h-7 w-14 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                  contractState.paused ? "bg-red-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    contractState.paused ? "translate-x-8" : "translate-x-1"
                  }`}
                />
              </button>
            )}
          </div>
        </section>

        {/* Fee Rate configuration */}
        <section aria-labelledby="fee-heading" className="mb-6 bg-gray-800 rounded-xl border border-gray-700 p-5">
          <h2 id="fee-heading" className="text-lg font-semibold mb-1">
            Fee Rate
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Protocol fee applied to withdrawals, in basis points (100 bps = 1%).
          </p>
          {isAdmin ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="fee-rate-input" className="block text-xs text-gray-400 mb-1">
                  Basis points (0–1000)
                </label>
                <input
                  id="fee-rate-input"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={feeInput}
                  onChange={(e) => { setFeeInput(e.target.value); setFeeError(""); }}
                  disabled={feeSubmitting || contractLoading}
                  className="w-32 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  aria-invalid={!!feeError}
                  aria-describedby={feeError ? "fee-rate-error" : undefined}
                />
              </div>
              <button
                type="button"
                onClick={handleSaveFeeRate}
                disabled={feeSubmitting || contractLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {feeSubmitting ? "Saving…" : "Save"}
              </button>
              {feeError && (
                <p id="fee-rate-error" role="alert" className="text-red-400 text-xs w-full">
                  {feeError}
                </p>
              )}
            </div>
          ) : (
            <p className="text-white font-mono text-sm">
              {contractState ? `${(contractState.feeBasisPoints / 100).toFixed(2)}%` : "—"}
            </p>
          )}
        </section>

        {/* Token Whitelist */}
        <div className="mb-6">
          <WhitelistSection
            tokens={contractState?.whitelistedTokens ?? []}
            isAdmin={isAdmin}
            onAdd={handleAddWhitelist}
            onRemove={handleRemoveWhitelist}
            pending={whitelistSubmitting}
          />
        </div>

        {/* Treasury stats */}
        <section aria-labelledby="treasury-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="treasury-heading" className="text-lg font-semibold">
              Treasury Balances
            </h2>
            <button
              onClick={() => { setLoading(true); void fetchBalances(); }}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded px-2 py-1"
              aria-label="Refresh treasury balances"
            >
              {loading ? <Spinner /> : "↻ Refresh"}
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-44 bg-gray-800 rounded-xl animate-pulse border border-gray-700" />
              ))}
            </div>
          ) : balances.length === 0 ? (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-400 text-sm">
              No treasury data available.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {balances.map((entry) => (
                <TreasuryRow
                  key={entry.token}
                  entry={entry}
                  isAdmin={isAdmin}
                  xlmPrice={xlmPrice}
                  onSweep={handleSweep}
                  sweeping={sweepingToken === entry.token}
                />
              ))}
            </div>
          )}
        </section>

        {/* Summary totals */}
        {!loading && balances.length > 0 && (
          <div className="mt-6 bg-gray-800 rounded-xl border border-gray-700 px-5 py-4 flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-gray-400 mb-1">Total tokens tracked</p>
              <p className="text-white font-semibold">{balances.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Tokens with pending fees</p>
              <p className="text-white font-semibold">
                {balances.filter((b) => b.balanceStroops > 0).length}
              </p>
            </div>
          </div>
        )}

        {/* Stream Management */}
        <section aria-labelledby="streams-heading" className="mt-10">
          <h2 id="streams-heading" className="text-lg font-semibold mb-4">Stream Management</h2>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div>
              <label htmlFor="admin-status-filter" className="block text-xs text-gray-400 mb-1">
                Status
              </label>
              <select
                id="admin-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                <option value="">All statuses</option>
                <option value="Active">Active</option>
                <option value="Ended">Ended</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label htmlFor="admin-token-filter" className="block text-xs text-gray-400 mb-1">
                Token
              </label>
              <select
                id="admin-token-filter"
                value={tokenFilter}
                onChange={(e) => setTokenFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                <option value="">All tokens</option>
                {uniqueTokens.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="admin-page-size" className="block text-xs text-gray-400 mb-1">
                Per page
              </label>
              <select
                id="admin-page-size"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as StreamPageSize)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {STREAM_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            {(statusFilter || tokenFilter) && (
              <button
                onClick={() => { setStatusFilter(""); setTokenFilter(""); }}
                className="px-3 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Clear filters
              </button>
            )}
            <p className="text-xs text-gray-500 self-end ml-auto">
              {filteredStreams.length} stream{filteredStreams.length !== 1 ? "s" : ""}
              {totalStreamPages > 1 && (
                <span className="ml-1">· page {currentStreamPage} of {totalStreamPages}</span>
              )}
            </p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Sender</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Deposit</th>
                  <th className="px-4 py-3 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {paginatedStreams.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                      {statusFilter || tokenFilter
                        ? "No streams match the current filters."
                        : "No streams found."}
                    </td>
                  </tr>
                ) : (
                  paginatedStreams.map((s) => (
                    <tr key={s.id} className="bg-gray-900 hover:bg-gray-800/60 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-300">#{s.id}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} compact /></td>
                      <td className="px-4 py-3 text-white font-medium">{s.token}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{s.sender}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{s.recipient}</td>
                      <td className="px-4 py-3 text-gray-300">
                        {formatStellarAmount(s.deposit)} {s.token}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/stream/${s.id}`}
                          className="text-green-400 hover:text-green-300 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalStreamPages > 1 && (
            <nav
              aria-label="Stream list pagination"
              className="mt-4 flex items-center justify-center gap-2"
            >
              <button
                onClick={() => setStreamPage((p) => Math.max(1, p - 1))}
                disabled={currentStreamPage === 1}
                aria-label="Previous page"
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                ← Prev
              </button>
              {Array.from({ length: totalStreamPages }).map((_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setStreamPage(p)}
                    aria-current={currentStreamPage === p ? "page" : undefined}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                      currentStreamPage === p
                        ? "bg-green-700 border-green-600 text-white"
                        : "border-gray-700 text-gray-400 hover:bg-gray-800"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setStreamPage((p) => Math.min(totalStreamPages, p + 1))}
                disabled={currentStreamPage === totalStreamPages}
                aria-label="Next page"
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Next →
              </button>
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
