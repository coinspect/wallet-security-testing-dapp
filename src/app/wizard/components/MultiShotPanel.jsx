"use client";

import React, { useEffect, useRef, useState } from "react";
import { Info, RotateCcw, Wallet } from "lucide-react";
import CTAButton from "./CTAButton";
import ActionResult from "./ActionResult";
import ChainGate from "./ChainGate";
import { handleAction } from "../../../utils/wallet-methods/actionMethods";
import { riskNote } from "../utils/resolveCheckParams";
import { useWalletRuntime } from "../context/WalletRuntimeContext";
import { getActiveProvider } from "../utils/selectedProvider";
import { DEFAULT_PLATFORM, INJECTED_NO_PROVIDER_NOTE, pendingReviewNote, resolveTransport } from "../utils/platform";
import { gatesOnAccount, walletStateGuidance } from "../utils/walletState";
import { getProviderIdentity, sameProvider } from "../utils/providerIdentity";
import {
    isReadFailure,
    isReconnectSignal,
    planWcConnect,
    WC_CONNECT_RECONNECT_NOTE,
} from "../utils/wcConnect";
import PersistedEvidence from "./PersistedEvidence";
import { createStepRun, skippedStepResult } from "../../../utils/wallet-methods/stepRun.mjs";

const short = (v) => `${v.slice(0, 10)}…${v.slice(-8)}`;

// The single captured value shown on a completed shot's done row.
const capturedValue = (shot) => {
    if (!shot?.ran) return null;
    if (shot.error != null) return "error";
    const r = shot.result;
    if (r && typeof r === "object") {
        if (r.request_outcome === 'skipped_by_tester') return 'Skipped by tester';
        if (r.request_outcome === 'stopped_waiting') return 'Stopped waiting by tester';
        if (r.contractAddress) return short(r.contractAddress);
        if (r.status === "chain_not_added") return "Unrecognized chain · 4902";
        if (r.status === "switch_cancelled") return "Switch prompt shown · Cancelled";
        if (r.status === "switched") return "Switched chain";
        if (r.status === "rejected_by_user") {
            return r.at === "chain_switch"
                ? "Network switch rejected · action not sent"
                : "Wallet prompt shown · Rejected by user";
        }
        if (r.hash) return short(r.hash);
        return "done";
    }
    if (typeof r === "string") {
        return /^0x[0-9a-fA-F]{64}$/.test(r)
            ? short(r)
            : r.length > 28
                ? `${r.slice(0, 28)}…`
                : r;
    }
    return "done";
};

const initShots = (subSteps) =>
    subSteps.map(() => ({ ran: false, pending: false, result: null, error: null, guard: null }));

/**
 * Right column for multi-shot checks (THRE-002, VERI-005, VERI-003). Shots
 * render in order: completed shots collapse to a compact done row (label +
 * captured value + re-run); the NEXT unrun shot is the only live CTA (marked
 * "SHOT N · NEXT"); later shots are muted/locked. A tab strip exposes each
 * shot's evidence without growing the page. Reports run progress to the page
 * (for the left column's shot markers).
 */
const MultiShotPanel = ({ subSteps, platform = DEFAULT_PLATFORM, chainId = null, chainGate = null, walletConnectSession = null, onActiveLabel, onAnyRan, manualAheadNote }) => {
    const [shots, setShots] = useState(() => initShots(subSteps));
    const [evidenceTab, setEvidenceTab] = useState(0);
    const shotsRef = useRef(shots);
    const runControl = useRef(null);
    const running = useRef(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; runControl.current?.stop(); };
    }, []);
    shotsRef.current = shots;
    // The page single-sources WalletConnect state for this panel and its network
    // gate, so both inspect and dispatch through the same provider.
    const wcSession = walletConnectSession;

    const activeShot = shots.findIndex((s) => !s.ran);
    const activeTransport = resolveTransport(platform, subSteps[Math.max(activeShot, 0)]);
    const { address: account, status } = useWalletRuntime(activeTransport);
    const hasAccount = account != null;

    // Wallet identity + full account set captured when the FIRST part runs, so
    // later parts can flag account/provider drift (the tester leaves the dApp
    // between parts and the wallet may switch account or the runner may be bound
    // to a different extension) and — for the revocation probe — whether a
    // baseline connection was ever established.
    const baselineRef = useRef(null);

    const patchShot = (i, patch) => {
        if (!alive.current || runControl.current?.signal.aborted) return;
        setShots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    };

    const readAccounts = async (control) => {
        try {
            const eth = control?.provider ?? getActiveProvider();
            const a = eth ? await eth.request({ method: "eth_accounts" }) : [];
            return Array.isArray(a) ? a : [];
        } catch {
            return [];
        }
    };

    // Snapshot the environment at part 1. "Established" = a real, non-empty
    // account grant for this origin (not merely that the request returned).
    const captureBaseline = async (control) => {
        const accounts = await readAccounts(control);
        if (control.signal.aborted || !alive.current) return;
        baselineRef.current = {
            accounts,
            norm: accounts.map((a) => a.toLowerCase()),
            account: accounts[0] ?? null,
            provider: getProviderIdentity(),
            established: accounts.length > 0,
        };
    };

    // Cross-part checks → { extra (runtime fields), warnings (panel notes) }.
    // Additive: nothing here blocks a run; it annotates one that may be invalid.
    const analyzeShot = async (i, action, result, control) => {
        const extra = {};
        const warnings = [];
        if (i === 0) return { extra, warnings }; // part 1: nothing earlier to compare

        const base = baselineRef.current;
        const provider = getProviderIdentity();
        if (provider) extra.provider = provider;

        // The account THIS part evaluated: for the probe, the stabilized
        // eth_accounts row; otherwise a fresh read.
        const rows = Array.isArray(result) ? result : [];
        const acctRow = rows.find((r) => r.method === "eth_accounts");
        const accounts = action === "runAuthBypass"
            ? (Array.isArray(acctRow?.data_returned) ? acctRow.data_returned : [])
            : await readAccounts(control);
        const account = accounts[0] ?? null;

        if (base) {
            if (base.account) extra.account_at_part_1 = base.account;
            if (account) extra.from = account;
            if (base.provider) extra.provider_at_part_1 = base.provider;

            if (!sameProvider(base.provider, provider) && base.provider && provider) {
                warnings.push(
                    `This part ran under ${provider.name}, but part 1 ran under ${base.provider.name} — the result may be attributed to the wrong wallet.`
                );
            }
            // Generic account drift — NOT for the revocation probe, where an
            // account change is the finding (handled by the revocation states).
            if (
                action !== "runAuthBypass" &&
                base.account && account &&
                base.norm[0] !== account.toLowerCase()
            ) {
                warnings.push(
                    "This part is running under a different account than part 1 — the result may not be comparable."
                );
            }
        }

        if (action === "runAuthBypass") {
            const established = !!base?.established;
            extra.baseline_established = established;
            if (base) extra.accounts_at_part_1 = base.accounts;
            if (!established) {
                warnings.push(
                    "Part 1 didn't establish a connection — an empty result here doesn't tell you anything about revocation."
                );
                extra.revocation = "no_baseline";
            } else if (acctRow?.outcome !== "resolved" && acctRow?.outcome !== "empty") {
                // Only a SETTLED eth_accounts reading can be classified — "resolved"
                // (returned accounts) OR "empty" (settled on []), which is exactly
                // the fully-revoked signal and falls through to the branch below.
                // Anything else (unstable / no_response / rejected / errored /
                // missing) is inconclusive, NOT an empty grant.
                if (acctRow?.outcome === "unstable") {
                    extra.revocation = "unstable";
                    warnings.push(
                        "The account state kept changing — the probe couldn't get a stable reading, so revocation is inconclusive."
                    );
                } else if (acctRow?.outcome === "no_response") {
                    extra.revocation = "no_response";
                    warnings.push("The wallet never answered eth_accounts — revocation is inconclusive.");
                } else {
                    extra.revocation = "inconclusive";
                    warnings.push("The probe couldn't read the account state — revocation is inconclusive.");
                }
            } else {
                const probe = accounts.map((a) => a.toLowerCase());
                const inBase = (a) => base.norm.includes(a);
                if (probe.length === 0) {
                    extra.revocation = "fully_revoked";
                } else if (probe.every(inBase) && probe.length < base.norm.length) {
                    extra.revocation = "partially_revoked";
                    warnings.push(
                        "Some accounts were revoked but not all — the origin still has access through the remaining ones."
                    );
                } else if (probe.length === base.norm.length && probe.every(inBase)) {
                    extra.revocation = "not_revoked";
                } else {
                    extra.revocation = "changed";
                }
            }
            // wallet_getPermissions: judge by an eth_accounts parentCapability,
            // not a non-empty array (a wallet may return unrelated permissions).
            const permRow = rows.find((r) => r.method === "wallet_getPermissions");
            if (permRow && Array.isArray(permRow.data_returned)) {
                extra.eth_accounts_permission_present = permRow.data_returned.some(
                    (p) => p?.parentCapability === "eth_accounts"
                );
            }
        }

        return { extra, warnings };
    };

    const runShotBody = async (i, control) => {
        const controlledProvider = control.provider;
        const sub = subSteps[i];
        const action = sub.ui.content.button?.action;
        if (!action) return;
        if (chainGate?.wrong) return; // held until the wallet is on the right chain

        // No pre-gate on the mount-read account: a stale/transient negative must
        // not block the click. The injected path below does a fresh eth_accounts
        // read at dispatch time (the real gate); if a provider exists we proceed
        // and let the wallet answer.

        patchShot(i, { guard: null });

        const params = { ...(sub.data?.params ?? {}) };

        // Transport is per-sub-step: mobile DEFAULTS to WalletConnect; only a
        // sub-step declaring transport:"injected" uses window.ethereum. Nothing
        // else on mobile reaches the injected provider (transport guarantee).
        const transport = resolveTransport(platform, sub);

        // WalletConnect path: open the pairing modal when there's no session, else
        // dispatch through the WC provider and re-open on a stale session.
        if (transport === "walletconnect") {
            const plan = planWcConnect(wcSession);
            if (plan.mode === "open") {
                wcSession.open?.();
                patchShot(i, { guard: plan.note });
                return;
            }
            patchShot(i, { pending: true, guard: null });
            let result = null;
            let err = null;
            try {
                result = await handleAction(platform, action, controlledProvider, {
                    ...params,
                    ...plan.params,
                });
            } catch (e) {
                err = e.message;
            }
            if (control.signal.aborted || !alive.current) return;
            if (isReconnectSignal(result)) {
                wcSession.open?.();
                patchShot(i, { pending: false, guard: WC_CONNECT_RECONNECT_NOTE });
                return;
            }
            if (isReadFailure(result)) {
                // A read (quote/pool/receipt) couldn't reach the network — show the
                // twin's neutral note, record nothing, never hit the error overlay.
                patchShot(i, { pending: false, guard: result.note });
                return;
            }
            const { extra, warnings } = await analyzeShot(i, action, result, control);
            if (control.signal.aborted || !alive.current) return;
            patchShot(i, { result, error: err, ran: true, pending: false, extra, warnings });
            if (i === 0) await captureBaseline(control);
            if (control.signal.aborted || !alive.current) return;
            setEvidenceTab(i);
            return;
        }

        // Injected path — extension campaign, or a mobile sub-step declaring
        // transport:"injected" (embedded browser). Both run the extension code on
        // the SELECTED provider.
        const injected = controlledProvider;
        if (typeof window === "undefined" || !injected) {
            patchShot(i, { guard: transport === "injected" ? INJECTED_NO_PROVIDER_NOTE : "No browser wallet detected." });
            return;
        }
        // Only the default "connected" state requires an account before running.
        if (gatesOnAccount(sub.walletState)) {
            try {
                const accounts = await injected.request({ method: "eth_accounts" });
                if (control.signal.aborted || !alive.current) return;
                if (!accounts || accounts.length === 0) {
                    patchShot(i, {
                        guard: "Connect your wallet first (use the Connect Wallet button in the header).",
                    });
                    return;
                }
            } catch (err) {
                if (control.signal.aborted || !alive.current) return;
                patchShot(i, { error: err.message, ran: true });
                setEvidenceTab(i);
                return;
            }
        }

        // `params` (with the deploy→approve hand-off) was computed above the
        // transport split and is reused here for the extension dispatch.
        patchShot(i, { pending: true, guard: null });
        let result = null;
        let err = null;
        try {
            // Extension campaign and mobile injected sub-steps both dispatch the
            // extension path over the SELECTED provider → dispatch as "extension".
            result = await handleAction("extension", action, injected, params);
        } catch (e) {
            err = e.message;
        }
        // Annotate this run against the part-1 baseline (drift / provider /
        // revocation), then — if this WAS part 1 — snapshot the baseline for
        // the parts that follow.
        if (control.signal.aborted || !alive.current) return;
        const { extra, warnings } = await analyzeShot(i, action, result, control);
        if (control.signal.aborted || !alive.current) return;
        // Chain at the moment this part fired — additive runtime.chain_id.
        const extraWithChain = chainId ? { ...extra, chain_id: chainId } : extra;
        patchShot(i, { result, error: err, ran: true, pending: false, extra: extraWithChain, warnings });
        if (i === 0) await captureBaseline(control);
        if (control.signal.aborted || !alive.current) return;
        setEvidenceTab(i);
    };

    const runShot = async (i) => {
        if (running.current || chainGate?.wrong) return;
        const transport = resolveTransport(platform, subSteps[i]);
        const plan = transport === 'walletconnect' ? planWcConnect(wcSession) : null;
        if (plan?.mode === 'open') { wcSession.open?.(); patchShot(i, { guard: plan.note }); return; }
        const provider = plan?.provider ?? getActiveProvider();
        const control = createStepRun(provider, { transport });
        runControl.current = control;
        running.current = true;
        patchShot(i, { pending: true });
        try {
            const result = await control.execute(() => runShotBody(i, control));
            if (alive.current && result?.request_outcome) {
                setShots((prev) => prev.map((shot, index) => index === i ? { ...shot, ran: true, pending: false, result, error: null } : shot));
                setEvidenceTab(i);
            }
        } finally {
            running.current = false;
            if (alive.current) setShots((prev) => prev.map((shot, index) => index === i ? { ...shot, pending: false } : shot));
        }
    };

    const tabShot = shots[evidenceTab];
    const tabSub = subSteps[evidenceTab];

    const activeSub = activeShot >= 0 ? subSteps[activeShot] : null;
    const activeState = activeShot >= 0 ? shots[activeShot] : null;
    const activeButton = activeSub ? activeSub.ui.content.button : null;
    const activeAction = activeSub ? activeSub.ui.content.button.action : null;
    const activeNote = riskNote(activeAction, activeSub?.data?.params?.methods);
    // Per sub-step: does the tester APPROVE this request or REJECT it? Defaults
    // to "reject"; only the connect/deploy hand-off parts declare "approve".
    const activeOutcome = activeSub?.expectedOutcome ?? "reject";
    // NOTE-ONLY (never disables the run button): only a CONFIRMED empty read
    // ("none") speaks; the transient "unknown" window does not. The run does a
    // fresh eth_accounts read at click time, so a stale negative can't block it.
    const activeAccountKnownAbsent = activeSub
        ? gatesOnAccount(activeSub.walletState) && status === "none"
        : false;
    // Wrong network for a requiredChain check → hold the live part until switched.
    const gateBlocked = !!chainGate?.wrong;
    const activeStateNote = activeSub
        ? (gatesOnAccount(activeSub.walletState)
            ? (activeAccountKnownAbsent ? walletStateGuidance(activeSub.walletState, false) : null)
            : walletStateGuidance(activeSub.walletState, hasAccount))
        : null;
    const anyRan = shots.some((s) => s.ran);

    // Notes shown BELOW the button (separated by a divider). The generic
    // "review, then reject" line was DELETED — the How-to-Test steps already say
    // to reject; the "approve" variant stays (approving is the unusual case).
    const AMBER = "flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.8125rem] font-medium leading-[1.15rem] border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]";
    const GRAY = "text-[0.875rem] leading-[1.25rem] text-[var(--wsr-fg-muted)]";
    const activeNotes = [];
    if (activeSub) {
        if (activeAccountKnownAbsent) {
            activeNotes.push(<p key="gated" className={AMBER}>{activeStateNote}</p>);
        } else {
            if (activeNote) activeNotes.push(<p key="risk" className={AMBER}>{activeNote}</p>);
            if (activeStateNote) activeNotes.push(<p key="state" className={AMBER}>{activeStateNote}</p>);
            if (activeOutcome === "approve") {
                activeNotes.push(
                    <p key="approve" className={GRAY}>
                        Approve this request in your wallet — the check needs it to proceed.
                    </p>
                );
            }
            if (activeState?.pending) {
                activeNotes.push(
                    <p key="pending" className={GRAY}>
                        {pendingReviewNote(resolveTransport(platform, activeSub))}
                    </p>
                );
            }
        }
        if (activeState?.guard) {
            activeNotes.push(
                <div
                    key="guard"
                    className="rounded-md border px-3 py-2 text-[0.8125rem] border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]"
                >
                    {activeState.guard}
                </div>
            );
        }
        if (manualAheadNote) {
            activeNotes.push(
                <p key="manual" className={`flex items-center gap-1.5 ${GRAY}`}>
                    <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {manualAheadNote}
                </p>
            );
        }
    }

    // Tell the page which button is live, so the left column's steps table can
    // subtly mark the matching row(s). Null once every part has run.
    useEffect(() => {
        onActiveLabel?.(activeButton?.text ?? null);
    }, [activeButton?.text, onActiveLabel]);

    // Report whether any part has recorded evidence, so the page can collapse
    // the left column's "Before you start" note once the check has run.
    useEffect(() => {
        onAnyRan?.(anyRan);
    }, [anyRan, onAnyRan]);

    // Tabs describe EVIDENCE state, not action state — the header above already
    // marks the live part "Part N of M". No ✓ (a check reads as "approved/passed").
    const tabsNode = (
        <div className="flex items-center gap-1" role="tablist">
            {subSteps.map((sub, i) => {
                const status = shots[i].ran ? "Recorded" : "Not run";
                return (
                    <button
                        key={sub.id}
                        type="button"
                        role="tab"
                        aria-selected={i === evidenceTab}
                        onClick={() => setEvidenceTab(i)}
                        className={`rounded px-2 py-1 font-mono text-[0.8125rem] tracking-tight transition-colors ${
                            i === evidenceTab
                                ? "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
                                : "text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
                        }`}
                    >
                        Part {i + 1} · {status}
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="flex flex-col gap-4">
            {/* Lighter header — folds the old "before you start" box and the
                in-card "Part N" status into one low-chrome band above the card. */}
            <div>
                <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 pb-1.5 dark:border-gray-700">
                    <h2 className="text-[1.25rem] font-semibold uppercase leading-[1.75rem] tracking-wide text-gray-600 dark:text-gray-300">
                        Current action
                    </h2>
                    {activeSub && (
                        <span className="shrink-0 font-mono text-[0.8125rem] text-gray-500 dark:text-gray-400">
                            Part {activeShot + 1} of {subSteps.length}
                        </span>
                    )}
                </div>
            </div>

            {/* (a) CURRENT action card. */}
            {shots.some((shot) => shot.pending) && <button type="button" className="min-h-11 text-sm underline" onClick={() => runControl.current?.stop()}>Stop waiting and continue</button>}
            {activeSub ? (
                <div className="rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-5">
                    {/* Keep the primary action first and left-aligned. */}
                    <div className="flex">
                        <CTAButton
                            onClick={() => runShot(activeShot)}
                            disabled={activeState.pending || gateBlocked}>
                            {activeState.pending ? "Waiting for wallet…" : activeButton.text || "Run"}
                        </CTAButton>
                    </div>
                    {!running.current && <button type="button" className="min-h-11 text-sm underline" onClick={() => {
                        runControl.current = null;
                        patchShot(activeShot, { ran: true, result: skippedStepResult(), error: null });
                        setEvidenceTab(activeShot);
                    }}>Skip step</button>}
                    {(gateBlocked || activeNotes.length > 0) && (
                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                            {gateBlocked && <ChainGate {...chainGate} />}
                            {activeNotes}
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-[0.8125rem] text-gray-500 dark:text-gray-400">
                    All parts run — review each part&apos;s evidence below.
                </p>

            )}

            {/* (b) RECORDED RUNS — compact, neutral, one line per completed part. */}
            {anyRan && (
                <div>
                    <div className="mb-1 text-[0.8125rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Recorded runs
                    </div>
                    <div className="space-y-1">
                        {subSteps.map((sub, i) => {
                            if (!shots[i].ran) return null;
                            const label = sub.actionLabel || sub.ui.content.button.text;
                            return (
                                <div
                                    key={sub.id}
                                    className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800/40"
                                >
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Info className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
                                        <span className="truncate text-sm text-gray-700 dark:text-gray-200">
                                            {label}
                                        </span>
                                        <span className="truncate font-mono text-[0.8125rem] text-gray-500 dark:text-gray-400">
                                            {capturedValue(shots[i])}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => runShot(i)}
                                        disabled={shots[i].pending}
                                        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[0.8125rem] font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
                                    >
                                        <RotateCcw className="h-3 w-3" />
                                        Re-run
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* (c) EVIDENCE — ONE bordered region: [tabs · Copy value] header,
                then the result line + collapsible JSON. */}
            {tabShot?.ran ? (
                <div className="flex flex-col gap-2">
                    {tabShot.warnings?.length > 0 && (
                        <div className="space-y-1.5">
                            {tabShot.warnings.map((w, i) => (
                                <p
                                    key={i}
                                    className="flex items-start gap-2 rounded-md border px-3 py-2 text-[0.8125rem] leading-[1.15rem] border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]"
                                >
                                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span>{w}</span>
                                </p>
                            ))}
                        </div>
                    )}
                    <ActionResult
                        error={tabShot.error}
                        success={tabShot.result}
                        step={tabSub}
                        onRetry={() => runShot(evidenceTab)}
                        tabs={tabsNode}
                        extraRuntime={tabShot.extra}
                    />
                </div>
            ) : (
                <div className="space-y-2">
                    {!anyRan && (
                        <PersistedEvidence
                            checkId={subSteps[0]?.canonicalId ?? subSteps[0]?.id}
                            platform={platform}
                        />
                    )}
                    <div className="rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)]">
                        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-700">
                            <div className="min-w-0 flex-1">{tabsNode}</div>
                        </div>
                        <div className="px-3 py-2">
                            <p className="text-[0.875rem] leading-[1.25rem] text-gray-500 dark:text-gray-400">
                                No new evidence for this part. Run Part {evidenceTab + 1} to create it.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MultiShotPanel;
