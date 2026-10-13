"use client";

import CTAButton from "./CTAButton";
import { authRequestTitle } from "../utils/guidedRequests.mjs";
import { AUTH_REQUEST_TIMEOUT_MS } from "../../../utils/wallet-methods/authRunControl.mjs";

function RunMenu({ onSelect, children }) {
    return <details className="relative shrink-0 text-xs"
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
        onKeyDown={(event) => {
            if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
            }
        }}>
        <summary aria-label="Run options" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md px-2 text-[var(--wsr-fg-muted)] hover:bg-[var(--wsr-border)] [&::-webkit-details-marker]:hidden">More</summary>
        <div className="absolute right-0 top-full z-10 w-max rounded-md border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-1 shadow-lg">
            <button type="button" className="min-h-11 rounded px-3 text-sm hover:bg-[var(--wsr-border)]"
                onClick={(event) => { event.currentTarget.closest("details").open = false; onSelect(); }}>{children}</button>
        </div>
    </details>;
}

/** A single method and its response stay together until Next method is chosen. */
export default function AuthRunPanel({ pending, manual, onManualChange, progress, control, onRun, onNewRun, disabled, label, hasRun, onReview, onReconnect, delaySeconds = 0, onDelayChange }) {
    const finished = !pending && hasRun && !!onReview && !!(progress?.lastResult || progress?.stopped);
    const delayPicker = manual && onDelayChange && <fieldset className="space-y-2">
        <legend className="text-sm">Delay before request</legend>
        <div className="flex flex-wrap gap-2">{[0, 5, 10, 15, 30].map((seconds) => <button
            key={seconds} type="button" aria-pressed={delaySeconds === seconds} onClick={() => onDelayChange(seconds)}
            className={`min-h-11 min-w-11 rounded-md border px-3 text-sm ${delaySeconds === seconds ? "border-blue-500 bg-blue-500/10 text-blue-500" : "border-[var(--wsr-border)] hover:bg-[var(--wsr-border)]"}`}
        >{seconds === 0 ? "Off" : `${seconds}s`}</button>)}</div>
    </fieldset>;
    if (!pending && !finished) return <div className="space-y-2">
        <CTAButton onClick={onRun} disabled={disabled}>{manual ? "Start manual run" : label}</CTAButton>
        <details className="text-xs text-[var(--wsr-fg-secondary)]">
            <summary className="w-fit cursor-pointer py-2">Advanced controls</summary>
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={manual} onChange={(event) => onManualChange(event.target.checked)} />
                Run one method at a time
            </label>
        </details>
        {delayPicker}
    </div>;

    const phase = progress?.phase ?? "preparing";
    const result = progress?.lastResult;
    const showResult = (phase === "result" || finished) && result;
    const unsettled = showResult && ["no_response", "stopped_waiting"].includes(result.outcome);
    const canRecover = onReconnect && Number.isInteger(progress?.index) && (finished || (pending && ["ready", "countdown", "waiting", "result"].includes(phase)));
    const restartConnection = finished || (!["ready", "countdown"].includes(phase) && progress?.index + 1 >= progress?.total);
    const count = Number.isInteger(progress?.index) ? `Method ${progress.index + 1} of ${progress.total}` : "Preparing requests";
    const resultTitle = result?.outcome === "no_response"
        ? `No response within ${AUTH_REQUEST_TIMEOUT_MS / 1000} seconds`
        : result?.outcome === "stopped_waiting" ? "Stopped waiting" : result ? authRequestTitle(result) : null;

    return <div className="space-y-4 border-t border-[var(--wsr-border)] pt-3" aria-label={manual ? "Manual requests" : "Automatic requests"}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1 pt-2" role="status" aria-atomic="true">
                <p className="text-xs text-[var(--wsr-fg-muted)]">{finished ? progress?.stopped ? "Run ended" : "Run complete" : count}</p>
                {progress?.method && <p className="break-all font-mono text-base font-medium text-stealth-fg">{progress.method}</p>}
                {showResult && <p className="text-sm">{resultTitle}</p>}
                {pending && phase === "waiting" && <p className="text-sm">Waiting for wallet…</p>}
                {pending && phase === "countdown" && <p className="text-sm">Sending in {progress.remainingSeconds}s — lock your wallet now.</p>}
            </div>
            <RunMenu onSelect={pending ? () => control?.stop() : onNewRun}>{pending ? "End run" : "New run"}</RunMenu>
        </div>
        {progress?.notice && <p className="text-sm" role="status">{progress.notice}</p>}
        {pending && phase === "ready" && delayPicker}
        {unsettled && <p className="text-xs leading-relaxed text-[var(--wsr-fg-secondary)]">
            This request may still be pending in your wallet. Cancel any pending prompt there before continuing.
        </p>}
        {finished ? <CTAButton onClick={onReview}>Review responses</CTAButton>
            : manual && phase === "ready" ? <div className="flex items-center gap-3">
                <CTAButton className="flex-1 md:flex-none" onClick={() => control?.runNext(onDelayChange ? delaySeconds * 1000 : 0)}>Run request</CTAButton>
                <button type="button" className="min-h-11 shrink-0 px-3 text-sm underline underline-offset-4" onClick={() => control?.skipNext()}>Skip</button>
            </div>
            : manual && phase === "countdown" ? <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => control?.cancelCountdown()}>Cancel countdown</button>
            : !progress?.needsRecovery && (manual || progress?.awaitingNext) && phase === "result" ? <CTAButton onClick={() => control?.nextMethod()}>Next method</CTAButton>
            : manual && phase === "waiting" ? <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => control?.stopWaitingAndNext()}>{progress.index + 1 < progress.total ? "Stop waiting and go to next method" : "Stop waiting"}</button>
            : null}
        {canRecover && <div className="border-t border-[var(--wsr-border)] pt-3"><CTAButton onClick={onReconnect}>{restartConnection ? "Reconnect and start new run" : "Reconnect and resume"}</CTAButton></div>}
    </div>;
}
