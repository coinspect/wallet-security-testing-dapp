import { useEffect, useRef, useState } from 'react';
import CTAButton from './CTAButton';
import WizardStepHeader from './WizardStepHeader';
import ResultExportActions from './ResultExportActions';
import { useWalletRuntime } from '../context/WalletRuntimeContext';
import { comparisonEvidence } from '../utils/guidedComparison.mjs';
import { resolveCheckParams } from '../utils/resolveCheckParams';
import { loadCheckEvidence, persistEvidenceRecord } from '../utils/evidenceStorage.mjs';
import { panelToPngBlob } from '../utils/panelToImage';
import { checkTitle } from '../utils/checkMeta';
import { chains } from '@/utils/constants';
import { normalizeChainId } from '@/utils/wallet-methods/chainId.mjs';
import { requestChainSwitch } from '@/utils/wallet-methods/chainSwitchProbe.mjs';
import { requestChainVerification } from '@/utils/wallet-methods/chainSwitchVerification.mjs';
import { resolveTransport } from '../utils/platform';

const channels = { mobile: 'Mobile', extension: 'Extension', embedded: 'Wallet embedded browser', walletconnect: 'WalletConnect' };
const usesWalletConnect = (record) => record.runtime?.transport === 'walletconnect' || record.channel === 'walletconnect';
const unknown = 'Not determined';
const field = 'w-full rounded border border-[var(--wsr-border)] bg-[var(--wsr-bg)] p-2 text-sm';
const card = 'space-y-3 rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-4';
const chainLabel = (id) => {
    if (!id) return 'Not recorded';
    const name = Object.values(chains).find((chain) => normalizeChainId(chain.chainId) === normalizeChainId(id))?.chainName;
    return name ? `${name} (${id})` : id;
};
const readLabel = (read) => read?.error ? 'Read failed — see details' : chainLabel(read?.chain_id);
const rpcLabel = (result) => {
    const labels = { pending: 'Waiting', switch_response: 'Success', switch_cancelled: 'Rejected',
        chain_not_added: 'Network not configured', switch_not_supported: 'Not supported',
        switch_error: 'Error', error: 'Error', switch_not_sent: 'Not sent', switch_stopped_waiting: 'Stopped waiting' };
    const code = result.error?.code ?? result.code;
    return `${labels[result.status] ?? 'Not recorded'}${code != null ? ` (${code})` : ''}`;
};
const topicOf = (runtime) => (runtime.provider?.session ?? runtime.provider?.signer?.session)?.topic;
const sameConnection = (a, b) => a.provider === b.provider && a.connectionTopic === topicOf(b) && a.address?.toLowerCase() === b.address?.toLowerCase();

function Choice({ label, value, onChange, options = ['Yes', 'No', unknown] }) {
    return <label className="block space-y-1"><span>{label}</span>
        <select className={field} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
            <option value="">Not recorded</option>
            {options.map((option) => <option key={option}>{option}</option>)}
        </select>
    </label>;
}

export default function ChainSwitchCheck({ check, platform }) {
    const channel = platform;
    const transport = resolveTransport(platform, check.steps[0]);
    const runtime = useWalletRuntime(transport);
    const latest = useRef(runtime); latest.current = runtime;
    const [records, setRecords] = useState(() => loadCheckEvidence(check.canonicalId, platform)
        .map((record) => record.evidence).filter((record) => record.switch_attempt_id));
    const recordsRef = useRef(records);
    const connections = useRef(new Map());
    const active = useRef(null);
    const alive = useRef(true);
    const summary = useRef(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [targets, setTargets] = useState(() => check.steps.map((step) => chains[step.data.params.switchTo].chainId));
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; active.current?.abort(); };
    }, []);
    const save = (record) => {
        const exists = recordsRef.current.some((item) => item.switch_attempt_id === record.switch_attempt_id);
        const next = exists ? recordsRef.current.map((item) => item.switch_attempt_id === record.switch_attempt_id ? record : item)
            : [...recordsRef.current, record];
        recordsRef.current = next;
        if (alive.current) setRecords(next);
        persistEvidenceRecord({ platform, checkId: check.canonicalId, step: record.step, evidence: record });
    };
    const update = (id, changes) => {
        const record = recordsRef.current.find((item) => item.switch_attempt_id === id);
        if (record) save({ ...record, ...changes });
    };
    const run = async (index) => {
        if (active.current || !channel) return;
        const target = normalizeChainId(targets[index]);
        if (!target || target === '0x0') { setNotice('Enter a valid target chain ID.'); return; }
        const initial = { ...latest.current, connectionTopic: topicOf(latest.current) };
        if (!initial.provider?.request || !initial.address) { setNotice('Connect your wallet using Connect Wallet in the navbar.'); return; }
        if (initial.networkSetup?.busy) { setNotice('Wait for connection setup to finish before starting a switch attempt.'); return; }
        const controller = new AbortController(); active.current = controller; setBusy(true); setNotice('');
        const id = crypto.randomUUID();
        const resolved = resolveCheckParams(check.steps[index]);
        const base = comparisonEvidence(resolved, { runtime: {
            platform, transport: transport,
            channel, channel_source: 'navbar', from: initial.address,
            chain_id: initial.chainId, session_topic: topicOf(initial) ?? null,
        } }, window.location.origin);
        const record = { ...base, step: `${index + 1}/${check.steps.length}:${channel}:${id}`,
            switch_attempt_id: id, started_at: new Date().toISOString(), channel,
            ...(transport === 'walletconnect' ? { transaction_probe_limitation: 'Not sent: WalletConnect requires an explicit routing chain, which cannot verify the wallet active network.' } : {}),
            parameters: { ...base.parameters, requested_chain_id: target },
            switch_result: { chainId: target, status: 'pending' }, tester_observations: {}, verification_attempts: [] };
        connections.current.set(id, initial);
        save(record);
        try {
            const result = await requestChainSwitch({ provider: initial.provider, chainId: target,
                transport: transport,
                requirePolygon: false, signal: controller.signal });
            update(id, { switch_result: result, wallet_output: result,
                context_changed_during_request: !sameConnection(initial, latest.current) });
        } catch (error) {
            update(id, { switch_result: { chainId: target, status: 'error', error: { message: String(error?.message ?? error), code: error?.code } } });
        } finally { active.current = null; if (alive.current) setBusy(false); }
    };
    const verify = async (record) => {
        if (active.current) return;
        const initial = connections.current.get(record.switch_attempt_id);
        if (recordsRef.current.at(-1)?.switch_attempt_id !== record.switch_attempt_id || channel !== record.channel || !initial || !sameConnection(initial, latest.current)) {
            setNotice('Connection changed or restored. Start a new switch attempt before requesting a transaction.'); return;
        }
        const controller = new AbortController(); active.current = controller; setBusy(true); setNotice('');
        try {
            const result = await requestChainVerification({ provider: initial.provider, address: initial.address,
                chainId: record.switch_result.chainId, transport: record.runtime.transport,
                signal: controller.signal });
            const current = recordsRef.current.find((item) => item.switch_attempt_id === record.switch_attempt_id);
            update(record.switch_attempt_id, { verification_attempts: [...current.verification_attempts, {
                ...result, recorded_at: new Date().toISOString(),
                context_changed: !sameConnection(initial, latest.current),
            }] });
        } finally { active.current = null; if (alive.current) setBusy(false); }
    };
    const observe = (record, key, value) => update(record.switch_attempt_id, {
        tester_observations: { ...record.tester_observations, [key]: value || null },
    });
    const copy = async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(recordsRef.current, null, 2)); setNotice('Evidence copied'); }
        catch { setNotice('Clipboard unavailable. Use Export evidence or copy the JSON below.'); }
    };
    const copyImage = async () => {
        try {
            const blob = await panelToPngBlob(summary.current);
            if (!blob) throw new Error('Image unavailable');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setNotice('Image copied');
        } catch { setNotice('Image copy unavailable. Capture the results on screen.'); }
    };
    return <section className="mx-auto w-full max-w-3xl space-y-5 pb-12 pt-4 md:px-4 md:pt-8">
        <WizardStepHeader checkId={check.canonicalId} title={checkTitle(check.steps[0])} contained={false} wrapTitle />
        <p>Compare the provider network before and after each switch with the network displayed by the wallet.</p>
        <p className="rounded-lg border border-[var(--wsr-note-border)] p-3 text-sm text-[var(--wsr-note-fg)]">Use a dedicated test wallet. Capture the switch prompt. For the later transaction request, capture the displayed network and cancel. Do not sign or send a transaction.</p>
        {check.steps.map((step, index) => <div key={step.id} className={card}>
            <h2 className="font-semibold">{index + 1}. Request {chains[step.data.params.switchTo].chainName}</h2>
            <details className="text-sm">
                <summary>Change target network</summary>
                <label className="mt-2 block space-y-1"><span>Target chain ID</span>
                    <input className={field} value={targets[index]} disabled={busy} onChange={(event) => setTargets((values) => values.map((value, i) => i === index ? event.target.value : value))} />
                </label>
            </details>
            <CTAButton disabled={busy || !channel} onClick={() => run(index)}>Request network switch</CTAButton>
            {records.at(-1)?.step.startsWith(`${index + 1}/`) && records.at(-1).switch_result.status !== 'pending' && <div className="space-y-2">
                {usesWalletConnect(records.at(-1)) ? <p className="text-xs">Transaction inspection is unavailable through WalletConnect without choosing a network.</p> : <>
                    <CTAButton disabled={busy} onClick={() => verify(records.at(-1))}>Inspect transaction network</CTAButton>
                    <p className="text-xs">Capture the network shown by the wallet, then cancel the transaction request.</p>
                </>}
            </div>}
        </div>)}
        {busy && <CTAButton onClick={() => active.current?.abort()}>Stop waiting</CTAButton>}
        {busy && <p className="text-xs">Stopping the dApp wait does not cancel a wallet request. Cancel any open prompt before continuing.</p>}
        {records.length > 0 && <>
            <div ref={summary} className={card} aria-live="polite">
                <h2 className="font-semibold">Results · {channels[channel]}</h2>
                {records.map((record, index) => <article key={record.switch_attempt_id} className="space-y-2 border-t border-[var(--wsr-border)] pt-3 text-sm">
                    <h3 className="font-semibold">Attempt {index + 1} · {chainLabel(record.switch_result.chainId)}</h3>
                    <p>Before: {readLabel(record.switch_result.chain_before)}</p>
                    <p>After: {readLabel(record.switch_result.chain_after)}</p>
                    <p>Switch RPC: {rpcLabel(record.switch_result)}</p>
                    {usesWalletConnect(record) && <p className="text-xs">Session network only; the wallet’s active network is not verified.</p>}
                    {record.context_changed_during_request && <p className="text-xs">Connection changed. Repeat this attempt.</p>}
                    <fieldset disabled={busy} data-capture-skip>
                        <Choice label="Did the wallet show a network-switch confirmation prompt?" value={record.tester_observations.confirmation} onChange={(value) => observe(record, 'confirmation', value)} />
                    </fieldset>
                    <p>Confirmation prompt: {record.tester_observations.confirmation || 'Not recorded'}</p>
                    {record.verification_attempts.length > 0 && <p>Transaction probe: {record.verification_attempts.at(-1).status === 'cancelled' ? 'Cancelled' : record.verification_attempts.at(-1).status === 'response' ? 'Response received' : record.verification_attempts.at(-1).status.replaceAll('_', ' ')}</p>}
                </article>)}
            </div>
            <ResultExportActions onCopyEvidence={copy} onCopyImage={copyImage} />
            <details className={card}><summary>Evidence and technical details</summary>
                <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(records, null, 2)}</pre>
            </details>
        </>}
        {notice && <p role="status">{notice}</p>}
    </section>;
}
