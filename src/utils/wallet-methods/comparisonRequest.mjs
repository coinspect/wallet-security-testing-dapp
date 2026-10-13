import { waitForAuthRequest, AUTH_REQUEST_TIMEOUT_MS } from './authRunControl.mjs';
import { snapshotError } from './requestDiagnostics.mjs';
import { isUserCancellation, isRequestExpired } from './walletErrors.mjs';
import { providerRequestAdapter } from './providerRequestAdapter.mjs';

// Stop at the actual provider boundary, not just around the whole action: a
// delayed preparation read must never dispatch a transaction after reconnect.
export function createComparisonRequest(provider, { signal, onLateSettlement, timeoutMs = AUTH_REQUEST_TIMEOUT_MS } = {}) {
    const topic = (provider?.session ?? provider?.signer?.session)?.topic;
    const diagnostics = { boundary: 'provider.request', transaction_request_invoked: false, calls: [] };
    let interruption = null;
    const stoppedError = () => Object.assign(new Error('The dApp stopped waiting for this request.'), { requestNotSent: true });
    const request = async (args) => {
        if (interruption || signal?.aborted) throw stoppedError();
        if ((provider.session ?? provider.signer?.session)?.topic !== topic) {
            throw Object.assign(new Error('WalletConnect session changed before dispatch.'), { requestNotSent: true });
        }
        const transaction = args.method === 'eth_sendTransaction';
        const call = { method: args.method, status: 'pending', request_submitted: false };
        diagnostics.calls.push(call);
        try {
            const result = await waitForAuthRequest(() => {
                if (interruption || signal?.aborted) throw stoppedError();
                if ((provider.session ?? provider.signer?.session)?.topic !== topic) throw stoppedError();
                call.request_submitted = true;
                if (transaction) diagnostics.transaction_request_invoked = true;
                return provider.request(args);
            }, args, timeoutMs, signal, (late) => {
                if (!transaction || !call.request_submitted) return;
                onLateSettlement?.(late.resolved ? {
                    outcome: 'resolved', wallet_output: late.value ?? null,
                } : {
                    outcome: isRequestExpired(late.error) ? 'request_expired'
                        : isUserCancellation(late.error) ? 'cancelled_by_tester' : 'error',
                    rpc_error: snapshotError(late.error),
                });
            });
            call.status = 'fulfilled';
            return result;
        } catch (error) {
            if (error?.__timeout || error?.__authInterrupted) {
                interruption ??= {
                    source: error.__timeout ? 'timeout' : 'tester',
                    stage: transaction ? 'transaction_request' : args.method,
                    request_submitted: diagnostics.transaction_request_invoked,
                };
                call.status = error.__timeout ? 'no_response' : 'stopped_waiting';
                throw stoppedError();
            }
            if (error?.requestNotSent) {
                call.request_submitted = false;
                if (transaction) diagnostics.transaction_request_invoked = false;
            }
            call.status = 'rejected';
            call.error = snapshotError(error);
            throw error;
        }
    };
    return {
        provider: providerRequestAdapter(provider, request),
        diagnostics,
        get interruption() {
            return interruption ?? (signal?.aborted ? { source: 'tester', stage: 'preparation', request_submitted: false } : null);
        },
    };
}
