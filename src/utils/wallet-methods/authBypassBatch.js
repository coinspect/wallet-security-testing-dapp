// Shared auth batch for injected and WalletConnect providers. Both use the same
// payload builder and outcome classification; only the request transport differs.
// Requests remain raw: no signer/library shaping or automatic retries.
//
// WC-specific: a dead/dropped WalletConnect session is classified as
// "session_dropped" — distinct from a wallet REFUSING to serve. A dropped session
// is a transport failure (re-pair), NOT the finding; a locked wallet that still
// serves (resolves) or refuses with an auth code IS the finding.

import {
    LONG_SIGN_MESSAGE,
    PERMIT_EIP712,
    resolveAddChain,
    TEST_ERC20_ADDRESS,
    chains,
} from "@/utils/constants";
import {
    buildAddEthereumChain,
    buildWatchAsset,
    buildWizardAuthBypassRequest,
    AUTH_BYPASS_PLACEHOLDER_CIPHERTEXT,
    ETH_DECRYPT_PLACEHOLDER_NOTE,
} from "@/utils/wallet-methods/authBypassPayloads";
import {
    isDeadWalletConnectSession,
    isUserCancellation,
    isRequestExpired,
} from "@/utils/wallet-methods/walletErrors.mjs";
import { AUTH_REQUEST_TIMEOUT_MS, readAuthPreflight, waitForAuthRequest } from "./authRunControl.mjs";
import { snapshotError } from './requestDiagnostics.mjs';

// Payload per privileged RPC. Derived from the SINGLE shared request builder, so
// the wire and the /params registry cannot drift — fed the wizard's own payload
// decisions rather than the builder's generic defaults:
//   • addChain    an UNCOMMON chain (default Taiko) so wallet_addEthereumChain is
//                 a GENUINE add, not an "already have it" no-op; a check can
//                 declare "zora"/"zksync" for an alternate.
//   • watchAsset  the WSRT test-token CONTRACT — EIP-747 requires options.address
//                 to be a real ERC-20 whose symbol/decimals match, or a
//                 validating wallet throws -32602.
//   • ciphertext  a NON-DECRYPTABLE placeholder (see ETH_DECRYPT_PLACEHOLDER_NOTE):
//                 a valid one needs a NaCl-box dep we do not have, and chaining
//                 eth_getEncryptionPublicKey would defeat the per-request gate.
export const authBypassParams = (method, account, chainId, addChain) =>
    buildWizardAuthBypassRequest({
        method,
        account,
        chainId,
        permit: PERMIT_EIP712,
        addChain: buildAddEthereumChain(resolveAddChain(addChain)).params[0],
        watchAsset: buildWatchAsset({ address: TEST_ERC20_ADDRESS }).params,
        ciphertext: AUTH_BYPASS_PLACEHOLDER_CIPHERTEXT,
        message: LONG_SIGN_MESSAGE,
    }).params;

// Numeric chainId for the typed-data domain: a live eth_chainId (via the injected
// `request`) → the step's declared chain → 137. Mirrors resolveAuthBypassChainId.
export const resolveAuthBypassChainId = async (request, declaredChain, control) => {
    try {
        const hex = await readAuthPreflight(request, { method: "eth_chainId" }, control);
        const n = parseInt(hex, 16);
        if (Number.isFinite(n) && n > 0) return n;
    } catch (error) {
        if (error?.authSetupStopped) throw error;
        /* locked / unreadable — fall through */
    }
    const declaredHex = declaredChain && chains[declaredChain]?.chainId;
    const declaredNum = declaredHex ? parseInt(declaredHex, 16) : NaN;
    return Number.isFinite(declaredNum) && declaredNum > 0 ? declaredNum : 137;
};

const AUTH_BYPASS_TIMEOUT_MS = AUTH_REQUEST_TIMEOUT_MS;
const ACCOUNTS_POLL_MAX = 6;
const ACCOUNTS_POLL_GAP_MS = 400;

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A resolution that carried NO data — empty array, null/undefined, or empty
// string. Distinct from "resolved" (returned data) AND from a 4001 rejection:
// the wallet ANSWERED, just with nothing. Both transports use this classifier.
// PERM-008's disconnected eth_accounts ([]) is
// the canonical case.
const isEmptyResolution = (v) =>
    v == null || (Array.isArray(v) && v.length === 0) || v === "";

// A resolution whose data is boolean `false` — for wallet_watchAsset (EIP-747)
// the spec-defined "I did NOT add the asset" answer. A DECLINE, not a bypass:
// the wallet answered NO, so it must not read as "resolved" (served). Strict
// `false` only (not any falsy), shared by both transports.
const isDeclinedResolution = (v) => v === false;

// Rejection and dead-session classification come from walletErrors.mjs — one
// source for both transports, with a session regex tight enough not to swallow
// unrelated "not connected" errors.

export const AUTH_BYPASS_LATE_EVENT = "wsr:auth-bypass-late-settlement";

const publishLateSettlement = (detail) => {
    console.warn("[WSR_LATE_WALLET_SETTLEMENT]", JSON.stringify(detail));
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent(AUTH_BYPASS_LATE_EVENT, { detail }));
    }
};

// Classify a thrown error into an outcome + numeric code. "session_dropped" is
// the WC transport-drop signal (NOT the finding); everything else mirrors the
// extension's classification.
const errOutcome = (error, classifySessionDrops) => {
    const code = typeof error?.code === "number" ? error.code : null;
    if (error?.networkPrecondition) return { outcome: 'network_required', code };
    if (error?.authTransportReason) return { outcome: ["method_not_approved", "method_not_requested"].includes(error.authTransportReason) ? error.authTransportReason : "session_dropped", code };
    if (isRequestExpired(error)) return { outcome: 'request_expired', code };
    if (classifySessionDrops && isDeadWalletConnectSession(error)) {
        return { outcome: "session_dropped", code };
    }
    const firstLine = error?.message?.split?.("\n")?.[0] || String(error);
    // -32603 is JSON-RPC "Internal error" — a failure inside the wallet, not a
    // user decision. Never let the message-text heuristic relabel it "rejected"
    // (an explicit rejection normally uses code 4001).
    if (code === -32603) {
        return { outcome: `error (internal): ${firstLine}`, code };
    }
    return {
        outcome: isUserCancellation(error) ? "cancelled_by_tester" : `error: ${firstLine}`,
        code,
    };
};

// eth_accounts with stability polling over the selected request transport.
// A reading that never settles is the observation ("unstable"); a dropped
// session surfaces via errOutcome as "session_dropped".
const probeEthAccounts = async (request, timeoutMs, classifySessionDrops, signal, onLateSettlement) => {
    const t0 = nowMs();
    const samples = [];
    let value = null;
    let stabilized = false;
    for (let i = 0; i < ACCOUNTS_POLL_MAX; i += 1) {
        let r;
        try {
            r = await waitForAuthRequest(request, { method: "eth_accounts" }, timeoutMs, signal, onLateSettlement);
        } catch (error) {
            if (error?.__timeout || error?.__authInterrupted) {
                return { method: "eth_accounts", outcome: error.__timeout ? "no_response" : "stopped_waiting", data_returned: null, elapsed_ms: Math.round(nowMs() - t0), samples };
            }
            const { outcome, code } = errOutcome(error, classifySessionDrops);
            const entry = { method: "eth_accounts", outcome, data_returned: null, elapsed_ms: Math.round(nowMs() - t0), samples };
            entry.rpc_error = snapshotError(error);
            if (code != null) entry.code = code;
            return entry;
        }
        const val = r ?? null;
        samples.push(val);
        value = val;
        if (samples.length >= 2 && JSON.stringify(samples[samples.length - 2]) === JSON.stringify(val)) {
            stabilized = true;
            break;
        }
        if (i < ACCOUNTS_POLL_MAX - 1) await sleep(ACCOUNTS_POLL_GAP_MS);
    }
    return {
        method: "eth_accounts",
        outcome: stabilized ? (isEmptyResolution(value) ? "empty" : "resolved") : "unstable",
        data_returned: value,
        elapsed_ms: Math.round(nowMs() - t0),
        samples,
        stabilized,
    };
};

// Run the batch over an injected `request(args)`. Returns the SAME results-array
// shape the extension's runAuthBypass returns (the evidence `wallet_output`).
export const runAuthBypassBatch = async ({
    request,
    methods,
    account,
    chainId,
    addChain,
    timeoutMs = AUTH_BYPASS_TIMEOUT_MS,
    classifySessionDrops = true,
    accountSource = null,
    control,
}) => {
    const list = Array.isArray(methods) ? methods : [];
    const results = [...(control?.previousResults ?? [])];
    if (results.length > list.length || results.some((row, index) => row.method !== list[index])) throw new Error("Cannot resume a different auth method list");
    for (const method of list.slice(results.length)) {
        const info = { method, index: results.length, total: list.length };
        const decision = await control?.beforeMethod(info) ?? "run";
        if (decision !== "run") {
            const entry = { method, outcome: decision === "skip" ? "skipped_by_tester" : "not_attempted", request_submitted: false, data_returned: null, elapsed_ms: 0,
                ...(request.authContext ? { runtime: request.authContext } : {}) };
            results.push(entry);
            await control?.endRequest(entry, info);
            continue;
        }
        const signal = control?.beginRequest(info);
        let submitted = false;
        const dispatch = async (args) => {
            submitted = true;
            try { return await request(args); }
            catch (error) { if (error?.requestNotSent) submitted = false; throw error; }
        };
        const params = authBypassParams(method, account, chainId, addChain);
        const t0 = nowMs();
        let entryRef = null;
        let queuedLate = null;
        const onLateSettlement = ({ resolved, value, error, reason }) => {
            const late = {
                method,
                outcome: reason === "stop"
                    ? resolved ? "resolved_after_stop" : "rejected_after_stop"
                    : resolved ? "resolved_after_timeout" : "rejected_after_timeout",
                data_returned: resolved ? (value ?? null) : null,
                code: typeof error?.code === "number" ? error.code : null,
                elapsed_ms: Math.round(nowMs() - t0),
                ...(!resolved ? { response_outcome: errOutcome(error, classifySessionDrops).outcome, rpc_error: snapshotError(error) } : {}),
            };
            queuedLate = late;
            if (entryRef) entryRef.late_settlement = late;
            publishLateSettlement(late);
        };
        let outcome;
        let data_returned = null;
        let code = null;
        let transportReason;
        let rpcError;
        let networkPrecondition = false;
        if (method === "eth_accounts") {
            const entry = await probeEthAccounts(dispatch, timeoutMs, classifySessionDrops, signal, onLateSettlement);
            if (!submitted && entry.outcome === "stopped_waiting") entry.outcome = "not_attempted";
            entryRef = entry;
            entry.request_submitted = submitted;
            if (submitted && control?.getRequestDelay?.()) entry.request_delay = control.getRequestDelay();
            if (request.authContext) entry.runtime = request.authContext;
            if (entry.outcome === "no_response" || entry.outcome === "stopped_waiting") entry.late_settlement = queuedLate ?? "pending";
            results.push(entry);
            await control?.endRequest(entry, info);
            continue;
        }
        try {
            const r = await waitForAuthRequest(
                dispatch,
                params === undefined ? { method } : { method, params },
                timeoutMs,
                signal,
                onLateSettlement,
            );
            outcome = isDeclinedResolution(r) ? "declined" : isEmptyResolution(r) ? "empty" : "resolved";
            data_returned = r ?? null;
        } catch (error) {
            if (error?.requestNotSent) submitted = false;
            transportReason = error?.authTransportReason;
            networkPrecondition = error?.networkPrecondition === true;
            if (error?.__timeout) {
                outcome = "no_response";
            } else if (error?.__authInterrupted) {
                outcome = "stopped_waiting";
            } else {
                ({ outcome, code } = errOutcome(error, classifySessionDrops));
                if (submitted) rpcError = snapshotError(error);
            }
        }
        if (!submitted && outcome === "stopped_waiting") outcome = "not_attempted";
        const entry = { method, outcome, data_returned, elapsed_ms: Math.round(nowMs() - t0), request_submitted: submitted,
            ...(request.authContext ? { runtime: request.authContext } : {}),
            ...(transportReason ? { transport_reason: transportReason } : {}) };
        if (submitted && control?.getRequestDelay?.()) entry.request_delay = control.getRequestDelay();
        if (networkPrecondition) entry.network_precondition = 'polygon_required';
        if (rpcError) entry.rpc_error = rpcError;
        entryRef = entry;
        if (outcome === "no_response" || outcome === "stopped_waiting") entry.late_settlement = queuedLate ?? "pending";
        if (code != null) entry.code = code;
        if (method === "eth_signTypedData_v4") entry.chain_id = chainId;
        // eth_decrypt's ciphertext is a non-decryptable placeholder — record why,
        // so a decode/decrypt error on this row is never read as an auth-gate result.
        if (method === "eth_decrypt") entry.payload_note = ETH_DECRYPT_PLACEHOLDER_NOTE;
        results.push(entry);
        await control?.endRequest(entry, info);
    }
    // Arrays remain the historical wallet_output shape. The non-enumerable
    // runtime attachment carries dispatch-time provenance to ActionResult without
    // altering the per-method evidence rows or any wallet request payload.
    Object.defineProperty(results, "runtime", {
        value: {
            ...(account ? { from: account } : {}),
            ...(accountSource ? { account_source: accountSource } : {}),
            ...(control ? { execution_mode: control.manual ? "manual" : "automatic" } : {}),
            ...(request.authContext ? { connection_attempts: control?.connectionAttempt ?? 1 } : {}),
        },
        enumerable: false,
    });
    control?.finish();
    return results;
};
