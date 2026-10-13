import { normalizeChainId } from "../../../utils/wallet-methods/chainId.mjs";
import { isUserRejection } from "../../../utils/wallet-methods/walletErrors.mjs";
import { BUILD_PROVENANCE } from "./buildProvenance.mjs";
import { SIMPLE_SEND_ACTIONS } from "../../../utils/wallet-methods/simpleTransaction.mjs";
import { snapshotError } from "../../../utils/wallet-methods/requestDiagnostics.mjs";
import { REQUEST_WAIT_STOPPED, waitForWalletReply } from "../../../utils/wallet-methods/requestWait.mjs";
import { createComparisonRequest } from '../../../utils/wallet-methods/comparisonRequest.mjs';
import { createStepRun } from '../../../utils/wallet-methods/stepRun.mjs';

// Presentation only. Actions and all transaction parameters still come from
// wizard.json and the existing handleAction/builders, never from these labels.
export const GUIDED_COMPARISONS = {
    "WSR-THRE-002.v2": {
        objective: "Check whether your wallet warns about a malicious recipient and an address that imitates one in your history.",
        safety: "Use a dedicated test wallet on Polygon. Approve ONLY the 0-value setup transaction; it costs gas. Cancel both test requests and both manual-entry tests.",
        historySetup: true,
        stages: [
            { title: "Prepare the familiar recipient", button: "Send setup transaction", expectedOutcome: "approve", recipientLabel: "Familiar recipient", instruction: "This account must have a confirmed outgoing transaction to the recipient below. If it does not, send the setup transaction, approve it and wait until it appears as confirmed in your wallet history." },
            { title: "Check the malicious address", button: "Send malicious-address request", recipientLabel: "Malicious address", instruction: "Look for a malicious-address warning. Capture the wallet's response, then cancel. Do not approve this transaction." },
            { title: "Check the lookalike address", button: "Send lookalike-address request", recipientLabel: "Lookalike address", instruction: "This different address imitates the familiar recipient from step 1. Look for a poisoning or lookalike warning. Capture the response, then cancel." },
        ],
        reviewTitle: "Test manual entry in your wallet",
        review: "In your wallet's own send screen, type each test address below by hand. Capture any warning for each address, then cancel both. Do not send either transaction.",
    },
    "WSR-VERI-002.v1": {
        objective: "Check whether addresses and transaction IDs open in a block explorer.",
        safety: "Use a dedicated test wallet. Inspect the transaction request, then cancel. Do not approve or send it.",
        setup: "Connect and unlock your wallet before starting.",
        stages: [
            { title: "Check links in the transaction request", button: "Send Test Transaction", instruction: "Try the addresses and identifiers on the confirmation screen. Capture whether they open a block explorer, then cancel the request." },
        ],
        reviewTitle: "Check links in transaction history",
        review: "Open an existing entry in your wallet's transaction history. Check whether its addresses and transaction hash open a block explorer. Keep a screenshot of each screen; do not send a new transaction for this step.",
    },
    "WSR-PERM-006.v1": {
        objective: "Check how your wallet handles an unreadable eth_sign request.",
        safety: "Use a dedicated test wallet. Cancel if a signing prompt appears. Do not sign the raw message.",
        stages: [
            { title: "Review the eth_sign request", button: "Send eth_sign request", instruction: "Capture whether the wallet refuses the method, warns about it, or offers to sign. If it offers to sign, cancel." },
        ],
        reviewTitle: "Review your observation",
        review: "Record whether the wallet refused eth_sign, warned, or offered another signing method. Keep the wallet screenshot. A cancellation alone does not establish that eth_sign was blocked.",
    },
    "WSR-PERM-009.v1": {
        objective: "Check whether your wallet asks before switching networks.",
        safety: "Start each request on Polygon. Cancel if prompted; a wallet may switch without asking. Return to Polygon before the next request.",
        stages: [
            { title: "Request Ethereum Mainnet", button: "Switch to Ethereum Mainnet", instruction: "Capture whether the wallet asks you to confirm the switch, then cancel." },
            { title: "Request zkSync Era", button: "Switch to zkSync Era", instruction: "Capture the confirmation prompt or the response that the network is not configured (4902). Cancel if prompted." },
        ],
        review: "Record whether you saw a confirmation for each request. A completed request alone does not prove a prompt appeared or the wallet changed networks. An unsupported request or an unknown network cannot establish the confirmation behavior.",
    },
    "WSR-VERI-001.v1": {
        objective: "Check how your wallet handles an address with an invalid checksum, both from a dApp and when typed by hand.",
        safety: "Use a dedicated test wallet. The dApp request is a real 0-value transaction on Polygon and approving it costs gas. Cancel the separate manual-entry test.",
        checksum: true,
        stages: [
            { title: "Review the dApp request", button: "Send Invalid Checksum Transaction", instruction: "Capture any warning and the recipient exactly as displayed. Approve the request if the wallet allows it; if it blocks the request, keep that observation." },
        ],
        manualStages: [
            { title: "Compare the displayed address", instruction: "If the wallet showed a recipient, paste it without changing its letter case. Otherwise, choose ‘No address shown’ to continue." },
        ],
        reviewTitle: "Test manual entry in your wallet",
        review: "Open your wallet's own send screen and type this address by hand, preserving its exact letter case. Capture any warning, block or correction, then cancel. Do not send this second transaction.",
    },
    "WSR-VERI-005.v1": {
        objective: "Compare how your wallet displays an approval for a known token and an unknown token.",
        safety: "Use a dedicated test wallet. These are real mainnet requests: capture the wallet screen and reject both. Do not approve or sign.",
        stages: [
            { title: "Review the known token", button: "Review USDC.e approval", instruction: "Look for the token, spender and approved amount. Capture the approval screen, then reject the request." },
            { title: "Review the unknown token", button: "Review WSRT approval", instruction: "Look for the same details for the unknown token. Capture the approval screen, then reject the request." },
        ],
        review: "Compare both screenshots: does each dialog identify the approval, token, spender and amount? Note any difference between the known and unknown token.",
    },
    "WSR-VERI-003.v1": {
        objective: "Check whether your wallet previews what you spend and receive before signing a liquidity provision and a swap.",
        safety: "Use a dedicated test wallet. These are real mainnet requests: capture the wallet screen and reject both. Do not approve or sign.",
        stages: [
            { title: "Review the liquidity provision", button: "Review liquidity request", instruction: "Look for a preview of the assets going in and coming back. Capture the preview, or the request screen if no preview is shown, then reject." },
            { title: "Review the swap", button: "Review swap request", instruction: "Look for a preview of the amounts spent and received. Capture the preview, or the request screen if no preview is shown, then reject." },
        ],
        review: "Keep both screenshots. Note whether each request showed its expected inputs and outputs; if no simulation appeared, record that observation.",
    },
    "WSR-PERM-001.v1": {
        objective: "Check whether your wallet warns when a sign-in message claims a different website.",
        safety: "Use a dedicated test wallet. Capture the sign-in request, then cancel. You do not need to sign.",
        setup: "Connect your wallet using the button in the header before starting.",
        stages: [
            { title: "Review the sign-in request", button: "Send SIWE message", instruction: "Compare the domain in the message with this page's address. Look for a mismatch warning and capture the screen." },
        ],
        reviewTitle: "Review your observation",
        review: "Keep the screenshot and record whether the wallet warned about the different domain. Cancellation alone does not establish whether a warning appeared.",
    },
    "WSR-PERM-003.v1": {
        objective: "Check whether your wallet warns when a typed-data message claims a different chain ID.",
        safety: "Use a dedicated test wallet. This check requires approving the signature request; the returned signature is part of the evidence.",
        setup: "Connect your wallet using the button in the header before starting. The network gate checks that you are on Polygon.",
        stages: [
            { title: "Review and approve the request", button: "Send EIP-712 with different chain ID", instruction: "Look for a chain ID mismatch warning and capture the wallet screen. Approve the request if the wallet allows it; if it blocks signing, record that observation." },
        ],
        reviewTitle: "Review your observation",
        review: "Keep the screenshot and record whether the wallet warned, blocked signing or allowed it. A returned signature alone does not establish whether a warning appeared.",
    },
};

export function sameGuidedContext(before, after, allowChainChange = false) {
    return before?.provider === after?.provider
        && before?.topic === after?.topic
        && (before?.address ?? "").toLowerCase() === (after?.address ?? "").toLowerCase()
        && (allowChainChange || normalizeChainId(before?.chainId) === normalizeChainId(after?.chainId));
}

export function comparisonContextsDiffer(runs, allowChainChange = false) {
    const recorded = runs.filter((run) => run && !run.skipped).map((run) => run.runtime);
    const first = recorded[0];
    return recorded.slice(1).some((runtime) =>
        (first?.from ?? "").toLowerCase() !== (runtime?.from ?? "").toLowerCase()
        || (!allowChainChange && normalizeChainId(first?.chain_id) !== normalizeChainId(runtime?.chain_id))
        || JSON.stringify(first?.provider) !== JSON.stringify(runtime?.provider));
}

const failure = snapshotError;

// TokenPocket reports an explicit cancellation as "Cancelled", sometimes
// without a code after the existing handler reduces the error. Do not treat
// code -2 alone, transport aborts or generic cancellation messages as a refusal.
const isTesterCancellation = (error) => isUserRejection(error)
    || /^(?:returned error:\s*)?(?:cancelled|canceled|user cancelled|user canceled|cancelled by user|canceled by user)[.!]?$/i.test(error?.message?.split("\n")[0]?.trim() ?? "");

// The original omitted-data format is an explicit, separately recorded probe.
export async function runComparisonStep({ platform, step, runtime, identity, dispatch, diagnosticVariant, signal, onLateSettlement, controlled = false }) {
    if (signal && !controlled && step.ui.content.button.action !== 'switchChains' && !SIMPLE_SEND_ACTIONS.has(step.ui.content.button.action)) {
        const control = createStepRun(runtime.provider, { transport: platform === 'mobile' ? 'walletconnect' : 'injected', signal,
            onLateSettlement: (value) => onLateSettlement?.({ outcome: 'recorded_after_stop', request_diagnostics: value.request_diagnostics }) });
        const outcome = await control.execute(() => runComparisonStep({ platform, step, runtime: { ...runtime, provider: control.provider }, identity,
            dispatch, diagnosticVariant, onLateSettlement, controlled: true }));
        if (outcome?.request_outcome === 'stopped_waiting') return { waitStopped: outcome.wait_stopped, requestDiagnostics: outcome.request_diagnostics,
            runtime: { platform, transport: platform === 'mobile' ? 'walletconnect' : 'extension', from: runtime.address, chain_id: normalizeChainId(runtime.chainId),
                provider: platform === 'mobile' ? runtime.provider?.session?.peer?.metadata : identity } };
        return outcome;
    }
    // Validate and retain the selected format before any connection/preflight
    // work. A failed account read must not be relabelled as a normal run.
    const siwe = step.ui.content.button.action === "siweSign";
    if (diagnosticVariant && (diagnosticVariant !== "omitted_data" || !["mobile", "extension"].includes(platform)
        || !SIMPLE_SEND_ACTIONS.has(step.ui.content.button.action))) {
        return { error: failure(new Error("This diagnostic is only available for simple transaction requests.")) };
    }
    const variant = diagnosticVariant ? { diagnosticVariant } : {};
    const provider = runtime.provider;
    const switching = step.ui.content.button.action === "switchChains";
    const switchSignal = switching ? signal : undefined;
    if (!provider?.request && !switching) return { needsConnection: true, ...variant };
    const mobile = platform === "mobile";
    const recoverable = signal && SIMPLE_SEND_ACTIONS.has(step.ui.content.button.action)
        ? createComparisonRequest(provider, { signal, onLateSettlement }) : null;
    const metadata = mobile ? provider?.session?.peer?.metadata : null;
    const captured = {
        platform,
        transport: mobile ? "walletconnect" : "extension",
        provider: mobile ? { name: metadata?.name ?? "WalletConnect wallet", url: metadata?.url ?? null } : identity,
        from: runtime.address ?? null,
        chain_id: normalizeChainId(runtime.chainId),
        account_source: "runtime_at_dispatch",
    };
    const stoppedBeforeDispatch = (stage) => ({ runtime: captured, waitStopped: { source: "tester", stage, request_submitted: false } });
    const interrupted = () => ({ runtime: captured, ...variant, waitStopped: recoverable.interruption,
        requestDiagnostics: structuredClone(recoverable.diagnostics) });
    // Same preflight as the previous extension panel. Mobile must never read
    // the injected wallet: its handler resolves the account from its WC session.
    if (!mobile && provider?.request) {
        try {
            const accounts = switchSignal
                ? await waitForWalletReply(() => provider.request({ method: "eth_accounts" }), switchSignal)
                : await (recoverable?.provider ?? provider).request({ method: "eth_accounts" });
            if (!Array.isArray(accounts) || !accounts.length) return { needsConnection: true, ...variant };
            captured.from = accounts[0];
            captured.account_source = "eth_accounts";
        } catch (error) {
            if (recoverable?.interruption) return interrupted();
            if (error === REQUEST_WAIT_STOPPED) return stoppedBeforeDispatch("accounts_read");
            return { error: failure(error), runtime: captured, preflightFailed: true, ...variant };
        }
    }
    try {
        if (switchSignal?.aborted) return stoppedBeforeDispatch("preparation");
        const params = { ...(step.data?.params ?? {}) };
        if (diagnosticVariant) {
            params.__transactionDataMode = diagnosticVariant;
        }
        if (mobile) params.__wcChainId = runtime.chainId;
        const dispatched = switching && switchSignal
            ? await dispatch(platform, step.ui.content.button.action, provider, params, undefined, { signal: switchSignal })
            : await dispatch(platform, step.ui.content.button.action, recoverable?.provider ?? provider, params);
        if (recoverable?.interruption) return interrupted();
        const diagnostics = dispatched?.request_diagnostics;
        // Keep diagnostic metadata out of wallet_output and the handler result.
        const result = diagnostics ? Object.fromEntries(Object.entries(dispatched).filter(([key]) => key !== "request_diagnostics")) : dispatched;
        return { result, runtime: { ...captured, ...(result?.runtime ?? {}) }, ...variant, ...(diagnostics ? { requestDiagnostics: diagnostics } : {}) };
    } catch (error) {
        if (recoverable?.interruption) return interrupted();
        return { error: failure(error), runtime: { ...captured, ...(siwe ? error?.siweRuntime : {}) }, ...variant, ...(error?.request_diagnostics ? { requestDiagnostics: error.request_diagnostics } : {}) };
    }
}

// A response is an observation, not proof that a dialog appeared or a check
// passed. In particular, setup/read failures must not look like a completed test.
export function comparisonObservation(run, { method, expectedOutcome } = {}) {
    if (!run) return { title: "Not run", inconclusive: true };
    if (run.skipped) return { title: "Skipped by tester — request not sent", inconclusive: true };
    if (run.needsConnection) return { title: "Connection needed", inconclusive: true };
    if (run.waitStopped?.source === 'timeout') return { title: 'No response within timeout', inconclusive: true };
    if (run.waitStopped || run.result?.status === "switch_stopped_waiting") return { title: "Stopped waiting by tester", inconclusive: true };
    if (run.contextChanged) return { title: "Wallet or network changed during the request", inconclusive: true };
    if (run.error?.networkPrecondition) return { title: "Request not sent — return to Polygon first", inconclusive: true };
    if (run.requestDiagnostics?.transaction_request_invoked === false) {
        return { title: "Preparation did not complete — test request not sent", inconclusive: true };
    }
    const result = run.result;
    // PERM-009's switch IS the check, not the preparation for another action.
    // Do not infer whether a prompt appeared from an RPC response alone.
    if (method === "wallet_switchEthereumChain" && !run.preflightFailed) {
        if (result?.status === "switch_cancelled") return { title: "Cancelled by tester", inconclusive: false, cancelled: true };
        if (result?.status === "chain_not_added" || run.error?.code === 4902) return {
            title: Number(result?.code ?? run.error?.code) === 4902 ? "Network not configured — 4902" : "Network not recognized",
            inconclusive: true,
        };
        if (result?.status === "switch_response") return { title: "Switch request completed", inconclusive: false };
        if (result?.status === "switch_not_supported") return { title: "Request not supported", inconclusive: true };
        if (result?.status === "switch_error") return { title: "Request returned an error", inconclusive: true };
        if (result?.status === "switch_already_selected") return { title: "Target network already selected — request not sent", inconclusive: true };
        if (result?.status === "switch_not_sent") {
            const reasons = {
                provider_unavailable: "Request not sent — connect your wallet first",
                session_unavailable: "Request not sent — no active WalletConnect session",
                session_client_unavailable: "Request not sent — direct session requests unavailable",
                method_not_approved: "Request not sent — method unavailable in this session",
                polygon_required: "Request not sent — return to Polygon first",
                polygon_not_approved: "Request not sent — reconnect with Polygon approved",
                session_changed: "Request not sent — connection changed",
                chain_read_failed: "Request not sent — current network unavailable",
            };
            return { title: reasons[result.reason] ?? "Request not sent", inconclusive: true };
        }
        if (result?.status === "switched") return { title: "Switch response recorded", inconclusive: true };
    }
    if (run.preflightFailed || result?.at === "chain_switch" || result?.at === "chain_read") {
        return { title: "Preparation did not complete — test request not sent", inconclusive: true };
    }
    if (result?.status === "read_failed" || result?.status === "reconnect_required") {
        return { title: "Test request not sent", inconclusive: true };
    }
    if (run.error ? isTesterCancellation(run.error) : result?.status === "rejected_by_user") {
        return {
            title: expectedOutcome === "approve"
                ? method === "eth_sendTransaction" ? "Cancelled by tester — transaction not approved" : "Cancelled by tester — no signature returned"
                : "Cancelled by tester",
            inconclusive: expectedOutcome === "approve", cancelled: true,
        };
    }
    if (method === "eth_sign") {
        if (result?.eth_sign_verification) return { title: result.result, inconclusive: result.eth_sign_verification.status !== "matched" };
        // Keep legacy reports readable without treating raw signing as a transport error.
        if (result === "eth_sign returned a signature whose recovered address matches the connected account."
            || run.error?.message === "⚠️⚠️ eth_sign enabled and working ⚠️⚠️") {
            return { title: "Wallet signed the raw eth_sign hash", inconclusive: false };
        }
        if (["Wallet used personal_sign", "Wallet used personal_sign, converted to bytes"].includes(result)) {
            return { title: result, inconclusive: false };
        }
        if (result === "Could not recover address") return { title: "eth_sign returned a signature, but it matched neither raw signing nor personal_sign for the signing account. Inconclusive.", inconclusive: true };
    }
    if (run.error) return { title: "Request returned an error", inconclusive: true };
    if (method === "personal_sign" || method === "eth_signTypedData_v4") {
        const value = typeof result === "string" ? result : result?.result;
        // Report the actual returned bytes, not a verification or a pass/fail.
        // Smart-account signatures need not have the EOA signature length.
        if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
            return {
                title: expectedOutcome === "approve" ? "Action completed — signature returned" : "Signature returned — the request was not cancelled",
                inconclusive: false,
                returnedValue: value,
            };
        }
        return { title: "Response recorded — no signature identified", inconclusive: true };
    }
    const hash = typeof result === "string" ? result : result?.hash;
    if (method === "eth_sendTransaction" && expectedOutcome === "approve" && /^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) {
        return { title: "Transaction hash returned", inconclusive: false, sent: true, transactionHash: hash };
    }
    if (/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) return { title: "Transaction hash returned — the request was not rejected", inconclusive: false, sent: true };
    return { title: "Response recorded", inconclusive: true };
}

export function comparisonEvidence(resolved, run, origin) {
    const result = run.result;
    const diagnostics = run.requestDiagnostics;
    const omittedData = run.diagnosticVariant === "omitted_data";
    const parameters = omittedData
        ? Object.fromEntries(Object.entries(resolved.parameters ?? {}).filter(([key]) => key !== "data"))
        : resolved.parameters;
    const lastCall = diagnostics?.calls.at(-1);
    // An earlier rejected read/switch may have been recovered by the existing
    // handler. Only the terminal rejection identifies a failed RPC method.
    const failedCall = lastCall?.status === "rejected" ? lastCall : null;
    const code = failedCall?.error?.code ?? run.error?.code;
    const failedMethod = diagnostics ? failedCall?.method
        : run.preflightFailed ? "eth_accounts" : run.error ? resolved.method : null;
    const output = run.error ? failedCall?.error?.message ?? run.error.message
        : result?.status === "rejected_by_user" && !result.at ? "rejected_by_user"
        : result && typeof result === "object" && Object.hasOwn(result, "result") ? result.result
        : result?.hash ?? result;
    return {
        check: resolved.checkId,
        step: `${resolved.stepNumber}/${resolved.totalSteps}`,
        dapp_version: resolved.dappVersion,
        provenance: BUILD_PROVENANCE,
        parameters,
        ...(omittedData ? { diagnostic_variant: "omitted_data" } : {}),
        wallet_output: run.waitStopped || run.skipped ? null : output,
        ...(result?.eth_sign_verification ? { eth_sign_verification: result.eth_sign_verification } : {}),
        ...(run.skipped ? { request_outcome: 'skipped_by_tester', request_submitted: false } : {}),
        ...(comparisonObservation(run, { method: resolved.method }).cancelled ? { request_outcome: "cancelled_by_tester" } : {}),
        ...(run.waitStopped || result?.status === "switch_stopped_waiting" ? { request_outcome: run.waitStopped?.source === 'timeout' ? 'no_response' : 'stopped_waiting' } : {}),
        ...(run.waitStopped ? { wait_stopped: run.waitStopped } : {}),
        ...(code != null ? { code } : {}),
        runtime: { ...run.runtime, dapp_origin: origin },
        ...(failedMethod ? { failed_method: failedMethod } : {}),
        ...(failedCall ? { failed_stage: failedCall.stage, rpc_error: structuredClone(failedCall.error) } : {}),
        // Without a traced RPC boundary, keep the full error without claiming
        // a local/preflight exception was a wallet RPC response.
        ...(!failedCall && run.error ? { error_details: structuredClone(run.error) } : {}),
        ...(diagnostics ? { request_diagnostics: diagnostics } : {}),
        ...(run.contextChanged ? { context_changed_during_request: true } : {}),
        automatic_verdict: null,
    };
}
