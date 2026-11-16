import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { requestChainSwitch } from '../src/utils/wallet-methods/chainSwitchProbe.mjs';
import { sourceLoader, reactHarness, nodes, deferred, flush } from './helpers/sourceHarness.mjs';

const account = `0x${'12'.repeat(20)}`;
for (const response of ['success', 'unchanged', 'rejected', 'unsupported']) {
    test(`switch observation preserves before/after and ${response} without a verdict`, async () => {
        const calls = []; let selected = '0x89';
        const provider = { request: async (request) => {
            calls.push(request.method);
            if (request.method === 'eth_chainId') return selected;
            if (response === 'success') selected = '0x1';
            if (response === 'rejected') throw { code: 4001, message: 'Rejected' };
            if (response === 'unsupported') throw { code: 4200, message: 'Unsupported' };
            return null;
        } };
        const result = await requestChainSwitch({ provider, chainId: '0x1', requirePolygon: false });
        assert.deepEqual(calls, ['eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId']);
        assert.equal(result.chain_before.chain_id, '0x89');
        assert.equal(result.chain_after.chain_id, response === 'success' ? '0x1' : '0x89');
        if (['success', 'unchanged'].includes(response)) assert.equal(result.response, null);
        else assert.equal(result.error.code, response === 'rejected' ? 4001 : 4200);
        assert.equal(result.confirmation, undefined);
        assert.equal(result.automatic_verdict, undefined);
    });
}
for (const failed of ['before', 'after', 'both']) test(`failed ${failed} read is retained without suppressing an injected switch`, async () => {
    let reads = 0; let sent = 0;
    const result = await requestChainSwitch({ chainId: '0x144', requirePolygon: false, provider: { request: async ({ method }) => {
        if (method === 'wallet_switchEthereumChain') { sent++; return null; }
        reads++;
        if (failed === 'both' || (failed === 'before' ? reads === 1 : reads === 2)) throw { code: -32000, message: 'Read failed' };
        return '0x1';
    } } });
    assert.equal(sent, 1); assert.equal(reads, 2);
    for (const name of ['before', 'after']) {
        if (failed === name || failed === 'both') assert.deepEqual(result[`chain_${name}`].error, { code: -32000, message: 'Read failed' });
        else assert.equal(result[`chain_${name}`].chain_id, '0x1');
    }
});

function fixture({ initial = [], pending = false, platform = 'extension' } = {}) {
    const hooks = reactHarness(), calls = [], saved = new Map(), copied = [];
    const reply = deferred(); let selected = '0x89';
    const provider = { request: async (request) => {
        calls.push(request);
        if (request.method === 'eth_chainId') return selected;
        if (request.method === 'wallet_switchEthereumChain') {
            if (pending) return reply.promise;
            selected = request.params[0].chainId; return null;
        }
        if (request.method === 'eth_sendTransaction') throw { code: 4001, message: 'User rejected' };
        assert.fail(`Unexpected method ${request.method}`);
    } };
    const injected = { provider, address: account, chainId: '0x89' };
    const wcProvider = { request: async () => '0x89', session: { topic: 'session', namespaces: {} } };
    wcProvider.client = { session: { get: () => wcProvider.session }, request: async (request) => { calls.push(request); return null; } };
    const wc = { provider: wcProvider, address: account, chainId: '0x89' };
    const load = sourceLoader({ react: hooks.react,
        '../context/WalletRuntimeContext': { useWalletRuntime: (transport) => transport === 'walletconnect' ? wc : injected },
        '../utils/evidenceStorage.mjs': { loadCheckEvidence: () => initial.map((evidence) => ({ evidence })),
            persistEvidenceRecord: (record) => saved.set(record.step, structuredClone(record.evidence)) },
        '../utils/panelToImage': {}, './WizardStepHeader': () => null,
    }, { window: { location: { origin: 'https://example.test' } }, navigator: { clipboard: { writeText: async (value) => copied.push(JSON.parse(value)) } } });
    const check = load('src/app/wizard/config/wizard.json').wizard.checks['WSR-PERM-009'];
    const Component = load('src/app/wizard/components/ChainSwitchCheck.jsx').default;
    const render = () => hooks.render(Component, { check, platform });
    const click = (label, index = 0) => {
        const button = nodes(render()).filter((node) => node.props.onClick && node.props.children === label)[index];
        assert(button, label); assert(!button.props.disabled, label); return button.props.onClick();
    };
    const observations = () => nodes(render()).filter((node) => typeof node.type === 'function' && node.type.name === 'Choice');
    const exported = async () => { await nodes(render()).find((node) => node.props.onCopyEvidence).props.onCopyEvidence(); return copied.at(-1); };
    return { render, click, calls, saved, exported, observations, injected, reply, hooks };
}

for (const platform of ['extension', 'mobile']) test(`${platform} follows navbar without another platform or connection control`, async () => {
    const f = fixture({ platform });
    const markup = renderToStaticMarkup(f.render());
    assert.doesNotMatch(markup, /Test channel|Select the channel|Connect selected channel/);
    assert.equal(nodes(f.render()).filter((node) => node.type === 'select').length, 0);
    await f.click('Request network switch');
    await f.click(platform === 'mobile' ? 'Record transaction probe limitation' : 'Inspect transaction network');
    f.observations()[0].props.onChange('No');
    f.observations()[3].props.onChange('Yes');
    assert.match(renderToStaticMarkup(f.render()), /choose a network that is not approved/);
    const first = (await f.exported())[0];
    assert.equal(first.channel, platform);
    assert.equal(first.runtime.platform, platform);
    assert.equal(first.runtime.channel_source, 'navbar');
    assert.equal(first.runtime.transport, platform === 'mobile' ? 'walletconnect' : 'extension');
    assert.equal(first.switch_result.chain_after.chain_id, platform === 'mobile' ? '0x89' : '0x1');
    assert.equal(first.verification_attempts[0].status, platform === 'mobile' ? 'unavailable' : 'cancelled');
    assert.equal(first.tester_observations.confirmation, 'No');
    assert.equal(first.automatic_verdict, null);
    await f.click('Request network switch', 1);
    const result = await f.exported();
    assert.equal(result.length, 2); assert.equal(f.saved.size, 2);
    assert.deepEqual(result[0], first);
    assert.equal(new Set(result.map((record) => record.step)).size, 2);
    assert(f.calls.every((request) => !['wallet_addEthereumChain', 'eth_signTypedData_v4'].includes(request.method)));
    if (platform === 'mobile') assert(f.calls.every((request) => request.chainId === 'eip155:137'));
    else assert(f.calls.every((request) => request.method));
});

test('stopping a pending attempt preserves it and late settlement cannot overwrite a newer attempt', async () => {
    const f = fixture({ pending: true });
    const first = f.click('Request network switch'); await flush();
    await f.click('Stop waiting'); await first;
    const original = structuredClone([...f.saved.values()][0]);
    assert.equal(original.switch_result.status, 'switch_stopped_waiting');
    const second = f.click('Request network switch', 1); await flush();
    f.reply.reject({ code: 4001, message: 'Late rejection' }); await second;
    assert.deepEqual([...f.saved.values()][0], original);
    assert.equal(f.saved.size, 2);
});

test('connection changes and restored evidence cannot silently route follow-up requests', async () => {
    const f = fixture(); await f.click('Request network switch');
    const records = await f.exported(); const before = f.calls.length;
    f.injected.address = `0x${'34'.repeat(20)}`;
    await f.click('Inspect transaction network');
    assert.equal(f.calls.length, before);
    const restored = fixture({ initial: records });
    await restored.click('Inspect transaction network');
    assert.equal(restored.calls.length, 0);
    assert.deepEqual(await restored.exported(), records);
});

test('unmount stops the wait and retains the attempt without dispatching a later request', async () => {
    const f = fixture({ pending: true });
    const run = f.click('Request network switch'); await flush(); f.hooks.unmount(); await run;
    const calls = f.calls.length;
    f.reply.resolve(null); await flush();
    assert.equal(f.calls.length, calls);
    assert.equal([...f.saved.values()][0].switch_result.request_submitted, true);
});
