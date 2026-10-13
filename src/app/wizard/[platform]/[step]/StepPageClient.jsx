"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router";
import ProgressBar from "../../components/ProgressBar";
import LoadingState from "../../components/LoadingState";
import StepRenderer from "../../components/StepRenderer";
import WizardParamsPanel from "../../components/WizardParamsPanel";
import WizardStepHeader from "../../components/WizardStepHeader";
import ActionPanel from "../../components/ActionPanel";
import EvidencePanel from "../../components/EvidencePanel";
import MultiShotPanel from "../../components/MultiShotPanel";
import ConnectedDappCheck from "../../components/ConnectedDappCheck";
import GuidedComparisonCheck from "../../components/GuidedComparisonCheck";
import GuidedRequestCheck from "../../components/GuidedRequestCheck";
import { GUIDED_REQUESTS } from "../../utils/guidedRequests.mjs";
import { GUIDED_COMPARISONS } from "../../utils/guidedComparison.mjs";
import UnknownAddressPicker from "../../components/UnknownAddressPicker";
import PreconditionNote from "../../components/PreconditionNote";
import NoteBadge from "../../components/NoteBadge";
import AddressField, { isValidAddress } from "../../components/AddressField";
import { resolveCheckParams } from "../../utils/resolveCheckParams";
import { checkTitle } from "../../utils/checkMeta";
import { usePlatform } from "../../context/PlatformContext";
import { resolveCheckKey, campaignHoldingBase, baseCheckId, canonicalCheckBase, DEFAULT_PLATFORM, PLATFORM_LABEL, resolveTransport } from "../../utils/platform";
import { gatesOnAccount } from "../../utils/walletState";
import { hasUnknownPool, findCandidate, DEFAULT_UNKNOWN_CANDIDATE } from "../../utils/unknownPool";
import { useWalletConnectSession } from "../../utils/wcConnect";
import { useWalletRuntime } from "../../context/WalletRuntimeContext";
import { actionToString } from "../../utils/actionText";
import { testParams } from "@/utils/constants";
import { POLYGON_CHAIN_ID } from '@/utils/wallet-methods/polygonPolicy.mjs';
import { normalizeChainId } from "@/utils/wallet-methods/chainId.mjs";
import wizardConfig from "../../config/wizard";

// Checks that must run on a throwaway wallet get the dedicated-test-wallet note.
// PHYS-002 sets/changes credentials; PHYS-001/003/005 reveal or copy the secret.
// PHYS-006 (auto-lock) touches no secret, so it is intentionally excluded.
const DEDICATED_WALLET_NOTE_CHECKS = new Set([
    "WSR-PHYS-002~Browser.v1",
    "WSR-PHYS-002~Mobile.v1",
    "WSR-PHYS-001.v1",
    "WSR-PHYS-003.v1",
    "WSR-PHYS-005.v1",
]);

// A step whose action is a BROWSER navigation (opening a URL, switching or
// closing a tab) rather than a wallet interaction — so it isn't mislabelled
// "In your wallet". A bare "open" is NOT enough (wallet steps say "open the
// seed screen"); it needs a domain/URL, or an explicit tab/browser word.
const BROWSER_ACTION = /\bbrowser\b|\btabs?\b|https?:\/\/|\b[a-z0-9-]+\.(?:org|com|xyz|io|net|app)\b/i;

export default function StepPage() {
    const { step: routeStep } = useParams();
    const step = canonicalCheckBase(routeStep) ?? routeStep;

    const platformCtx = usePlatform();
    const platform = platformCtx?.platform ?? DEFAULT_PLATFORM;
    // Until the persisted campaign is resolved (post-mount), hold LoadingState so
    // the page renders the CORRECT campaign directly — no extension→mobile flash
    // of the wrong variant / dot count.
    const platformReady = platformCtx?.ready ?? true;
    const [error, setError] = useState(null);
    const [isClient, setIsClient] = useState(false);
    const [paramsOpen, setParamsOpen] = useState(false);
    // Single-action outcome (multi-shot state lives in <MultiShotPanel>).
    const [runningResult, setRunningResult] = useState(null);
    const [runningError, setRunningError] = useState(null);
    // A single-shot run in flight (before its result/error lands) — keeps the
    // active step on the post-action row while the wallet prompts, so the right
    // card doesn't flip back to the CTA mid-run.
    const [isRunning, setIsRunning] = useState(false);
    // Whether a multi-shot check has recorded any evidence (reported up by
    // <MultiShotPanel>) — used only to collapse the left column's precondition.
    const [multiAnyRan, setMultiAnyRan] = useState(false);
    // Which multi-shot button is live — reported up by <MultiShotPanel> so the
    // left column's steps table can highlight the matching row.
    const [activeButtonLabel, setActiveButtonLabel] = useState(null);
    // THRE-005 unknown-address pool selection (registry key of the candidate).
    const [unknownCandidate, setUnknownCandidate] = useState(DEFAULT_UNKNOWN_CANDIDATE);
    // PERM-008 tester-provided address (prefilled from the last seen account).
    const [providedAddress, setProvidedAddress] = useState("");
    // Last address persisted while connected — lets the LOCKED auth-bypass check
    // build valid requests even though eth_accounts is empty when locked.
    const [persistedLastAddress, setPersistedLastAddress] = useState(null);
    // Tester-local fallback for Mobile setup rows. It only advances the visual
    // instructions; the action panel still requires a real provider before it
    // can dispatch or record anything.
    const [manualMobileSteps, setManualMobileSteps] = useState(() => new Set());
    // Whether a manual "Switch to Polygon" is in flight (disables that button).
    const [switchingChain, setSwitchingChain] = useState(false);
    const [networkError, setNetworkError] = useState(null);
    // Chain snapshot taken when a single-shot action fires, recorded in evidence.
    const [ranChainId, setRanChainId] = useState(null);

    // The `[step]` segment is the BASE check id (e.g. "WSR-PERM-010"); the
    // active campaign resolves the actual checks{} key (variant). A check may
    // have >1 sub-step (multi-shot); the explanation renders from the first.
    const resolvedKey = resolveCheckKey(step, platform);
    const currentCheck = resolvedKey ? wizardConfig.wizard.checks[resolvedKey] : null;
    const guidedComparison = GUIDED_COMPARISONS[currentCheck?.canonicalId];
    const guidedRequest = GUIDED_REQUESTS[currentCheck?.canonicalId];
    const subSteps = currentCheck?.steps ?? [];
    const isMulti = subSteps.length > 1;
    const explainStep = subSteps[0];
    const transport = resolveTransport(platform, explainStep);
    const runtime = useWalletRuntime(transport);
    // One WalletConnect subscription for the application; panels receive this
    // same runtime object so account, provider and chain cannot drift.
    const wcSession = useWalletConnectSession();
    const chainId = normalizeChainId(runtime.chainId);
    const connectedAccount = runtime.address ?? null;
    const hasConnectedWallet = transport === "walletconnect"
        ? Boolean(runtime.provider)
        : Boolean(runtime.address);
    // Wizard-button labels across all sub-steps, so the steps table can pill
    // the ones referenced in each action ("Click Connect this dApp").
    const buttonLabels = subSteps
        .map((s) => s.ui?.content?.button?.text)
        .filter(Boolean);
    // Clear the active-row highlight when navigating between checks.
    useEffect(() => setActiveButtonLabel(null), [step]);

    // Per-step-row metadata for the left column: whether the row is a WIZARD
    // action (references a sub-step's button) or a manual WALLET step, and the
    // RPC method (for the row's Technical details). Derived — nothing hand-set.
    const stepRows = explainStep?.ui?.content?.steps ?? [];
    const stepsMeta = stepRows.map((row) => {
        // Normalise once: string stays itself, an array of clauses joins to one
        // string, so the button-label match and BROWSER_ACTION test are unchanged.
        const actionStr = actionToString(row.action);
        const sub = subSteps.find((ss) => {
            const t = ss.ui?.content?.button?.text;
            return t && actionStr.includes(t);
        });
        const source = sub
            ? "wizard"
            : BROWSER_ACTION.test(actionStr)
                ? "browser"
                : "wallet";
        // Technical details shows the REAL RPC. For the auth-bypass batch that's
        // the declared methods in fire order (not the internal "auth_bypass_batch"
        // resolveCheckParams returns); otherwise the single JSON-RPC method.
        let rpc = null;
        if (sub) {
            rpc = sub.ui?.content?.button?.action === "runAuthBypass"
                ? (sub.data?.params?.methods ?? [])
                : resolveCheckParams(sub).method;
        }
        return { source, rpc };
    });
    // Active-step + manual-stretch derivation lives BELOW the block flags — it
    // needs to know whether the live action is currently runnable.

    const handleRunStart = useCallback(() => {
        setRunningResult(null);
        setRunningError(null);
    }, []);

    useEffect(() => {
        setIsClient(true);
    }, []);

    // Prefill the PERM-008 address field + capture the persisted last-known
    // address (used to gate the locked auth-bypass check).
    useEffect(() => {
        if (typeof window === "undefined") return;
        const last = window.localStorage.getItem("wizard.lastAddress");
        setPersistedLastAddress(last || null);
        if (last) setProvidedAddress(last);
    }, []);

    // WalletConnect addresses do not pass through the injected AccountProvider.
    // Persist the AppKit/RPC-resolved address through the same last-address path
    // used by locked/disconnected auth checks.
    useEffect(() => {
        if (platform !== "mobile" || !wcSession.address || typeof window === "undefined") return;
        try {
            window.localStorage.setItem("wizard.lastAddress", wcSession.address);
        } catch {
            /* storage unavailable — non-fatal */
        }
        setPersistedLastAddress(wcSession.address);
    }, [platform, wcSession.address]);

    // Reset outcome + pool selection when the check route changes.
    useEffect(() => {
        setRunningResult(null);
        setRunningError(null);
        setIsRunning(false);
        setMultiAnyRan(false);
        setRanChainId(null);
        setUnknownCandidate(DEFAULT_UNKNOWN_CANDIDATE);
        setManualMobileSteps(new Set());
    }, [step, platform]);

    // (Removed the cross-campaign auto-switch effect: the URL no longer carries
    // a platform, and it fought manual campaign switches — a ~Browser check
    // yanked the mode back to Extension the instant you clicked Mobile.)

    // NavStatusStrip's chain badge dispatches `sentinel:inspector-toggle`
    // globally; here it flips the read-only params panel.
    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const onToggle = () => setParamsOpen((v) => !v);
        window.addEventListener("sentinel:inspector-toggle", onToggle);
        return () => window.removeEventListener("sentinel:inspector-toggle", onToggle);
    }, []);

    // Rebroadcast `sentinel:inspector-state` so the header chip glow stays in sync.
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
            new CustomEvent("sentinel:inspector-state", { detail: { open: paramsOpen } })
        );
    }, [paramsOpen]);

    const handleStepError = useCallback((message) => {
        setError(message);
    }, []);

    // Polygon is the starting network for every check, including PERM-009.
    // Setup is separate from the measurement: never switch back automatically
    // after a test request or trigger an unlock prompt on a locked check visit.
    const requiredChain = POLYGON_CHAIN_ID;
    const chainProvider = runtime.provider;
    const onWrongChain =
        !!requiredChain &&
        !!chainProvider &&
        chainId !== requiredChain;
    const runSwitch = async () => {
        if (!runtime.switchToPolygon || switchingChain || runtime.networkSetup?.busy) return;
        setSwitchingChain(true);
        setNetworkError(null);
        try {
            await runtime.switchToPolygon();
        } catch (err) {
            setNetworkError(err.message);
        } finally {
            setSwitchingChain(false);
        }
    };

    if (!isClient || !platformReady) {
        return <LoadingState />;
    }

    // Base id has no variant in the active campaign → don't 404; point the
    // tester at the campaign that holds it (they switch via the navbar).
    if (!explainStep) {
        const otherCampaign = campaignHoldingBase(step);
        if (!otherCampaign) return <LoadingState />;
        return (
            <div className='wizard-surface flex flex-col font-[var(--default-font)]'>
                <ProgressBar currentStep={step} platform={platform} />
                <div className='mx-auto w-full max-w-7xl px-3 pt-16 sm:px-4 lg:px-6'>
                    <div className='mx-auto max-w-[60ch] rounded-lg border border-gray-200 bg-surface-light p-6 text-center dark:border-gray-700 dark:bg-dark-surface'>
                        <h2 className='text-[1.25rem] font-semibold text-gray-800 dark:text-gray-200'>
                            Not in the {PLATFORM_LABEL[platform]} campaign
                        </h2>
                        <p className='mt-2 text-[0.9375rem] leading-6 text-gray-600 dark:text-gray-400'>
                            This check belongs to the {PLATFORM_LABEL[otherCampaign]} campaign. Switch
                            campaigns in the navbar to open it.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // walletOnly checks have no dApp action: no button, RPC, params or evidence.
    // Single source is the check-level `walletOnly` flag (drives layout + the
    // per-step done toggles); the `isWalletUi` name is kept locally.
    const isWalletUi = currentCheck?.walletOnly === true;

    // THRE-005 only: pick the send target from the documented unknown pool.
    const singleAction = explainStep.ui?.content?.button?.action;
    const showUnknownPool = !isWalletUi && hasUnknownPool(singleAction);
    const unknownTargetAddress = showUnknownPool ? findCandidate(unknownCandidate).address : null;

    // PERM-008 (disconnected auth-bypass): the ONE text input in the wizard.
    const needsAddressField = singleAction === "runAuthBypass" && explainStep.walletState === "disconnected";
    const addressValid = isValidAddress(providedAddress);

    // Auth-bypass checks WITHOUT the field (PERM-010 connected, PERM-002 locked)
    // need a resolvable address so the batch builds valid params. Available if a
    // wallet is connected now, or an address was persisted while connected.
    const authNeedsResolvedAccount = singleAction === "runAuthBypass" && !needsAddressField;
    const authAddressMissing =
        authNeedsResolvedAccount && !connectedAccount && !persistedLastAddress;
    const actionBlocked = (needsAddressField && !addressValid) || authAddressMissing;
    const actionBlockedNote = authAddressMissing
        ? "Connect your wallet once before running this check, then lock it — the batch needs your address to build valid requests."
        : undefined;

    // Which precondition, if any, is blocking the live single-shot action —
    // reusing the SAME flags the panel uses to disable its button. Two kinds,
    // because they resolve at DIFFERENT steps:
    //  - CONNECTION blocker → the connect/setup step (FIRST pre-action step):
    //      the walletState:"connected" account gate, or an auth-bypass batch with
    //      no address source at all (never connected, nothing persisted). This
    //  - ADDRESS-FIELD blocker → the "confirm your address" step (LAST pre-action
    //      step): PERM-008 has an address source but the field value is invalid.
    //  Connection wins if both — you can't fill a valid address without ever
    //  having connected. isPending is transient, not a precondition.
    const actionAccountGated = gatesOnAccount(explainStep.walletState) && !hasConnectedWallet;
    const noAddressSource = !connectedAccount && !persistedLastAddress;
    const hardAddressSourceBlocked = singleAction === "runAuthBypass" && noAddressSource;
    const connectionBlocked =
        actionAccountGated || hardAddressSourceBlocked;
    const addressFieldBlocked = needsAddressField && !addressValid && !noAddressSource;

    // The ACTIVE step: the live part in a multi-part check (via activeButtonLabel),
    // else the first not-yet-run wizard action. If a precondition blocks it,
    // highlight the step that RESOLVES that specific blocker instead of the
    // disabled action row. Clears on its own once the blocker lifts.
    const firstWizardIdx = stepsMeta.findIndex((m) => m.source === "wizard");
    // "Ran" for active-step purposes INCLUDES a run in flight — so the active
    // step advances to the post-action row the instant the CTA is pressed and
    // stays there through the wallet round-trip (and any re-run).
    const singleRan = !isMulti && (runningResult != null || runningError != null || isRunning);
    // Blocker target: connection → first non-wizard pre-action step;
    // address-field → last non-wizard pre-action step (-1 if there is none).
    let blockerTarget = -1;
    if (!isWalletUi && singleAction && connectionBlocked) {
        for (let i = 0; i < firstWizardIdx; i += 1) {
            if (
                stepsMeta[i].source !== "wizard" &&
                // Mobile WalletConnect setup can be advanced by hand when a
                // wallet does not expose connection state. This never bypasses
                // the hard address requirement of an auth-bypass payload.
                !(
                    platform === "mobile" &&
                    transport === "walletconnect" &&
                    !hardAddressSourceBlocked &&
                    manualMobileSteps.has(i)
                )
            ) {
                blockerTarget = i;
                break;
            }
        }
    } else if (!isWalletUi && singleAction && addressFieldBlocked) {
        for (let i = firstWizardIdx - 1; i >= 0; i -= 1) {
            if (stepsMeta[i].source !== "wizard") { blockerTarget = i; break; }
        }
    }
    let activeStepIndex = 0;
    if (isMulti && activeButtonLabel) {
        const i = stepRows.findIndex(
            (s) => actionToString(s.action).includes(activeButtonLabel)
        );
        activeStepIndex = i >= 0 ? i : Math.max(firstWizardIdx, 0);
    } else if (firstWizardIdx < 0) {
        activeStepIndex = 0;
    } else if (singleRan) {
        activeStepIndex = Math.min(firstWizardIdx + 1, stepRows.length - 1);
    } else if (blockerTarget >= 0) {
        activeStepIndex = blockerTarget;
    } else {
        activeStepIndex = firstWizardIdx;
    }
    // Manual stretch immediately after the active step → a one-line card summary.
    // Counts non-wizard steps (wallet AND browser); phrased "inside your wallet"
    // only when the whole stretch is wallet, else "outside the wizard".
    let manualAhead = 0;
    let manualHasBrowser = false;
    for (let i = activeStepIndex + 1; i < stepsMeta.length && stepsMeta[i].source !== "wizard"; i += 1) {
        manualAhead += 1;
        if (stepsMeta[i].source === "browser") manualHasBrowser = true;
    }
    const manualAheadNote =
        manualAhead > 0
            ? `Next: ${manualAhead} step${manualAhead > 1 ? "s" : ""} ${
                  manualHasBrowser ? "outside the wizard" : "inside your wallet"
              }.`
            : null;

    // The right card renders from this SAME active step: wizard surface → the
    // primary CTA; wallet/browser surface → the observing state (surface label +
    // the step's instruction). Both derive from activeStepIndex — no re-implement.
    const activeSurface = stepsMeta[activeStepIndex]?.source ?? "wizard";
    // Only truthiness-guarded downstream today, but normalise so it is always a
    // string (never a raw array) if it is ever rendered later.
    const activeInstruction = actionToString(stepRows[activeStepIndex]?.action) || null;
    // The auth-bypass checks (single-shot, action "runAuthBypass") record a wide
    // 7-row results table. It reads far better across the full content width than
    // squeezed into the 55% right column, so its evidence panel drops out of the
    // right column and renders full-width BELOW the two-column grid. Derived from
    // the check's own fire action — the two-column layout is untouched for all
    // other checks.
    const isAuthBypassCheck = explainStep?.ui?.content?.button?.action === "runAuthBypass";
    const wideEvidence = !isMulti && isAuthBypassCheck;
    // Collapse the left precondition note once the check has been run. Single:
    // reuse singleRan (stays true through a re-run, so the note doesn't flicker
    // open/closed). Multi: whether any part has recorded evidence.
    const hasEvidence = isMulti ? multiAnyRan : singleRan;

    // Per-run params passed to the action, and the per-run runtime recorded in
    // evidence — coherent across the two checks that carry extras.
    const actionParams = showUnknownPool
        ? { targetAddress: unknownTargetAddress }
        : needsAddressField
            ? { providedAddress: providedAddress.trim() }
            : undefined;
    const extraRuntime = (() => {
        const base = showUnknownPool
            ? { unknown_candidate: unknownCandidate }
            : needsAddressField
                ? { provided_address: providedAddress.trim() }
                : {};
        // Chain at the moment the action fired — additive runtime.chain_id.
        if (ranChainId) base.chain_id = ranChainId;
        return Object.keys(base).length > 0 ? base : undefined;
    })();
    const seedNote = DEDICATED_WALLET_NOTE_CHECKS.has(explainStep.canonicalId)
        ? "⚠ Use a dedicated test wallet"
        : null;
    // Generic "Before you start" precondition, declared per-step (only where
    // needed). A `shortcut` key is resolved to its registry URL — a one-click
    // SETUP open of a second dApp (no action, no evidence).
    const rawPrecondition = explainStep.ui?.content?.precondition ?? null;
    const precondition = rawPrecondition
        ? {
            ...rawPrecondition,
            shortcut: rawPrecondition.shortcut
                ? testParams.find((p) => p.key === rawPrecondition.shortcut)?.value
                : undefined,
        }
        : null;

    // Unknown or non-Polygon networks hold all test actions. The connection
    // setup handles new sessions; this button handles existing/wrong sessions.
    const chainGate = requiredChain
        ? {
            wrong: onWrongChain,
            chainName: "Polygon",
            autoSwitching: runtime.networkSetup?.busy,
            switching: switchingChain,
            error: networkError || runtime.networkSetup?.error,
            onSwitch: runSwitch,
        }
        : null;

    return (
        <div className='wizard-surface flex flex-col font-[var(--default-font)]'>
            {/* Two-column checks: navigator + header span the wide band at the top.
                walletOnly checks render BOTH inside their single column instead
                (below), so the navigator, title, and steps share one left edge +
                max-width. */}
            {!isWalletUi && <ProgressBar currentStep={step} platform={platform} />}

            {!isWalletUi && currentCheck.presentation !== "connection-management" && !guidedComparison && !guidedRequest && (
                <WizardStepHeader
                    checkId={explainStep.canonicalId}
                    title={checkTitle(explainStep)}
                />
            )}

            {paramsOpen && (
                <div className='mx-auto w-full max-w-7xl px-3 pt-2 sm:px-4 lg:px-6'>
                    <WizardParamsPanel stepConfig={explainStep} walletUi={isWalletUi} />
                </div>
            )}

            {/* ONE page-level scroll — no nested column scrollers; panels size to
                their content. walletOnly checks use a single narrow column that
                the header shares; two-column checks use the wide grid. */}
            {currentCheck.presentation === "connection-management" ? (
                <ConnectedDappCheck key={`${step}:${platform}`} check={currentCheck} platform={platform} />
            ) : guidedComparison ? (
                <GuidedComparisonCheck key={`${step}:${platform}`} check={currentCheck} presentation={guidedComparison} platform={platform} chainGate={chainGate} />
            ) : guidedRequest ? (
                <GuidedRequestCheck key={`${step}:${platform}`} step={explainStep} presentation={guidedRequest} platform={platform}
                    targetAddress={showUnknownPool ? unknownTargetAddress : undefined} extraRuntime={extraRuntime}
                    preparation={<>
                        {showUnknownPool && <UnknownAddressPicker selected={unknownCandidate} onSelect={setUnknownCandidate} provider={runtime.provider} chainId={chainId} />}
                        {needsAddressField && <AddressField value={providedAddress} onChange={setProvidedAddress} />}
                    </>}
                    actionProps={{ params: actionParams, blocked: actionBlocked, blockedNote: actionBlockedNote, chainGate, walletConnectSession: wcSession }} />
            ) : isWalletUi ? (
                /* walletOnly: ONE shared column — header, precondition, and the
                   HOW TO TEST block all sit at the same left edge + max-width, at
                   every viewport width. No action card, no evidence line. */
                <div className='mx-auto w-full max-w-3xl pb-12 pt-1 md:px-4 md:pb-24 md:pt-6'>
                    <ProgressBar currentStep={step} platform={platform} contained={false} />
                    <div className='mt-4 md:mt-10'>
                        <WizardStepHeader
                            checkId={explainStep.canonicalId}
                            title={checkTitle(explainStep)}
                            contained={false}
                            wrapTitle
                        />
                    </div>
                    <div className='mt-6'>
                        {seedNote && (
                            <div className='mb-5'>
                                <NoteBadge>{seedNote}</NoteBadge>
                            </div>
                        )}
                        {precondition && (
                            <div className='mb-5'>
                                <PreconditionNote key={step} {...precondition} platform={platform} collapsed={hasEvidence} />
                            </div>
                        )}
                        <StepRenderer
                            key={`${explainStep.canonicalId}:${platform}`}
                            stepConfig={explainStep}
                            onError={handleStepError}
                            walletUi={isWalletUi}
                            platform={platform}
                            buttonLabels={buttonLabels}
                            stepsMeta={stepsMeta}
                            activeStepIndex={activeStepIndex}
                            manualDone={manualMobileSteps}
                            onToggleManualDone={(index) => {
                                setManualMobileSteps((previous) => {
                                    const next = new Set(previous);
                                    next.has(index) ? next.delete(index) : next.add(index);
                                    return next;
                                });
                            }}
                        />
                    </div>
                </div>
            ) : (
                <div className='mx-auto w-full max-w-7xl px-3 pt-12 sm:px-4 sm:pt-16 lg:px-6'>
                    <div className='grid grid-cols-1 items-start gap-10 md:grid-cols-[45%_55%]'>
                        {/* LEFT — instructions. "Before you start" sits ABOVE step 01
                            and collapses to one line once the check has evidence. */}
                        <div className='min-w-0'>
                            {precondition && (
                                <div className='mb-5'>
                                    <PreconditionNote key={step} {...precondition} platform={platform} collapsed={hasEvidence} />
                                </div>
                            )}
                            <StepRenderer
                                stepConfig={explainStep}
                                onError={handleStepError}
                                walletUi={isWalletUi}
                                platform={platform}
                                buttonLabels={buttonLabels}
                                stepsMeta={stepsMeta}
                                activeStepIndex={activeStepIndex}
                                manualProgress={
                                    platform === "mobile" &&
                                    transport === "walletconnect" &&
                                    actionAccountGated &&
                                    !hardAddressSourceBlocked
                                }
                                manualDone={manualMobileSteps}
                                onToggleManualDone={(index) => {
                                    setManualMobileSteps((previous) => {
                                        const next = new Set(previous);
                                        next.has(index) ? next.delete(index) : next.add(index);
                                        return next;
                                    });
                                }}
                            />
                        </div>

                        {/* RIGHT — dApp checks act + record evidence here. */}
                        <div className='flex min-w-0 flex-col gap-4'>
                            {isMulti ? (
                                // Multi-shot renders its OWN lighter header (live "Part N")
                                // above its action card; the precondition lives left.
                                <MultiShotPanel
                                    key={step}
                                    subSteps={subSteps}
                                    platform={platform}
                                    chainId={chainId}
                                    chainGate={chainGate}
                                    walletConnectSession={wcSession}
                                    onActiveLabel={setActiveButtonLabel}
                                    onAnyRan={setMultiAnyRan}
                                    manualAheadNote={manualAheadNote}
                                />
                            ) : (
                                <>
                                    {/* Lighter header: title only, no box — one action
                                        surface + evidence panel below. */}
                                    <div>
                                        <h2 className='border-b border-gray-200 pb-1.5 text-[1.25rem] font-semibold uppercase leading-[1.75rem] tracking-wide text-gray-600 dark:border-gray-700 dark:text-gray-300'>
                                            Current action
                                        </h2>
                                    </div>
                                    {showUnknownPool && (
                                        <UnknownAddressPicker
                                            selected={unknownCandidate}
                                            onSelect={setUnknownCandidate}
                                        />
                                    )}
                                    {needsAddressField && (
                                        <AddressField
                                            value={providedAddress}
                                            onChange={setProvidedAddress}
                                        />
                                    )}
                                    <ActionPanel
                                        step={explainStep}
                                        platform={platform}
                                        params={actionParams}
                                        blocked={actionBlocked}
                                        blockedNote={actionBlockedNote}
                                        manualAheadNote={manualAheadNote}
                                        activeSurface={activeSurface}
                                        activeInstruction={activeInstruction}
                                        hasRun={singleRan}
                                        chainGate={chainGate}
                                        walletConnectSession={wcSession}
                                        onRunStart={() => {
                                            setRunningResult(null);
                                            setRunningError(null);
                                            setIsRunning(true);
                                            setRanChainId(chainId);
                                        }}
                                        onResult={(r) => {
                                            setRunningResult(r);
                                            setIsRunning(false);
                                        }}
                                        onError={(e) => {
                                            setRunningError(e);
                                            setIsRunning(false);
                                        }}
                                    />
                                    {/* Non-table evidence stays in the right column;
                                        the auth-bypass table renders full-width below. */}
                                    {!wideEvidence && (
                                        <EvidencePanel
                                            error={runningError}
                                            success={runningResult}
                                            step={explainStep}
                                            onRetry={handleRunStart}
                                            extraRuntime={extraRuntime}
                                            targetAddress={showUnknownPool ? unknownTargetAddress : undefined}
                                            platform={platform}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                    {/* Full-width evidence — the wide auth-bypass results table gets
                        the whole content width instead of the 55% column. */}
                    {wideEvidence && (
                        <div className='mt-8'>
                            <EvidencePanel
                                error={runningError}
                                success={runningResult}
                                step={explainStep}
                                onRetry={handleRunStart}
                                extraRuntime={extraRuntime}
                                targetAddress={showUnknownPool ? unknownTargetAddress : undefined}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
