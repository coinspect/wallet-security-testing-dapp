import { normalizeChainId } from './chainId.mjs';
import { REQUEST_WAIT_STOPPED, waitForWalletReply } from './requestWait.mjs';
import { isUserCancellation } from './walletErrors.mjs';

export function networkVerificationData(chainId) {
    return {
        types: {
            EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }],
            NetworkVerification: [{ name: 'message', type: 'string' }],
        },
        primaryType: 'NetworkVerification',
        domain: { name: 'Wallet network verification', version: '1', chainId: Number(BigInt(chainId)) },
        message: { message: 'Network display test. Cancel this request.' },
    };
}

export async function requestChainVerification({ provider, address, chainId, transport, signal, timeoutMs = 30000 }) {
    const mobile = transport === 'walletconnect';
    const result = {
        target_chain_id: normalizeChainId(chainId), from: address ?? null,
        request_path: mobile ? 'walletconnect_sign_client' : 'injected_provider',
        request_submitted: false, automatic_verdict: null,
    };
    if (!provider || !address) return { ...result, status: 'not_sent', message: 'Connect your wallet first.' };
    const controller = new AbortController();
    const stop = () => controller.abort('tester');
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
        const request = { method: 'eth_signTypedData_v4', params: [address, JSON.stringify(networkVerificationData(chainId))] };
        result.request = request;
        let send;
        if (mobile) {
            const universal = provider.client ? provider : provider.signer;
            const session = provider.session ?? universal?.session;
            if (!session?.topic || !universal?.client?.request) {
                return { ...result, status: 'not_sent', message: 'WalletConnect connection unavailable.' };
            }
            result.session_topic = session.topic;
            result.routing_chain_id = `eip155:${BigInt(chainId)}`;
            send = () => universal.client.request({ topic: session.topic, chainId: result.routing_chain_id, request });
        } else {
            if (!provider.request) return { ...result, status: 'not_sent', message: 'Wallet provider unavailable.' };
            result.routing_chain_id = null;
            send = () => provider.request(request);
        }
        const response = await waitForWalletReply(() => { result.request_submitted = true; return send(); }, controller.signal);
        return { ...result, status: 'response', wallet_output: response ?? null, message: 'Signing response received. Network change not confirmed.' };
    } catch (error) {
        if (error === REQUEST_WAIT_STOPPED) return { ...result,
            status: controller.signal.reason === 'timeout' ? 'timeout' : 'stopped',
            message: controller.signal.reason === 'timeout' ? 'No response within timeout.' : 'Stopped waiting.' };
        return { ...result, status: isUserCancellation(error) ? 'cancelled' : 'error',
            message: isUserCancellation(error) ? 'Cancelled by tester.' : String(error?.message ?? error),
            rpc_error: { message: String(error?.message ?? error), ...(error?.code != null ? { code: error.code } : {}) } };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
    }
}
