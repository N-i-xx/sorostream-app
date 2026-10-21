import { renderHook } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  let container: HTMLDivElement;
  let ref: { current: HTMLDivElement | null };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    ref = { current: container };
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  const pressKey = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
    return event;
  };

  it('keeps focus on the single focusable element when pressing Tab', () => {
    const button = document.createElement('button');
    button.textContent = 'Only';
    container.appendChild(button);

    renderHook(() => useFocusTrap(ref, true));

    button.focus();
    expect(document.activeElement).toBe(button);

    pressKey('Tab');

    expect(document.activeElement).toBe(button);
  });

  it('keeps focus on the single focusable element when pressing Shift+Tab', () => {
    const button = document.createElement('button');
    button.textContent = 'Only';
    container.appendChild(button);

    renderHook(() => useFocusTrap(ref, true));

    button.focus();
    expect(document.activeElement).toBe(button);

    pressKey('Tab', true);

    expect(document.activeElement).toBe(button);
  });
});
