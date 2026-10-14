"use client";

import { useEffect, useRef, useState } from "react";
import CTAButton from "./CTAButton";
import ResultExportActions from "./ResultExportActions";
import RuntimeIdentity from "./RuntimeIdentity";
import { formatResponseDetails } from "../utils/responseDetails.mjs";
import ApprovalTokenIdentity from "./ApprovalTokenIdentity";
import ChainGate from "./ChainGate";
import PersistedEvidence from "./PersistedEvidence";
import WizardStepHeader from "./WizardStepHeader";
import SkipStepButton from "./SkipStepButton";
import { ChecksumAddress, ChecksumFacts, ChecksumInput } from "./ChecksumReview";
import { useWalletRuntime } from "../context/WalletRuntimeContext";
import { checkTitle } from "../utils/checkMeta";
import { resolveCheckParams } from "../utils/resolveCheckParams";
import { getProviderIdentity } from "../utils/providerIdentity";
import { persistEvidenceRecord } from "../utils/evidenceStorage.mjs";
import { panelToPngBlob } from "../utils/panelToImage";
import { comparisonContextsDiffer, comparisonEvidence, comparisonObservation, runComparisonStep, sameGuidedContext } from "../utils/guidedComparison.mjs";
import { approvalTokenForStep } from "../utils/approvalToken";
import { handleAction } from "@/utils/wallet-methods/actionMethods";
import { nonSelfTarget } from "@/utils/wallet-methods/addressBoundary.mjs";
import { TESTER_WALLET_1, TESTER_WALLET_2 } from "@/utils/constants";
import { SIMPLE_SEND_ACTIONS } from "@/utils/wallet-methods/simpleTransaction.mjs";
import { normalizeChainId } from "@/utils/wallet-methods/chainId.mjs";
import { requestChainVerification } from "@/utils/wallet-methods/chainSwitchVerification.mjs";
import { authConnection, authRecoveryGuard, disconnectForRecovery } from '../utils/authRecovery.mjs';

const linkStyle = "text-sm underline underline-offset-4 text-[var(--wsr-fg-secondary)] disabled:opacity-50";
const contextOf = (runtime) => ({ provider: runtime.provider, topic: (runtime.provider?.session ?? runtime.provider?.signer?.session)?.topic, address: runtime.address, chainId: runtime.chainId });

function TestRecipient({ label, address, onCopy }) {
    return <div className="space-y-2 rounded-md border border-[var(--wsr-border)] p-3">
        <p className="text-xs text-[var(--wsr-fg-secondary)]">{label}</p>
        <code className="block select-all break-all text-xs" aria-label={label}>{address}</code>
        <button className={linkStyle} onClick={() => onCopy(address, label)}>Copy {label.toLowerCase()}</button>
    </div>;
}

function TypedDataChainIdentity({ evidence }) {
    const messageChain = evidence?.parameters?.params?.eip712_mismatched_chainid;
    if (messageChain == null) return null;
    // Use the saved run, never the wallet's current network or the expected
    // Polygon chain: a later network change must not relabel the evidence.
    const recordedChain = evidence.runtime?.chain_id;
    const walletChain = recordedChain == null || recordedChain === "" ? null : normalizeChainId(recordedChain);
    return <dl className="space-y-1 text-xs">
        <div className="flex flex-wrap gap-x-2">
            <dt>Message chain ID (EIP-712):</dt><dd className="break-all font-mono">{String(messageChain)}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
            <dt>Wallet chain ID at request:</dt><dd className="break-all font-mono">{walletChain ? `${BigInt(walletChain).toString()} (${walletChain})` : "Not recorded"}</dd>
        </div>
    </dl>;
}

function SiweIdentity({ run }) {
    const captured = run?.runtime;
    if (!captured?.siwe_message) return null;
    return <div className="space-y-2 text-xs">
        <p>Message format: {captured.siwe_scheme ? "with https://" : "without https://"}</p>
        <p>Message domain: <code>{captured.siwe_domain}</code></p>
        <p className="break-all">Request origin: <code>{run.evidence.runtime.dapp_origin}</code></p>
        <p>Message chain ID: <code>{captured.siwe_chain_id}</code></p>
        <p>Wallet chain ID: <code>{normalizeChainId(captured.chain_id) ?? "Not recorded"}</code></p>
        <p className="break-all">Nonce: <code>{captured.siwe_nonce}</code></p>
        <p className="break-all">Issued At: <code>{captured.siwe_issued_at}</code></p>
        <details><summary className="cursor-pointer">SIWE message</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all">{captured.siwe_message}</pre>
        </details>
        {captured.siwe_request && <details><summary className="cursor-pointer">RPC payload · personal_sign</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(captured.siwe_request, null, 2)}</pre>
        </details>}
    </div>;
}

export default function GuidedComparisonCheck({ check, presentation, platform, chainGate }) {
    const runtime = useWalletRuntime(platform === "mobile" ? "walletconnect" : "extension");
    const latest = useRef(runtime);
    latest.current = runtime;
    const alive = useRef(true);
    const working = useRef(false);
    const activeSwitch = useRef(null);
    const activeVerification = useRef(null);
    const activeComparison = useRef(null);
    const attempts = useRef([]);
    const diagnosticAttempts = useRef([]);
    const recoveryBusy = useRef(false);
    const recoveryRef = useRef(null);
    const connectionAttempt = useRef(1);
    const resumedAfter = useRef(null);
    const [recovery, setRecovery] = useState(null);
    const summary = useRef(null);
    const [phase, setPhase] = useState(0);
    const [busy, setBusy] = useState(false);
    const [runs, setRuns] = useState(() => check.steps.map(() => null));
    const [diagnosticRuns, setDiagnosticRuns] = useState({});
    const [notice, setNotice] = useState(null);
    const [copyStatus, setCopyStatus] = useState(null);
    const [displayedAddress, setDisplayedAddress] = useState("");
    const [noAddressShown, setNoAddressShown] = useState(false);
    const historyContext = useRef(null);
    const setupContext = useRef(null);
    const [historyConfirmation, setHistoryConfirmation] = useState(null);
    const canReconnect = platform === 'mobile' && (presentation.historySetup || presentation.checksum);
    const canStopRequest = true;
    const historyMatches = !!historyConfirmation && sameGuidedContext(historyContext.current, contextOf(runtime));
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            activeSwitch.current?.controller.abort();
            activeVerification.current?.abort();
            activeComparison.current?.controller.abort();
        };
    }, []);

    const run = async (index, diagnosticVariant) => {
        if (working.current || chainGate?.wrong || recoveryRef.current) return;
        if (diagnosticVariant && (diagnosticVariant !== "omitted_data" || !SIMPLE_SEND_ACTIONS.has(check.steps[index]?.ui.content.button.action))) return;
        if (presentation.historySetup && index > 0 && !historyMatches) {
            setPhase(0);
            setNotice("Confirm the familiar recipient in this wallet's history before continuing.");
            return;
        }
        working.current = true;
        const switchRun = check.steps[index].ui.content.button.action === "switchChains"
            ? { index, controller: new AbortController() } : null;
        activeSwitch.current = switchRun;
        setBusy(true);
        setNotice(null);
        setCopyStatus(null);
        const initial = latest.current;
        const initialContext = contextOf(initial);
        const attempt = canStopRequest ? {
            index, controller: new AbortController(), original: authConnection(initial),
            history: index > 0 && historyMatches ? historyConfirmation : null, connectionAttempt: connectionAttempt.current,
            resumedAfter: resumedAfter.current, diagnosticVariant, entry: null, late: null,
        } : null;
        if (attempt) {
            attempt.done = new Promise((resolve) => { attempt.finish = resolve; });
            activeComparison.current = attempt;
            (diagnosticVariant ? diagnosticAttempts : attempts).current[index] = attempt;
        }
        const approvalToken = approvalTokenForStep(check.steps[index]);
        if (presentation.historySetup && index === 0 && !diagnosticVariant) {
            setHistoryConfirmation(null);
            setupContext.current = initialContext;
        }
        try {
            const outcome = await runComparisonStep({
                platform, step: check.steps[index], runtime: initial,
                identity: platform === "mobile" ? null : getProviderIdentity(), dispatch: handleAction,
                diagnosticVariant,
                signal: switchRun?.controller.signal ?? attempt?.controller.signal,
                onLateSettlement: (late) => {
                    if (!attempt) return;
                    attempt.late = late;
                    if (!alive.current || !attempt.entry || (diagnosticVariant ? diagnosticAttempts : attempts).current[index] !== attempt) return;
                    const entry = { ...attempt.entry, lateSettlement: late, evidence: { ...attempt.entry.evidence, late_settlement: late } };
                    attempt.entry = entry;
                    if (diagnosticVariant) setDiagnosticRuns((previous) => ({ ...previous, [index]: entry }));
                    else {
                        setRuns((previous) => previous.map((value, i) => i === index ? entry : value));
                        persistEvidenceRecord({ platform, checkId: entry.evidence.check, step: entry.evidence.step, evidence: entry.evidence });
                    }
                },
            });
            if (!alive.current) return;
            if (outcome.needsConnection) {
                if (platform === "mobile") {
                    setNotice("Connect your mobile wallet, then run this step again.");
                    Promise.resolve(latest.current.open?.()).catch(() => {
                        if (alive.current) setNotice("Could not open the connection dialog. Use Connect Wallet in the header.");
                    });
                } else setNotice("Connect your wallet using Connect Wallet in the header, then run this step again.");
                return;
            }
            if (presentation.checksum && !diagnosticVariant) {
                setDisplayedAddress("");
                setNoAddressShown(false);
            }
            const current = latest.current;
            if (attempt) outcome.runtime = { ...outcome.runtime, connection_attempt: attempt.connectionAttempt };
            outcome.contextChanged = !sameGuidedContext(initialContext, contextOf(current), check.steps[index].ui.content.button.action === "switchChains");
            const step = check.steps[index];
            const resolved = resolveCheckParams(step);
            // Same existing non-self rule as the handler. This changes only the
            // recorded recipient, never the declared params sent to the wallet.
            const targetAddress = step.ui.content.button.action === "sendExplorerLinkTransaction" && outcome.runtime?.from
                ? nonSelfTarget(resolved.target, outcome.runtime.from, [TESTER_WALLET_1, TESTER_WALLET_2]) : undefined;
            const evidenceParams = targetAddress ? {
                ...resolved,
                parameters: { ...resolved.parameters, target: targetAddress, value: resolved.value },
            } : resolved;
            const evidence = comparisonEvidence(evidenceParams, outcome, window.location.origin);
            if (attempt?.resumedAfter) evidence.resumed_after_reconnecting = attempt.resumedAfter;
            if (attempt?.late) evidence.late_settlement = attempt.late;
            if (diagnosticVariant) {
                // A compatibility probe must not overwrite the normal run,
                // establish setup history, or enter the campaign's evidence.
                const entry = { ...outcome, evidence };
                if (attempt) attempt.entry = entry;
                setDiagnosticRuns((previous) => ({ ...previous, [index]: entry }));
                return;
            }
            if (presentation.historySetup && index > 0) evidence.history_precondition = attempt?.history ?? historyConfirmation;
            const entry = { ...outcome, evidence, approvalToken, ...(attempt?.late ? { lateSettlement: attempt.late } : {}) };
            if (attempt) attempt.entry = entry;
            setRuns((previous) => previous.map((value, i) => i === index ? entry : value));
            persistEvidenceRecord({ platform, checkId: evidence.check, step: evidence.step, evidence });
            if (switchRun?.controller.signal.reason === 'continue' || attempt?.controller.signal.reason === 'continue') setPhase(index + 1);
        } catch (error) {
            if (alive.current) setNotice(error.message || "Could not start this request. Try again.");
        } finally {
            if (activeSwitch.current === switchRun) activeSwitch.current = null;
            if (activeComparison.current === attempt) activeComparison.current = null;
            working.current = false;
            if (alive.current) setBusy(false);
            attempt?.finish();
        }
    };

    const verifyNetwork = async (index) => {
        const original = runs[index];
        if (working.current || recoveryRef.current || !original?.result?.chainId) return;
        working.current = true;
        const controller = new AbortController();
        activeVerification.current = controller;
        setBusy(true);
        setNotice(null);
        const initial = latest.current;
        try {
            const result = await requestChainVerification({
                provider: initial.provider, address: initial.address, chainId: original.result.chainId,
                transport: platform === 'mobile' ? 'walletconnect' : 'extension', signal: controller.signal,
            });
            if (!alive.current) return;
            const verification = { ...result,
                context_changed: !sameGuidedContext(contextOf(initial), contextOf(latest.current), true),
                same_account_as_switch: initial.address?.toLowerCase() === original.runtime?.from?.toLowerCase(),
                provider_chain_id_at_dispatch: normalizeChainId(initial.chainId),
                provider_chain_source: platform === 'mobile' ? 'walletconnect_session_provider' : 'injected_wallet_provider',
            };
            const evidence = { ...original.evidence, post_switch_verification: verification };
            setRuns((previous) => previous.map((entry, i) => i === index ? { ...entry, evidence } : entry));
            persistEvidenceRecord({ platform, checkId: evidence.check, step: evidence.step, evidence });
        } finally {
            activeVerification.current = null;
            working.current = false;
            if (alive.current) setBusy(false);
        }
    };

    const reconnectAndResume = async (attempt) => {
        if (!canReconnect || !attempt || attempt.diagnosticVariant || recoveryBusy.current) return;
        recoveryBusy.current = true;
        const pending = { attempt, phase: 'disconnecting' };
        recoveryRef.current = pending; setRecovery(pending);
        attempt.controller.abort();
        await attempt.done;
        if (!alive.current) { recoveryBusy.current = false; return; }
        let note;
        try {
            if (!attempt.entry) throw new Error('No observation was recorded.');
            const current = latest.current;
            const topic = authConnection(current).topic;
            if (topic && topic === attempt.original.topic) {
                if (!current.disconnect) throw new Error('Disconnect unavailable');
                await disconnectForRecovery(current.disconnect);
                if (!alive.current) return;
            }
            // Never disconnect a different session the tester already selected.
            const nextTopic = authConnection(latest.current).topic;
            if (!nextTopic || nextTopic === attempt.original.topic) {
                await latest.current.open?.({ view: 'Connect', namespace: 'eip155' });
            }
        } catch {
            note = 'Disconnect this dApp in your wallet, then reconnect. Your recorded observations are preserved.';
        } finally {
            recoveryBusy.current = false;
            if (alive.current) {
                const next = { attempt, phase: 'connect', note };
                recoveryRef.current = next; setRecovery(next);
            }
        }
    };
    const resumeComparison = () => {
        const pending = recoveryRef.current;
        if (!pending || pending.phase !== 'connect' || recoveryBusy.current || chainGate?.wrong
            || !pending.attempt.entry || authRecoveryGuard(pending.attempt.original, latest.current)) return;
        const { attempt } = pending;
        // A new session is not new on-chain history. Transfer the existing
        // tester confirmation only through the same-wallet/account/Polygon gate.
        if (attempt.history) {
            historyContext.current = contextOf(latest.current);
            setHistoryConfirmation(attempt.history);
        }
        connectionAttempt.current = attempt.connectionAttempt + 1;
        resumedAfter.current = { connection_attempt: attempt.connectionAttempt, after_step: `${attempt.index + 1}/${check.steps.length}` };
        recoveryRef.current = null; setRecovery(null);
        setNotice(null);
        // Setup is never resent or treated as confirmed by reconnecting.
        setPhase(presentation.historySetup && attempt.index === 0 ? 0 : attempt.index + 1);
    };

    const stopWaiting = (index) => {
        const pending = activeSwitch.current ?? activeComparison.current;
        if (!pending || pending.index !== index || pending.controller.signal.aborted) return;
        // End only our wait. The wallet request itself cannot be cancelled here.
        pending.controller.abort(pending.diagnosticVariant ? 'stop' : 'continue');
    };

    const confirmHistory = async () => {
        if (working.current || chainGate?.wrong || recoveryRef.current) return;
        const current = latest.current;
        if (!current.provider || !current.address) {
            setNotice("Connect the test wallet before confirming its history.");
            if (platform === "mobile") {
                try { await current.open?.(); }
                catch { setNotice("Could not open the connection dialog. Use Connect Wallet in the header."); }
            }
            return;
        }
        const setupHash = runs[0] && !runs[0].contextChanged
            && sameGuidedContext(setupContext.current, contextOf(current))
            ? comparisonObservation(runs[0], { method: "eth_sendTransaction", expectedOutcome: "approve" }).transactionHash : null;
        historyContext.current = contextOf(current);
        setHistoryConfirmation({
            source: "tester_confirmation",
            from: current.address,
            chain_id: current.chainId,
            recipient: resolveCheckParams(check.steps[0]).target,
            ...(setupHash ? { setup_transaction_hash: setupHash } : {}),
        });
        setNotice(null);
        setPhase(1);
    };

    const copyEvidence = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(runs.filter(Boolean).map((entry) => entry.evidence), null, 2));
            setCopyStatus("Evidence copied");
        } catch { setCopyStatus("Clipboard unavailable. Use Export evidence above."); }
    };
    const copySignature = async (value) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopyStatus("Signature copied");
        } catch { setCopyStatus("Clipboard unavailable. Copy the signature from the result below."); }
    };
    const copyValue = async (value, label) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopyStatus(`${label} copied`);
        } catch { setCopyStatus("Clipboard unavailable. Select and copy the value manually."); }
    };
    const copyImage = async () => {
        try {
            const blob = await panelToPngBlob(summary.current);
            if (!blob) throw new Error("Image unavailable");
            if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                    setCopyStatus("Image copied");
                    return;
                } catch { /* download when clipboard permissions are unavailable */ }
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url; link.download = `${check.canonicalId}-${platform}.png`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setCopyStatus("Image downloaded");
        } catch { setCopyStatus("Image capture unavailable. Take a screenshot instead."); }
    };

    const hasRuns = runs.some(Boolean);
    const observations = runs.map((entry, index) => comparisonObservation(entry, {
        method: resolveCheckParams(check.steps[index]).method,
        expectedOutcome: check.steps[index].expectedOutcome ?? presentation.stages[index].expectedOutcome,
    }));
    const currentSetupHash = !runs[0]?.contextChanged && sameGuidedContext(setupContext.current, contextOf(runtime))
        ? observations[0].transactionHash : null;
    const reviewTitle = presentation.reviewTitle ?? "Review both observations";
    const manualStages = presentation.manualStages ?? [];
    const titles = [...presentation.stages.map((stage) => stage.title), ...manualStages.map((stage) => stage.title), reviewTitle];
    const requestCount = check.steps.length;
    const reviewIndex = requestCount + manualStages.length;
    // Resolve the verbatim target from the same registry as the dispatcher;
    // tester-entered text is presentation-only and can NEVER replace it.
    const checksumTarget = presentation.checksum ? resolveCheckParams(check.steps[0]).target : null;
    const differentWallet = comparisonContextsDiffer(runs, check.steps[0].ui.content.button.action === "switchChains");
    const recoveryNote = recovery ? authRecoveryGuard(recovery.attempt.original, runtime) : null;
    const recoverableAttempt = canReconnect ? activeComparison.current ?? attempts.current[phase]
        ?? (!historyMatches ? attempts.current[phase - 1] : null) : null;

    return (
        <section className="mx-auto w-full max-w-3xl space-y-5 pb-12 pt-4 md:space-y-6 md:px-4 md:pb-24 md:pt-8" aria-label={`${checkTitle(check.steps[0])} guided test`}>
            <WizardStepHeader checkId={check.canonicalId} title={checkTitle(check.steps[0])} contained={false} wrapTitle />
            <p className="text-[var(--wsr-fg-secondary)]">{presentation.objective}</p>
            <p className="rounded-lg border border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] p-3 text-sm text-[var(--wsr-note-fg)]">
                {presentation.safety}
            </p>
            {presentation.setup && !hasRuns && <p className="text-sm text-[var(--wsr-fg-secondary)]">{presentation.setup}</p>}
            <ol className="space-y-3">
                {titles.map((title, index) => (
                    <li key={title} aria-current={phase === index ? "step" : undefined}
                        className={`rounded-lg border p-4 md:p-5 ${phase === index ? "border-blue-400/60 bg-[var(--wsr-card)]" : "border-[var(--wsr-border)]"}`}>
                        <h2 className="flex items-center gap-3 font-semibold">
                            <span className="font-mono text-sm">0{index + 1}</span>
                            {index < phase ? <button className="text-left disabled:opacity-50" onClick={() => { setPhase(index); setNotice(null); }} disabled={busy || !!recovery}>{title}</button> : title}
                        </h2>
                        {phase === index && <div className="mt-4 space-y-4 text-sm">
                            {index < requestCount ? <>
                                <p>{presentation.stages[index].instruction}</p>
                                {presentation.historySetup && <>
                                    {index === 2 && <TestRecipient label="Familiar recipient · reference" address={resolveCheckParams(check.steps[0]).target} onCopy={copyValue} />}
                                    <TestRecipient label={presentation.stages[index].recipientLabel} address={resolveCheckParams(check.steps[index]).target} onCopy={copyValue} />
                                </>}
                                {chainGate?.wrong && !(check.canonicalId === 'WSR-PERM-009.v1' && runs[index]?.result?.chainId) && <ChainGate {...chainGate} />}
                                {recovery ? <div className="space-y-3" aria-live="polite">
                                    <p className="font-medium">{recovery.phase === 'disconnecting' ? 'Saving observations and disconnecting…' : 'Continue after reconnecting'}</p>
                                    {recovery.phase === 'connect' && <>
                                        <p>{recoveryNote ? recovery.note || recoveryNote : 'Same wallet and Polygon confirmed. Your previous observations are preserved.'}</p>
                                        <div className="flex flex-wrap gap-3">
                                            {recoveryNote ? <CTAButton onClick={async () => {
                                                if (authConnection(latest.current).topic === recovery.attempt.original.topic) {
                                                    await reconnectAndResume(recovery.attempt);
                                                } else {
                                                    try { await latest.current.open?.({ view: 'Connect', namespace: 'eip155' }); }
                                                    catch { setNotice('Could not open the connection dialog. Use Connect Wallet in the header.'); }
                                                }
                                            }}>Reconnect wallet</CTAButton> : <CTAButton disabled={!recovery.attempt.entry || chainGate?.wrong} onClick={resumeComparison}>
                                                {presentation.historySetup && recovery.attempt.index === 0 ? 'Continue to history confirmation' : 'Resume with next step'}
                                            </CTAButton>}
                                            <button type="button" className={linkStyle} onClick={() => {
                                                recoveryRef.current = null; setRecovery(null); setPhase(reviewIndex);
                                            }}>Review saved observations</button>
                                        </div>
                                    </>}
                                </div> : <div className="flex flex-wrap gap-3">
                                    <CTAButton onClick={() => run(index)} disabled={busy || chainGate?.wrong || (presentation.historySetup && index > 0 && !historyMatches)}>
                                        {busy ? "Waiting for wallet…" : runs[index] ? "Run this request again" : presentation.stages[index].button}
                                    </CTAButton>
                                    {busy && !activeVerification.current && <CTAButton onClick={() => stopWaiting(index)}>
                                        {activeComparison.current?.diagnosticVariant ? 'Stop waiting' : 'Stop waiting and continue'}
                                    </CTAButton>}
                                    {presentation.historySetup && index === 0 ? <CTAButton onClick={confirmHistory} disabled={busy || chainGate?.wrong}>
                                        {currentSetupHash ? "I confirmed it in wallet history" : "This recipient is already in my history"}
                                    </CTAButton> : !busy && runs[index] && <CTAButton onClick={() => { setPhase(index + 1); setNotice(null); }}>
                                        {observations[index].inconclusive ? "Continue as inconclusive" : presentation.historySetup ? titles[index + 1] : index < requestCount - 1 ? "Continue to the second request" : titles[index + 1]}
                                    </CTAButton>}
                                    {recoverableAttempt && !recoverableAttempt.diagnosticVariant
                                        && (busy || recoverableAttempt.entry) && <CTAButton onClick={() => reconnectAndResume(recoverableAttempt)}>
                                            Reconnect and resume
                                        </CTAButton>}
                                </div>}
                                {check.canonicalId === 'WSR-PERM-009.v1' && runs[index]?.result?.chainId && <div className="space-y-3 border-t border-[var(--wsr-border)] pt-3">
                                    <p>Send a signing request for the target network. Capture the network shown by the wallet, then cancel. The message chain ID alone does not confirm a switch.</p>
                                    <CTAButton disabled={busy} onClick={() => verifyNetwork(index)}>
                                        {index === 0 ? 'Send verification request — Ethereum' : 'Send verification request — zkSync Era'}
                                    </CTAButton>
                                    {activeVerification.current && <CTAButton onClick={() => activeVerification.current?.abort()}>Stop waiting for verification</CTAButton>}
                                    <p className="text-xs">Cancel any pending prompt before sending another request. Return to Polygon only before the next switch test.</p>
                                </div>}
                                {canReconnect && busy && !recovery && <p className="text-xs text-[var(--wsr-fg-secondary)]">
                                    Connection stuck? Reconnect and resume without resending this request. Cancel any open wallet prompt first.
                                </p>}
                                {busy && <p className="text-xs text-[var(--wsr-fg-secondary)]">
                                    Cancel any open wallet prompt first. This only stops waiting in the dApp.
                                </p>}
                                {!recovery && SIMPLE_SEND_ACTIONS.has(check.steps[index]?.ui.content.button.action) && <details className="rounded-md border border-[var(--wsr-border)] p-3">
                                    <summary className="cursor-pointer text-xs text-[var(--wsr-fg-secondary)]">Advanced controls</summary>
                                    <div className="mt-3 space-y-3">
                                        <p>Normal requests include <code>{'data: "0x"'}</code>. Test the original format without this field separately. Cancel any pending wallet request first, and cancel this probe too.</p>
                                        <CTAButton onClick={() => run(index, "omitted_data")} disabled={busy || chainGate?.wrong}>
                                            Try original format (no data)
                                        </CTAButton>
                                        {diagnosticRuns[index] && <div className="space-y-2" aria-live="polite">
                                            <p className="font-medium">Separate probe · data omitted</p>
                                            <p>{comparisonObservation(diagnosticRuns[index], { method: "eth_sendTransaction", expectedOutcome: "reject" }).title}</p>
                                            <button type="button" className={linkStyle} onClick={() => copyValue(JSON.stringify([diagnosticRuns[index].evidence], null, 2), "Diagnostic JSON")}>Copy diagnostic JSON</button>
                                            <details>
                                                <summary className="cursor-pointer text-xs">Diagnostic details</summary>
                                                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(diagnosticRuns[index].evidence, null, 2)}</pre>
                                            </details>
                                        </div>}
                                    </div>
                                </details>}
                            </> : index < reviewIndex ? <>
                                <p>{manualStages[index - requestCount].instruction}</p>
                                {presentation.checksum && <ChecksumInput value={displayedAddress} onChange={(value) => {
                                    setDisplayedAddress(value);
                                    setNoAddressShown(false);
                                }} />}
                                <div className="flex flex-wrap items-center gap-3">
                                    <CTAButton onClick={() => { setPhase(index + 1); setNotice(null); }}>{titles[index + 1]}</CTAButton>
                                    {presentation.checksum && <button type="button" className={`${linkStyle} min-h-11 md:min-h-0`} onClick={() => {
                                        setDisplayedAddress("");
                                        setNoAddressShown(true);
                                        setPhase(index + 1);
                                        setNotice(null);
                                    }}>No address shown — continue</button>}
                                </div>
                            </> : <>
                                <p>{presentation.review}</p>
                                {presentation.checksum && <ChecksumAddress address={checksumTarget} onCopy={(value) => copyValue(value, "Address")} />}
                                {presentation.historySetup && check.steps.slice(1).map((step, i) => <TestRecipient key={step.id}
                                    label={presentation.stages[i + 1].recipientLabel} address={resolveCheckParams(step).target} onCopy={copyValue} />)}
                            </>}
                            {!busy && !recovery && <SkipStepButton checkId={check.canonicalId} platform={platform} stage={index + 1} title={title} onSkip={() => {
                                if (index < requestCount && !runs[index]) {
                                    const outcome = { skipped: true, runtime: { platform } };
                                    const evidence = comparisonEvidence(resolveCheckParams(check.steps[index]), outcome, window.location.origin);
                                    setRuns((previous) => previous.map((value, i) => i === index ? { ...outcome, evidence } : value));
                                    persistEvidenceRecord({ platform, checkId: check.canonicalId, step: evidence.step, evidence });
                                }
                                setPhase(Math.min(index + 1, reviewIndex)); setNotice(null);
                            }} />}
                        </div>}
                    </li>
                ))}
            </ol>
            {presentation.historySetup && phase > 0 && !historyMatches && !recovery && <p role="status" className="text-sm">
                Wallet or network changed. <button className={linkStyle} onClick={() => setPhase(0)} disabled={busy}>Confirm history for this wallet</button> before sending another test request.
            </p>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
            {hasRuns ? <>
                <div ref={summary} aria-live="polite" className="space-y-4 rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-4 md:p-5">
                    <p className="text-xs text-[var(--wsr-fg-secondary)]">{check.canonicalId} · {platform}</p>
                    {presentation.checksum && <ChecksumFacts sent={runs[0]?.evidence?.parameters?.target ?? checksumTarget} input={displayedAddress} noAddressShown={noAddressShown} />}
                    {presentation.stages.map((stage, index) => <div key={stage.title} className="space-y-1">
                        {runs[index]?.runtime?.connection_attempt && <p className="text-xs text-[var(--wsr-fg-muted)]">Connection {runs[index].runtime.connection_attempt}{runs[index].evidence.resumed_after_reconnecting ? ' · resumed after reconnecting' : ''}</p>}
                        <h3 className="font-semibold">{stage.title}</h3>
                        <p className="text-sm">{presentation.historySetup && index === 0 && !runs[0] && historyConfirmation ? "Existing history confirmed by tester — no setup request sent" : observations[index].title}</p>
                        {runs[index]?.evidence?.post_switch_verification && <div className="text-sm">
                            <p>Network verification: {runs[index].evidence.post_switch_verification.message}</p>
                            <p>Target chain: {runs[index].evidence.post_switch_verification.target_chain_id}. Confirm the displayed network in the wallet screenshot.</p>
                            {runs[index].evidence.post_switch_verification.context_changed && <p>Connection changed during verification. Repeat with the same wallet.</p>}
                            {!runs[index].evidence.post_switch_verification.same_account_as_switch && <p>Verification used a different account from the switch request.</p>}
                        </div>}
                        <ApprovalTokenIdentity token={runs[index]?.approvalToken} />
                        {check.steps[index].ui.content.button.action === "differentChainId" && <TypedDataChainIdentity evidence={runs[index]?.evidence} />}
                        {check.steps[index].ui.content.button.action === "siweSign" && <SiweIdentity run={runs[index]} />}
                        {check.steps[index].ui.content.button.action === "switchChains" && runs[index]?.result?.error && runs[index].result.status !== 'switch_cancelled' && <details open className="text-xs">
                            <summary className="cursor-pointer">Response details</summary>
                            <p>Request attempted: {runs[index].result.request_submitted ? 'yes' : 'no'}</p>
                            {runs[index].result.request_path === 'walletconnect_sign_client' && <p>A WalletConnect transport error does not confirm wallet receipt.</p>}
                            <pre className="mt-2 whitespace-pre-wrap break-all">{formatResponseDetails(runs[index].result)}</pre>
                        </details>}
                        {presentation.historySetup && <div className="text-xs"><p>Recipient address:</p><code className="block break-all">{resolveCheckParams(check.steps[index]).target}</code></div>}
                        {observations[index].transactionHash && <div className="space-y-2">
                            <p className="text-xs">Tx hash:</p>
                            <code className="block break-all text-xs" aria-label="Transaction hash">{observations[index].transactionHash}</code>
                            <button className={linkStyle} onClick={() => copyValue(observations[index].transactionHash, "Transaction hash")}>Copy transaction hash</button>
                        </div>}
                        {observations[index].returnedValue && <div className="space-y-2">
                            <pre className="whitespace-pre-wrap break-all text-xs" aria-label="Returned signature">{observations[index].returnedValue}</pre>
                            <button className={linkStyle} onClick={() => copySignature(observations[index].returnedValue)}>Copy signature</button>
                        </div>}
                        {runs[index] && <RuntimeIdentity runtime={runs[index].runtime} />}
                        {presentation.checksum && runs[index]?.waitStopped && <div className="space-y-1 text-xs">
                            <p>Waiting ended during: <code>{runs[index].waitStopped.stage}</code></p>
                            <p>Transaction request submitted to provider: {runs[index].waitStopped.request_submitted ? 'yes' : 'no'}. This does not confirm a wallet prompt appeared.</p>
                            <details open><summary className="cursor-pointer">Response details</summary>
                                <pre className="mt-2 whitespace-pre-wrap break-all">{formatResponseDetails(runs[index].evidence)}</pre>
                            </details>
                        </div>}
                        {runs[index]?.waitStopped?.request_submitted && !runs[index].lateSettlement && <p className="text-xs">The wallet request was not cancelled by the dApp. A late response may still arrive.</p>}
                        {runs[index]?.lateSettlement && <p className="text-xs">{runs[index].lateSettlement.outcome === 'request_expired'
                            ? 'Original request expired without a wallet response.' : `Late response recorded: ${runs[index].lateSettlement.outcome.replaceAll('_', ' ')}.`}</p>}
                        {/^0x[0-9a-fA-F]{64}$/.test(runs[index]?.lateSettlement?.wallet_output ?? '') && <p className="break-all text-xs">Late tx hash: {runs[index].lateSettlement.wallet_output}</p>}
                    </div>)}
                    {presentation.historySetup && historyConfirmation && <p className="break-words text-xs text-[var(--wsr-fg-secondary)]">
                        Recipient history confirmed by tester for {historyConfirmation.from}.{!historyMatches && " Reconnect to the same wallet and account, or reconfirm history before continuing."}
                    </p>}
                    {differentWallet && <p className="text-sm">The wallet, account or network differs between requests. These observations may not be comparable; repeat with the same wallet and account.</p>}
                    <ResultExportActions onCopyEvidence={copyEvidence} onCopyImage={copyImage} status={copyStatus} />
                </div>
                <details className="rounded-lg border border-[var(--wsr-border)] p-4">
                    <summary className="cursor-pointer text-sm font-medium">Evidence and technical details</summary>
                    <div className="mt-4 space-y-4">
                        {runs.map((entry, index) => entry && <div key={index}>
                            <h3 className="mb-2 text-sm font-medium">{presentation.stages[index].title}</h3>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry.evidence, null, 2)}</pre>
                        </div>)}
                    </div>
                </details>
            </> : <PersistedEvidence checkId={check.canonicalId} platform={platform} />}
        </section>
    );
}
