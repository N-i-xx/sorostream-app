/**
 * WalletBalanceDisplay with assets it does and doesn't know about. A balance
 * in an unsupported asset must show under its own code with its raw balance
 * and issuer, never be dropped or labelled as XLM or as a supported token
 * that happens to share its code.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WalletBalanceDisplay from '../WalletBalanceDisplay';

vi.mock('@/src/context/SettingsContext', () => ({ useSettings: () => ({ language: 'en-US' }) }));
vi.mock('@/src/lib/i18n', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/src/lib/freighter', () => ({ APP_NETWORK: 'testnet' }));

const ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const AQUA_ISSUER = 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA';
const OTHER_ISSUER = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

function horizonReturns(balances: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ balances }) }) as Response),
  );
}

async function openDropdown() {
  const button = screen.getByRole('button', { name: 'wallet_balance' });
  await waitFor(() => expect(button).toHaveTextContent(/XLM/));
  fireEvent.click(button);
  return button;
}

describe('WalletBalanceDisplay assets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the expected assets as before: XLM as the primary balance, supported tokens in the list', async () => {
    horizonReturns([
      { asset_type: 'native', balance: '1234.5000000' },
      { asset_type: 'credit_alphanum4', asset_code: 'AQUA', asset_issuer: AQUA_ISSUER, balance: '50.0000000' },
    ]);
    render(<WalletBalanceDisplay address={ADDRESS} />);

    const button = await openDropdown();
    expect(button).toHaveTextContent('1,234.50 XLM');
    expect(button).toHaveTextContent('+1');
    expect(screen.getByText('AQUA')).toBeInTheDocument();
    expect(screen.getByText('50.00')).toBeInTheDocument();
    expect(screen.queryByTestId('unrecognized-balance')).not.toBeInTheDocument();
  });

  it('shows an unsupported asset under its own code with the raw balance and issuer', async () => {
    horizonReturns([
      { asset_type: 'native', balance: '10.0000000' },
      { asset_type: 'credit_alphanum12', asset_code: 'SOROTOKEN', asset_issuer: OTHER_ISSUER, balance: '0.1234567' },
    ]);
    render(<WalletBalanceDisplay address={ADDRESS} />);

    const button = await openDropdown();
    // The primary balance is still the native XLM one, not the odd asset.
    expect(button).toHaveTextContent('10.00 XLM');
    expect(button).not.toHaveTextContent('SOROTOKEN');

    const row = screen.getByTestId('unrecognized-balance');
    expect(row).toHaveTextContent('SOROTOKEN');
    expect(row).toHaveTextContent('0.1234567 SOROTOKEN'); // raw, not rounded
    expect(row).toHaveTextContent('(GDUK…YLEX)');
    expect(within(row).queryByText(/XLM/)).not.toBeInTheDocument();
  });

  it('does not label a same-code asset from another issuer as the supported token', async () => {
    horizonReturns([
      { asset_type: 'native', balance: '10.0000000' },
      { asset_type: 'credit_alphanum4', asset_code: 'AQUA', asset_issuer: OTHER_ISSUER, balance: '999.0000000' },
    ]);
    render(<WalletBalanceDisplay address={ADDRESS} />);
    await openDropdown();

    const row = screen.getByTestId('unrecognized-balance');
    expect(row).toHaveTextContent('AQUA');
    expect(row).toHaveTextContent('(GDUK…YLEX)');
    expect(row.querySelector('[title]')).toHaveAttribute('title', `Issuer ${OTHER_ISSUER}`);
  });

  it('shows a wallet holding only XLM without any extra rows', async () => {
    horizonReturns([{ asset_type: 'native', balance: '5.0000000' }]);
    render(<WalletBalanceDisplay address={ADDRESS} />);
    const button = await openDropdown();
    expect(button).toHaveTextContent('5.00 XLM');
    expect(button).not.toHaveTextContent('+');
    expect(screen.queryByTestId('unrecognized-balance')).not.toBeInTheDocument();
  });
});
