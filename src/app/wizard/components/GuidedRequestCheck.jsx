"use client";

import { useRef, useState } from "react";
import ActionPanel from "./ActionPanel";
import ActionResult from "./ActionResult";
import PersistedEvidence from "./PersistedEvidence";
import WizardStepHeader from "./WizardStepHeader";
import RecipientAddress from "./RecipientAddress";
import SkipStepButton from "./SkipStepButton";
import { checkTitle } from "../utils/checkMeta";
import { useWalletRuntime } from "../context/WalletRuntimeContext";
import { resolveTransport } from "../utils/platform";
import { getProviderIdentity } from "../utils/providerIdentity";
import { sameGuidedContext } from "../utils/guidedComparison.mjs";
import { testParams } from "@/utils/constants";

const contextOf = (runtime) => ({ provider: runtime.provider, topic: runtime.provider?.session?.topic, address: runtime.address, chainId: runtime.chainId });

export default function GuidedRequestCheck({ step, presentation, platform, preparation, actionProps, targetAddress, extraRuntime }) {
    const [phase, setPhase] = useState(0);
    const [busy, setBusy] = useState(false);
    const [run, setRun] = useState(null);
    const capture = useRef(null);
    const transport = resolveTransport(platform, step);
    const runtime = useWalletRuntime(transport);
    const latest = useRef(runtime);
    latest.current = runtime;
    const actionIndex = presentation.stages.findIndex((stage) => stage.action);
    const links = (step.ui.content.links ?? []).map((key) => testParams.find((item) => item.key === key)).filter(Boolean);
    const isNavigation = step.ui.content.button.action === "openScamUrl";
    const isAuth = step.ui.content.button.action === "runAuthBypass";
    const begin = ({ resume = false } = {}) => {
        const metadata = runtime.provider?.session?.peer?.metadata;
        capture.current = {
            targetAddress,
            context: contextOf(runtime),
            runtime: {
                platform, transport: isNavigation ? "browser" : transport,
                provider: isNavigation ? null : transport === "walletconnect"
                    ? { name: metadata?.name ?? "WalletConnect wallet", url: metadata?.url ?? null }
                    : getProviderIdentity(),
                from: isNavigation ? null : runtime.address ?? null,
                chain_id: isNavigation ? null : runtime.chainId ?? null,
                account_source: "runtime_at_dispatch",
                ...extraRuntime,
            },
        };
        setBusy(true);
        if (!resume) setRun(null);
    };
    const finish = (value) => {
        const captured = capture.current;
        // A failed account preflight has no dispatch snapshot. Do not reuse
        // provenance from a previous run or claim that the request was sent.
        setRun((previous) => ({ ...(!captured && value.success?.request_outcome === 'stopped_waiting' ? previous : {}),
            ...value, ...captured, contextChanged: captured ? !sameGuidedContext(captured.context, contextOf(latest.current)) : previous?.contextChanged ?? false }));
        setBusy(false);
    };
    const selectedTarget = run?.targetAddress ?? targetAddress;

    return <section className="mx-auto w-full max-w-3xl space-y-5 pb-12 pt-4 md:space-y-6 md:px-4 md:pb-24 md:pt-8" aria-label={`${checkTitle(step)} guided test`}>
        <WizardStepHeader checkId={step.canonicalId} title={checkTitle(step)} contained={false} wrapTitle />
        <p className="text-[var(--wsr-fg-secondary)]">{presentation.objective}</p>
        <p className="rounded-lg border border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] p-3 text-sm text-[var(--wsr-note-fg)]">{presentation.safety}</p>
        <ol className="space-y-3" aria-label="Guided test steps">
            {presentation.stages.map((stage, index) => <li key={stage.title} aria-current={phase === index ? "step" : undefined}
                className={`rounded-lg border p-4 md:p-5 ${phase === index ? "border-blue-400/60 bg-[var(--wsr-card)]" : "border-[var(--wsr-border)]"}`}>
                <h2><button type="button" disabled={busy} aria-expanded={phase === index} aria-controls={`request-stage-${index}`}
                    onClick={() => setPhase(index)} className="-my-2 flex min-h-11 w-full items-center gap-3 text-left font-semibold disabled:opacity-60 md:my-0 md:min-h-0">
                    <span className="font-mono text-sm">{String(index + 1).padStart(2, "0")}</span>{stage.title}
                </button></h2>
                {/* Keep ActionPanel mounted while changing cards: the pending
                    guard and the running batch must never reset with the UI. */}
                <div id={`request-stage-${index}`} hidden={phase !== index} className="mt-4 space-y-4 text-sm text-[var(--wsr-fg-secondary)]">
                    <p>{stage.instruction}</p>
                    {stage.checklist && <ul className="list-disc space-y-2 pl-5">{stage.checklist.map((line) => <li key={line}>{line}</li>)}</ul>}
                    {stage.preparation && <fieldset disabled={busy} className="min-w-0">{preparation}</fieldset>}
                    {stage.links && <ul className="space-y-2">{links.filter((link) => !stage.linkKeys || stage.linkKeys.includes(link.key)).map((link, i) => <li key={link.key}>
                        <a className="break-all underline underline-offset-4" href={/^https?:\/\//i.test(link.value) ? link.value : `https://${link.value}`} target="_blank" rel="noopener noreferrer">{i + 1}. {link.key === 'unknown_dapp_url' ? 'Open unknown dApp' : link.value}</a>
                        {link.key === 'unknown_dapp_url' && <p className="break-all text-xs">{link.value}</p>}
                    </li>)}</ul>}
                    {stage.target && <RecipientAddress
                        label={index > actionIndex && run ? "Recipient used in the dApp request" : "Selected recipient"}
                        address={index > actionIndex ? selectedTarget : targetAddress} />}
                    {stage.action && <ActionPanel {...actionProps} step={step} platform={platform} compact
                        label={run ? "Run requests again" : presentation.button}
                        hasRun={!!run} onPendingChange={setBusy}
                        onReview={() => setPhase(Math.min(index + 1, presentation.stages.length - 1))}
                        onRunStart={begin} onRunFinish={() => { setBusy(false); capture.current = null; }}
                        onResult={(success) => finish({ success })} onError={(error, errorDetails) => finish({ error, errorDetails })} />}
                    {index < presentation.stages.length - 1 && !(isAuth && stage.action) && <button type="button" disabled={busy} onClick={() => setPhase(index + 1)}
                        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 disabled:opacity-50 md:min-h-0">Continue</button>}
                    {!stage.action && <SkipStepButton checkId={step.canonicalId} platform={platform} stage={index + 1} title={stage.title} disabled={busy}
                        onSkip={() => setPhase(Math.min(index + 1, presentation.stages.length - 1))} />}
                </div>
            </li>)}
        </ol>
        {run ? <>
            <ActionResult guided error={run.error} errorDetails={run.errorDetails} success={run.success} step={step}
                extraRuntime={run.runtime} targetAddress={run.targetAddress} contextChanged={run.contextChanged} onRetry={() => setPhase(actionIndex)} />
        </> : !busy && <PersistedEvidence platform={platform} checkId={step.canonicalId} step="1/1" />}
    </section>;
}
