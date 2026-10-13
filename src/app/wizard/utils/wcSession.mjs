// Pure WalletConnect session decisions. Kept separate from the React/AppKit hook
// so the provider-lag and reconnect behaviour can be regression-tested in Node.

export const WC_CONNECT_OPEN_NOTE =
    "No WalletConnect session yet — the pairing modal is open. Approve the connection in your wallet, then run this again.";
export const WC_CONNECT_RECONNECT_NOTE =
    "Your WalletConnect session ended — the pairing modal is open. Re-pair your wallet, then run this again.";

export const planWcConnect = (session) => {
    // AppKit's isConnected flag can lag behind the provider on mobile. A live
    // provider is sufficient to try the request; stale sessions are recognized
    // below and reopen the pairing modal without recording data.
    if (!session?.walletProvider) {
        return { mode: "open", note: WC_CONNECT_OPEN_NOTE };
    }
    return {
        mode: "dispatch",
        provider: session.walletProvider,
        params: { __wcChainId: session.chainId },
    };
};

export const isReconnectSignal = (result) => result?.status === "reconnect_required";

export const isReadFailure = (result) => result?.status === "read_failed";
