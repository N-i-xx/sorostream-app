import { render, screen, fireEvent, act } from '@testing-library/react';
import EmbedWidgetModal from '../EmbedWidgetModal';

const copyToClipboard = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/clipboard', () => ({ copyToClipboard }));

const COPY = 'Copy Snippet';
const COPIED = '✓ Copied to clipboard!';
const FAILED = /Copy failed/;

/** Renders the modal and flushes the focus trap's initial animation frame so timer counts are exact. */
function renderModal() {
  const view = render(<EmbedWidgetModal streamId="42" onClose={vi.fn()} />);
  act(() => {
    vi.advanceTimersByTime(50);
  });
  return view;
}

async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: COPY }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  copyToClipboard.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('EmbedWidgetModal copy feedback (#920)', () => {
  it('shows the copied state and resets it after 2.5 seconds', async () => {
    copyToClipboard.mockResolvedValue(true);
    renderModal();

    await clickCopy();
    expect(screen.getByRole('button', { name: COPIED })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByRole('button', { name: COPY })).toBeInTheDocument();
  });

  it('shows the failure state and resets it after 4 seconds', async () => {
    copyToClipboard.mockResolvedValue(false);
    renderModal();

    await clickCopy();
    expect(screen.getByRole('button', { name: FAILED })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByRole('button', { name: FAILED })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: COPY })).toBeInTheDocument();
  });

  it('clears the pending reset timer when the modal unmounts', async () => {
    copyToClipboard.mockResolvedValue(true);
    const { unmount } = renderModal();

    await clickCopy();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not touch state if the modal closes while the copy is still pending', async () => {
    let finish!: (ok: boolean) => void;
    copyToClipboard.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: COPY }));
    unmount();
    await act(async () => {
      finish(true);
    });

    // No timer is scheduled for an unmounted modal, and nothing was logged.
    expect(vi.getTimerCount()).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('restarts the reset window on a repeated copy instead of stacking timers', async () => {
    copyToClipboard.mockResolvedValue(true);
    renderModal();

    await clickCopy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: COPIED }));
    });

    // Only one timer is pending, and it was restarted by the second click.
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: COPIED })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('button', { name: COPY })).toBeInTheDocument();
  });
});
