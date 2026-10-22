/**
 * ChangelogModal seen-state. Intended behavior (documented on STORAGE_KEY in
 * ChangelogModal.tsx): seen-state is per release, and opening the modal marks
 * every entry of that release seen, so closing straight away and scrolling
 * through everything first leave the same state behind.
 */
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import ChangelogModal, { useChangelogUnread } from '@/components/ChangelogModal';

vi.mock('@/src/lib/useFocusTrap', () => ({ useFocusTrap: vi.fn() }));

const STORAGE_KEY = 'sorostream-changelog-seen';
const CHANGELOG = {
  version: '3.1.0',
  entries: Array.from({ length: 12 }, (_, i) => ({
    icon: '•',
    title: `Entry ${i + 1}`,
    description: `Change number ${i + 1}`,
  })),
};

/** fetch that resolves only when `release()` is called. */
function deferredFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchMock = vi.fn(async () => {
    await gate;
    return { ok: true, json: async () => CHANGELOG } as Response;
  });
  return { fetchMock, release };
}

async function stillUnread() {
  const { result } = renderHook(() => useChangelogUnread());
  // Let the hook's own fetch settle before reading it.
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  return result.current;
}

describe('ChangelogModal seen-state', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('closing immediately after opening (no scrolling) marks the whole release seen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => CHANGELOG }) as Response),
    );
    const onClose = vi.fn();
    const { rerender } = render(<ChangelogModal open onClose={onClose} />);

    await screen.findByText('Entry 1');
    fireEvent.click(screen.getByText('Got it'));
    expect(onClose).toHaveBeenCalled();
    rerender(<ChangelogModal open={false} onClose={onClose} />);

    // All 12 entries count as seen, including the ones never scrolled to.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('3.1.0');
    expect(await stillUnread()).toBe(false);
  });

  it('closing before the changelog has even loaded still marks it seen once it loads', async () => {
    const { fetchMock, release } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const { rerender } = render(<ChangelogModal open onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close changelog'));
    rerender(<ChangelogModal open={false} onClose={onClose} />);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    release();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('3.1.0'));
  });

  it('scrolling through every entry before closing leaves the same state (the paths do not differ)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => CHANGELOG }) as Response),
    );
    const onClose = vi.fn();
    render(<ChangelogModal open onClose={onClose} />);

    const list = (await screen.findByText('Entry 1')).closest('ul')!;
    fireEvent.scroll(list, { target: { scrollTop: list.scrollHeight } });
    expect(screen.getByText('Entry 12')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('3.1.0');
    expect(await stillUnread()).toBe(false);
  });

  it('a newer release is unread again after an older one was marked seen', async () => {
    localStorage.setItem(STORAGE_KEY, '3.0.0');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => CHANGELOG }) as Response),
    );
    const { result } = renderHook(() => useChangelogUnread());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
