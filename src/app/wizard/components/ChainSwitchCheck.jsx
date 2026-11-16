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
import { REQUEST_WAIT_STOPPED, waitForWalletReply } from '@/utils/wallet-methods/requestWait.mjs';

const channels = { embedded: 'Wallet embedded browser', extension: 'Browser extension', walletconnect: 'WalletConnect' };
const unknown = 'Not determined';
const field = 'w-full rounded border border-[var(--wsr-border)] bg-[var(--wsr-bg)] p-2 text-sm';
const card = 'space-y-3 rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-4';
const readLabel = (read) => read?.error ? `Read failed: ${read.error.message ?? JSON.stringify(read.error)}` : read?.chain_id ?? 'Not recorded';
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
    const injected = useWalletRuntime('extension');
    const walletConnect = useWalletRuntime('walletconnect');
    const [channel, setChannel] = useState('');
    const runtime = channel === 'walletconnect' ? walletConnect : injected;
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
    const connect = async () => {
        if (active.current) return;
        const controller = new AbortController(); active.current = controller; setBusy(true);
        try {
            if (channel === 'walletconnect') await runtime.open?.({ view: 'Connect', namespace: 'eip155' });
            else if (runtime.provider?.request) {
                await waitForWalletReply(() => runtime.provider.request({ method: 'eth_requestAccounts' }), controller.signal);
                await runtime.refresh?.();
            } else setNotice('Open this page in the wallet browser or enable its browser extension.');
        } catch (error) { if (alive.current) setNotice(error === REQUEST_WAIT_STOPPED ? 'Stopped waiting. Cancel any open wallet prompt.' : String(error?.message ?? error)); }
        finally { active.current = null; if (alive.current) setBusy(false); }
    };
    const run = async (index) => {
        if (active.current || !channel) return;
        const target = normalizeChainId(targets[index]);
        if (!target || target === '0x0') { setNotice('Enter a valid target chain ID.'); return; }
        const initial = { ...latest.current, connectionTopic: topicOf(latest.current) };
        if (!initial.provider?.request || !initial.address) { setNotice('Connect the selected channel before starting.'); return; }
        if (initial.networkSetup?.busy) { setNotice('Wait for connection setup to finish before starting a switch attempt.'); return; }
        const controller = new AbortController(); active.current = controller; setBusy(true); setNotice('');
        const id = crypto.randomUUID();
        const resolved = resolveCheckParams(check.steps[index]);
        const base = comparisonEvidence(resolved, { runtime: {
            platform, transport: channel === 'walletconnect' ? 'walletconnect' : 'injected',
            channel, channel_source: 'tester_selected', from: initial.address,
            chain_id: initial.chainId, session_topic: topicOf(initial) ?? null,
        } }, window.location.origin);
        const record = { ...base, step: `${index + 1}/${check.steps.length}:${channel}:${id}`,
            switch_attempt_id: id, started_at: new Date().toISOString(), channel,
            parameters: { ...base.parameters, requested_chain_id: target },
            switch_result: { chainId: target, status: 'pending' }, tester_observations: {}, verification_attempts: [] };
        connections.current.set(id, initial);
        save(record);
        try {
            const result = await requestChainSwitch({ provider: initial.provider, chainId: target,
                transport: channel === 'walletconnect' ? 'walletconnect' : 'extension',
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
                chainId: record.switch_result.chainId, transport: record.channel === 'walletconnect' ? 'walletconnect' : 'extension',
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
        <div className={card}>
            <label className="block space-y-1"><span>Test channel</span>
                <select className={field} value={channel} disabled={busy} onChange={(event) => setChannel(event.target.value)}>
                    <option value="">Select the channel you are using</option>
                    {Object.entries(channels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </label>
            <p className="text-sm">The provider cannot reliably distinguish an embedded browser from an extension. Select the actual channel; attempts are saved separately.</p>
            <CTAButton disabled={busy || !channel} onClick={connect}>Connect selected channel</CTAButton>
            {runtime.address && channel && <p className="break-all text-xs">Account: {runtime.address}</p>}
        </div>
        {check.steps.map((step, index) => <div key={step.id} className={card}>
            <h2 className="font-semibold">{index + 1}. Request {chains[step.data.params.switchTo].chainName}</h2>
            <p className="text-sm">Record whether a confirmation appeared and how you responded. A successful RPC alone does not prove a network change.</p>
            <label className="block space-y-1"><span>Target chain ID</span>
                <input className={field} value={targets[index]} disabled={busy} onChange={(event) => setTargets((values) => values.map((value, i) => i === index ? event.target.value : value))} />
            </label>
            <p className="text-xs">For an unapproved-network retry, enter its chain ID. The dApp will not add networks or reconnect automatically.</p>
            <CTAButton disabled={busy || !channel} onClick={() => run(index)}>Request network switch</CTAButton>
        </div>)}
        {busy && <CTAButton onClick={() => active.current?.abort()}>Stop waiting</CTAButton>}
        {busy && <p className="text-xs">Stopping the dApp wait does not cancel a wallet request. Cancel any open prompt before continuing.</p>}
        {records.length > 0 && <>
            <div ref={summary} className="space-y-4" aria-live="polite">
                {records.map((record) => <article key={record.switch_attempt_id} className={card}>
                    <h2 className="font-semibold">{channels[record.channel]} · Target {record.switch_result.chainId}</h2>
                    <p className="break-all text-xs">Attempt {record.switch_attempt_id} · {record.started_at}</p>
                    <p className="text-sm">Before: {readLabel(record.switch_result.chain_before)}</p>
                    <p className="text-sm">Switch RPC: {record.switch_result.status === 'switch_response' ? `Success (${JSON.stringify(record.switch_result.response ?? null)}) — network change not established by this response` : record.switch_result.status}</p>
                    {record.switch_result.error && <p className="text-sm">Error: {record.switch_result.error.code ?? record.switch_result.code ?? 'No code'} · {record.switch_result.error.message}</p>}
                    {record.switch_result.reason && <p className="text-sm">Not sent: {record.switch_result.reason}</p>}
                    <p className="text-sm">After: {readLabel(record.switch_result.chain_after)}</p>
                    {record.channel === 'walletconnect' && <p className="text-sm">WalletConnect reads describe the session provider, not a unique active wallet network. The follow-up transaction requires explicit chain routing and is unavailable as an active-network probe.</p>}
                    {record.context_changed_during_request && <p>Connection changed during this attempt. Repeat with the same connection.</p>}
                    <div data-capture-skip>
                        <CTAButton disabled={busy || record.switch_result.status === 'pending'} onClick={() => verify(record)}>
                            {record.channel === 'walletconnect' ? 'Record transaction probe limitation' : 'Inspect transaction network'}
                        </CTAButton>
                        <p className="text-xs">Zero-value self-transfer with no chain selected by the dApp. Capture the wallet network, then cancel. Transaction consent is not consent to switch networks.</p>
                    </div>
                    {record.verification_attempts.map((result, index) => <p key={index} className="text-sm">Transaction probe {index + 1}: {result.message}{result.context_changed ? ' Connection changed; repeat this attempt.' : ''}</p>)}
                    <fieldset disabled={busy} className="space-y-3 text-sm" data-capture-skip>
                        <Choice label="Did the wallet ask to confirm the network switch?" value={record.tester_observations.confirmation} onChange={(value) => observe(record, 'confirmation', value)} />
                        <Choice label="How did you respond to the switch prompt?" options={['Accepted', 'Cancelled', 'No prompt', unknown]} value={record.tester_observations.switch_prompt_response} onChange={(value) => observe(record, 'switch_prompt_response', value)} />
                        <label className="block">Network shown in the later transaction request
                            <input className={field} value={record.tester_observations.displayed_network ?? ''} onChange={(event) => observe(record, 'displayed_network', event.target.value)} />
                        </label>
                        <Choice label="Was the target network preapproved?" options={['Preapproved', 'Not preapproved', unknown]} value={record.tester_observations.preapproved} onChange={(value) => observe(record, 'preapproved', value)} />
                        <Choice label="Does the wallet let you manage preapproved networks?" value={record.tester_observations.preapproval_management} onChange={(value) => observe(record, 'preapproval_management', value)} />
                        <label className="block">Capture references (file names or links)
                            <textarea className={field} value={record.tester_observations.capture_references ?? ''} onChange={(event) => observe(record, 'capture_references', event.target.value)} />
                        </label>
                        <label className="block">Notes
                            <textarea className={field} value={record.tester_observations.notes ?? ''} onChange={(event) => observe(record, 'notes', event.target.value)} />
                        </label>
                    </fieldset>
                    {record.tester_observations.confirmation === 'No' && record.tester_observations.preapproval_management === 'Yes' && <p>Check the wallet’s approved networks, choose a network that is not approved and start a new attempt above. Keep this attempt for comparison.</p>}
                    <dl className="space-y-1 text-xs">
                        {Object.entries({ Confirmation: record.tester_observations.confirmation, 'Switch prompt response': record.tester_observations.switch_prompt_response,
                            'Displayed network': record.tester_observations.displayed_network, 'Target preapproved': record.tester_observations.preapproved,
                            'Preapproved-network management': record.tester_observations.preapproval_management,
                            Captures: record.tester_observations.capture_references, Notes: record.tester_observations.notes }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="whitespace-pre-wrap break-words">{value || 'Not recorded'}</dd></div>)}
                    </dl>
                    <p className="text-xs">No automatic verdict. Missing data, rejection and unsupported methods do not establish whether a confirmation appeared.</p>
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
