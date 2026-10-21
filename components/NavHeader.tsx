"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NetworkSelector from "@/components/NetworkSelector";
import WalletConnect from "@/components/WalletConnect";
import ThemeToggle from "@/components/ThemeToggle";
import ChangelogModal, { useChangelogUnread } from "@/components/ChangelogModal";
import NotificationBadge from "@/components/NotificationBadge";
import GlobalSearch from "@/components/GlobalSearch";
import WalletBalanceDisplay from "@/components/WalletBalanceDisplay";
import { useNotifications } from "@/src/context/NotificationContext";
import { useSettings } from "@/src/context/SettingsContext";
import { useWallet } from "@/src/context/WalletContext";
import { useTranslations } from "@/src/lib/i18n";
import { useGlobalShortcuts } from "@/components/GlobalShortcuts";
import RpcHealthIndicator from "@/components/RpcHealthIndicator";
import { useNetwork } from "@/src/lib/network";
import { useFocusTrap } from "@/src/lib/useFocusTrap";

const HORIZON_URL = process.env.NEXT_PUBLIC_RPC_URL
  ? process.env.NEXT_PUBLIC_RPC_URL.replace("/rpc/v1", "")
  : "https://horizon-testnet.stellar.org";

const NAV_LINKS = [
  { href: "/", key: "home" },
  { href: "/dashboard", key: "dashboard" },
  { href: "/analytics", key: "analytics" },
  { href: "/stream/new", key: "create" },
  { href: "/activity", key: "activity" },
  { href: "/admin", key: "admin" },
  { href: "/archive", key: "archive" },
  { href: "/settings", key: "settings" },
] as const;

// Routes already reachable from BottomNav on mobile; omitted from the drawer.
const BOTTOM_NAV_HREFS = ["/dashboard", "/stream/new", "/address-book", "/settings"];
const DRAWER_LINKS = NAV_LINKS.filter((l) => !BOTTOM_NAV_HREFS.includes(l.href));

/**
 * Next.js App Router (14.2.5) has a known failure mode where a soft
 * (client-side) navigation gets stuck — the router can't apply the fetched
 * RSC payload and, unlike its documented behavior, doesn't fall back to a
 * hard navigation either. The click just does nothing, with no error
 * surfaced anywhere (vercel/next.js#57565). Since the header's nav links are
 * the primary way users move through the app, force a real browser
 * navigation if the soft nav demonstrably didn't go anywhere.
 */
function watchdogNav(href: string) {
  const startPath = window.location.pathname;
  window.setTimeout(() => {
    if (window.location.pathname === startPath && startPath !== href) {
      window.location.href = href;
    }
  }, 1200);
}

export default function NavHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const { countFor, clearSection } = useNotifications();
  const { showUsd, toggleShowUsd, language } = useSettings();
  const { address, balanceRefreshTrigger } = useWallet();
  const { network } = useNetwork();
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceUpdated, setBalanceUpdated] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const changelogUnread = useChangelogUnread();
  const { openHelp } = useGlobalShortcuts();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Close the drawer on navigation.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Clear a section's unread badge once the user navigates into it (#193).
  useEffect(() => {
    const active = NAV_LINKS.find(
      (l) => pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href)),
    );
    if (active) clearSection(active.href);
  }, [pathname, clearSection]);

  const fetchBalance = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${addr}`);
      if (!res.ok) throw new Error(`Horizon ${res.status}`);
      const data = await res.json() as { balances?: { asset_type: string; asset_code?: string; balance: string }[] };
      const native = data.balances?.find((b) => b.asset_type === "native");
      const usdc = data.balances?.find((b) => b.asset_code === "USDC");
      setXlmBalance(native ? parseFloat(native.balance).toFixed(2) : null);
      setUsdcBalance(usdc ? parseFloat(usdc.balance).toFixed(2) : null);
    } catch {
      setXlmBalance(null);
      setUsdcBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setXlmBalance(null);
      setUsdcBalance(null);
      return;
    }
    void fetchBalance(address);
    const interval = setInterval(() => void fetchBalance(address), 60_000);
    return () => clearInterval(interval);
  // balanceRefreshTrigger: re-fetch immediately when bumped (e.g. after withdrawal)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, fetchBalance, balanceRefreshTrigger]);

  // Brief "Balance updated" indicator when balance changes
  const prevBalanceRef = useRef<string | null>(null);
  const prevUsdcRef = useRef<string | null>(null);
  useEffect(() => {
    const xlmChanged = xlmBalance !== null && prevBalanceRef.current !== null && prevBalanceRef.current !== xlmBalance;
    const usdcChanged = usdcBalance !== null && prevUsdcRef.current !== null && prevUsdcRef.current !== usdcBalance;
    if (xlmChanged || usdcChanged) {
      setBalanceUpdated(true);
      const timer = setTimeout(() => setBalanceUpdated(false), 2000);
      return () => clearTimeout(timer);
    }
    prevBalanceRef.current = xlmBalance;
    prevUsdcRef.current = usdcBalance;
  }, [xlmBalance, usdcBalance]);

  return (
    <>
      <header
        className={`sticky top-0 z-50 border-b transition-colors ${
          scrolled ? "border-gray-200 bg-white/95 dark:border-gray-700 dark:bg-gray-900/95 backdrop-blur" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        }`}
      >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-14 py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-w-0">
        <div className="flex items-center gap-3 lg:gap-6 min-w-0 shrink-0">
          <Link
            href="/"
            // See watchdogNav above: this brand link is mounted on every
            // single page and was found (via stack-traced history API
            // calls) to be the actual source of the stuck-router bug — its
            // background prefetch for "/" was later applied by Next's
            // router over whatever page the user had actually navigated
            // to, silently bouncing them back home a second or two after
            // any navigation, click-driven or not.
            prefetch={false}
            className="shrink-0 text-lg font-bold text-green-400 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            SoroStream
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 shrink-0"
            aria-label={t("main_navigation")}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          {/* Nav wraps onto a second line instead of overflowing into the
              wallet controls on medium-width viewports (#542). */}
          <nav className="hidden sm:flex flex-wrap items-center gap-x-2 sm:gap-x-3 lg:gap-x-4 gap-y-1 min-w-0" aria-label={t("main_navigation")}>
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              const unread = countFor(link.href);
              const label = t(link.key);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  // Mitigates a known App Router bug (vercel/next.js#57565)
                  // where soft navigation can get permanently stuck with no
                  // error; prefetching these always-visible links increases
                  // exposure to it, and watchdogNav (below) is the recovery.
                  prefetch={false}
                  onClick={() => watchdogNav(link.href)}
                  aria-current={isActive ? "page" : undefined}
                  className={`text-sm whitespace-nowrap transition-colors rounded-md px-1 py-0.5 inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 dark:focus-visible:ring-offset-gray-900 ${
                    isActive ? "text-gray-900 dark:text-white font-medium" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {label}
                  <NotificationBadge count={unread} label={`${label} update`} />
                  {isActive && <span className="ml-1 inline-block h-1 w-1 rounded-full bg-green-600 dark:bg-green-400" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 min-w-0 shrink-0">
          {/* GlobalSearch reads useSearchParams(), which requires a Suspense
              boundary or every page using NavHeader fails static prerendering. */}
          <Suspense fallback={null}>
            <GlobalSearch />
          </Suspense>
          <NetworkSelector />
          <RpcHealthIndicator />
          {address && (
            <span
              className="text-xs text-gray-600 dark:text-gray-300 font-mono hidden md:inline-block shrink-0"
              aria-label={t("wallet_balance")}
            >
              {balanceLoading && xlmBalance === null && usdcBalance === null ? (
                <span className="inline-block w-24 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" aria-hidden="true" />
              ) : (xlmBalance !== null || usdcBalance !== null) ? (
                <span className="inline-flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-gray-50 dark:bg-gray-800">
                  {xlmBalance !== null && (
                    <span>{parseFloat(xlmBalance).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM</span>
                  )}
                  {usdcBalance !== null && (
                    <span className="text-gray-400 dark:text-gray-500">|</span>
                  )}
                  {usdcBalance !== null && (
                    <span className="text-blue-600 dark:text-blue-400">{parseFloat(usdcBalance).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
                  )}
                  {balanceUpdated && (
                    <span className="text-[10px] text-green-400 font-normal" aria-live="polite">
                      updated
                    </span>
                  )}
                </span>
              ) : null}
            </span>
          )}
          <WalletConnect compact />
          <button
            onClick={toggleShowUsd}
            className={`hidden sm:block text-xs px-2 py-1 rounded border transition-colors ${
              showUsd
                ? "border-green-600 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            aria-pressed={showUsd}
            aria-label={showUsd ? t("hide_usd") : t("show_usd")}
            title={showUsd ? t("hide_usd") : t("show_usd")}
          >
            {showUsd ? t("usd_active") : t("usd")}
          </button>
          <button
            onClick={() => setChangelogOpen(true)}
            className="relative text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 dark:focus-visible:ring-offset-gray-900 p-1"
            aria-label={changelogUnread ? t("whats_new_unread") : t("whats_new")}
            title={t("whats_new")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {changelogUnread && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-600 dark:bg-green-400 rounded-full" aria-hidden="true" />
            )}
          </button>
          <button
            onClick={openHelp}
            className="hidden sm:block text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            title={t("keyboard_shortcuts")}
            aria-label={t("open_keyboard_shortcuts")}
          >
            <span>{t("shortcuts")}</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
    {network === "testnet" && (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-700 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-yellow-700 dark:text-yellow-400 flex-shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Testnet mode: Connected to Stellar Testnet. For development and testing only.
          </span>
        </div>
      </div>
    )}
    <div className={`fixed inset-0 z-[60] md:hidden ${menuOpen ? "" : "hidden"}`}>
        <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        <div
          ref={drawerRef}
          id="mobile-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t("main_navigation")}
          className="absolute inset-y-0 left-0 w-full bg-white dark:bg-gray-900 p-4 shadow-xl animate-nav-drawer-in"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-lg font-bold text-green-400">SoroStream</span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="p-1 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              aria-label="Close menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <nav aria-label={t("main_navigation")}>
            <ul className="flex flex-col gap-1">
              {DRAWER_LINKS.map((link) => {
                const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      prefetch={false}
                      onClick={() => {
                        setMenuOpen(false);
                        watchdogNav(link.href);
                      }}
                      aria-current={isActive ? "page" : undefined}
                      className={`block rounded-md px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                        isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {t(link.key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
    </div>
    <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}
