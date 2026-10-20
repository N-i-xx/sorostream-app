"use client";

import { useEffect } from "react";

export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Are you sure you want to leave this page?";

/**
 * Warn the user before they navigate away while `isDirty` is true.
 * Covers tab close / reload / external navigation (beforeunload), in-app link
 * clicks and browser back/forward navigation (popstate, confirmation dialog).
 */
export function useUnsavedChangesWarning(
  isDirty: boolean,
  message: string = UNSAVED_CHANGES_MESSAGE,
): void {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    // URL of the page that owns the dirty form, captured when the guard is
    // installed. Popstate back into this URL is not a leave, so it must not
    // prompt.
    const guardedUrl = window.location.href;
    // Set while we return the user to the guarded page after they decline a
    // popstate warning, so the resulting popstate does not prompt again.
    let restoring = false;

    const handlePopState = () => {
      if (restoring) {
        restoring = false;
        return;
      }

      // Returning to the guarded page (e.g. a forward navigation) is not a leave.
      if (window.location.href === guardedUrl) return;

      if (window.confirm(message)) return;

      // popstate cannot be cancelled, so the navigation has already happened by
      // the time this fires. Move history forward again to re-enter the guarded
      // page — the closest equivalent to the link-click dialog's `preventDefault`.
      // There is guaranteed to be a forward entry because we just came from it.
      restoring = true;
      window.history.forward();
    };

    const handleClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isDirty, message]);
}
