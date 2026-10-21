import Link from "next/link";

/**
 * Dashboard empty state shown when a connected wallet has no streams (#550).
 *
 * The illustration is theme-aware: every fill/stroke is driven by Tailwind
 * `fill-*` / `stroke-*` classes with `dark:` variants, so it adapts when the
 * `dark` / `light` class on <html> changes.
 */
export default function EmptyStreamsIllustration() {
  return (
    <div className="rounded-xl p-10 text-center flex flex-col items-center gap-4 border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
      <svg
        width="200"
        height="150"
        viewBox="0 0 200 150"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="No streams created yet"
        className="max-w-full h-auto"
      >
        {/* Backdrop */}
        <ellipse cx="100" cy="132" rx="72" ry="8" className="fill-gray-200 dark:fill-gray-900" />
        <circle cx="100" cy="70" r="60" className="fill-green-50 dark:fill-gray-900" />

        {/* Sender wallet */}
        <rect x="22" y="54" width="44" height="32" rx="6" strokeWidth="2" className="fill-white stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-600" />
        <rect x="48" y="64" width="18" height="12" rx="3" className="fill-gray-200 dark:fill-gray-700" />
        <circle cx="56" cy="70" r="2.5" className="fill-green-500 dark:fill-green-400" />

        {/* Recipient wallet */}
        <rect x="134" y="54" width="44" height="32" rx="6" strokeWidth="2" className="fill-white stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-600" />
        <rect x="134" y="64" width="18" height="12" rx="3" className="fill-gray-200 dark:fill-gray-700" />
        <circle cx="144" cy="70" r="2.5" className="fill-green-500 dark:fill-green-400" />

        {/* Dashed stream path waiting to be filled */}
        <path
          d="M68 70 C88 44, 112 96, 132 70"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="2 8"
          className="stroke-green-500 dark:stroke-green-400"
        />
        <circle cx="84" cy="60" r="4" className="fill-green-500/70 dark:fill-green-400/70" />
        <circle cx="100" cy="70" r="5" className="fill-green-500 dark:fill-green-400" />
        <circle cx="116" cy="80" r="4" className="fill-green-500/70 dark:fill-green-400/70" />

        {/* Sparkles */}
        <path d="M100 18 v10 M95 23 h10" strokeWidth="2" strokeLinecap="round" className="stroke-gray-400 dark:stroke-gray-500" />
        <path d="M160 30 v6 M157 33 h6" strokeWidth="2" strokeLinecap="round" className="stroke-gray-300 dark:stroke-gray-600" />
        <path d="M38 32 v6 M35 35 h6" strokeWidth="2" strokeLinecap="round" className="stroke-gray-300 dark:stroke-gray-600" />
      </svg>

      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">No streams yet</h2>
      <p className="text-sm max-w-xs text-gray-600 dark:text-gray-400">
        Stream payments in real time to anyone on Stellar. Set up your first stream in under a minute.
      </p>
      <Link
        href="/stream/new"
        className="mt-2 inline-flex items-center gap-2 bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-800"
      >
        Create your first stream <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
