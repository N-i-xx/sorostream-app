"use client";

import { useEffect, useRef, type RefObject } from "react";
import { pushModal, removeModal, isTopModal } from "./modalStack";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether the current DOM implementation reports real layout boxes.
 *
 * Browsers lay elements out, so a rendered element has a non-empty client
 * rect. jsdom (used by our tests) has no layout engine and reports an empty
 * rect for *every* element, so trusting rects there would hide every
 * focusable element. The capability is probed once via the root element.
 */
let layoutSupport: boolean | null = null;
function hasLayoutSupport(): boolean {
  if (typeof document === "undefined") return false;
  if (layoutSupport === null) {
    const rootRect = document.documentElement.getBoundingClientRect();
    layoutSupport = rootRect.width > 0 || rootRect.height > 0;
  }
  return layoutSupport;
}

/**
 * Whether `el` is actually rendered, i.e. can receive focus.
 *
 * Elements inside a collapsed section (`display: none` on any ancestor) keep
 * matching `FOCUSABLE_SELECTOR` but have no layout box, so focusing them would
 * move focus to something invisible.
 */
function isRendered(el: HTMLElement, layoutIsSupported: boolean): boolean {
  // `visibility` inherits but can be re-enabled by a descendant, so only the
  // element's own computed value matters.
  const { visibility } = window.getComputedStyle(el);
  if (visibility === "hidden" || visibility === "collapse") return false;

  // `display: none` on the element or any ancestor removes its layout box.
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === "none") return false;
  }

  // Belt-and-braces for browsers: no layout box means no focus.
  if (layoutIsSupported && el.getClientRects().length === 0) return false;

  return true;
}

/** All focusable elements inside `container` that are actually rendered. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const layoutIsSupported = hasLayoutSupport();
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => isRendered(el, layoutIsSupported));
}

/**
 * Traps keyboard focus inside `containerRef` while `active` is true.
 *
 * - On activation, the previously focused element is saved and focus moves to
 *   the first focusable element inside the container (or the container itself
 *   if none exist).
 * - Tab / Shift+Tab cycle within the container.
 * - On deactivation, focus returns to the element that was focused before the
 *   trap activated.
 * - The trap registers on the global modal stack (#647): opening a new modal
 *   closes any other open modal via its `onClose`, and only the topmost
 *   modal traps Tab.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  active: boolean,
  onClose?: () => void,
): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Register with the modal stack while active.
  useEffect(() => {
    if (!active) return;
    const id = pushModal(onCloseRef.current ? () => onCloseRef.current?.() : undefined);
    modalIdRef.current = id;
    return () => {
      removeModal(id);
      modalIdRef.current = null;
    };
  }, [active]);

  // Save the currently focused element when the trap activates.
  useEffect(() => {
    if (active) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    }
  }, [active]);

  // Focus the first element inside the container on activation.
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const raf = requestAnimationFrame(() => {
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        if (!container.hasAttribute("tabindex")) {
          container.setAttribute("tabindex", "-1");
        }
        container.focus();
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [active, containerRef]);

  // Intercept Tab / Shift+Tab to cycle within the container.
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (modalIdRef.current !== null && !isTopModal(modalIdRef.current)) return;

      const focusable = getFocusableElements(container!);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container!.addEventListener("keydown", handleKeyDown);
    return () => container!.removeEventListener("keydown", handleKeyDown);
  }, [active, containerRef]);

  // Restore focus when the trap deactivates or the component unmounts.
  // The cleanup captures values from the render where the effect was created.
  // When active transitions true→false, cleanup runs with active=true and the
  // saved previousFocusRef, correctly restoring focus.
  useEffect(() => {
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [active]);
}
