import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { providerRequestAdapter } from '../src/utils/wallet-methods/providerRequestAdapter.mjs';
import { polygonGuardedProvider } from '../src/utils/wallet-methods/polygonPolicy.mjs';
import { createComparisonRequest } from '../src/utils/wallet-methods/comparisonRequest.mjs';
import { deferred, flush, sourceLoader } from './helpers/sourceHarness.mjs';

const account = `0x${'11'.repeat(20)}`;
const load = sourceLoader();
const { handleAction } = load('src/utils/wallet-methods/actionMethods.js');
const checks = load('src/app/wizard/config/wizard.json').wizard.checks;
const methods = checks['WSR-PERM-002~Mobile'].steps[0].data.params.methods;
const cancelled = Object.freeze({ code: 4001, message: 'User rejected' });

function wallet({ chain = '0x89', reply = () => { throw cancelled; } } = {}) {
    const calls = [];
    const state = { chain, session: { topic: 'first' } };
    const provider = Object.freeze({
        get session() { assert.equal(this, provider); return state.session; },
        request(args) {
            assert.equal(this, provider, 'Call methods on the original provider');
            calls.push(args);
            if (args.method === 'eth_chainId') return Promise.resolve(state.chain);
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return Promise.resolve([account]);
            return reply(args);
        },
    });
    return { provider, calls, state };
}

test('protected request properties work without modifying the provider or payload', async () => {
    for (const protect of [Object.freeze, Object.seal, (provider) => {
        Object.defineProperty(provider, 'request', { writable: false, configurable: false });
        return provider;
    }]) {
        const calls = [];
        const provider = protect({ async request(args) {
            assert.equal(this, provider); calls.push(args);
            return args.method === 'eth_chainId' ? '0x89' : null;
        } });
        const before = Object.getOwnPropertyDescriptors(provider);
        const wrapped = polygonGuardedProvider(provider);
        const payload = Object.freeze({ method: 'personal_sign', params: ['0xab', account] });
        assert.equal(wrapped.request, wrapped.request);
        assert.equal(await wrapped.request(payload), null);
        assert.equal(calls[1], payload);
        assert.deepEqual(Object.getOwnPropertyDescriptors(provider), before);
    }
});

test('the facade preserves live getters, protected methods, symbols and event receiver identity', () => {
    const marker = Symbol('wallet');
    class Provider {
        #session = { topic: 'first' };
        #listeners = new Set();
        get session() { return this.#session; }
        on(listener) { this.#listeners.add(listener); }
        removeListener(listener) { this.#listeners.delete(listener); }
        replace(session) { this.#session = session; for (const listener of this.#listeners) listener(session); }
    }
    const provider = new Provider();
    provider[marker] = 'test-wallet';
    provider.on = provider.on;
    Object.freeze(provider);
    const request = async () => null;
    const facade = providerRequestAdapter(provider, request);
    const events = [], listener = (value) => events.push(value);
    assert.equal(facade.on, facade.on);
    facade.on(listener);
    provider.replace({ topic: 'second' });
    assert.equal(facade.session, provider.session);
    assert.deepEqual(events, [{ topic: 'second' }]);
    facade.removeListener(listener);
    provider.replace({ topic: 'third' });
    assert.equal(events.length, 1);
    assert.equal(facade[marker], 'test-wallet');
    assert('session' in facade);
    assert('request' in facade);
    assert.equal(facade.request, request);
    assert(Object.keys(facade).includes('on'));
    assert(Reflect.ownKeys(facade).includes(marker));
    assert.equal(Object.getOwnPropertyDescriptor(facade, 'on').get(), facade.on);
    assert.equal(Reflect.set(facade, 'request', null), false);
    assert.equal(Reflect.defineProperty(facade, 'request', { value: null }), false);
    assert.equal(Reflect.deleteProperty(facade, 'request'), false);
    assert.equal(Reflect.preventExtensions(facade), false);
    assert.equal(Reflect.setPrototypeOf(facade, {}), false);
    assert.equal(facade.request, request);
});

test('both nested wrappers preserve wallet errors and actual dispatch diagnostics', async () => {
    const f = wallet();
    const comparison = createComparisonRequest(f.provider);
    const guarded = polygonGuardedProvider(comparison.provider);
    const payload = { method: 'eth_sendTransaction', params: [{ from: account, to: account, value: '0x0' }] };
    await assert.rejects(guarded.request(payload), (error) => error === cancelled);
    assert.equal(f.calls.at(-1), payload);
    assert.deepEqual(comparison.diagnostics.calls.map((call) => [call.method, call.status]), [
        ['eth_chainId', 'fulfilled'], ['eth_sendTransaction', 'rejected'],
    ]);
    assert.equal(comparison.diagnostics.transaction_request_invoked, true);
    assert.equal(comparison.diagnostics.calls.at(-1).error.code, 4001);
});

test('protected providers still block privileged requests off Polygon', async () => {
    const f = wallet({ chain: '0x1' });
    const comparison = createComparisonRequest(polygonGuardedProvider(f.provider));
    await assert.rejects(comparison.provider.request({ method: 'personal_sign' }), (error) => error.networkPrecondition && error.requestNotSent);
    assert.deepEqual(f.calls, [{ method: 'eth_chainId' }]);
    assert.equal(comparison.diagnostics.calls[0].request_submitted, false);
});

test('stopping a protected-provider request preserves late settlement without resending', async () => {
    const pending = deferred(), late = [], control = new AbortController();
    const f = wallet({ reply: () => pending.promise });
    const comparison = createComparisonRequest(f.provider, { signal: control.signal, onLateSettlement: (value) => late.push(value) });
    const result = assert.rejects(comparison.provider.request({ method: 'eth_sendTransaction' }), (error) => error.requestNotSent);
    await flush(); control.abort(); await result;
    assert.equal(comparison.interruption.source, 'tester');
    assert.equal(comparison.interruption.request_submitted, true);
    pending.reject(cancelled); await flush();
    assert.equal(late[0].outcome, 'cancelled_by_tester');
    await assert.rejects(comparison.provider.request({ method: 'eth_sendTransaction' }));
    assert.equal(f.calls.length, 1);
});

test('session replacement on a protected provider prevents stale comparison requests', async () => {
    const f = wallet();
    const comparison = createComparisonRequest(f.provider);
    f.state.session = { topic: 'replacement' };
    await assert.rejects(comparison.provider.request({ method: 'eth_sendTransaction' }), (error) => error.requestNotSent);
    assert.equal(f.calls.length, 0);
});

test('the embedded-browser and extension auth checks dispatch all methods through a frozen provider', async () => {
    const { resolveTransport } = load('src/app/wizard/utils/platform.js');
    for (const [key, platform] of [['WSR-PERM-010~Browser', 'extension'], ['WSR-PERM-010~Mobile', 'mobile']]) {
        const step = checks[key].steps.find((item) => item.ui?.content?.button?.action === 'runAuthBypass');
        assert.notEqual(resolveTransport(platform, step), 'walletconnect');
        const f = wallet({ reply: ({ method }) => {
            if (method === 'eth_decrypt') throw Object.freeze({ code: -32601, message: 'Method not supported' });
            throw cancelled;
        } });
        const rows = await handleAction('extension', 'runAuthBypass', f.provider, step.data.params);
        assert(Array.isArray(rows), JSON.stringify(rows));
        assert.deepEqual(rows.map((row) => row.method), step.data.params.methods);
        assert.deepEqual(f.calls.filter((call) => step.data.params.methods.includes(call.method)).map((call) => call.method), step.data.params.methods);
        assert(rows.every((row) => row.request_submitted));
        assert.equal(rows.find((row) => row.method === 'eth_decrypt').rpc_error.code, -32601);
        assert(rows.filter((row) => row.method !== 'eth_decrypt').every((row) => row.outcome === 'cancelled_by_tester'));
    }
});

test('frozen WalletConnect providers retain their client, permissions and Polygon route', async () => {
    const sent = [];
    const session = {
        topic: 'test-session', namespaces: { eip155: { accounts: [`eip155:137:${account}`], methods } },
        optionalNamespaces: { eip155: { chains: ['eip155:137'], methods } },
    };
    const client = Object.freeze({
        session: { get: () => session },
        request(args) { assert.equal(this, client); sent.push(args); throw cancelled; },
    });
    const provider = Object.freeze({ session, client, async request({ method }) {
        assert.equal(this, provider);
        if (method === 'eth_chainId') return '0x89';
        assert.equal(method, 'eth_accounts'); return [account];
    } });
    const rows = await handleAction('mobile', 'runAuthBypass', provider, { methods, chain: 'polygon', __wcChainId: '0x89' });
    assert.deepEqual(sent.map((call) => call.request.method), methods);
    assert(sent.every((call) => call.chainId === 'eip155:137'));
    assert(rows.every((row) => row.outcome === 'cancelled_by_tester' && row.request_submitted));
    assert.deepEqual(rows[0].runtime.session_permissions.requested_methods, methods);
});

test('network-read errors preserve their cause and are not mislabeled as incomplete setup', async () => {
    const Result = load('src/app/wizard/components/GuidedRequestResult.jsx').default;
    const message = 'Wallet provider unavailable';
    const provider = Object.freeze({ request: () => { throw new Error(message); } });
    const result = await handleAction('extension', 'runAuthBypass', provider, { methods, chain: 'polygon' });
    assert.equal(result.at, 'chain_read');
    assert.equal(result.message, message);
    const html = renderToStaticMarkup(Result({ action: 'runAuthBypass', success: result }));
    assert.match(html, /Wallet network read failed — request not sent/);
    assert.match(html, /Wallet provider unavailable/);
    assert.doesNotMatch(html, /Network preparation did not complete/);
    const switchHtml = renderToStaticMarkup(Result({ action: 'runAuthBypass', success: { ...result, at: 'chain_switch' } }));
    assert.match(switchHtml, /Network preparation did not complete — request not sent/);
});
