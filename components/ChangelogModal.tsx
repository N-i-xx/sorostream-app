"use client";
import { useEffect, useState, useRef } from "react";
import { useFocusTrap } from "@/src/lib/useFocusTrap";

interface ChangelogEntry {
  icon: string;
  title: string;
  description: string;
}

interface Changelog {
  version: string;
  entries: ChangelogEntry[];
}

/**
 * Seen-state is tracked per release, not per entry: this key holds the
 * changelog `version` the user has seen. Opening the modal marks that whole
 * version seen as soon as the changelog loads. How far the user scrolled
 * and how quickly they close it don't matter: opening "What's New" counts
 * as acknowledging the release, so the unread dot clears and the modal is
 * not pushed again until a new version ships. Covered by
 * ChangelogModal.seenState.test.tsx.
 */
const STORAGE_KEY = "sorostream-changelog-seen";

/**
 * Check whether the latest changelog version has been seen by the user.
 *
 * @returns {boolean} `true` when `/CHANGELOG.json` has a version not yet stored as seen.
 */
export function useChangelogUnread(): boolean {
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/CHANGELOG.json");
        if (!res.ok) return;
        const data: Changelog = await res.json();
        const seen = localStorage.getItem(STORAGE_KEY);
        setUnread(seen !== data.version);
      } catch {
        // ignore
      }
    }
    void check();
  }, []);

  return unread;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ChangelogModal({ open, onClose }: Props) {
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, open, onClose);

  useEffect(() => {
    if (!open) return;
    async function load() {
      try {
        const res = await fetch("/CHANGELOG.json");
        if (!res.ok) return;
        const data: Changelog = await res.json();
        setChangelog(data);
        localStorage.setItem(STORAGE_KEY, data.version);
      } catch {
        // ignore
      }
    }
    void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Stay mounted in the DOM at all times and toggle visibility via
  // `display: none` (Tailwind's `hidden` class) instead of conditionally
  // rendering/unmounting. `display: none` already removes the subtree from
  // the tab order and the accessibility tree, so focus-trap/Escape/backdrop
  // behavior above (all gated on `open`) continues to work correctly while
  // the modal is closed (#615).
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="What's new in SoroStream"
      aria-hidden={!open}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${open ? "" : "hidden"}`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">What&apos;s New</h2>
            {changelog && (
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">Version {changelog.version}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 p-1"
            aria-label="Close changelog"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {changelog ? (
          <ul className="flex flex-col gap-4">
            {changelog.entries.map((entry, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5" aria-hidden="true">{entry.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{entry.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{entry.description}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-2/3" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-1 w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 dark:focus-visible:ring-offset-gray-900"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
