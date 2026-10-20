import { renderHook } from '@testing-library/react';
import { useFocusTrap, getFocusableElements } from '../useFocusTrap';

describe('useFocusTrap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function setupTrap(active = true) {
    const ref = { current: container as HTMLDivElement | null };
    renderHook(() => useFocusTrap(ref, active));
    return ref;
  }

  function pressKey(key: string, shiftKey = false) {
    const event = new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
    return event;
  }

  it('keeps focus on the single focusable element when pressing Tab', () => {
    const button = document.createElement('button');
    button.textContent = 'Only';
    container.appendChild(button);
    button.focus();

    setupTrap();

    pressKey('Tab');

    expect(document.activeElement).toBe(button);
  });

  it('keeps focus on the single focusable element when pressing Shift+Tab', () => {
    const button = document.createElement('button');
    button.textContent = 'Only';
    container.appendChild(button);
    button.focus();

    setupTrap();

    pressKey('Tab', true);

    expect(document.activeElement).toBe(button);
  });
});

describe('getFocusableElements', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('still returns every visible focusable element', () => {
    container.innerHTML = `
      <a href="#section" id="link">Link</a>
      <input id="visible-input" />
      <button id="visible-button">Go</button>
    `;

    expect(getFocusableElements(container).map((el) => el.id)).toEqual([
      'link',
      'visible-input',
      'visible-button',
    ]);
  });

  it('skips inputs inside a collapsed section hidden with display:none', () => {
    container.innerHTML = `
      <button id="first">First</button>
      <section style="display: none">
        <input id="hidden-input" />
        <button id="hidden-button">Hidden</button>
      </section>
      <button id="last">Last</button>
    `;

    expect(getFocusableElements(container).map((el) => el.id)).toEqual([
      'first',
      'last',
    ]);
  });

  it('skips elements hidden via visibility:hidden', () => {
    container.innerHTML = `
      <button id="first">First</button>
      <input id="hidden-input" style="visibility: hidden" />
      <button id="last">Last</button>
    `;

    expect(getFocusableElements(container).map((el) => el.id)).toEqual([
      'first',
      'last',
    ]);
  });

  it('does not let the trap cycle onto inputs in a collapsed section', () => {
    // The collapsed input comes last in DOM order, so if the trap treated it as
    // the last stop, Tab from #last would not wrap and Shift+Tab from #first
    // would move focus into the invisible input.
    container.innerHTML = `
      <button id="first">First</button>
      <button id="last">Last</button>
      <div class="collapsed-section" style="display: none">
        <input id="hidden-input" />
      </div>
    `;
    const first = container.querySelector<HTMLButtonElement>('#first')!;
    const last = container.querySelector<HTMLButtonElement>('#last')!;

    const ref = { current: container as HTMLDivElement | null };
    renderHook(() => useFocusTrap(ref, true));

    const tab = (shiftKey: boolean) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(event);
      return event;
    };

    last.focus();
    expect(tab(false).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });
});
