import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPolygon, polygonGuardedProvider } from '../src/utils/wallet-methods/polygonPolicy.mjs';
import { createAuthSessionRequest } from '../src/utils/wallet-methods/wc/authSession.mjs';
import { authConnection, authRecoveryGuard } from '../src/app/wizard/utils/authRecovery.mjs';
import { comparisonObservation, runComparisonStep } from '../src/app/wizard/utils/guidedComparison.mjs';
import { deferred, flush, reactHarness, sourceLoader } from './helpers/sourceHarness.mjs';

const account = `0x${'11'.repeat(20)}`;
const load = sourceLoader();
const { ensurePolygon } = load('src/utils/wallet-methods/chain.js');
const { handleAction } = load('src/utils/wallet-methods/actionMethods.js');
const config = load('src/app/wizard/config/wizard.json').wizard.checks;
const { resolveCheckParams } = load('src/app/wizard/utils/resolveCheckParams.js');

test('auth evidence explicitly declares Polygon without modifying frozen check parameters', () => {
    const before = JSON.stringify(config);
    let checked = 0;
    for (const check of Object.values(config)) {
        for (const step of check.steps) {
            if (step.ui?.content?.button?.action !== 'runAuthBypass') continue;
            const resolved = resolveCheckParams(step);
            assert.equal(resolved.parameters.chain, '0x89', check.canonicalId);
            assert.deepEqual(resolved.parameters.params.methods, step.data.params.methods);
            checked++;
        }
    }
    assert(checked > 0);
    assert.equal(JSON.stringify(config), before);
});
function wallet(chain = '0x89') {
    const calls = [], listeners = new Map();
    const provider = {
        chain, calls, listeners, session: { topic: 'first' },
        async request(args) {
            assert.equal(this, provider, 'Use the original provider binding');
            calls.push(args);
            if (args.method === 'eth_chainId') return this.chain;
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return [account];
            if (args.method === 'wallet_switchEthereumChain') { this.chain = args.params[0].chainId; return null; }
            return null;
        },
        on(name, listener) { listeners.set(name, listener); },
        removeListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
        emit(name, value) { listeners.get(name)?.(value); },
    };
    return provider;
}

test('AppKit offers Polygon as the only connection network and explicit default', () => {
    const polygon = { id: 137 }, configurations = [];
    sourceLoader({
        '@reown/appkit/react': { createAppKit: (options) => configurations.push(options) },
        '@reown/appkit/networks': { polygon },
        '@reown/appkit-adapter-ethers5': { Ethers5Adapter: class {} },
    })('src/components/context/AppKitProvider.jsx');
    assert.equal(configurations.length, 1);
    assert.deepEqual(configurations[0].networks, [polygon]);
    assert.equal(configurations[0].defaultNetwork, polygon);
    assert.equal(configurations[0].allowUnsupportedChain, false);
});

test('network validation accepts normalized Polygon and fails closed for other/unknown networks', async () => {
    for (const chain of ['0x89', 137, '137']) assert.equal(await assertPolygon(wallet(chain)), '0x89');
    for (const chain of ['0x1', '0x144', null, 'invalid']) {
        const provider = wallet(chain);
        await assert.rejects(assertPolygon(provider), (e) => e.requestNotSent && e.networkPrecondition && e.requiredChainId === '0x89');
        assert.deepEqual(provider.calls, [{ method: 'eth_chainId' }]);
    }
    for (const request of [() => { throw new Error('Locked'); }, () => new Promise(() => {})]) {
        await assert.rejects(assertPolygon({ request }, 5), (e) => e.requestNotSent && e.networkPrecondition);
    }
});

test('each privileged request is checked independently without changing payload, binding or retrying', async () => {
    const provider = wallet(), guarded = polygonGuardedProvider(provider);
    const args = Object.freeze({ method: 'eth_signTypedData_v4', params: [account, '{"domain":{"chainId":1}}'] });
    await guarded.request(args);
    assert.equal(provider.calls[1], args, 'Intentional EIP-712 mismatch stays untouched');
    provider.chain = '0x1';
    await assert.rejects(guarded.request({ method: 'personal_sign', params: ['0xab', account] }), (e) => e.requestNotSent);
    assert.deepEqual(provider.calls.map((c) => c.method), ['eth_chainId', 'eth_signTypedData_v4', 'eth_chainId']);
});

test('read-only probes remain read-only, while Polygon connection setup can run from another network', async () => {
    const provider = wallet('0x1'), guarded = polygonGuardedProvider(provider);
    await guarded.request({ method: 'eth_accounts' });
    await guarded.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
    assert.deepEqual(provider.calls.map((c) => c.method), ['eth_accounts', 'wallet_switchEthereumChain']);
    assert.equal(provider.chain, '0x89');
});

test('setup switches to Polygon and verifies it; a null response alone is not success', async () => {
    const provider = wallet('0x1');
    await ensurePolygon(provider);
    assert.equal(provider.chain, '0x89');
    assert.deepEqual(provider.calls, [{ method: 'eth_chainId' }, { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] }, { method: 'eth_chainId' }]);
    const falseSuccess = wallet('0x1');
    const original = falseSuccess.request;
    falseSuccess.request = async function (args) { return args.method === 'wallet_switchEthereumChain' ? null : original.call(this, args); };
    await assert.rejects(ensurePolygon(falseSuccess), /Switch to Polygon/);
});

test('missing Polygon is added, then switched and verified; rejection never makes the connection ready', async () => {
    const provider = wallet('0x1'), original = provider.request;
    let first = true;
    provider.request = async function (args) {
        if (first && args.method === 'wallet_switchEthereumChain') { first = false; throw { code: 4902, message: 'Unknown chain' }; }
        return original.call(this, args);
    };
    await ensurePolygon(provider);
    assert.equal(provider.calls.find((c) => c.method === 'wallet_addEthereumChain').params[0].chainId, '0x89');
    assert.equal(provider.chain, '0x89');
    provider.chain = '0x1';
    provider.request = async (args) => { if (args.method === 'eth_chainId') return '0x1'; throw { code: 4001, message: 'Rejected' }; };
    await assert.rejects(ensurePolygon(provider), /Polygon/);
});

test('changing the selected connection during setup prevents subsequent setup requests', async () => {
    const pending = deferred(), calls = [];
    let current = true;
    const provider = { request(args) { calls.push(args); return pending.promise; } };
    const setup = ensurePolygon(provider, { isCurrent: () => current });
    await flush(); current = false; pending.resolve('0x1');
    await assert.rejects(setup, /connection changed/);
    assert.deepEqual(calls, [{ method: 'eth_chainId' }]);
});

test('extension connection publishes readiness only after Polygon is verified', async () => {
    const provider = wallet('0x1'), events = [], errors = [];
    const { connectToWallet } = sourceLoader({
        '@/app/wizard/utils/selectedProvider': { getActiveProvider: () => provider },
    }, { window: { dispatchEvent: (e) => { assert.equal(provider.chain, '0x89'); events.push(e); } } })('src/utils/walletConnection.js');
    assert.equal(await connectToWallet((e) => errors.push(e)), account);
    assert.equal(events.length, 1);
    assert.deepEqual(errors, []);
});

test('wrong-network transaction preconditions are recorded as not sent, not a wallet refusal', async () => {
    const provider = wallet();
    let reads = 0;
    const original = provider.request;
    provider.request = async function (args) {
        if (args.method === 'eth_chainId' && ++reads === 3) this.chain = '0x1';
        return original.call(this, args);
    };
    const result = await runComparisonStep({ platform: 'mobile', step: config['WSR-THRE-002'].steps[0],
        runtime: { provider, address: account, chainId: '0x89' }, dispatch: handleAction });
    assert.equal(result.error.networkPrecondition, true);
    assert.equal(result.requestDiagnostics.transaction_request_invoked, false);
    assert.equal(result.requestDiagnostics.calls.at(-1).request_submitted, false);
    assert.equal(comparisonObservation(result).title, 'Request not sent — return to Polygon first');
    assert(!provider.calls.some((c) => c.method === 'eth_sendTransaction'));
});

test('direct WalletConnect auth requests stay on Polygon and stop when the current network changes', async () => {
    const provider = wallet(), sent = [];
    provider.session.namespaces = { eip155: { accounts: [`eip155:137:${account}`, `eip155:1:${account}`], methods: ['personal_sign'] } };
    provider.client = { session: { get: () => provider.session }, request: (args) => { sent.push(args); return null; } };
    const request = createAuthSessionRequest(provider, '0x89', account);
    await request({ method: 'personal_sign', params: ['0xab', account] });
    provider.chain = '0x1';
    await assert.rejects(request({ method: 'personal_sign' }), (e) => e.networkPrecondition && e.requestNotSent);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chainId, 'eip155:137');
    await assert.rejects(createAuthSessionRequest(provider, '0x1', account)({ method: 'personal_sign' }), (e) => e.authTransportReason === 'polygon_required');
    const original = authConnection({ provider, address: account, chainId: '0x1' });
    provider.session.topic = 'new';
    assert.match(authRecoveryGuard(original, { provider, address: account, chainId: '0x89' }), /started on another network/);
});

function mountRuntime(provider) {
    const hooks = reactHarness();
    const state = { provider, appKitChain: 1 };
    const events = { addEventListener() {}, removeEventListener() {} };
    const Component = sourceLoader({
        react: hooks.react,
        '../utils/selectedProvider': { useActiveProvider: () => null },
        '@/utils/walletConnection': { WALLET_ACCOUNTS_EVENT: 'test-accounts' },
        '@reown/appkit/react': {
            useAppKit: () => ({ open() {} }), useAppKitAccount: () => ({ address: account }),
            useAppKitNetwork: () => ({ chainId: state.appKitChain }),
            useAppKitProvider: () => ({ walletProvider: state.provider }), useDisconnect: () => ({ disconnect() {} }),
        },
    }, { window: { ...events, localStorage: { setItem() {} } }, document: events })('src/app/wizard/context/WalletRuntimeContext.jsx').WalletRuntimeProvider;
    const render = () => hooks.render(Component, {}).props.value.walletConnect;
    const settle = async () => { for (let i = 0; i < 4; i++) { render(); await flush(); } return render(); };
    return { state, render, settle, unmount: hooks.unmount };
}

test('restored and replacement WC sessions start on Polygon even if AppKit caches Ethereum', async () => {
    const provider = wallet('0x1'), ui = mountRuntime(provider);
    assert.equal((await ui.settle()).chainId, '0x89');
    assert.equal(provider.calls.filter((c) => c.method === 'wallet_switchEthereumChain').length, 1);
    provider.chain = '0x1'; provider.session.topic = 'replacement';
    assert.equal((await ui.settle()).chainId, '0x89');
    assert.equal(provider.calls.filter((c) => c.method === 'wallet_switchEthereumChain').length, 2);
    ui.unmount();
});

test('a later network change is exposed without silently switching back or disturbing a chain-switch test', async () => {
    const provider = wallet(), ui = mountRuntime(provider);
    await ui.settle();
    provider.chain = '0x1'; provider.emit('chainChanged', '0x1');
    assert.equal((await ui.settle()).chainId, '0x1');
    assert(!provider.calls.some((c) => c.method === 'wallet_switchEthereumChain'));
    await ui.render().switchToPolygon();
    assert.equal((await ui.settle()).chainId, '0x89');
    ui.unmount();
});

test('setup rejection remains visibly on the wrong network and permits an explicit retry', async () => {
    const provider = wallet('0x1'), original = provider.request;
    provider.request = async function (args) { if (args.method === 'wallet_switchEthereumChain') throw { code: 4001, message: 'User rejected' }; return original.call(this, args); };
    const ui = mountRuntime(provider);
    const result = await ui.settle();
    assert.equal(result.chainId, '0x1');
    assert.equal(result.networkSetup.busy, false);
    assert.match(result.networkSetup.error, /Polygon/);
    provider.request = original;
    await result.switchToPolygon();
    assert.equal((await ui.settle()).chainId, '0x89');
    ui.unmount();
});

test('missing RPC network does not fall back to a cached Polygon in AppKit', async () => {
    const provider = wallet();
    provider.request = async ({ method }) => { if (method === 'eth_chainId') throw new Error('Unavailable'); return [account]; };
    const ui = mountRuntime(provider); ui.state.appKitChain = 137;
    assert.equal((await ui.settle()).chainId, null);
    ui.unmount();
});

test('leaving during Polygon setup cannot issue more requests or modify the next session', async () => {
    const provider = wallet('0x1'), pending = deferred(), original = provider.request;
    provider.request = async function (args) {
        if (args.method === 'wallet_switchEthereumChain') { provider.calls.push(args); return pending.promise; }
        return original.call(this, args);
    };
    const ui = mountRuntime(provider);
    await ui.settle();
    const count = provider.calls.length;
    ui.unmount(); pending.resolve(null); await flush();
    assert.equal(provider.calls.length, count);
});
