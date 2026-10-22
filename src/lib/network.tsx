"use client";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Network = "testnet" | "mainnet";

interface NetworkContextType {
  network: Network;
  rpcUrl: string;
  setNetwork: (network: Network) => void;
}

export const NETWORK_CONFIG: Record<
  Network,
  { rpcUrl: string; label: string; networkPassphrase: string }
> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    label: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    label: "Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

const NetworkContext = createContext<NetworkContextType | null>(null);

/**
 * Access the selected Stellar network configuration.
 *
 * @returns {NetworkContextType} Active network, RPC URL and a setter to switch networks.
 * @throws {Error} When called outside a `NetworkProvider`.
 */
export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<Network>("testnet");

  useEffect(() => {
    const saved = localStorage.getItem("sorostream-network") as Network | null;
    if (saved === "testnet" || saved === "mainnet") {
      setNetworkState(saved);
    } else {
      const env = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
      if (env === "testnet" || env === "mainnet") setNetworkState(env);
    }
  }, []);

  const setNetwork = (n: Network) => {
    setNetworkState(n);
    localStorage.setItem("sorostream-network", n);
  };

  return (
    <NetworkContext.Provider value={{ network, rpcUrl: NETWORK_CONFIG[network].rpcUrl, setNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}
