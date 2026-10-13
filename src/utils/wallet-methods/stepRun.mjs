import { providerRequestAdapter } from './providerRequestAdapter.mjs';
import { waitForWalletReply, REQUEST_WAIT_STOPPED } from './requestWait.mjs';
import { snapshotError } from './requestDiagnostics.mjs';
import { CONTROLLED_WALLET_REQUEST, isWalletProbeMethod, walletConnectProbeProvider } from './wc/probeProvider.mjs';

export const skippedStepResult = () => ({ request_outcome: 'skipped_by_tester', request_submitted: false, wallet_output: null, automatic_verdict: null });

export function createStepRun(provider, { transport, manual = false, signal, onChange, onLateSettlement } = {}) {
    const controller = new AbortController();
    const calls = [];
    let decision;
    let sent = 0;
    let finished = false;
    const topic = (provider?.session ?? provider?.signer?.session)?.topic;
    const source = transport === 'walletconnect' ? walletConnectProbeProvider(provider) : provider;
    const snapshot = () => ({ boundary: transport === 'walletconnect' ? 'walletconnect_sign_client' : 'provider.request', calls: structuredClone(calls) });
    const stopped = () => ({
        request_outcome: 'stopped_waiting', wallet_output: null, automatic_verdict: null,
        wait_stopped: { source: 'tester', stage: calls.findLast((call) => call.status === 'stopped_waiting')?.method ?? 'preparation',
            request_submitted: calls.some((call) => call.request_submitted && (isWalletProbeMethod(call.method) || call.method === 'eth_requestAccounts')) },
        request_diagnostics: snapshot(),
    });
    const stop = () => {
        if (finished || controller.signal.aborted) return;
        for (const call of calls) if (call.status === 'pending') call.status = 'stopped_waiting';
        controller.abort();
        decision?.();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    const guard = () => {
        if (controller.signal.aborted || finished) throw Object.assign(new Error('Run stopped by tester'), { requestNotSent: true });
        if (topic !== (provider?.session ?? provider?.signer?.session)?.topic) throw Object.assign(new Error('The original wallet connection changed. Start a new run.'), { requestNotSent: true });
    };
    const request = async (args) => {
        guard();
        const interactive = isWalletProbeMethod(args.method);
        if (manual && interactive && sent > 0) {
            onChange?.({ phase: 'ready', method: args.method });
            await waitForWalletReply(() => new Promise((resolve) => { decision = resolve; }), controller.signal);
            decision = null;
            guard();
        }
        guard();
        const call = { method: args.method, status: 'pending', request_submitted: false };
        calls.push(call);
        if (interactive) onChange?.({ phase: 'waiting', method: args.method });
        return waitForWalletReply(async () => {
            guard();
            call.request_submitted = true;
            if (interactive) sent += 1;
            try {
                const value = await source.request(args);
                if (controller.signal.aborted) {
                    call.late_settlement = { status: 'fulfilled', response: value ?? null };
                    onLateSettlement?.(stopped());
                } else { call.status = 'fulfilled'; call.response = value ?? null; }
                return value;
            } catch (error) {
                if (error?.requestNotSent) call.request_submitted = false;
                const details = snapshotError(error);
                if (controller.signal.aborted) {
                    call.late_settlement = { status: 'rejected', error: details };
                    onLateSettlement?.(stopped());
                } else { call.status = 'rejected'; call.error = details; }
                throw error;
            }
        }, controller.signal);
    };
    return {
        signal: controller.signal,
        observation: stopped,
        provider: provider?.request ? providerRequestAdapter(provider, request, { [CONTROLLED_WALLET_REQUEST]: true }) : provider,
        stop,
        next: () => { const next = decision; decision = null; next?.(); },
        async execute(task) {
            try { return await waitForWalletReply(task, controller.signal); }
            catch (error) { if (controller.signal.aborted || error === REQUEST_WAIT_STOPPED) return stopped(); throw error; }
            finally { finished = true; signal?.removeEventListener('abort', stop); }
        },
    };
}
