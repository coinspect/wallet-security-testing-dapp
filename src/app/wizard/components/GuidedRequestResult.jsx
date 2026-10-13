import { authRequestFailure, authRequestTitle, authResultSummary, requestCancelled, signingRequestRows } from "../utils/guidedRequests.mjs";
import RuntimeIdentity from "./RuntimeIdentity";
import { formatResponseDetails, responseErrorMessages } from "../utils/responseDetails.mjs";

export default function GuidedRequestResult({ action, success, error, runtime, checkId, platform, targetAddress }) {
    if (success?.request_outcome) return <div className="space-y-3">
        <p className="text-xs">{checkId} · {platform}</p>
        <h3 className="font-semibold">{success.request_outcome === 'skipped_by_tester' ? 'Skipped by tester — request not sent' : 'Stopped waiting by tester'}</h3>
        {success.wait_stopped && <p className="text-sm">The dApp did not cancel the wallet request. A late response may still arrive. No further requests will be sent from this run.</p>}
        {success.request_diagnostics && <details open><summary className="cursor-pointer text-sm">Response details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{formatResponseDetails(success.request_diagnostics)}</pre>
        </details>}
        <RuntimeIdentity runtime={runtime} />
    </div>;
    const signingRows = signingRequestRows(action, success);
    const authRows = action === "runAuthBypass" && Array.isArray(success) && success.length > 0 && success.every((row) => row && "elapsed_ms" in row) ? success : null;
    const hash = typeof success === "string" && /^0x[0-9a-fA-F]{64}$/.test(success) ? success : success?.hash;
    const errorMessage = error || (success?.status === "error" ? success.message : null);
    const cancelled = success?.status === "rejected_by_user" || requestCancelled({ message: errorMessage });
    const title = success?.at === "chain_read" ? "Wallet network read failed — request not sent"
        : success?.at === "chain_switch" ? "Network preparation did not complete — request not sent"
        : cancelled ? "Cancelled by tester"
        : errorMessage ? "Request returned an error"
        : hash ? "Transaction hash returned"
        : action === "openScamUrl" ? "Requested opening the first URL"
        : action === "requestConnection" ? "Connection response recorded"
        : "Response recorded";
    return <div className="space-y-3 md:space-y-4 md:p-2" aria-label="Recorded observations">
        <p className="text-xs">{checkId} · {platform}</p>
        {authRows ? <>
            <p className="font-semibold">{authResultSummary(authRows)}</p>
            <ul className="space-y-2 md:space-y-3">{authRows.map((row, index) => {
                const failure = authRequestFailure(row);
                return <li key={`${row.method}:${index}`} className="border-t border-[var(--wsr-border)] pt-2 md:pt-3">
                {row.runtime?.connection_attempt && row.runtime.connection_attempt !== authRows[index - 1]?.runtime?.connection_attempt && <p className="mb-2 text-xs text-[var(--wsr-fg-muted)]">Connection {row.runtime.connection_attempt}{row.runtime.connection_attempt > 1 ? " · resumed after reconnecting" : ""}</p>}
                <p className="break-all font-mono text-xs">{row.method}</p>
                <p className="mt-1 font-medium">{authRequestTitle(row)}</p>
                {row.request_delay && <p className="mt-1 text-xs">Delay before request: {row.request_delay.selected_ms / 1000}s</p>}
                {row.outcome === "resolved" && <pre className="mt-1 whitespace-pre-wrap break-all text-xs">{typeof row.data_returned === "string" ? row.data_returned : JSON.stringify(row.data_returned, null, 2)}</pre>}
                {row.late_settlement && <p className="mt-1 text-xs">{row.late_settlement === "pending" ? "A late response may still arrive."
                    : row.late_settlement.response_outcome === 'request_expired' ? "Original request expired without a wallet response."
                    : `Late response: ${row.late_settlement.response_outcome ? authRequestTitle({ ...row.late_settlement, outcome: row.late_settlement.response_outcome }) : row.late_settlement.outcome?.replaceAll("_", " ") ?? "recorded"}`}</p>}
                {row.late_settlement?.data_returned != null && <pre className="mt-1 whitespace-pre-wrap break-all text-xs">{typeof row.late_settlement.data_returned === "string" ? row.late_settlement.data_returned : JSON.stringify(row.late_settlement.data_returned, null, 2)}</pre>}
                {failure && <details open className="text-xs md:mt-2"><summary className="cursor-pointer py-3.5 md:py-0">Response details</summary>
                    {responseErrorMessages(row, failure.message).map((message) => <p key={message} className="mt-1 whitespace-pre-wrap break-words">{failure.late ? "Late error: " : "Reason: "}{message}</p>)}
                </details>}
            </li>})}</ul>
        </> : signingRows ? <ul className="space-y-4">{signingRows.map((row) => <li key={row.label}>
            <h3 className="font-semibold">{row.label}</h3><p>{row.title}</p>
            {row.detail && row.title !== "Cancelled by tester" && <details className="mt-2 text-xs"><summary className="cursor-pointer">Response details</summary><pre className="mt-2 whitespace-pre-wrap break-all">{row.detail}</pre></details>}
        </li>)}</ul> : <>
            <h3 className="font-semibold">{title}</h3>
            {targetAddress && <div className="text-xs"><p className="text-[var(--wsr-fg-secondary)]">Recipient address:</p><code className="block select-all break-all">{targetAddress}</code></div>}
            {hash && <div className="text-xs"><p className="text-[var(--wsr-fg-secondary)]">Tx hash:</p><code className="block select-all break-all">{hash}</code></div>}
            {errorMessage && !cancelled && <p className="break-words">{errorMessage}</p>}
        </>}
        <RuntimeIdentity runtime={runtime} />
    </div>;
}
