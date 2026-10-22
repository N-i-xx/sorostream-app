/**
 * The QR code in StreamQrModal must name the network the user has selected
 * (src/lib/network.tsx). A SEP-7 URI without `network_passphrase` means the
 * public network to wallets, so a testnet user's code would otherwise point
 * at mainnet.
 */
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import QRCode from 'qrcode';
import StreamQrModal, { buildRecipientQrUri } from '../StreamQrModal';
import { NetworkProvider, useNetwork, type Network } from '@/src/lib/network';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));

const RECIPIENT = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TESTNET = 'Test SDF Network ; September 2015';
const MAINNET = 'Public Global Stellar Network ; September 2015';

/** The URI passed to QRCode.toCanvas the last time the code was drawn. */
function lastEncodedUri(): URL {
  const calls = vi.mocked(QRCode.toCanvas).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return new URL(calls[calls.length - 1][1] as unknown as string);
}

/** Network switcher plus a button that opens the modal, as on the stream page. */
function Harness() {
  const { setNetwork } = useNetwork();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setNetwork('testnet')}>Use testnet</button>
      <button onClick={() => setNetwork('mainnet')}>Use mainnet</button>
      <button onClick={() => setOpen(true)}>Show QR</button>
      <StreamQrModal open={open} onClose={() => setOpen(false)} recipient={RECIPIENT} />
    </>
  );
}

function renderOn(network: Network) {
  localStorage.setItem('sorostream-network', network);
  render(
    <NetworkProvider>
      <Harness />
    </NetworkProvider>,
  );
}

describe('StreamQrModal network', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(QRCode.toCanvas).mockClear();
  });

  it('encodes testnet while on testnet', () => {
    renderOn('testnet');
    fireEvent.click(screen.getByText('Show QR'));

    const uri = lastEncodedUri();
    expect(uri.protocol).toBe('web+stellar:');
    expect(uri.searchParams.get('destination')).toBe(RECIPIENT);
    expect(uri.searchParams.get('network_passphrase')).toBe(TESTNET);
    expect(screen.getByText('Testnet')).toBeInTheDocument();
  });

  it('encodes mainnet while on mainnet', () => {
    renderOn('mainnet');
    fireEvent.click(screen.getByText('Show QR'));

    expect(lastEncodedUri().searchParams.get('network_passphrase')).toBe(MAINNET);
    expect(screen.getByText('Mainnet')).toBeInTheDocument();
  });

  it('a modal opened after switching networks mid-session encodes the new network', () => {
    renderOn('testnet');
    fireEvent.click(screen.getByText('Show QR'));
    expect(lastEncodedUri().searchParams.get('network_passphrase')).toBe(TESTNET);

    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByText('Use mainnet'));
    vi.mocked(QRCode.toCanvas).mockClear();
    fireEvent.click(screen.getByText('Show QR'));
    expect(lastEncodedUri().searchParams.get('network_passphrase')).toBe(MAINNET);

    // And back again.
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByText('Use testnet'));
    fireEvent.click(screen.getByText('Show QR'));
    expect(lastEncodedUri().searchParams.get('network_passphrase')).toBe(TESTNET);
  });

  it('redraws an open modal when the network changes', () => {
    renderOn('testnet');
    fireEvent.click(screen.getByText('Show QR'));
    act(() => {
      fireEvent.click(screen.getByText('Use mainnet'));
    });
    expect(lastEncodedUri().searchParams.get('network_passphrase')).toBe(MAINNET);
  });
});

describe('buildRecipientQrUri', () => {
  it('builds a SEP-7 pay URI with the network passphrase', () => {
    expect(buildRecipientQrUri(RECIPIENT, 'testnet')).toBe(
      `web+stellar:pay?destination=${RECIPIENT}&network_passphrase=Test%20SDF%20Network%20%3B%20September%202015`,
    );
  });

  it('leaves non-account recipients unchanged', () => {
    expect(buildRecipientQrUri('alice*example.com', 'mainnet')).toBe('alice*example.com');
  });
});
