import { normalizeChainId } from './chainId.mjs';
import { REQUEST_WAIT_STOPPED, waitForWalletReply } from './requestWait.mjs';
import { isUserCancellation } from './walletErrors.mjs';
import { simpleTransaction } from './simpleTransaction.mjs';

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
        const request = { method: 'eth_sendTransaction', params: [simpleTransaction(address, address)] };
        result.request = request;
        let send;
        if (mobile) {
            return { ...result, status: 'unavailable', routing_chain_id: null,
                message: 'Not sent: WalletConnect requires an explicit routing chain. That selection cannot prove the wallet switched its active network.' };
        } else {
            if (!provider.request) return { ...result, status: 'not_sent', message: 'Wallet provider unavailable.' };
            result.routing_chain_id = null;
            send = () => provider.request(request);
        }
        const response = await waitForWalletReply(() => { result.request_submitted = true; return send(); }, controller.signal);
        return { ...result, status: 'response', wallet_output: response ?? null, message: 'Transaction response received. Review the wallet screenshot; this does not establish consent to the network switch.' };
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
