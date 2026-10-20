"use client";

import { useEffect, useCallback, type RefObject } from "react";

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  description: string;
  action: () => void;
  /** If true, prevent default browser behavior. Defaults to true. */
  preventDefault?: boolean;
  /** Only trigger when a specific element is focused (e.g. search input). */
  targetRef?: RefObject<HTMLElement | null>;
  /** If set, only trigger when no input/textarea/select/contentEditable region is focused (unless targetRef is set). */
  ignoreWhenEditing?: boolean;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

/**
 * True when `element` is (or lives inside) an editing context, i.e. the
 * shortcut should be suppressed while the user is typing.
 *
 * Covers form controls (input/textarea/select) and contentEditable regions,
 * walking up the ancestors so a caret parked in a nested node of a rich-text
 * field is still detected (#696).
 */
function isEditingContext(element: Element | null): boolean {
  let node: Element | null = element;

  while (node) {
    if (node instanceof HTMLElement) {
      // True when the node itself or an ancestor hosts an editing host.
      if (node.isContentEditable) return true;
      // Fallback for environments where `isContentEditable` is not computed
      // (and for an explicit attribute on the node itself).
      const attr = node.getAttribute("contenteditable");
      if (attr !== null) {
        const value = attr.trim().toLowerCase();
        if (value === "" || value === "true" || value === "plaintext-only") return true;
      }
    }
    node = node.parentElement;
  }

  return false;
}

/**
 * Register document-level keyboard shortcuts for the lifetime of the component.
 *
 * @param {ShortcutGroup[]} groups - Grouped shortcut definitions; each shortcut's handler runs when its key combo is pressed.
 * @returns {void}
 */
export function useKeyboardShortcuts(groups: ShortcutGroup[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const group of groups) {
        for (const shortcut of group.shortcuts) {
          const ctrlOrMeta = e.ctrlKey || e.metaKey;
          if (
            e.key === shortcut.key &&
            !!shortcut.ctrl === ctrlOrMeta &&
            !!shortcut.alt === e.altKey &&
            !!shortcut.shift === e.shiftKey
          ) {
            if (shortcut.targetRef) {
              if (document.activeElement !== shortcut.targetRef.current) continue;
            } else if (shortcut.ignoreWhenEditing !== false) {
              const active = document.activeElement;
              const tag = active?.tagName ?? "";
              if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") continue;
              // contentEditable regions behave like text inputs for our
              // purposes: suppress the shortcut while the caret is inside (#696).
              if (isEditingContext(active)) continue;
            }
            e.preventDefault();
            shortcut.action();
            return;
          }
        }
      }
    },
    [groups],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
