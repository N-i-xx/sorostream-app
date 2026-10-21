"use client";
/**
 * errorPersist — persists the last fatal load error for a stream detail
 * view to sessionStorage, keyed by stream id (#618).
 *
 * Without this, navigating away from an errored stream page (e.g. via
 * the browser back/forward buttons, or a Link elsewhere in the app) and
 * back drops the error state entirely on unmount, so the user briefly
 * sees a bare loading skeleton with no indication anything went wrong
 * until the retry fetch settles again. Persisting the message means the
 * same error is shown immediately on remount and is cleared as soon as
 * the retry succeeds.
 *
 * Mirrors the pure-function + hook pattern used by useFormPersist.ts for
 * the create-stream draft.
 */

const STORAGE_PREFIX = "sorostream_stream_error_";
/** Keep only the most recently used stream errors for this browser session. */
export const MAX_PERSISTED_STREAM_ERRORS = 50;

function keyFor(streamId: string): string {
  return `${STORAGE_PREFIX}${streamId}`;
}

function trimOldestErrors(): void {
  const storage = window.sessionStorage;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  while (keys.length > MAX_PERSISTED_STREAM_ERRORS) {
    storage.removeItem(keys.shift()!);
  }
}

function touchError(key: string, message: string): void {
  const storage = window.sessionStorage;
  storage.removeItem(key);
  storage.setItem(key, message);
  trimOldestErrors();
}

/** Read the persisted error message for `streamId`, or null if none / unavailable. */
export function readPersistedStreamError(streamId: string): string | null {
  if (typeof window === "undefined" || !streamId) return null;
  try {
    const key = keyFor(streamId);
    const message = window.sessionStorage.getItem(key);
    if (message !== null) touchError(key, message);
    return message;
  } catch {
    return null;
  }
}

/** Persist `message` as the last known error for `streamId`. */
export function writePersistedStreamError(streamId: string, message: string): void {
  if (typeof window === "undefined" || !streamId) return;
  try {
    touchError(keyFor(streamId), message);
  } catch {
    // sessionStorage may be unavailable (private mode quota, security policy)
  }
}

/** Clear the persisted error for `streamId` (call on a successful load). */
export function clearPersistedStreamError(streamId: string): void {
  if (typeof window === "undefined" || !streamId) return;
  try {
    window.sessionStorage.removeItem(keyFor(streamId));
  } catch {
    // ignore
  }
}

/**
 * Clear the persisted error for `streamId` as soon as `load` resolves with
 * a successful result, whether or not the component that started the load
 * is still mounted (#714).
 *
 * The stream page ignores a fetch result once its effect has been cleaned
 * up, so a clear done there is skipped if the user navigates away before
 * the retry settles. Attaching the clear to the fetch promise itself means
 * a later return to the stream does not show an error that already
 * resolved. Failures are left alone: the caller decides whether to persist
 * them, and a stale failure must never overwrite a newer result.
 *
 * Returns `load` unchanged so callers can keep awaiting or racing it.
 */
export function clearPersistedStreamErrorOnSuccess<T>(
  streamId: string,
  load: Promise<T>,
  isSuccess: (result: T) => boolean = () => true,
): Promise<T> {
  load.then(
    (result) => {
      if (isSuccess(result)) clearPersistedStreamError(streamId);
    },
    () => {
      // Failure handling stays with the caller.
    },
  );
  return load;
}
