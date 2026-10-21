import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitProvider, useRateLimit, type RateLimitContextValue } from './RateLimitContext';
import { rpcFetch } from '@/src/lib/rpcClient';

const rateLimitError = () => new Error('HTTP 429 Too Many Requests');

/**
 * Renders a consumer that records every context value it observes, so tests can
 * assert on the sequence of updates (including transient ones) as well as the
 * final DOM state.
 */
function renderProvider() {
  const observed: RateLimitContextValue[] = [];

  function RecordingConsumer() {
    const state = useRateLimit();
    observed.push(state);
    return (
      <div>
        <span data-testid="active">{String(state.active)}</span>
        <span data-testid="secondsLeft">{String(state.secondsLeft)}</span>
        <span data-testid="attempt">{String(state.attempt)}</span>
      </div>
    );
  }

  const view = render(
    <RateLimitProvider>
      <RecordingConsumer />
    </RateLimitProvider>,
  );

  return { observed, ...view };
}

describe('RateLimitContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts inactive with a zero attempt index', () => {
    renderProvider();

    expect(screen.getByTestId('active').textContent).toBe('false');
    expect(screen.getByTestId('secondsLeft').textContent).toBe('0');
    expect(screen.getByTestId('attempt').textContent).toBe('0');
  });

  it('counts down per second before reaching zero', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');

    renderProvider();

    let pending!: Promise<string>;
    await act(async () => {
      pending = rpcFetch(fn);
      // Let the rejected call settle so the 429 is detected and emitted.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('active').textContent).toBe('true');
    expect(screen.getByTestId('secondsLeft').textContent).toBe('2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByTestId('secondsLeft').textContent).toBe('1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await pending;
    });
  });

  it('flips active to false in the same update that secondsLeft reaches zero', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');

    const { observed } = renderProvider();

    let pending!: Promise<string>;
    await act(async () => {
      pending = rpcFetch(fn);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await pending;
    });

    const flashing = observed.filter((r) => r.active === true && r.secondsLeft === 0);
    expect(flashing).toHaveLength(0);

    const last = observed[observed.length - 1];
    expect(last.active).toBe(false);
    expect(last.secondsLeft).toBe(0);
  });

  it('increments the attempt index across consecutive retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');

    const { observed } = renderProvider();

    let pending!: Promise<string>;
    await act(async () => {
      pending = rpcFetch(fn);
      await vi.advanceTimersByTimeAsync(0);
    });

    // First retry (2 s backoff) is attempt 0.
    expect(screen.getByTestId('attempt').textContent).toBe('0');
    expect(screen.getByTestId('active').textContent).toBe('true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      // Flush the 429 from the second attempt.
      await vi.advanceTimersByTimeAsync(0);
    });

    // Second retry is attempt 1 while the first backoff has completed.
    expect(screen.getByTestId('attempt').textContent).toBe('1');
    expect(screen.getByTestId('active').textContent).toBe('true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      await pending;
    });

    expect(fn).toHaveBeenCalledTimes(3);

    const attemptSequence = [
      ...new Set(observed.filter((r) => r.active).map((r) => r.attempt)),
    ];
    expect(attemptSequence).toEqual([0, 1]);
  });

  it('exposes the active attempt index to consumers outside the banner', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');

    renderProvider();

    let pending!: Promise<string>;
    await act(async () => {
      pending = rpcFetch(fn);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    // Consumers can correlate the countdown with the retry attempt in progress.
    expect(screen.getByTestId('active').textContent).toBe('true');
    expect(screen.getByTestId('attempt').textContent).toBe('1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      await pending;
    });
  });
});
