import assert from 'node:assert/strict';
import test from 'node:test';
import { createStepRun, skippedStepResult } from '../src/utils/wallet-methods/stepRun.mjs';
import { walletConnectProbeProvider } from '../src/utils/wallet-methods/wc/probeProvider.mjs';
import { providerRequestAdapter } from '../src/utils/wallet-methods/providerRequestAdapter.mjs';
import { createRevocationProbe } from '../src/app/wizard/utils/revocationProbe.mjs';
import { sourceLoader, reactHarness, nodes, deferred, flush } from './helpers/sourceHarness.mjs';

const account = `0x${'11'.repeat(20)}`;
const rejected = { code: 4001, message: 'User rejected' };

test('manual requests pause between wallet methods without modifying their payloads', async () => {
    const sent = [], progress = [];
    const provider = { request: async (args) => { sent.push(args); if (args.method === 'eth_requestAccounts') return [account]; throw rejected; } };
    const control = createStepRun(provider, { manual: true, onChange: (state) => progress.push(state) });
    const payloads = [{ method: 'personal_sign', params: ['0x1234', account] }, { method: 'eth_signTypedData_v4', params: [account, '{}'] }];
    const done = control.execute(async () => {
        const results = [];
        for (const args of payloads) {
            await control.provider.request({ method: 'eth_requestAccounts' });
            try { await control.provider.request(args); } catch (error) { results.push(error); }
        }
        return results;
    });
    await flush();
    assert.equal(sent.filter((args) => args.method !== 'eth_requestAccounts').length, 1);
    assert.deepEqual(progress.at(-1), { phase: 'ready', method: 'eth_signTypedData_v4' });
    control.next(); control.next();
    assert.deepEqual(await done, [rejected, rejected]);
    assert.deepEqual(sent.filter((args) => args.method !== 'eth_requestAccounts'), payloads);
});

for (const transport of ['injected', 'walletconnect']) test(`${transport}: stop retains earlier replies and consumes late errors without dispatching the next method`, async () => {
    const pending = deferred(), sent = [], late = [];
    const request = (args) => { sent.push(args); return sent.length === 1 ? Promise.reject(rejected) : pending.promise; };
    const provider = transport === 'injected' ? { request } : {
        session: { topic: 'original' }, client: { request: ({ request: args }) => request(args) },
        request: () => assert.fail('Wallet probes must not use the HTTP/session fallback'),
    };
    const control = createStepRun(Object.freeze(provider), { transport, onLateSettlement: (value) => late.push(value) });
    // Repeated adapters must not bypass the stop/manual boundary to reach SignClient.
    const dispatchProvider = transport === 'walletconnect'
        ? walletConnectProbeProvider(providerRequestAdapter(control.provider, (args) => control.provider.request(args))) : control.provider;
    const done = control.execute(async () => {
        for (const method of ['personal_sign', 'eth_signTypedData_v4', 'wallet_watchAsset']) {
            try { await dispatchProvider.request({ method }); } catch {}
        }
        return 'finished';
    });
    await flush(); control.stop();
    const result = await done;
    assert.equal(result.request_outcome, 'stopped_waiting');
    assert.equal(result.wait_stopped.request_submitted, true);
    assert.equal(result.request_diagnostics.calls[0].error.code, 4001);
    assert.equal(result.request_diagnostics.calls[1].status, 'stopped_waiting');
    pending.reject(new Error('Late expiry')); await flush();
    assert.equal(sent.length, 2);
    assert.equal(late[0].request_outcome, 'stopped_waiting');
    assert.equal(late[0].request_diagnostics.calls[1].late_settlement.error.message, 'Late expiry');
});

test('stop during an account preflight cannot send a late wallet request', async () => {
    const reply = deferred(), sent = [];
    const control = createStepRun({ request: (args) => { sent.push(args.method); return reply.promise; } });
    const done = control.execute(async () => {
        try { await control.provider.request({ method: 'eth_accounts' }); } catch {}
        await control.provider.request({ method: 'personal_sign' });
    });
    await flush(); control.stop();
    assert.equal((await done).wait_stopped.request_submitted, false);
    reply.resolve([account]); await flush();
    assert.deepEqual(sent, ['eth_accounts']);
});

test('a stopped manual queue and a replaced WalletConnect session never dispatch', async () => {
    const sent = [], provider = { session: { topic: 'first' }, request: async (args) => { sent.push(args.method); return null; } };
    const control = createStepRun(provider, { manual: true });
    const done = control.execute(async () => {
        await control.provider.request({ method: 'personal_sign' });
        await control.provider.request({ method: 'wallet_watchAsset' });
    });
    await flush(); control.stop(); control.next(); await done;
    assert.deepEqual(sent, ['personal_sign']);
    const next = createStepRun(provider);
    provider.session.topic = 'replacement';
    await assert.rejects(next.execute(() => next.provider.request({ method: 'personal_sign' })), /connection changed/);
    assert.equal(sent.length, 1);
});

function actionUI({ id = 'WSR-VERI-006', platform = 'mobile', holdRead = false } = {}) {
    const hooks = reactHarness(), requests = [], replies = [], results = [], errors = [];
    const read = deferred();
    const provider = {
        session: { topic: 'original', peer: { metadata: { name: 'OKTO test double' } } },
        client: { request: ({ request }) => send(request) },
        request(args) {
            if (holdRead) return read.promise;
            if (args.method === 'eth_chainId') return Promise.resolve('0x89');
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return Promise.resolve([account]);
            return send(args);
        },
    };
    function send(args) { const reply = deferred(); requests.push(args); replies.push(reply); return reply.promise; }
    if (platform === 'extension') { delete provider.session; delete provider.client; }
    const runtime = { provider, walletProvider: provider, address: account, chainId: '0x89', status: 'connected' };
    const load = sourceLoader({ react: hooks.react,
        '../context/WalletRuntimeContext': { useWalletRuntime: () => runtime },
        './SourceLabel': () => null, './ChainGate': () => null,
    }, { window: { location: { origin: 'https://testing.example' }, addEventListener() {}, removeEventListener() {} } });
    const step = load('src/app/wizard/config/wizard.json').wizard.checks[id].steps[0];
    const Component = load('src/app/wizard/components/ActionPanel.jsx').default;
    let reviews = 0;
    const props = { step, platform, walletConnectSession: runtime, onResult: (value) => { results.push(value); props.hasRun = true; },
        onError: (error) => errors.push(error), onReview: () => reviews++ };
    const render = () => hooks.render(Component, props);
    const button = (label) => nodes(render()).find((node) => node.props?.onClick && node.props.children === label);
    const start = () => nodes(render()).find((node) => node.props?.onClick && node.props.children === step.ui.content.button.text).props.onClick();
    return { hooks, requests, replies, results, errors, read, render, props, button, start, reviews: () => reviews };
}

test('Clear message signing UI sends all three real requests only after manual clicks', async () => {
    const ui = actionUI();
    nodes(ui.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    const running = ui.start(); await flush();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].method, 'personal_sign');
    for (let i = 0; i < 3; i++) {
        ui.replies[i].reject(rejected); await flush();
        assert.equal(ui.requests.length, i + 1);
        if (i < 2) { ui.button('Send next request').props.onClick(); await flush(); }
    }
    await running;
    assert.equal(ui.requests.length, 3);
    assert.equal(ui.errors.length, 0);
    assert(ui.results[0].personalSign.error);
    assert(ui.results[0].typedData.error);
    assert.equal(ui.results[0].permit.status, 'rejected_by_user');
    ui.hooks.unmount();
});

for (const options of [{}, { id: 'WSR-THRE-005' }, { platform: 'extension', holdRead: true }]) {
    test(`ActionPanel stop and continue releases ${JSON.stringify(options)} without late follow-up requests`, async () => {
        const ui = actionUI(options);
        const running = ui.start(); await flush();
        const count = ui.requests.length;
        await ui.button('Stop waiting and continue').props.onClick(); await running;
        assert.equal(ui.results.at(-1).request_outcome, 'stopped_waiting');
        assert.equal(ui.reviews(), 1);
        ui.replies.forEach((reply) => reply.reject(rejected)); ui.read.resolve([account]); await flush();
        assert.equal(ui.requests.length, count);
        assert.equal(ui.results.at(-1).request_outcome, 'stopped_waiting');
        assert.equal(ui.errors.length, 0);
        ui.hooks.unmount();
    });
}

test('skip is available even with unmet network prerequisites and never calls the wallet', () => {
    const ui = actionUI();
    ui.props.chainGate = { wrong: true };
    ui.button('Skip step').props.onClick();
    assert.deepEqual(ui.results, [skippedStepResult()]);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.reviews(), 1);
    ui.hooks.unmount();
});

test('unmount terminates a signing sequence without dispatching remaining methods', async () => {
    const ui = actionUI();
    const running = ui.start(); await flush();
    ui.hooks.unmount(); await running;
    ui.replies[0].reject(rejected); await flush();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.results.length, 0);
});

test('revocation probe abort preserves the original identity and prevents subsequent reads', async () => {
    const pending = deferred(), sent = [];
    let hold = false;
    const provider = { request: async ({ method }) => {
        sent.push(method);
        if (hold && method === 'eth_accounts') return pending.promise;
        return method === 'eth_chainId' ? '0x89' : [account];
    } };
    const probe = createRevocationProbe({ provider, transport: 'injected' });
    await probe.captureBaseline(); sent.length = 0; hold = true;
    const signal = new AbortController();
    const checking = probe.check(provider, { signal: signal.signal });
    await flush(); signal.abort(); await assert.rejects(checking);
    pending.resolve([]); await flush();
    assert.deepEqual(sent, ['eth_chainId', 'eth_accounts']);
    probe.dispose();
});

test('a late reply from a stopped signing run cannot replace a new run', async () => {
    const ui = actionUI();
    const first = ui.start(); await flush();
    await ui.button('Stop waiting and continue').props.onClick(); await first;
    const original = ui.results[0];
    const second = ui.start(); await flush();
    ui.replies[0].reject(new Error('Old response')); await flush();
    assert.equal(ui.results.length, 1);
    assert.equal(ui.results[0], original);
    assert.equal(ui.requests.length, 2);
    await ui.button('Stop waiting and continue').props.onClick(); await second;
    ui.replies[1].reject(rejected); await flush(); ui.hooks.unmount();
});

function connectedUI({ hold = false } = {}) {
    const hooks = reactHarness(), saved = [], pending = deferred(), calls = [];
    const provider = { request: async ({ method }) => { calls.push(method); if (hold) return pending.promise;
        return method === 'eth_chainId' ? '0x89' : [account]; } };
    const runtime = { provider, address: account, chainId: '0x89' };
    const load = sourceLoader({ react: hooks.react,
        '../context/WalletRuntimeContext': { useWalletRuntime: () => runtime },
        '../utils/providerIdentity': { getProviderIdentity: () => ({ name: 'Wallet' }) },
        '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => saved.push(structuredClone(record)) },
        '../utils/panelToImage': {}, './PersistedEvidence': () => null, './WizardStepHeader': () => null,
    }, { window: { location: { origin: 'https://testing.example' } } });
    const check = load('src/app/wizard/config/wizard.json').wizard.checks['WSR-PERM-004'];
    const Component = load('src/app/wizard/components/ConnectedDappCheck.jsx').default;
    const render = () => hooks.render(Component, { check, platform: 'extension' });
    const button = (label) => nodes(render()).find((node) => node.props?.onClick && node.props.children === label);
    const skip = () => nodes(render()).find((node) => node.props?.onSkip).props.onSkip();
    return { hooks, saved, pending, calls, render, button, skip };
}

test('connection setup can be skipped without inventing a baseline, second dApp or revocation proof', () => {
    const ui = connectedUI();
    ui.skip();
    ui.button('I disconnected this dApp').props.onClick();
    assert.equal(ui.calls.length, 0);
    const record = ui.saved.at(-1).evidence;
    assert.equal(record.baseline, null);
    assert.equal(record.automatic_verdict, null);
    assert.equal(record.tester_observations.second_dapp_connected, undefined);
    assert.equal(record.tester_observations.revocation_confirmed_by_tester, true);
    assert(ui.button('Check access after disconnecting').props.disabled);
    ui.hooks.unmount();
});

test('connection setup stops while accounts are pending and ignores a late grant', async () => {
    const ui = connectedUI({ hold: true });
    const connecting = ui.button('Connect this dApp').props.onClick(); await flush();
    ui.button('Stop waiting and continue').props.onClick(); await connecting;
    const record = structuredClone(ui.saved.at(-1).evidence);
    assert.equal(record.request_outcome, 'stopped_waiting');
    assert.equal(record.baseline, null);
    ui.pending.resolve([account]); await flush();
    assert.deepEqual(ui.calls, ['eth_requestAccounts']);
    assert.deepEqual(ui.saved.at(-1).evidence, record);
    ui.hooks.unmount();
});

test('skip navigation records a separate neutral event without overwriting request evidence', () => {
    const hooks = reactHarness(), saved = [];
    const load = sourceLoader({ react: hooks.react,
        '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => saved.push(record) },
    });
    const Component = load('src/app/wizard/components/SkipStepButton.jsx').default;
    let advanced = false;
    const tree = hooks.render(Component, { checkId: 'check', platform: 'mobile', stage: 2, title: 'Review', onSkip: () => { advanced = true; } });
    nodes(tree).find((node) => node.type === 'button').props.onClick();
    assert.equal(advanced, true);
    assert.equal(saved[0].step, 'skipped:2');
    assert.equal(saved[0].evidence.request_outcome, 'skipped_by_tester');
    assert.equal(saved[0].evidence.wallet_output, null);
    assert.equal(saved[0].evidence.automatic_verdict, null);
    hooks.unmount();
});

const memoryStorage = () => {
    const values = new Map();
    return { get length() { return values.size; }, key: (i) => [...values.keys()][i],
        getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test('skipping a request after a reload preserves its previously saved response', () => {
    const storage = memoryStorage();
    const load = sourceLoader({}, { window: { sessionStorage: storage, dispatchEvent() {} } });
    const { persistEvidenceRecord, loadCheckEvidence } = load('src/app/wizard/utils/evidenceStorage.mjs');
    const prior = { wallet_output: 'User rejected', automatic_verdict: null };
    persistEvidenceRecord({ platform: 'mobile', checkId: 'test', step: '1/1', evidence: prior });
    persistEvidenceRecord({ platform: 'mobile', checkId: 'test', step: '1/1', evidence: skippedStepResult() });
    const records = loadCheckEvidence('test', 'mobile');
    assert.equal(records.length, 2);
    assert.deepEqual(records.find((record) => record.step === '1/1').evidence, prior);
    assert.equal(records.find((record) => record.step === 'skipped:1/1').evidence.request_outcome, 'skipped_by_tester');
});

test('manual wallet steps can all be skipped without being marked reviewed, and progress can reset', () => {
    const hooks = reactHarness(), storage = memoryStorage();
    const load = sourceLoader({ react: hooks.react, './SourceLabel': () => null, './ImageModal': () => null },
        { window: { localStorage: storage } });
    const Component = load('src/app/wizard/components/StepRenderer.jsx').default;
    const stepConfig = load('src/app/wizard/config/wizard.json').wizard.checks['WSR-PHYS-002~Mobile'].steps[0];
    const render = () => hooks.render(Component, { stepConfig, walletUi: true, platform: 'mobile' });
    render();
    for (let i = 0; i < stepConfig.ui.content.steps.length; i++) {
        const skip = nodes(render()).find((node) => node.props?.onSkip);
        assert(skip, `Missing skip on manual stage ${i + 1}`);
        skip.props.onSkip();
    }
    const finished = render();
    assert.equal(nodes(finished).filter((node) => node.props?.children === 'Reviewed').length, 0);
    assert.equal(nodes(finished).filter((node) => node.props?.children === 'Skipped').length, stepConfig.ui.content.steps.length);
    nodes(finished).find((node) => node.props?.children === 'Reset steps').props.onClick();
    assert.equal(storage.length, 0);
    hooks.unmount();
});
