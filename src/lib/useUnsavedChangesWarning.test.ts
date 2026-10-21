import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  UNSAVED_CHANGES_MESSAGE,
  useUnsavedChangesWarning,
} from './useUnsavedChangesWarning';

describe('useUnsavedChangesWarning', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;
  let confirmSpy: MockInstance<typeof window.confirm>;
  let forwardSpy: MockInstance<typeof window.history.forward>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    addSpy = vi.spyOn(window, 'addEventListener');
    removeSpy = vi.spyOn(window, 'removeEventListener');
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  const getBeforeUnloadHandler = () => {
    const call = addSpy.mock.calls.find(([event]) => event === 'beforeunload');
    return call?.[1] as ((event: BeforeUnloadEvent) => void) | undefined;
  };

  const createBeforeUnloadEvent = () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', {
      writable: true,
      value: undefined,
    });
    return event;
  };

  /** Simulate the browser moving to another URL and firing popstate. */
  const simulateBackNavigation = (to = '/streams') => {
    window.history.replaceState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  it('does not warn after a successful save flips isDirty to false', () => {
    const { rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useUnsavedChangesWarning(isDirty),
      { initialProps: { isDirty: true } },
    );

    // Dirty state registers a beforeunload listener.
    expect(getBeforeUnloadHandler()).toBeTypeOf('function');

    // Simulate a successful save.
    rerender({ isDirty: false });

    // The listener should have been removed on cleanup.
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    // Triggering a navigation/unload event should not prompt.
    const event = createBeforeUnloadEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(event.returnValue).toBeUndefined();
  });

  it('warns when navigation happens while isDirty remains true', () => {
    renderHook(() => useUnsavedChangesWarning(true));

    const handler = getBeforeUnloadHandler();
    expect(handler).toBeTypeOf('function');

    const event = createBeforeUnloadEvent();
    handler?.(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe(UNSAVED_CHANGES_MESSAGE);
  });

  it('warns on simulated back navigation and restores the page when declined', () => {
    renderHook(() => useUnsavedChangesWarning(true));

    simulateBackNavigation();

    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(forwardSpy).toHaveBeenCalledTimes(1);

    // The popstate caused by moving forward again must not prompt a second time.
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('does not restore the page when the user accepts the back navigation', () => {
    confirmSpy.mockReturnValue(true);
    renderHook(() => useUnsavedChangesWarning(true));

    simulateBackNavigation();

    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(forwardSpy).not.toHaveBeenCalled();
  });

  it('does not warn when popstate returns to the guarded page', () => {
    renderHook(() => useUnsavedChangesWarning(true));

    // Forward navigation back onto the same URL as the dirty form.
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(forwardSpy).not.toHaveBeenCalled();
  });

  it('does not warn on popstate when isDirty is false', () => {
    renderHook(() => useUnsavedChangesWarning(false));

    simulateBackNavigation();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(forwardSpy).not.toHaveBeenCalled();
  });
});
