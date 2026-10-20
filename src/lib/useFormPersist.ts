"use client";

import { useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All fields the create-stream wizard persists to sessionStorage. */
export interface CreateStreamDraft {
  recipient: string;
  amount: string;
  duration: number;
  selectedToken: string;
  customTokenAddress: string;
  endDate: string;
  cliffDate: string;
}

/** The key under which the draft is stored in sessionStorage. */
export const FORM_DRAFT_KEY = "sorostream_create_stream_draft";

/**
 * Schema version of the persisted draft.
 *
 * Bump this whenever the shape of `CreateStreamDraft` changes (a field is
 * renamed, removed, or changes type). Drafts written under any other version
 * are discarded on read instead of being partially applied to the form.
 */
export const FORM_DRAFT_SCHEMA_VERSION = 1;

/** The envelope written to sessionStorage, carrying the schema version. */
interface PersistedDraft {
  version: number;
  draft: CreateStreamDraft;
}

// ---------------------------------------------------------------------------
// Low-level helpers (pure functions — easy to unit-test independently)
// ---------------------------------------------------------------------------

/**
 * Read and parse a draft from sessionStorage.
 * Returns `null` on any error (missing key, malformed JSON, wrong shape) and
 * discards any draft whose schema version does not match the current one, so
 * a draft saved by a different app version can never populate the form.
 */
export function readDraft(): CreateStreamDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FORM_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedDraft> | null;
    if (typeof parsed !== "object" || parsed === null) {
      clearDraft();
      return null;
    }
    // Missing (pre-versioning) or mismatched version: drop the draft wholesale
    // rather than applying fields that may no longer mean the same thing.
    if (parsed.version !== FORM_DRAFT_SCHEMA_VERSION) {
      clearDraft();
      return null;
    }
    const draft = parsed.draft as Partial<CreateStreamDraft> | undefined;
    if (typeof draft !== "object" || draft === null) {
      clearDraft();
      return null;
    }
    // Validate that at least the required keys exist with the expected types.
    if (
      typeof draft.recipient !== "string" ||
      typeof draft.amount !== "string" ||
      typeof draft.duration !== "number" ||
      typeof draft.selectedToken !== "string"
    ) {
      clearDraft();
      return null;
    }
    return {
      recipient: draft.recipient,
      amount: draft.amount,
      duration: draft.duration,
      selectedToken: draft.selectedToken,
      customTokenAddress: draft.customTokenAddress ?? "",
      endDate: draft.endDate ?? "",
      cliffDate: draft.cliffDate ?? "",
    };
  } catch {
    return null;
  }
}

/** Persist `draft` to sessionStorage. Silently ignores errors (private/incognito). */
export function writeDraft(draft: CreateStreamDraft): void {
  if (typeof window === "undefined") return;
  try {
    const persisted: PersistedDraft = {
      version: FORM_DRAFT_SCHEMA_VERSION,
      draft,
    };
    window.sessionStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(persisted));
  } catch {
    // sessionStorage may be unavailable (private mode quota, security policy)
  }
}

/** Remove the persisted draft from sessionStorage. */
export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(FORM_DRAFT_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseFormPersistReturn {
  /**
   * Save the current form state to sessionStorage.
   * Call this inside every field's onChange handler.
   */
  saveDraft: (draft: CreateStreamDraft) => void;
  /**
   * Wipe the persisted draft.
   * Call on successful stream creation and on explicit "Reset" actions.
   */
  clearDraft: () => void;
}

/**
 * `useFormPersist` manages create-stream form draft persistence via
 * sessionStorage.
 *
 * Usage pattern:
 *
 * ```tsx
 * const draft = readDraft(); // read once before useState initialisation
 *
 * const [recipient, setRecipient] = useState(draft?.recipient ?? initialRecipient);
 * // … other fields …
 *
 * const { saveDraft, clearDraft } = useFormPersist();
 *
 * // In every onChange:
 * onChange={(v) => {
 *   setRecipient(v);
 *   saveDraft({ recipient: v, amount, duration, … });
 * }}
 *
 * // On successful create:
 * clearDraft();
 * router.push(…);
 * ```
 *
 * The hook debounces writes by 150 ms so rapid keystrokes don't saturate
 * sessionStorage with synchronous calls on every keystroke. Once `clearDraft`
 * is called, any write debounced before the clear is discarded when its timer
 * fires, so a cleared draft can never be resurrected by an in-flight write;
 * saves made after the clear (a fresh editing session) persist as usual.
 */
export function useFormPersist(): UseFormPersistReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  // Cancel any pending debounced write on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const saveDraft = useCallback((draft: CreateStreamDraft) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const generation = generationRef.current;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (generation !== generationRef.current) return;
      writeDraft(draft);
    }, 150);
  }, []);

  const clearDraftCb = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearDraft();
  }, []);

  return { saveDraft, clearDraft: clearDraftCb };
}
