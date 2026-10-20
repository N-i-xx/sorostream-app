import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  it('keeps focus on the single focusable element when pressing Tab', async () => {
    const user = userEvent.setup();

    function Trap() {
      const containerRef = useRef<HTMLDivElement>(null);
      useFocusTrap(containerRef, true);
      return (
        <div ref={containerRef}>
          <button type="button">Only</button>
        </div>
      );
    }

    render(<Trap />);

    const only = screen.getByRole('button', { name: 'Only' });
    only.focus();
    expect(only).toHaveFocus();

    await user.tab();
    expect(only).toHaveFocus();
  });

  it('keeps focus on the single focusable element when pressing Shift+Tab', async () => {
    const user = userEvent.setup();

    function Trap() {
      const containerRef = useRef<HTMLDivElement>(null);
      useFocusTrap(containerRef, true);
      return (
        <div ref={containerRef}>
          <button type="button">Only</button>
        </div>
      );
    }

    render(<Trap />);

    const only = screen.getByRole('button', { name: 'Only' });
    only.focus();
    expect(only).toHaveFocus();

    await user.tab({ shift: true });
    expect(only).toHaveFocus();
  });
});
