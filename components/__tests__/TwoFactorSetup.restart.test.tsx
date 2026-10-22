/**
 * Abandoning and restarting 2FA setup.
 *
 * Behavior asserted here (documented in TwoFactorSetup.tsx):
 * - One setup attempt keeps one secret. Going Back from verify to the scan
 *   step shows the same secret, so a code the user already scanned stays
 *   valid.
 * - Restarting after abandoning (Cancel, or navigating away mid-setup)
 *   generates a fresh secret. The abandoned one is never stored, so it can't
 *   be resumed, and the scan step warns that the authenticator entry from
 *   the earlier attempt is stale.
 * - Completing setup clears that warning for future runs.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import TwoFactorSetup, { ABANDONED_SETUP_KEY } from '@/components/TwoFactorSetup';
import { generateSecret } from '@/src/lib/totp';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn((_uri: string, cb: (err: null, url: string) => void) =>
      cb(null, 'data:image/png;base64,MOCK_QR'),
    ),
  },
}));

let secretCounter = 0;
vi.mock('@/src/lib/totp', () => ({
  generateSecret: vi.fn(() => `SECRET${++secretCounter}`),
  generateTOTPURI: vi.fn((s: string, a: string) => `otpauth://totp/SoroStream:${a}?secret=${s}`),
  generateRecoveryCodes: vi.fn(() => ['AABB1122', 'CCDD3344']),
  validateTOTP: vi.fn((_s: string, code: string) => /^\d{6}$/.test(code)),
  hashSecret: vi.fn(async () => 'hashed'),
  isValidRecoveryCode: vi.fn(() => true),
  formatRecoveryCode: vi.fn((c: string) => c),
}));

const STALE_WARNING = /delete\s+that SoroStream entry/;

function renderSetup() {
  const onCancel = vi.fn();
  const onComplete = vi.fn();
  const utils = render(
    <TwoFactorSetup accountName="alice" onCancel={onCancel} onComplete={onComplete} />,
  );
  return { ...utils, onCancel, onComplete };
}

const shownSecret = () => screen.getByText(/^SECRET\d+$/).textContent;

describe('TwoFactorSetup abandon and restart', () => {
  beforeEach(() => {
    secretCounter = 0;
    vi.mocked(generateSecret).mockClear();
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('restarting after cancelling generates a new secret and warns the old entry is stale', () => {
    const first = renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    expect(shownSecret()).toBe('SECRET1');
    expect(screen.queryByText(STALE_WARNING)).not.toBeInTheDocument();

    // Abandon: Cancel unmounts the setup, as the settings page does.
    fireEvent.click(screen.getByText('Cancel'));
    expect(first.onCancel).toHaveBeenCalled();
    first.unmount();
    expect(localStorage.getItem(ABANDONED_SETUP_KEY)).toBe('1');

    renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    expect(shownSecret()).toBe('SECRET2');
    expect(generateSecret).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent(STALE_WARNING);
  });

  it('navigating away mid-setup counts as abandoning', () => {
    const { unmount } = renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    fireEvent.click(screen.getByText(/Scanned the QR Code/));
    unmount(); // e.g. route change while on the verify step

    renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    expect(shownSecret()).toBe('SECRET2');
    expect(screen.getByText(STALE_WARNING)).toBeInTheDocument();
  });

  it('leaving before any secret was shown does not warn', () => {
    const { unmount } = renderSetup();
    fireEvent.click(screen.getByText('Cancel')); // still on the intro step
    unmount();
    expect(localStorage.getItem(ABANDONED_SETUP_KEY)).toBeNull();

    renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    expect(screen.queryByText(STALE_WARNING)).not.toBeInTheDocument();
  });

  it('within one attempt, going back from verify keeps the same secret', () => {
    renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    expect(shownSecret()).toBe('SECRET1');

    fireEvent.click(screen.getByText(/Scanned the QR Code/));
    fireEvent.click(screen.getByText('Back'));

    expect(shownSecret()).toBe('SECRET1');
    expect(generateSecret).toHaveBeenCalledTimes(1);
  });

  it('completing setup clears the stale-entry warning', async () => {
    vi.useFakeTimers();
    localStorage.setItem(ABANDONED_SETUP_KEY, '1');
    const { unmount } = renderSetup();
    fireEvent.click(screen.getByText('Get Started'));
    expect(screen.getByText(STALE_WARNING)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Scanned the QR Code/));
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify Code'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.click(screen.getByText(/Saved My Codes/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('2FA Enabled')).toBeInTheDocument();
    unmount();

    expect(localStorage.getItem(ABANDONED_SETUP_KEY)).toBeNull();
  });
});
