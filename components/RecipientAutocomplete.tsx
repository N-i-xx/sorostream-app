"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getContacts, type AddressBookContact } from "@/src/lib/addressBook";
import { resolveFederationName } from "@/src/lib/federation";

/** Debounce delay in ms for federation/horizon lookups (issue #579). */
const LOOKUP_DEBOUNCE_MS = 300;

interface RecipientAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  placeholder?: string;
  error?: string;
  touched?: boolean;
  /** Connected sender address — scopes the contact list to this sender's book (#432). */
  senderAddress?: string;
}

function truncateAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function RecipientAutocomplete({
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  touched,
  senderAddress,
}: RecipientAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<AddressBookContact[]>([]);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Federation lookup state
  const [federationResolution, setFederationResolution] = useState<{
    status: "idle" | "resolving" | "resolved" | "failed";
    address: string | null;
    error: string | null;
  }>({ status: "idle", address: null, error: null });

  // Refs for debounce timer and AbortController (issue #579)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setContacts(getContacts(senderAddress));
  }, [senderAddress]);

  // Federation lookup effect — debounced 300 ms, in-flight requests cancelled
  // on each new keystroke via AbortController (issue #579).
  useEffect(() => {
    // Cancel any pending debounce timer
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Abort any in-flight lookup from a previous debounce cycle
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Reset federation state if input doesn't contain * (not a federation address)
    if (!value.includes("*")) {
      setFederationResolution({ status: "idle", address: null, error: null });
      return;
    }

    // Show "resolving" immediately so the user sees feedback, then debounce the
    // actual network request by LOOKUP_DEBOUNCE_MS after the last keystroke.
    setFederationResolution({ status: "resolving", address: null, error: null });

    debounceTimerRef.current = setTimeout(() => {
      // Create a fresh AbortController for this lookup attempt
      const controller = new AbortController();
      abortControllerRef.current = controller;

      void (async () => {
        try {
          const resolved = await resolveFederationName(value, {
            signal: controller.signal,
          });

          // If the request was aborted while we were awaiting, discard the result
          if (controller.signal.aborted) return;

          if (resolved) {
            setFederationResolution({ status: "resolved", address: resolved, error: null });
            // Auto-update the field to the resolved G-address
            onChange(resolved);
          } else {
            setFederationResolution({ status: "failed", address: null, error: "Federation address not found" });
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          setFederationResolution({
            status: "failed",
            address: null,
            error: err instanceof Error ? err.message : "Federation lookup failed",
          });
        }
      })();
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      // Cleanup on unmount or before next effect run
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [value, onChange]);

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(value.toLowerCase()) ||
      c.address.toLowerCase().includes(value.toLowerCase()),
  );
  const showDropdown = open && filtered.length > 0;
  const selectedContact = contacts.find((c) => c.address === value);

  const select = useCallback(
    (contact: AddressBookContact) => {
      onChange(contact.address);
      setOpen(false);
      setHighlightedIdx(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  useEffect(() => {
    setHighlightedIdx(-1);
  }, [value]);

  useEffect(() => {
    if (!showDropdown) setHighlightedIdx(-1);
  }, [showDropdown]);

  // Close the dropdown on outside clicks. Safari does not fire `blur` when the
  // user clicks a non-focusable element, so relying on the input's `onBlur`
  // alone leaves the dropdown open forever (#545). A `mousedown` listener on
  // `document` runs before focus moves in every browser.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      setOpen(false);
      setHighlightedIdx(-1);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIdx((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIdx((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIdx >= 0 && highlightedIdx < filtered.length) {
          select(filtered[highlightedIdx]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setHighlightedIdx(-1);
        break;
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative" ref={containerRef}>
        <input
          ref={inputRef}
          id="recipient"
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 200);
            onBlur();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-4 pr-10 py-3 text-white font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          aria-required="true"
          aria-invalid={!!error}
          aria-describedby={
            error ? "recipient-error" : federationResolution.status !== "idle" ? "federation-status" : undefined
          }
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="recipient-listbox"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="recipient-input"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle address book contacts"
          data-testid="address-book-toggle"
          onClick={() => setOpen((prev) => !prev)}
          className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors ${open ? "text-green-400" : "text-gray-400 hover:text-white"}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </button>
        {open && contacts.length === 0 && (
          <div
            data-testid="address-book-empty-state"
            className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-xl px-4 py-6 text-center text-sm text-gray-400"
          >
            No saved contacts. Add an address book entry to enable quick-fill.
          </div>
        )}
        {showDropdown && (
          <ul
            id="recipient-listbox"
            ref={listRef}
            role="listbox"
            data-testid="address-book-dropdown"
            className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto"
          >
            {filtered.map((contact, idx) => (
              <li
                key={contact.id}
                role="option"
                data-testid={`contact-option-${contact.name}`}
                aria-selected={highlightedIdx === idx}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  highlightedIdx === idx ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-700/60"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(contact);
                }}
                onMouseEnter={() => setHighlightedIdx(idx)}
              >
                <span className="flex-1 truncate font-medium text-white">{contact.name}</span>
                <span className="text-gray-400 font-mono text-xs shrink-0">{truncateAddress(contact.address)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedContact && (
        <div data-testid="selected-contact-alias" className="flex items-center gap-2 text-sm text-gray-400">
          <span className="text-green-400">Alias:</span>
          <span className="font-medium text-white">{selectedContact.name}</span>
          <span className="text-xs text-gray-500 font-mono">{truncateAddress(selectedContact.address)}</span>
        </div>
      )}
      {/* Federation lookup status and resolved address display */}
      {federationResolution.status !== "idle" && (
        <div id="federation-status" className="flex items-start gap-2 text-sm">
          {federationResolution.status === "resolving" && (
            <div className="flex items-center gap-2 text-gray-400">
              <div className="w-4 h-4 rounded-full border-2 border-gray-600 border-t-green-500 animate-spin" />
              <span>Resolving federation address…</span>
            </div>
          )}
          {federationResolution.status === "resolved" && federationResolution.address && (
            <div className="flex items-start gap-2 w-full p-2 bg-green-900/20 border border-green-700/30 rounded text-green-300">
              <span className="text-lg">✓</span>
              <div>
                <p className="font-medium">Federation resolved</p>
                <p className="text-xs text-green-200/70 break-all font-mono">{federationResolution.address}</p>
              </div>
            </div>
          )}
          {federationResolution.status === "failed" && (
            <div className="flex items-start gap-2 w-full p-2 bg-red-900/20 border border-red-700/30 rounded text-red-300">
              <span className="text-lg">✕</span>
              <div>
                <p className="font-medium">Resolution failed</p>
                <p className="text-xs text-red-200/70">{federationResolution.error}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
