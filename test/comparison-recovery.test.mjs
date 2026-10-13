import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { sourceLoader, reactHarness, nodes, deferred, flush } from './helpers/sourceHarness.mjs';
import { createComparisonRequest } from '../src/utils/wallet-methods/comparisonRequest.mjs';

const account = `0x${'11'.repeat(20)}`, hash = `0x${'22'.repeat(32)}`;
const cancel = { code: -32000, message: 'User canceled' };
const expiry = { code: 'EXPIRED', message: 'Request expired. Please try again.' };

function wallet(topic = 'first') {
    const calls = [], transactions = [];
    const provider = {
        session: { topic, peer: { metadata: { name: 'Test wallet', url: 'https://wallet.test' } } },
        request(args) {
            assert.equal(this, provider);
            calls.push(structuredClone(args));
            if (args.method === 'eth_chainId') return Promise.resolve('0x89');
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return Promise.resolve([account]);
            assert.equal(args.method, 'eth_sendTransaction');
            const reply = deferred(); transactions.push({ args, ...reply }); return reply.promise;
        },
    };
    return { provider, calls, transactions };
}

function fixture({ platform = 'mobile', id = 'WSR-THRE-002', timeoutMs } = {}) {
    const hooks = reactHarness(), first = wallet(), saved = [], copied = [], events = [];
    if (platform === 'extension') delete first.provider.session;
    const runtime = { provider: first.provider, address: account, chainId: '0x89',
        disconnect: async () => { events.push('disconnect'); runtime.provider = null; runtime.address = null; runtime.chainId = null; },
        open: async () => { events.push('open'); },
    };
    const load = sourceLoader({ react: hooks.react,
        '../../../utils/wallet-methods/comparisonRequest.mjs': { createComparisonRequest: (provider, options) => createComparisonRequest(provider, { ...options, timeoutMs }) },
        '../context/WalletRuntimeContext': { useWalletRuntime: () => runtime },
        '../utils/providerIdentity': { getProviderIdentity: () => ({ name: 'Test wallet' }) },
        '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => { saved.push(structuredClone(record)); events.push(`saved:${record.step}`); } },
        '../utils/panelToImage': {}, './RuntimeIdentity': () => null, './PersistedEvidence': () => null,
        './WizardStepHeader': () => null,
    }, { window: { location: { origin: 'http://localhost:3000' } }, navigator: { clipboard: { writeText: async (text) => copied.push(text) } } });
    const check = load('src/app/wizard/config/wizard.json').wizard.checks[id];
    const presentation = load('src/app/wizard/utils/guidedComparison.mjs').GUIDED_COMPARISONS[check.canonicalId];
    const Component = load('src/app/wizard/components/GuidedComparisonCheck.jsx').default;
    const render = () => hooks.render(Component, { check, platform, presentation });
    const button = (label) => nodes(render()).find((n) => n.props?.onClick && n.props.children === label);
    const click = (label) => { const node = button(label); assert(node, `Missing: ${label}`); assert(!node.props.disabled, `Disabled: ${label}`); return node.props.onClick(); };
    const phase = () => nodes(render()).filter((n) => n.type === 'li').findIndex((n) => n.props['aria-current'] === 'step');
    const connect = (next = wallet('second')) => {
        runtime.provider = next.provider; runtime.address = account; runtime.chainId = '0x89'; render(); return next;
    };
    const drop = () => { first.provider.session = null; runtime.provider = null; runtime.address = null; runtime.chainId = null; render(); };
    const evidence = async () => { await nodes(render()).find((n) => n.props?.onCopyEvidence).props.onCopyEvidence(); return JSON.parse(copied.at(-1)); };
    return { hooks, first, runtime, saved, copied, events, check, render, button, click, phase, connect, drop, evidence };
}

test('reconnect resumes the lookalike step with setup, history, errors and late responses intact', async () => {
    const ui = fixture(), frozen = JSON.stringify(ui.check);
    const setup = ui.click('Send setup transaction'); await flush();
    ui.first.transactions[0].resolve(hash); await setup;
    const originalSetup = structuredClone(ui.saved[0]);
    await ui.click('I confirmed it in wallet history');
    const malicious = ui.click('Send malicious-address request'); await flush();
    ui.drop();
    const reconnect = ui.button('Reconnect and resume').props.onClick;
    const recovery = reconnect();
    await reconnect(); // stale/double click must not dispatch
    await recovery; await malicious;
    const firstEvidence = await ui.evidence();
    assert.equal(firstEvidence[1].request_outcome, 'stopped_waiting');
    assert.equal(firstEvidence[1].wait_stopped.request_submitted, true);
    assert.equal(firstEvidence[1].wallet_output, null);
    assert.deepEqual(ui.saved[0], originalSetup);
    assert.deepEqual(ui.events, ['saved:1/3', 'saved:2/3', 'open']);
    const second = ui.connect();
    await ui.click('Resume with next step');
    assert.equal(ui.phase(), 2);
    assert.equal(second.calls.length, 0, 'Resume must not send a request automatically');
    assert(!ui.button('Send lookalike-address request').props.disabled);
    const lookalike = ui.click('Send lookalike-address request'); await flush();
    second.transactions[0].reject(cancel); await lookalike;
    const evidence = await ui.evidence();
    assert.deepEqual(evidence[2].history_precondition, firstEvidence[1].history_precondition);
    assert.equal(evidence[2].history_precondition.setup_transaction_hash, hash);
    assert.equal(evidence[2].runtime.connection_attempt, 2);
    assert.equal(evidence[2].runtime.chain_id, '0x89');
    assert.equal(evidence[2].runtime.from, account);
    assert.deepEqual(evidence[2].resumed_after_reconnecting, { connection_attempt: 1, after_step: '2/3' });
    assert.equal(evidence[2].request_outcome, 'cancelled_by_tester');
    assert(evidence.every((r) => r.automatic_verdict === null));
    ui.first.transactions[1].reject(expiry); await flush();
    const late = await ui.evidence();
    assert.equal(late[1].request_outcome, 'stopped_waiting');
    assert.deepEqual(late[1].late_settlement, { outcome: 'request_expired', rpc_error: expiry });
    assert.deepEqual(late[2], evidence[2]);
    assert.deepEqual(late[0], originalSetup.evidence);
    assert.equal(ui.first.transactions.length, 2);
    assert.equal(second.transactions.length, 1);
    assert.equal(JSON.stringify(ui.check), frozen);
    ui.hooks.unmount();
});

test('a recorded wallet error survives recovery; reconnection does not invent a malicious-address verdict', async () => {
    const ui = fixture();
    await ui.click('This recipient is already in my history');
    const run = ui.click('Send malicious-address request'); await flush();
    ui.drop();
    ui.first.transactions[0].reject({ code: -32603, message: 'Wallet disconnected the session', data: { reason: 'blocked' } });
    await run;
    const original = (await ui.evidence())[0];
    await ui.click('Reconnect and resume');
    ui.connect(); await ui.click('Resume with next step');
    assert.deepEqual((await ui.evidence())[0], original);
    assert.equal(original.rpc_error.code, -32603);
    assert.equal(original.automatic_verdict, null);
    assert.equal(ui.phase(), 2);
    ui.hooks.unmount();
});

test('recovery rejects the old session, wrong account, wrong wallet and any non-Polygon chain', async () => {
    const ui = fixture();
    await ui.click('This recipient is already in my history');
    const running = ui.click('Send malicious-address request'); await flush();
    ui.runtime.disconnect = async () => { throw new Error('Disconnect failed'); };
    await ui.click('Reconnect and resume'); await running;
    assert.equal(ui.button('Resume with next step'), undefined);
    assert(!ui.events.includes('open'));
    const second = ui.connect();
    const staleResume = ui.button('Resume with next step').props.onClick;
    for (const changed of [
        () => { ui.runtime.address = `0x${'33'.repeat(20)}`; },
        () => { ui.runtime.chainId = '0x1'; },
        () => { second.provider.session.peer.metadata.name = 'Other wallet'; },
    ]) {
        changed(); ui.render();
        assert.equal(ui.button('Resume with next step'), undefined);
        staleResume(); assert.equal(ui.phase(), 1);
        ui.runtime.address = account; ui.runtime.chainId = '0x89'; second.provider.session.peer.metadata.name = 'Test wallet';
    }
    await ui.click('Resume with next step');
    assert.equal(ui.phase(), 2);
    assert.equal(second.transactions.length, 0);
    ui.first.transactions[0].reject(cancel); await flush(); ui.hooks.unmount();
});

for (const method of ['eth_chainId', 'eth_requestAccounts']) test(`stopping during ${method} never sends a late setup transaction`, async () => {
    const ui = fixture(), read = deferred(), original = ui.first.provider.request;
    ui.first.provider.request = function (args) { return args.method === method ? read.promise : original.call(this, args); };
    const running = ui.click('Send setup transaction'); await flush();
    await ui.click('Reconnect and resume'); await running;
    const evidence = (await ui.evidence())[0];
    assert.equal(evidence.wait_stopped.request_submitted, false);
    assert.equal(evidence.request_diagnostics.transaction_request_invoked, false);
    assert.equal(evidence.wallet_output, null);
    const second = ui.connect();
    await ui.click('Continue to history confirmation');
    assert.equal(ui.phase(), 0, 'Reconnection does not confirm setup history');
    read.resolve(method === 'eth_chainId' ? '0x89' : [account]); await flush();
    assert.equal(ui.first.transactions.length, 0);
    assert.equal(second.calls.length, 0);
    assert.equal(ui.button('I confirmed it in wallet history'), undefined);
    ui.hooks.unmount();
});

test('a replacement session on the same provider object is accepted only through explicit resume', async () => {
    const ui = fixture();
    await ui.click('This recipient is already in my history');
    const running = ui.click('Send malicious-address request'); await flush();
    await ui.click('Reconnect and resume'); await running;
    ui.first.provider.session = { ...ui.first.provider.session, topic: 'replacement' };
    ui.connect(ui.first);
    await ui.click('Resume with next step');
    assert.equal(ui.phase(), 2);
    assert(!ui.button('Send lookalike-address request').props.disabled);
    ui.first.transactions[0].resolve(hash); await flush();
    assert.equal((await ui.evidence())[0].late_settlement.wallet_output, hash);
    assert.equal(ui.first.transactions.length, 1);
    ui.hooks.unmount();
});

test('leaving while disconnecting preserves the saved observation but never opens another connection', async () => {
    const ui = fixture(), disconnect = deferred();
    await ui.click('This recipient is already in my history');
    const running = ui.click('Send malicious-address request'); await flush();
    ui.runtime.disconnect = () => disconnect.promise;
    const reconnecting = ui.click('Reconnect and resume'); await flush(); await running;
    assert.equal(ui.saved.length, 1);
    ui.hooks.unmount(); disconnect.resolve(); await reconnecting;
    ui.first.transactions[0].reject(cancel); await flush();
    assert(!ui.events.includes('open'));
    assert.equal(ui.saved.length, 1);
});

test('a timed-out provider read cannot dispatch more RPCs even when its old reply arrives', async () => {
    const w = wallet(), read = deferred(), late = [];
    w.provider.request = () => read.promise;
    const control = createComparisonRequest(w.provider, { timeoutMs: 5, onLateSettlement: (value) => late.push(value) });
    await assert.rejects(control.provider.request({ method: 'eth_requestAccounts' }));
    assert.deepEqual(control.interruption, { source: 'timeout', stage: 'eth_requestAccounts', request_submitted: false });
    await assert.rejects(control.provider.request({ method: 'eth_sendTransaction', params: [] }), (e) => e.requestNotSent);
    read.resolve([account]); await flush();
    assert.equal(control.diagnostics.calls.length, 1);
    assert.deepEqual(late, []);
});

test('a timed-out malicious request remains inconclusive and its late rejection stays in the copied and saved evidence', async () => {
    const ui = fixture({ timeoutMs: 5 });
    await ui.click('This recipient is already in my history');
    await ui.click('Send malicious-address request');
    const initial = (await ui.evidence())[0];
    assert.equal(initial.request_outcome, 'no_response');
    assert.equal(initial.wait_stopped.source, 'timeout');
    assert.equal(initial.wait_stopped.request_submitted, true);
    assert.equal(initial.rpc_error, undefined);
    assert.equal(ui.phase(), 1);
    await ui.click('Reconnect and resume');
    assert(ui.events.indexOf('saved:2/3') < ui.events.indexOf('disconnect'));
    const second = ui.connect(); await ui.click('Resume with next step');
    ui.first.transactions[0].reject(cancel); await flush();
    const result = (await ui.evidence())[0];
    assert.equal(result.request_outcome, 'no_response');
    assert.equal(result.late_settlement.outcome, 'cancelled_by_tester');
    assert.deepEqual(ui.saved.at(-1).evidence, result);
    assert.equal(second.calls.length, 0);
    ui.hooks.unmount();
});

test('recovery from the lookalike request leads to manual entry and never reruns either recipient', async () => {
    const ui = fixture();
    await ui.click('This recipient is already in my history');
    const malicious = ui.click('Send malicious-address request'); await flush();
    ui.first.transactions[0].reject(cancel); await malicious;
    await ui.click('Check the lookalike address');
    const lookalike = ui.click('Send lookalike-address request'); await flush();
    await ui.click('Reconnect and resume'); await lookalike;
    const second = ui.connect(); await ui.click('Resume with next step');
    assert.equal(ui.phase(), 3);
    assert.equal(second.calls.length, 0);
    assert.equal((await ui.evidence()).length, 2);
    ui.first.transactions[1].reject(expiry); await flush();
    assert.equal(ui.first.transactions.length, 2);
    ui.hooks.unmount();
});

test('ordinary extension and other comparison checks do not acquire reconnection controls', async () => {
    for (const options of [{ platform: 'extension' }, { id: 'WSR-VERI-002' }]) {
        const ui = fixture(options);
        assert.doesNotMatch(renderToStaticMarkup(ui.render()), /Reconnect and resume/);
        ui.hooks.unmount();
    }
});

const checksumButton = 'Send Invalid Checksum Transaction';
const checksumTarget = '0x02970EA171A97EB0d627CB7EC9ABaC308253C716';

for (const platform of ['mobile', 'extension']) {
    test(`checksum ${platform}: stop preserves the submitted request and late reply without resending`, async () => {
        const ui = fixture({ platform, id: 'WSR-VERI-001' });
        const run = ui.click(checksumButton); await flush();
        assert.equal(ui.first.transactions.length, 1);
        assert.deepEqual(ui.first.transactions[0].args.params[0], {
            from: account, to: checksumTarget, value: '0x0', data: '0x',
        });
        const stop = ui.button('Stop waiting and continue').props.onClick;
        stop(); stop(); await run;
        const [entry] = await ui.evidence();
        assert.equal(entry.request_outcome, 'stopped_waiting');
        assert.equal(entry.wallet_output, null);
        assert.equal(entry.automatic_verdict, null);
        assert.equal(entry.runtime.chain_id, '0x89');
        assert.equal(entry.parameters.target, checksumTarget);
        assert.deepEqual(entry.wait_stopped, { source: 'tester', stage: 'transaction_request', request_submitted: true });
        assert.equal(ui.phase(), 1);
        const panel = nodes(ui.render()).find((node) => node.props?.ref);
        const html = renderToStaticMarkup(panel);
        assert.match(html, /<details open=""><summary[^>]*>Response details/);
        assert.match(html, /Waiting ended during: <code>transaction_request/);
        assert.match(html, /Transaction request submitted to provider: yes/);
        assert.match(html, /wallet request was not cancelled/);
        await ui.click('No address shown — continue');
        assert.equal(ui.phase(), 2);
        ui.first.transactions[0].resolve(hash); await flush();
        const [late] = await ui.evidence();
        assert.equal(late.request_outcome, 'stopped_waiting');
        assert.equal(late.late_settlement.wallet_output, hash);
        assert.equal(late.automatic_verdict, null);
        assert.deepEqual(ui.saved.at(-1).evidence, late);
        assert.equal(ui.first.transactions.length, 1);
        assert.deepEqual(ui.events.filter((event) => ['open', 'disconnect'].includes(event)), []);
        ui.hooks.unmount();
    });

    for (const method of ['eth_chainId', platform === 'mobile' ? 'eth_requestAccounts' : 'eth_accounts']) {
        test(`checksum ${platform}: stop during ${method} prevents late transaction dispatch`, async () => {
            const ui = fixture({ platform, id: 'WSR-VERI-001' }), read = deferred();
            const original = ui.first.provider.request;
            ui.first.provider.request = function (args) { return args.method === method ? read.promise : original.call(this, args); };
            const run = ui.click(checksumButton); await flush();
            await ui.click('Stop waiting and continue'); await run;
            const [entry] = await ui.evidence();
            assert.equal(entry.wait_stopped.request_submitted, false);
            assert.equal(entry.wait_stopped.stage, method);
            assert.equal(entry.request_diagnostics.transaction_request_invoked, false);
            assert.equal(entry.automatic_verdict, null);
            assert.match(renderToStaticMarkup(ui.render()), /Transaction request submitted to provider: no/);
            read.resolve(method === 'eth_chainId' ? '0x89' : [account]); await flush();
            assert.equal(ui.first.transactions.length, 0);
            assert.equal(ui.phase(), 1);
            ui.hooks.unmount();
        });
    }

    test(`checksum ${platform}: timeout releases the button and records late expiry`, async () => {
        const ui = fixture({ platform, id: 'WSR-VERI-001', timeoutMs: 5 });
        await ui.click(checksumButton);
        assert(!ui.button('Run this request again').props.disabled);
        const [entry] = await ui.evidence();
        assert.equal(entry.request_outcome, 'no_response');
        assert.equal(entry.wait_stopped.source, 'timeout');
        assert.equal(entry.wait_stopped.request_submitted, true);
        await ui.click('Continue as inconclusive');
        assert.equal(ui.phase(), 1);
        ui.first.transactions[0].reject(expiry); await flush();
        const [late] = await ui.evidence();
        assert.deepEqual(late.late_settlement, { outcome: 'request_expired', rpc_error: expiry });
        assert.equal(late.request_outcome, 'no_response');
        assert.equal(ui.first.transactions.length, 1);
        ui.hooks.unmount();
    });

    test(`checksum ${platform}: a read timeout records an unsent transaction and blocks late continuation`, async () => {
        const ui = fixture({ platform, id: 'WSR-VERI-001', timeoutMs: 5 }), read = deferred();
        ui.first.provider.request = () => read.promise;
        await ui.click(checksumButton);
        const [entry] = await ui.evidence();
        assert.equal(entry.request_outcome, 'no_response');
        assert.equal(entry.wait_stopped.request_submitted, false);
        assert.equal(entry.wait_stopped.stage, platform === 'mobile' ? 'eth_chainId' : 'eth_accounts');
        assert.equal(entry.request_diagnostics.calls.length, 1);
        read.resolve(platform === 'mobile' ? '0x89' : [account]); await flush();
        assert.equal(ui.first.transactions.length, 0);
        assert.equal(ui.saved.length, 1);
        ui.hooks.unmount();
    });

    test(`checksum ${platform}: the no-data probe can stop without replacing normal evidence`, async () => {
        const ui = fixture({ platform, id: 'WSR-VERI-001' });
        const normal = ui.click(checksumButton); await flush();
        ui.first.transactions[0].reject(cancel); await normal;
        const original = await ui.evidence();
        const probe = ui.click('Try original format (no data)'); await flush();
        assert.equal(Object.hasOwn(ui.first.transactions[1].args.params[0], 'data'), false);
        await ui.click('Stop waiting'); await probe;
        assert.equal(ui.phase(), 0);
        ui.first.transactions[1].reject(expiry); await flush();
        await ui.click('Copy diagnostic JSON');
        const [diagnostic] = JSON.parse(ui.copied.at(-1));
        assert.equal(diagnostic.diagnostic_variant, 'omitted_data');
        assert.equal(diagnostic.request_outcome, 'stopped_waiting');
        assert.equal(diagnostic.late_settlement.outcome, 'request_expired');
        assert.deepEqual(await ui.evidence(), original);
        assert.equal(ui.saved.length, 1);
        ui.hooks.unmount();
    });

    test(`checksum ${platform}: unmount stops a pending read without dispatching later`, async () => {
        const ui = fixture({ platform, id: 'WSR-VERI-001' }), read = deferred();
        ui.first.provider.request = () => read.promise;
        const run = ui.click(checksumButton); await flush();
        ui.hooks.unmount(); await run;
        read.resolve([account]); await flush();
        assert.equal(ui.saved.length, 0);
        assert.equal(ui.first.transactions.length, 0);
        assert(!ui.events.includes('open'));
    });
}

test('checksum WalletConnect recovery preserves evidence and resumes address comparison only', async () => {
    const ui = fixture({ id: 'WSR-VERI-001' });
    const run = ui.click(checksumButton); await flush();
    await ui.click('Reconnect and resume'); await run;
    const original = await ui.evidence();
    assert(ui.events.indexOf('saved:1/1') < ui.events.indexOf('disconnect'));
    ui.connect();
    ui.runtime.chainId = '0x1'; ui.render();
    assert.equal(ui.button('Resume with next step'), undefined);
    ui.runtime.chainId = '0x89'; ui.runtime.address = `0x${'33'.repeat(20)}`; ui.render();
    assert.equal(ui.button('Resume with next step'), undefined);
    const second = ui.connect();
    await ui.click('Resume with next step');
    assert.equal(ui.phase(), 1);
    assert.deepEqual(await ui.evidence(), original);
    assert.equal(second.calls.length, 0);
    ui.first.transactions[0].reject(cancel); await flush();
    assert.equal((await ui.evidence())[0].late_settlement.outcome, 'cancelled_by_tester');
    ui.hooks.unmount();
});
