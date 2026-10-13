export const AUTH_REQUEST_TIMEOUT_MS = 30000;

// Cancels our wait, never the wallet's request. Late replies stay observable.
export function waitForAuthRequest(request, args, ms = AUTH_REQUEST_TIMEOUT_MS, signal, onLateSettlement) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let abandoned = false;
        let reason;
        let dispatched = false;
        let timer;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", interrupt); };
        const abandon = (error) => {
            if (settled) return;
            settled = true;
            abandoned = true;
            reason = error.__timeout ? "timeout" : "stop";
            cleanup();
            reject(error);
        };
        const interrupt = () => abandon({ __authInterrupted: true });
        if (signal?.aborted) { interrupt(); return; }
        signal?.addEventListener("abort", interrupt, { once: true });
        timer = setTimeout(() => abandon({ __timeout: true }), ms);
        Promise.resolve().then(() => {
            if (settled) return;
            dispatched = true;
            return request(args);
        }).then(
            (value) => {
                if (abandoned && dispatched) onLateSettlement?.({ resolved: true, value, reason });
                else if (!settled) { settled = true; cleanup(); resolve(value); }
            },
            (error) => {
                if (abandoned && dispatched) onLateSettlement?.({ resolved: false, error, reason });
                else if (!settled) { settled = true; cleanup(); reject(error); }
            },
        );
    });
}

// A controller belongs to ONE run. It is never a wallet parameter or evidence.
export function createAuthRunControl({ manual = false, onChange = () => {}, recoverable = false, resume, isConnectionCurrent = () => true } = {}) {
    const lifetime = new AbortController();
    let requestAbort = null;
    let decision = null;
    let countdownTimer = null;
    let requestDelay = null;
    let advanceAfterWait = false;
    let state = { phase: "preparing", manual };
    let notify = onChange;
    const emit = (next) => { state = { ...state, ...next }; notify(state); };
    const choose = (value, phase) => {
        if (!decision || (phase && state.phase !== phase)) return;
        const resolve = decision;
        decision = null;
        resolve(value);
    };
    const clearCountdown = () => { clearTimeout(countdownTimer); countdownTimer = null; };
    const stop = (notice) => {
        if (lifetime.signal.aborted) return;
        clearCountdown();
        lifetime.abort();
        requestAbort?.abort();
        emit({ stopped: true, remainingSeconds: null, ...(notice ? { notice } : {}) });
        choose("stop");
    };
    const connectionCurrent = () => {
        if (isConnectionCurrent()) return true;
        stop("Connection changed — scheduled request not sent. Start a new run.");
        return false;
    };
    return {
        manual,
        previousResults: resume?.previousResults ?? [],
        connectionAttempt: resume?.connectionAttempt ?? 1,
        getState: () => state,
        signal: lifetime.signal,
        prepare: (method) => emit({ phase: "preparing", method }),
        beforeMethod(info) {
            requestDelay = null;
            if (lifetime.signal.aborted) return Promise.resolve("stop");
            if (!manual) return Promise.resolve("run");
            return new Promise((resolve) => {
                decision = resolve;
                const notice = advanceAfterWait ? "Previous request may still be pending. Cancel any open wallet prompt before running this method." : null;
                advanceAfterWait = false;
                emit({ ...info, phase: "ready", lastResult: null, notice, remainingSeconds: null });
            });
        },
        beginRequest(info) {
            if (requestDelay) connectionCurrent();
            requestAbort = new AbortController();
            if (lifetime.signal.aborted) requestAbort.abort();
            emit({ ...info, phase: "waiting" });
            return requestAbort.signal;
        },
        endRequest(result, info) {
            requestAbort = null;
            // Draining unsent rows after End run must not replace the method
            // and response the tester was looking at.
            if (lifetime.signal.aborted && result.outcome === "not_attempted") return;
            const needsRecovery = recoverable && ["session_dropped", "network_required"].includes(result.outcome);
            const awaitingNext = manual || needsRecovery || (recoverable && ["no_response", "stopped_waiting", "request_expired"].includes(result.outcome));
            const next = { ...info, phase: "result", lastResult: result, needsRecovery, awaitingNext };
            if (awaitingNext && !(advanceAfterWait && !needsRecovery) && !lifetime.signal.aborted && info.index + 1 < info.total) {
                return new Promise((resolve) => {
                    decision = resolve;
                    emit(next);
                });
            }
            emit(next);
        },
        runNext(delayMs = 0) {
            if (!manual || !decision || state.phase !== "ready" || lifetime.signal.aborted) return;
            const selectedMs = Number.isFinite(delayMs) ? Math.min(30000, Math.max(0, delayMs)) : 0;
            if (!selectedMs) { choose("run", "ready"); return; }
            const startedAt = Date.now();
            const tick = () => {
                if (lifetime.signal.aborted || !decision || !connectionCurrent()) return;
                const elapsedMs = Math.max(0, Date.now() - startedAt);
                if (elapsedMs >= selectedMs) {
                    clearCountdown();
                    requestDelay = { selected_ms: selectedMs, elapsed_ms: elapsedMs };
                    choose("run", "countdown");
                    return;
                }
                countdownTimer = setTimeout(tick, Math.min(1000, selectedMs - elapsedMs));
                emit({ phase: "countdown", remainingSeconds: Math.ceil((selectedMs - elapsedMs) / 1000), notice: null });
            };
            tick();
        },
        cancelCountdown() {
            if (state.phase !== "countdown" || !decision || lifetime.signal.aborted) return;
            clearCountdown();
            requestDelay = null;
            emit({ phase: "ready", remainingSeconds: null, notice: "Countdown cancelled — request not sent." });
        },
        getRequestDelay: () => requestDelay,
        skipNext: () => choose("skip", "ready"),
        nextMethod: () => { if (!state.needsRecovery) choose("next", "result"); },
        stopWaiting: () => requestAbort?.abort(),
        stopWaitingAndNext() {
            if (!manual || state.phase !== "waiting" || !requestAbort || lifetime.signal.aborted) return;
            advanceAfterWait = true;
            requestAbort.abort();
        },
        stop,
        finish: () => { clearCountdown(); emit({ phase: "complete", remainingSeconds: null }); },
        dispose() { notify = () => {}; stop(); },
    };
}

// Do not proceed with stale fallback values after a setup RPC timeout or stop.
// Ordinary wallet refusals follow the provider error path.
export async function readAuthPreflight(request, args, control, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
    control?.prepare(args.method);
    try {
        return await waitForAuthRequest(request, args, timeoutMs, control?.signal);
    } catch (error) {
        if (error?.__timeout || error?.__authInterrupted) {
            throw Object.assign(new Error(error.__timeout
                ? `No response to ${args.method} during setup. Auth requests were not started. Cancel any pending wallet prompt before retrying.`
                : "Auth run stopped during setup. Cancel any pending wallet prompt before retrying."), { authSetupStopped: true });
        }
        throw error;
    }
}
