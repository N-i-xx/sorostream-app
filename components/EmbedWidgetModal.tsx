"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useFocusTrap } from "@/src/lib/useFocusTrap";
import { copyToClipboard } from "@/src/lib/clipboard";

interface EmbedWidgetModalProps {
  streamId: string;
  onClose: () => void;
}

type Theme = "dark" | "light";
type ShowMode = "both" | "claimable" | "progress";

/**
 * Modal that generates an embeddable <iframe> snippet for a given stream.
 * Supports theme and show mode selection, with one-click clipboard copy.
 */
export default function EmbedWidgetModal({ streamId, onClose }: EmbedWidgetModalProps) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [show, setShow] = useState<ShowMode>("both");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  // Pending copied/copyFailed reset timer, and whether we are still mounted.
  // Both are needed so closing the modal never triggers setState afterwards (#920).
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useFocusTrap(modalRef, true, onClose);

  // Build the embed URL
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://sorostream-app.vercel.app";
  const embedUrl = `${origin}/embed/stream/${streamId}?theme=${theme}&show=${show}`;

  const snippet = `<iframe
  src="${embedUrl}"
  width="320"
  height="${show === "both" ? "220" : "160"}"
  frameborder="0"
  scrolling="no"
  style="border:none;border-radius:12px;overflow:hidden;"
  title="SoroStream ${streamId}"
  loading="lazy"
></iframe>`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(snippet);
    // The modal may have been closed while the clipboard write was pending.
    if (!mountedRef.current) return;
    // A repeated click restarts the reset window instead of stacking timers.
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      resetTimerRef.current = setTimeout(() => setCopied(false), 2500);
    } else {
      setCopied(false);
      setCopyFailed(true);
      resetTimerRef.current = setTimeout(() => setCopyFailed(false), 4000);
    }
  }, [snippet]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="embed-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        className="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-lg w-full space-y-5 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2
            id="embed-modal-title"
            className="text-lg font-semibold text-white flex items-center gap-2"
          >
            <span aria-hidden="true">📎</span>
            Embed Stream Widget
          </h2>
          <button
            onClick={onClose}
            aria-label="Close embed widget modal"
            className="text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded p-1"
          >
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
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-400">
          Paste this snippet into any webpage to display a live stream status widget.
        </p>

        {/* Options */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="embed-theme" className="text-xs font-medium text-gray-300 block mb-1.5">
              Theme
            </label>
            <select
              id="embed-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div>
            <label htmlFor="embed-show" className="text-xs font-medium text-gray-300 block mb-1.5">
              Show
            </label>
            <select
              id="embed-show"
              value={show}
              onChange={(e) => setShow(e.target.value as ShowMode)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
            >
              <option value="both">Claimable + Progress</option>
              <option value="claimable">Claimable balance only</option>
              <option value="progress">Progress bar only</option>
            </select>
          </div>
        </div>

        {/* Snippet preview */}
        <div>
          <label htmlFor="embed-snippet" className="text-xs font-medium text-gray-300 block mb-1.5">
            Snippet
          </label>
          <textarea
            id="embed-snippet"
            readOnly
            value={snippet}
            rows={6}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-green-300 font-mono text-xs resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            aria-label="iframe embed code snippet"
          />
        </div>

        {/* Live preview link */}
        <a
          href={embedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          Preview widget ↗
        </a>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800 ${
            copied
              ? "bg-green-800 text-green-300 focus-visible:ring-green-600"
              : "bg-green-700 hover:bg-green-600 text-white focus-visible:ring-green-500"
          }`}
        >
          {copied ? "✓ Copied to clipboard!" : copyFailed ? "Copy failed — select the snippet and copy manually" : "Copy Snippet"}
        </button>
      </div>
    </div>
  );
}
