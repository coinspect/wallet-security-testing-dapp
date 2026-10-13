import { normalizeChainId } from './chainId.mjs';
import { providerRequestAdapter } from './providerRequestAdapter.mjs';

export const POLYGON_CHAIN_ID = '0x89';
export const POLYGON_REQUIRED = 'Switch to Polygon before running this check. No test request was sent.';

// Read the provider, never a saved/default chain or the EIP-712 payload domain.
// This is deliberately read-only: locked/disconnected checks must not trigger
// a setup or unlock prompt in the middle of a measurement.
export async function assertPolygon(provider, timeoutMs = 3000) {
    let timer;
    let chainId;
    try {
        chainId = normalizeChainId(await Promise.race([
            Promise.resolve().then(() => provider.request({ method: 'eth_chainId' })),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Network read timed out')), timeoutMs); }),
        ]));
    } catch (cause) {
        throw Object.assign(new Error('Could not verify Polygon. Check the wallet network before trying again. No test request was sent.'), {
            requestNotSent: true, networkPrecondition: true, requiredChainId: POLYGON_CHAIN_ID, cause,
        });
    } finally { clearTimeout(timer); }
    if (chainId !== POLYGON_CHAIN_ID) throw Object.assign(new Error(POLYGON_REQUIRED), {
        requestNotSent: true, networkPrecondition: true, requiredChainId: POLYGON_CHAIN_ID, chainId,
    });
    return chainId;
}

// Account permission requests may precede network setup. Reads must not cause
// extra wallet prompts in locked/disconnected-wallet checks.
const NETWORK_NEUTRAL = new Set(['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_getTransactionReceipt', 'eth_call', 'eth_blockNumber', 'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionCount']);

// Recheck immediately before each wallet request, including later legs in a
// sequence. Leave all payload fields and the original provider binding intact.
export function polygonGuardedProvider(provider) {
    if (!provider?.request) return provider;
    return providerRequestAdapter(provider, async (args) => {
        const polygonSetup = ['wallet_switchEthereumChain', 'wallet_addEthereumChain'].includes(args.method)
            && normalizeChainId(args.params?.[0]?.chainId) === POLYGON_CHAIN_ID;
        if (!NETWORK_NEUTRAL.has(args.method) && !polygonSetup) await assertPolygon(provider);
        return provider.request(args);
    });
}
