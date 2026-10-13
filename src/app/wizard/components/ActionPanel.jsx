"use client";

import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, Wallet, PlugZap, Check } from "lucide-react";
import CTAButton from "./CTAButton";
import AuthRunPanel from "./AuthRunPanel";
import SourceLabel from "./SourceLabel";
import ChainGate from "./ChainGate";
import { handleAction } from "../../../utils/wallet-methods/actionMethods";
import { createAuthRunControl, readAuthPreflight } from "../../../utils/wallet-methods/authRunControl.mjs";
import { snapshotError } from "../../../utils/wallet-methods/requestDiagnostics.mjs";
import { createStepRun, skippedStepResult } from "../../../utils/wallet-methods/stepRun.mjs";
import { riskNote } from "../utils/resolveCheckParams";
import { useWalletRuntime } from "../context/WalletRuntimeContext";
import { DEFAULT_PLATFORM, INJECTED_NO_PROVIDER_NOTE, pendingReviewNote, resolveTransport } from "../utils/platform";
import { gatesOnAccount, requiresDisconnected, walletStateGuidance } from "../utils/walletState";
import { disconnectDapp } from "../utils/disconnectDapp";
import { authConnection, authRecoveryGuard, authResumePlan, disconnectForRecovery } from "../utils/authRecovery.mjs";
import { archiveCheckEvidence } from "../utils/evidenceStorage.mjs";
import {
    isReadFailure,
    isReconnectSignal,
    planWcConnect,
    WC_CONNECT_RECONNECT_NOTE,
} from "../utils/wcConnect";

/**
 * Right-column ACTION panel. It renders from the ACTIVE step (the single source
 * of truth the left column also uses, passed down as `activeSurface` /
 * `activeInstruction`):
 *   - active step in the wizard  → the executable CTA (primary state).
 *   - active step in the wallet / browser → an OBSERVING state that names the
 *     surface and shows the step's instruction. Once the action has run, a
 *     secondary "Run again" stays available here (auth-bypass is legitimately
 *     re-run), so the way to re-fire never disappears.
 * Self-contained run/guard logic; dispatches on the active `platform`
 * transport; reports outcome via onRunStart/onResult/onError.
 */
const ActionPanel = ({
    step,
    params,
    platform = DEFAULT_PLATFORM,
    blocked = false,
    blockedNote,
    manualAheadNote,
    activeSurface = "wizard",
    activeInstruction = null,
    hasRun = false,
    chainGate = null,
    walletConnectSession = null,
    onRunStart,
    onResult,
    onError,
    onRunFinish,
    onPendingChange,
    onReview,
    label,
    compact = false,
}) => {
    const [isPending, setIsPending] = useState(false);
    const [guardMessage, setGuardMessage] = useState(null);
    const pendingRef = useRef(false);
    const authControl = useRef(null);
    const stepControl = useRef(null);
    const [manualRequests, setManualRequests] = useState(false);
    const [requestProgress, setRequestProgress] = useState(null);
    const [manualAuth, setManualAuth] = useState(false);
    const [authDelaySeconds, setAuthDelaySeconds] = useState(0);
    const [authProgress, setAuthProgress] = useState(null);
    const mounted = useRef(true);
    const runDone = useRef(null);
    const lastAuthResult = useRef(null);
    const authOrigin = useRef(null);
    const recoveryBusy = useRef(false);
    const recoveryRef = useRef(null);
    const [recovery, setRecovery] = useState(null);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; authControl.current?.dispose(); stepControl.current?.stop(); };
    }, []);
    const transport = resolveTransport(platform, step);
    const walletRuntime = useWalletRuntime(transport);
    const latestRuntime = useRef(walletRuntime);
    latestRuntime.current = walletRuntime;
    const { address: account, status, refresh, provider: actionProvider } = walletRuntime;
    const hasAccount = account != null;
    // Disconnect-affordance feedback (PERM-008): idle | pending | done | unsupported | failed | no_provider.
    const [disc, setDisc] = useState("idle");
    // Live WalletConnect session is single-sourced by the page and shared with
    // the network gate, so both inspect and dispatch through the same provider.
    const wcSession = walletConnectSession;

    const buttonCfg = step.ui.content.button;
    const action = buttonCfg?.action;
    const runParams = { ...(step.data?.params ?? {}), ...(params ?? {}) };
    // Per-sub-step wallet-state precondition (default "connected").
    const walletState = step.walletState;
    // The account signal reads window.ethereum — an EXTENSION signal. On mobile
    // the "connected" precondition is the WalletConnect session, which run()
    // satisfies by opening the pairing modal, so never speak to it here.
    //
    // NOTE-ONLY (never a disabled button): only a CONFIRMED empty read ("none")
    // shows the connect note — never the transient "unknown" window. The button
    // stays enabled and run() does a fresh eth_accounts read at click time (the
    // real gate), so a stale/transient negative can't block the primary action.
    const accountKnownAbsent =
        action !== "openScamUrl" && platform !== "mobile" && gatesOnAccount(walletState) && status === "none";
    const stateNote = gatesOnAccount(walletState)
        ? (accountKnownAbsent ? walletStateGuidance(walletState, false) : null)
        : walletStateGuidance(walletState, hasAccount);
    // INVERSE gate (PERM-008): a "disconnected" check must NOT run while connected.
    // Only a CONFIRMED "connected" blocks — "unknown" (a transient read failure)
    // never does. Disables the button and surfaces a disconnect affordance.
    const mustDisconnect =
        platform !== "mobile" && requiresDisconnected(walletState) && status === "connected";

    const handleDisconnect = async () => {
        setDisc("pending");
        const r = await disconnectDapp();
        setDisc(r);
        // Re-read account state so the button re-enables even if the wallet never
        // emits accountsChanged (status → "none" → mustDisconnect false).
        refresh?.();
    };
    // Wrong network for a requiredChain check → the action is held until switched.
    const gateBlocked = !!chainGate?.wrong;

    const run = async (resume) => {
        const continuation = resume?.previousResults ? resume : null;
        const resumeOrigin = recoveryRef.current?.original;
        if (pendingRef.current || !action || blocked || gateBlocked || mustDisconnect) return;
        if (recoveryRef.current && !continuation) return;
        if (continuation && authRecoveryGuard(recoveryRef.current.original, latestRuntime.current)) return;
        if (continuation?.restart) {
            try { archiveCheckEvidence(platform, step.canonicalId); }
            catch { setGuardMessage("Could not preserve previous evidence. Copy the evidence JSON before starting another run."); return; }
        }
        setGuardMessage(null);
        const navigation = action === "openScamUrl";
        const wc = !navigation && transport === "walletconnect";
        const plan = wc ? planWcConnect(wcSession) : null;
        if (wc) {
            if (plan.mode === "open") {
                wcSession.open?.();
                setGuardMessage(plan.note);
                return;
            }
        }
        const injected = actionProvider;
        if (!navigation && !wc && (typeof window === "undefined" || !injected)) {
            setGuardMessage(transport === "injected" ? INJECTED_NO_PROVIDER_NOTE : "No browser wallet detected.");
            return;
        }

        // Lock before preflight too: double-clicks cannot open overlapping runs.
        pendingRef.current = true;
        let releaseRun;
        runDone.current = new Promise((resolve) => { releaseRun = resolve; });
        setIsPending(true);
        onPendingChange?.(true);
        setAuthProgress(null);
        setRequestProgress(null);
        const control = action === "runAuthBypass" ? createAuthRunControl({ manual: !!continuation || manualAuth, recoverable: wc,
            isConnectionCurrent: () => {
                const current = authConnection(latestRuntime.current);
                const original = authOrigin.current;
                return current.provider === original?.provider && current.topic === original?.topic
                    && current.address?.toLowerCase() === original?.address?.toLowerCase()
                    && current.chainId === original?.chainId;
            },
            resume: continuation, onChange: (state) => { if (mounted.current) setAuthProgress(state); } }) : undefined;
        authControl.current = control;
        if (control) {
            authOrigin.current = authConnection(latestRuntime.current);
            if (!continuation) lastAuthResult.current = null;
        }
        if (continuation) {
            recoveryRef.current = null;
            setRecovery(null);
            setManualAuth(true);
        }
        let started = false;
        const requestRun = control ? null : createStepRun(navigation ? null : wc ? plan.provider : injected, {
            transport, manual: manualRequests,
            onChange: (value) => { if (mounted.current) setRequestProgress(value); },
            onLateSettlement: (value) => { if (mounted.current && stepControl.current === requestRun) onResult?.(value); },
        });
        stepControl.current = requestRun;
        try {
            const execute = async () => {
                if (requestRun) { onRunStart?.({ resume: false }); started = true; }
                if (!navigation && !wc && gatesOnAccount(walletState)) {
                    const accounts = control
                        ? await readAuthPreflight((args) => injected.request(args), { method: "eth_accounts" }, control)
                        : await requestRun.provider.request({ method: "eth_accounts" });
                    if (!accounts || accounts.length === 0) {
                        setGuardMessage("Connect your wallet first (use the Connect Wallet button in the header).");
                        return { preflightOnly: true };
                    }
                }
                if (!started) onRunStart?.({ resume: !!continuation && !continuation.restart });
                started = true;
                return handleAction(navigation || wc ? platform : "extension", action,
                    requestRun ? requestRun.provider : navigation ? null : wc ? plan.provider : injected,
                    wc ? { ...runParams, ...plan.params } : runParams, control);
            };
            const r = requestRun ? await requestRun.execute(execute) : await execute();
            if (!mounted.current) return;
            if (r?.preflightOnly) return;
            if (continuation && !Array.isArray(r)) {
                throw new Error(r?.note || r?.message || "Connection setup did not complete. Your recorded responses are preserved.");
            }
            if (control && Array.isArray(r)) lastAuthResult.current = r;
            if (wc && isReconnectSignal(r)) {
                wcSession.open?.();
                setGuardMessage(WC_CONNECT_RECONNECT_NOTE);
            } else if (wc && isReadFailure(r)) {
                setGuardMessage(r.note);
            } else {
                onResult?.(r);
            }
        } catch (err) {
            const details = snapshotError(err);
            if (mounted.current) {
                if (continuation && lastAuthResult.current) {
                    // Failed setup must not replace the already captured history.
                    onResult?.(lastAuthResult.current);
                    setGuardMessage(details.message);
                    const retry = { original: resumeOrigin, plan: continuation, restart: !!continuation.restart, phase: "connect" };
                    recoveryRef.current = retry; setRecovery(retry);
                } else onError?.(details.message.split("\n")[0], details);
            }
        } finally {
            control?.finish();
            control?.dispose();
            authControl.current = null;
            pendingRef.current = false;
            if (mounted.current) {
                setIsPending(false);
                onPendingChange?.(false);
                if (started) onRunFinish?.();
            }
            releaseRun();
        }
    };

    const stopAndContinue = async () => {
        if (!pendingRef.current) return;
        authControl.current?.stop();
        stepControl.current?.stop();
        await runDone.current;
        if (mounted.current) onReview?.();
    };
    const countingDown = isPending && authProgress?.phase === "countdown";
    const escape = isPending ? <div className="space-y-2">
        <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={stopAndContinue}>{action === "runAuthBypass" ? "Stop run and go to next instruction" : countingDown ? "Cancel countdown and continue" : "Stop waiting and continue"}</button>
        <p className="text-xs">{action === "runAuthBypass" ? "Ends this instruction's run. Remaining methods will not be sent. Any request already sent may still be pending in your wallet." : countingDown ? "Ends this run without sending the scheduled request." : "This stops the dApp wait, not the wallet request. Cancel any open wallet prompt before sending another request."}</p>
    </div> : !hasRun && <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => {
        if (pendingRef.current) return;
        stepControl.current = null;
        onResult?.(skippedStepResult()); onReview?.();
    }}>Skip step</button>;

    const reconnectAndResume = async () => {
        const state = authControl.current?.getState() ?? authProgress;
        if (recoveryBusy.current || !state || !["ready", "countdown", "waiting", "result", "complete"].includes(state.phase)
            || !Number.isInteger(state.index)) return;
        const nextIndex = ["ready", "countdown"].includes(state.phase) ? state.index : state.index + 1;
        const restart = !pendingRef.current || nextIndex >= state.total;
        recoveryBusy.current = true;
        const original = authOrigin.current;
        const entry = { original, phase: "disconnecting", plan: null, restart };
        recoveryRef.current = entry; setRecovery(entry);
        authControl.current?.stop();
        await runDone.current;
        if (!mounted.current) { recoveryBusy.current = false; return; }
        let plan = null;
        let note;
        try {
            plan = restart ? { previousResults: [], connectionAttempt: 1, restart: true } : authResumePlan(lastAuthResult.current, nextIndex);
            const current = latestRuntime.current;
            if (authConnection(current).topic === original.topic) {
                if (!current.disconnect) throw new Error("Disconnect unavailable");
                await disconnectForRecovery(current.disconnect);
                if (!mounted.current) return;
                await latestRuntime.current.open?.({ view: "Connect", namespace: "eip155" });
            } else if (!authConnection(current).topic) {
                await current.open?.({ view: "Connect", namespace: "eip155" });
            }
        } catch {
            note = "Disconnect this dApp manually in your wallet, then reconnect. Your recorded responses are preserved.";
        } finally {
            recoveryBusy.current = false;
            if (mounted.current) {
                const next = { original, plan, note, restart, phase: "connect" };
                recoveryRef.current = next; setRecovery(next);
            }
        }
    };
    const recoveryNote = recovery ? authRecoveryGuard(recovery.original, walletRuntime) : null;

    // Guidance/SETUP note — the sober badge (shared --wsr-note-* tokens), never
    // bright standalone amber text, never a verdict.
    const amber = "flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.8125rem] font-medium leading-[1.15rem] border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]";
    const gray = "text-[0.875rem] leading-[1.25rem] text-[var(--wsr-fg-muted)]";
    const risk = riskNote(action, runParams.methods);

    // Notes shown BELOW the button (separated by a divider). The generic
    // "review, then reject" line was DELETED — How-to-Test step "Reject every
    // prompt…" already says it. The "approve" variant stays: approving is the
    // unusual case (PERM-004 part 1, VERI-005 part 1) and easy to get wrong.
    // PERM-008 disconnect affordance — the existing wallet_revokePermissions flow,
    // surfaced at the action gate so the tester can disconnect without hunting for
    // it. Neutral copy, no verdict.
    const disconnectNote = (
        <div key="mustdisc" className={`${amber} flex-col items-start gap-2`}>
            <p>This check must run while this dApp is disconnected. Disconnect it first, then run.</p>
            <button
                type="button"
                onClick={handleDisconnect}
                disabled={disc === "pending" || disc === "done"}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-[0.8125rem] font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
                {disc === "done" ? (
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                    <PlugZap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                {disc === "pending" ? "Disconnecting…" : disc === "done" ? "Disconnected" : "Disconnect this dApp"}
            </button>
            {disc === "unsupported" && (
                <span className="text-[0.75rem] text-[var(--wsr-fg-muted)]">
                    Your wallet doesn&apos;t support one-click disconnect — disconnect this dApp manually, then run.
                </span>
            )}
            {disc === "failed" && (
                <span className="text-[0.75rem] text-[var(--wsr-fg-muted)]">
                    Disconnect didn&apos;t complete — try again, or disconnect manually in the wallet.
                </span>
            )}
        </div>
    );

    const notes = [];
    if (mustDisconnect) {
        notes.push(disconnectNote);
    } else if (blocked && blockedNote) {
        notes.push(<p key="blocked" className={amber}>{blockedNote}</p>);
    } else if (accountKnownAbsent) {
        notes.push(<p key="gated" className={amber}>{stateNote}</p>);
    } else {
        if (!compact && risk) notes.push(<p key="risk" className={amber}>{risk}</p>);
        if (!compact && stateNote) notes.push(<p key="state" className={amber}>{stateNote}</p>);
        if (!compact && (step.expectedOutcome ?? "reject") === "approve") {
            notes.push(
                <p key="approve" className={gray}>
                    Approve this request in your wallet — the check needs it to proceed.
                </p>
            );
        }
        if (!compact && isPending && action !== "runAuthBypass") {
            notes.push(
                <p key="pending" className={gray}>
                    {pendingReviewNote(resolveTransport(platform, step))}
                </p>
            );
        }
    }
    if (manualAheadNote) {
        notes.push(
            <p key="manual" className={`flex items-center gap-1.5 ${gray}`}>
                <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {manualAheadNote}
            </p>
        );
    }
    if (guardMessage) {
        notes.push(
            <div
                key="guard"
                className="rounded-md border px-3 py-2 text-[0.8125rem] border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]"
            >
                {guardMessage}
            </div>
        );
    }

    // OBSERVING state — the active step is in the wallet or browser, so the card
    // names that surface and shows the step's instruction (neutral copy) instead
    // of a primary CTA. Environment notes that still apply are kept below it.
    if (activeSurface !== "wizard" && activeInstruction) {
        const obsNotes = [];
        if (blocked && blockedNote) {
            obsNotes.push(<p key="blocked" className={amber}>{blockedNote}</p>);
        } else if (accountKnownAbsent) {
            obsNotes.push(<p key="gated" className={amber}>{stateNote}</p>);
        }
        if (manualAheadNote) {
            obsNotes.push(
                <p key="manual" className={`flex items-center gap-1.5 ${gray}`}>
                    <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {manualAheadNote}
                </p>
            );
        }
        if (guardMessage) {
            obsNotes.push(
                <div
                    key="guard"
                    className="rounded-md border px-3 py-2 text-[0.8125rem] border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]"
                >
                    {guardMessage}
                </div>
            );
        }
        return (
            <div className="shrink-0 rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-5">
                <SourceLabel source={activeSurface} />
                {/* The step's instruction lives ONCE (the highlighted step on the
                    left), so this card never repeats it. Instead it carries a real
                    fact: once fired, WHERE the result is; before that, that this is
                    a by-hand step the wizard has no request to fire. */}
                <p className="mt-2 text-[0.9375rem] leading-6 text-gray-600 dark:text-gray-400">
                    {hasRun
                        ? "The wizard already fired this — its result is recorded below."
                        : "Done by hand — the wizard has no request to fire for this step."}
                </p>
                {escape}
                {(hasRun || gateBlocked || obsNotes.length > 0) && (
                    <div className="mt-4 space-y-2 border-t border-[var(--wsr-border)]/60 pt-4">
                        {gateBlocked && <ChainGate {...chainGate} />}
                        {hasRun && (
                            <button
                                type="button"
                                onClick={run}
                                disabled={!action || isPending || blocked || gateBlocked || mustDisconnect}
                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-[0.875rem] font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50"
                            >
                                <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {isPending ? "Waiting for wallet…" : "Run again"}
                            </button>
                        )}
                        {obsNotes}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={compact ? "space-y-3" : "shrink-0 rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-5"}>
            {/* Button FIRST and LEFT-aligned — the primary action, in line with
                the notes below it. The RPC method reference lives in the live
                step's Technical details. */}
            {recovery ? <div className="space-y-3" aria-live="polite">
                <p className="font-medium">{recovery.phase === "disconnecting" ? "Saving responses and disconnecting…" : recovery.restart ? "Start a new run" : "Continue with the next method"}</p>
                {recovery.phase === "connect" && <>
                    <p className="text-sm">{recoveryNote ? recovery.note || recoveryNote : "New connection ready. Previous responses are preserved."}</p>
                    {walletState === "locked" && <p className="text-sm">Lock your wallet again before resuming this check.</p>}
                    <div className="flex flex-wrap gap-3">
                        {recoveryNote ? <CTAButton disabled={authConnection(walletRuntime).topic === recovery.original.topic} onClick={() => {
                            latestRuntime.current.open?.({ view: "Connect", namespace: "eip155" });
                        }}>Connect wallet</CTAButton> : <CTAButton disabled={!recovery.plan || blocked || gateBlocked} onClick={() => run(recovery.plan)}>
                            {recovery.restart ? walletState === "locked" ? "Wallet locked — start new run" : "Start new run" : walletState === "locked" ? "Wallet locked — resume" : "Resume with next method"}
                        </CTAButton>}
                        <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => {
                            recoveryRef.current = null; setRecovery(null); onReview?.();
                        }}>Review saved responses</button>
                    </div>
                </>}
            </div> : action === "runAuthBypass" ? <AuthRunPanel
                pending={isPending} manual={manualAuth} onManualChange={setManualAuth}
                delaySeconds={authDelaySeconds} onDelayChange={platform === "mobile" && step.canonicalId === "WSR-PERM-002~Mobile.v1" ? setAuthDelaySeconds : undefined}
                progress={authProgress} control={authControl.current} onRun={run}
                onNewRun={() => setAuthProgress(null)}
                onReconnect={transport === "walletconnect" ? reconnectAndResume : undefined}
                disabled={blocked || gateBlocked || mustDisconnect}
                label={label || buttonCfg.text || "Run Test"} hasRun={hasRun} onReview={onReview}
            /> : <div className="flex">
                <CTAButton onClick={run} disabled={!action || isPending || blocked || gateBlocked || mustDisconnect}>
                    {isPending ? "Waiting for wallet…" : label || buttonCfg.text || "Run Test"}
                </CTAButton>
            </div>}
            {action !== "runAuthBypass" && ["clearMethodSignRequest", "signPermitAndSeaport", "signLongMessageAndTypedData"].includes(action) && <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={manualRequests} disabled={isPending} onChange={(event) => setManualRequests(event.target.checked)} />Send requests one at a time
            </label>}
            {isPending && requestProgress?.phase === "ready" && <div className="space-y-2">
                <p className="text-sm">Next: <code>{requestProgress.method}</code></p>
                <CTAButton onClick={() => stepControl.current?.next()}>Send next request</CTAButton>
            </div>}
            {escape}
            {(gateBlocked || notes.length > 0) && (
                <div className="mt-4 space-y-2 border-t border-[var(--wsr-border)]/60 pt-4">
                    {gateBlocked && <ChainGate {...chainGate} />}
                    {notes}
                </div>
            )}
        </div>
    );
};

export default ActionPanel;
