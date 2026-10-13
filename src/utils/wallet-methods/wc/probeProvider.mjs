import { providerRequestAdapter } from '../providerRequestAdapter.mjs';

export const CONTROLLED_WALLET_REQUEST = Symbol('controlled-wallet-request');

export const isWalletProbeMethod = (method) => typeof method === 'string' && (
    method.startsWith('wallet_') || method.startsWith('eth_sign') ||
    ['personal_sign', 'eth_sendTransaction', 'eth_sendRawTransaction', 'eth_decrypt', 'eth_getEncryptionPublicKey'].includes(method)
);

// Wallet probes use SignClient even when absent from the approved method list.
// UniversalProvider may otherwise use HTTP RPC or synthesize a local switch.
// Account/network reads remain session observations, not wallet-response proof.
export function walletConnectProbeProvider(provider, topic = (provider?.session ?? provider?.signer?.session)?.topic) {
    if (!provider?.request) return provider;
    if (provider[CONTROLLED_WALLET_REQUEST]) return provider;
    const universal = provider.client ? provider : provider.signer;
    const client = universal?.client;
    return providerRequestAdapter(provider, async (args) => {
        if (!isWalletProbeMethod(args.method)) return provider.request(args);
        const currentTopic = (provider.session ?? universal?.session)?.topic;
        if (!topic || !client?.request || currentTopic !== topic) {
            throw Object.assign(new Error('The original WalletConnect connection is unavailable. Reconnect before starting a new request.'), {
                requestNotSent: true, request_boundary: 'walletconnect_sign_client',
            });
        }
        return client.request({ topic, chainId: 'eip155:137', request: args });
    });
}
