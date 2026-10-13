// Stop our wait, not the wallet operation. The symbol cannot be confused with
// a vendor cancellation/error. Late resolutions and rejections are consumed,
// never forwarded to a newer run or used to send another request.
export const REQUEST_WAIT_STOPPED = Symbol("request-wait-stopped");

export function waitForWalletReply(request, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (complete, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", stop);
            complete(value);
        };
        const stop = () => finish(reject, REQUEST_WAIT_STOPPED);
        if (signal?.aborted) { stop(); return; }
        signal?.addEventListener("abort", stop, { once: true });
        Promise.resolve().then(() => {
            if (!settled) return request();
        }).then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
}
