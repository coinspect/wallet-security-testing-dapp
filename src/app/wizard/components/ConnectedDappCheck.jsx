"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CTAButton from "./CTAButton";
import ResultExportActions from "./ResultExportActions";
import PersistedEvidence from "./PersistedEvidence";
import WizardStepHeader from "./WizardStepHeader";
import { checkTitle } from "../utils/checkMeta";
import { useWalletRuntime } from "../context/WalletRuntimeContext";
import { getProviderIdentity } from "../utils/providerIdentity";
import { createRevocationProbe, REVOCATION_MESSAGES } from "../utils/revocationProbe.mjs";
import { persistEvidenceRecord } from "../utils/evidenceStorage.mjs";
import { BUILD_PROVENANCE } from "../utils/buildProvenance.mjs";
import { resolveCheckParams } from "../utils/resolveCheckParams";
import { panelToPngBlob } from "../utils/panelToImage";
import { testParams } from "@/utils/constants";
import { ensurePolygon } from '@/utils/wallet-methods/chain';
import { createStepRun } from '@/utils/wallet-methods/stepRun.mjs';
import SkipStepButton from './SkipStepButton';

const TITLES = ["Connect two dApps", "Disconnect this dApp in your wallet", "Check access after disconnecting"];
const secondary = "text-sm text-[var(--wsr-fg-secondary)] underline underline-offset-4 hover:text-gray-900 dark:hover:text-gray-100";

export default function ConnectedDappCheck({ check, platform }) {
    const transport = platform === "mobile" ? "walletconnect" : "injected";
    const runtime = useWalletRuntime(transport);
    const latestRuntime = useRef(runtime);
    latestRuntime.current = runtime;
    const probe = useRef(null);
    const activeRun = useRef(null);
    const pendingProbe = useRef(null);
    const [confirmations, setConfirmations] = useState({});
    const generation = useRef(0);
    const working = useRef(false);
    const resultPanel = useRef(null);
    const [phase, setPhase] = useState(0);
    const [baseline, setBaseline] = useState(null);
    const [waitingForConnection, setWaitingForConnection] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [result, setResult] = useState(null);
    const [evidence, setEvidence] = useState(null);
    const [unavailable, setUnavailable] = useState(false);
    const [note, setNote] = useState("");
    const [copyStatus, setCopyStatus] = useState(null);
    const secondDapp = testParams.find((p) => p.key === "verified_dapp_url")?.value;
    const resolved = resolveCheckParams(check.steps[1]);

    useEffect(() => () => {
        generation.current += 1;
        probe.current?.dispose();
        activeRun.current?.stop();
        pendingProbe.current?.dispose();
    }, []);

    const save = (base, observation, tester, output = null) => {
        const record = {
            check: check.canonicalId, step: "connection-management", dapp_version: resolved.dappVersion,
            provenance: BUILD_PROVENANCE,
            parameters: { ...resolved.parameters, second_dapp_url: secondDapp },
            runtime: {
                platform, transport, dapp_origin: window.location.origin,
                ...(base ? { from: base.accounts[0], chain_id: base.chain_id, provider: base.provider } : {}),
            },
            baseline: base, tester_observations: tester, observation,
            wallet_output: output?.wallet_output ?? [], session_events: output?.session_events ?? [],
            recorded_at: new Date().toISOString(), automatic_verdict: null,
        };
        setEvidence(record);
        persistEvidenceRecord({ platform, checkId: check.canonicalId, step: "connection-management", evidence: record });
    };

    const establish = useCallback(async (canRequestAccounts) => {
        const provider = latestRuntime.current.provider;
        if (!provider?.request || working.current) return;
        working.current = true;
        setBusy(true);
        setWaitingForConnection(false);
        setNotice(null);
        const currentGeneration = generation.current;
        const topic = provider.session?.topic;
        const isCurrent = () => generation.current === currentGeneration && latestRuntime.current.provider === provider && provider.session?.topic === topic;
        let candidate;
        const control = createStepRun(provider, { transport });
        activeRun.current = control;
        try {
            const captured = await control.execute(async () => {
                if (canRequestAccounts) await control.provider.request({ method: "eth_requestAccounts" });
                await ensurePolygon(control.provider, { isCurrent });
                if (!isCurrent()) return null;
                const metadata = provider.session?.peer?.metadata;
                candidate = createRevocationProbe({
                    provider, transport,
                    identity: transport === "walletconnect"
                        ? { name: metadata?.name ?? "WalletConnect wallet", url: metadata?.url ?? null }
                        : getProviderIdentity(),
                });
                pendingProbe.current = candidate;
                return candidate.captureBaseline({ signal: control.signal });
            });
            if (!isCurrent() || captured?.request_outcome || !captured) {
                candidate?.dispose();
                return;
            }
            probe.current?.dispose();
            probe.current = candidate;
            setBaseline(captured);
        } catch (error) {
            candidate?.dispose();
            if (generation.current === currentGeneration) setNotice(error.message);
        } finally {
            if (pendingProbe.current === candidate) pendingProbe.current = null;
            if (generation.current === currentGeneration) {
                working.current = false;
                setBusy(false);
            }
        }
    }, [transport]);

    // Only an explicitly requested setup connection may advance automatically.
    // Once a baseline exists, losing the session must never trigger pairing.
    useEffect(() => {
        if (waitingForConnection && runtime.provider) establish(false);
    }, [waitingForConnection, runtime.provider, establish]);

    const connect = async () => {
        const currentGeneration = generation.current;
        if (!runtime.provider && transport === "walletconnect") {
            setNotice("Approve the connection in your wallet to continue.");
            setWaitingForConnection(true);
            try { await runtime.open(); }
            catch (error) { if (generation.current === currentGeneration) { setWaitingForConnection(false); setNotice(error.message); } }
        } else if (!runtime.provider) {
            setNotice("Select a browser wallet using Connect Wallet in the header.");
        } else {
            await establish(transport === "injected");
        }
    };

    const verify = async () => {
        if (working.current || !probe.current) return;
        working.current = true;
        setBusy(true);
        setNotice(null);
        const currentGeneration = generation.current;
        const control = createStepRun(runtime.provider, { transport });
        activeRun.current = control;
        try {
            const output = await control.execute(() => probe.current.check(() => latestRuntime.current.provider, { signal: control.signal }));
            if (currentGeneration !== generation.current) return;
            if (output?.request_outcome) return;
            setResult(output);
            save(baseline, output.observation, confirmations, output);
        } catch (error) {
            if (currentGeneration === generation.current) setNotice(error.message);
        } finally {
            if (currentGeneration === generation.current) { working.current = false; setBusy(false); }
        }
    };

    const restart = () => {
        generation.current += 1;
        activeRun.current?.stop();
        probe.current?.dispose();
        probe.current = null;
        working.current = false;
        setPhase(0); setBaseline(null); setResult(null); setEvidence(null);
        setUnavailable(false); setNote(""); setNotice(null); setBusy(false);
        setWaitingForConnection(false); setCopyStatus(null);
        setConfirmations({});
    };

    const skip = () => {
        const stopping = busy || waitingForConnection;
        generation.current += 1;
        activeRun.current?.stop();
        working.current = false;
        setBusy(false); setWaitingForConnection(false);
        // Keep existing evidence; skipped navigation is a separate observation.
        const partial = (pendingProbe.current ?? probe.current)?.snapshot();
        const record = { check: check.canonicalId, step: `skipped:${phase + 1}`, baseline,
            provenance: BUILD_PROVENANCE, stage_title: TITLES[phase],
            runtime: { platform, transport }, tester_observations: confirmations,
            ...(stopping ? activeRun.current?.observation() : {}),
            request_outcome: stopping ? 'stopped_waiting' : 'skipped_by_tester', automatic_verdict: null,
            wallet_output: partial?.wallet_output?.map((row) => row.outcome === 'pending' ? { ...row, outcome: 'stopped_waiting' } : row) ?? null,
            session_events: partial?.session_events ?? [] };
        if (record.wait_stopped && partial?.wallet_output.some((row) => row.request_submitted && row.method === 'wallet_getPermissions')) {
            record.wait_stopped.request_submitted = true;
        }
        persistEvidenceRecord({ platform, checkId: check.canonicalId, step: record.step, evidence: record });
        setPhase(Math.min(phase + 1, 2));
        setNotice(stopping ? 'Stopped waiting. Cancel any open wallet prompt. Existing evidence is preserved.' : 'Step skipped. This does not confirm connection or revocation.');
    };

    const copyEvidence = async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(evidence, null, 2)); setCopyStatus("Evidence copied"); }
        catch { setCopyStatus("Clipboard unavailable. Use Export evidence above."); }
    };

    const copyImage = async () => {
        try {
            const blob = await panelToPngBlob(resultPanel.current);
            if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                setCopyStatus("Image copied");
            } else {
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url; link.download = "connected-dapp-evidence.png"; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setCopyStatus("Image downloaded");
            }
        } catch { setCopyStatus("Image capture unavailable. Take a screenshot instead."); }
    };

    const observed = result ? REVOCATION_MESSAGES[result.observation] : null;
    return (
        <section className="mx-auto w-full max-w-3xl space-y-5 pb-12 pt-4 md:space-y-6 md:px-4 md:pb-24 md:pt-8" aria-label="Connected dApp management test">
            <WizardStepHeader checkId={check.canonicalId} title={checkTitle(check.steps[0])} contained={false} wrapTitle />
            <p className="text-[var(--wsr-fg-secondary)]">Check whether your wallet lists connected dApps and removes their access when you disconnect them.</p>
            <ol className="space-y-3">
                {TITLES.map((title, index) => (
                    <li key={title} aria-current={phase === index ? "step" : undefined}
                        className={`rounded-lg border p-4 md:p-5 ${phase === index ? "border-blue-400/60 bg-[var(--wsr-card)]" : "border-[var(--wsr-border)]"}`}>
                        <h2 className={`flex items-center gap-3 font-semibold ${phase === index ? "text-gray-900 dark:text-gray-100" : "text-[var(--wsr-fg-secondary)]"}`}>
                            <span className="font-mono text-sm">0{index + 1}</span>{title}
                        </h2>
                        {phase === index && !unavailable && (
                            <div className="mt-4 space-y-4 text-sm">
                                {index === 0 && <>
                                    {!baseline ? <>
                                        <p>Connect this testing dApp first.</p>
                                        <CTAButton onClick={connect} disabled={busy}>{busy ? "Confirming connection…" : "Connect this dApp"}</CTAButton>
                                    </> : <>
                                        <p>Testing dApp connected. Now connect the same wallet to <a className={secondary} href={secondDapp} target="_blank" rel="noopener noreferrer">Uniswap ↗</a> so you can check that both are listed.</p>
                                        <CTAButton onClick={() => {
                                            setPhase(1); setNotice(null);
                                            setConfirmations({ second_dapp_connected: true });
                                            save(baseline, "setup_recorded", { second_dapp_connected: true });
                                        }}>Both dApps are connected</CTAButton>
                                    </>}
                                </>}
                                {index === 1 && <>
                                    <p>Open your wallet’s connected-dApps list. Capture both entries, then remove only this testing dApp and capture the removal.</p>
                                    <CTAButton onClick={() => {
                                        setPhase(2); setNotice(null);
                                        const tester = { ...confirmations, revocation_confirmed_by_tester: true };
                                        setConfirmations(tester);
                                        save(baseline, "revocation_reported_by_tester", tester);
                                    }}>I disconnected this dApp</CTAButton>
                                    <p className="text-xs text-[var(--wsr-fg-secondary)]">This confirms your manual step; access is checked next.</p>
                                </>}
                                {index === 2 && <>
                                    <p>Check the original connection without reconnecting your wallet.</p>
                                    {!baseline && <p>No initial connection was recorded. Continue with wallet screenshots; RPC access revocation cannot be verified.</p>}
                                    <CTAButton onClick={verify} disabled={busy || !baseline}>{busy ? "Checking access…" : result ? "Check again" : "Check access after disconnecting"}</CTAButton>
                                </>}
                                {busy || waitingForConnection ? <button type="button" className={secondary} onClick={skip}>Stop waiting and continue</button>
                                    : <SkipStepButton checkId={check.canonicalId} platform={platform} stage={index + 1} title={title} onSkip={skip} />}
                            </div>
                        )}
                    </li>
                ))}
            </ol>
            {notice && <p role="status" className="text-sm text-[var(--wsr-fg-secondary)]">{notice}</p>}
            {phase === 1 && !unavailable && <button className={secondary} onClick={() => {
                setUnavailable(true); setWaitingForConnection(false); setNotice(null);
            }} disabled={busy}>My wallet has no connected-dApps list</button>}
            {unavailable && <div className="space-y-3 rounded-lg border border-[var(--wsr-border)] p-5">
                <p>Capture where you looked in the wallet, then add a short note.</p>
                <label htmlFor="management-note" className="block text-sm">Where did you look?</label>
                <textarea id="management-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000}
                    className="w-full rounded border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-3 text-sm" />
                <CTAButton disabled={!note.trim()} onClick={() => {
                    save(baseline, "management_unavailable_reported_by_tester", { management_unavailable: true, note: note.trim() });
                    setNotice("Observation recorded. Include your wallet screenshot with the evidence.");
                }}>Record observation</CTAButton>
            </div>}
            {observed && <div ref={resultPanel} className="space-y-2 rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-4 md:p-5" role="status">
                <p className="text-xs text-[var(--wsr-fg-secondary)]">{check.canonicalId} · {platform} · {baseline?.provider?.name ?? "Selected wallet"}</p>
                <h3 className="font-semibold">{observed[0]}</h3>
                <p className="text-sm text-[var(--wsr-fg-secondary)]">{observed[1]}</p>
                <ResultExportActions onCopyEvidence={copyEvidence} onCopyImage={copyImage} status={copyStatus} />
            </div>}
            {evidence ? <details className="rounded-lg border border-[var(--wsr-border)] p-4">
                <summary className="cursor-pointer text-sm font-medium">Evidence and technical details</summary>
                <div className="mt-4 space-y-3">
                    <p className="text-xs text-[var(--wsr-fg-secondary)]">Keep screenshots of the connected-dApps list, the removal and this result. Wallet screenshots are captured manually.</p>
                    {!observed && <ResultExportActions onCopyEvidence={copyEvidence} status={copyStatus} />}
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(evidence, null, 2)}</pre>
                </div>
            </details> : <PersistedEvidence checkId={check.canonicalId} platform={platform} />}
            <button className={secondary} onClick={restart} disabled={busy}>Start a new test</button>
        </section>
    );
}
