import assert from "node:assert/strict";
import test from "node:test";
import { deferred, flush, reactHarness, sourceLoader } from "./helpers/sourceHarness.mjs";

const A = `0x${"11".repeat(20)}`, B = `0x${"22".repeat(20)}`;
function wallet() {
    const reads = [], listeners = new Map();
    return {
        session: { topic: "session-1" }, reads, listeners,
        request({ method }) { const next = { method, ...deferred() }; reads.push(next); return next.promise; },
        on(name, callback) { listeners.set(name, callback); },
        removeListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
        emit(name, value) { listeners.get(name)?.(value); },
        settle(account, chain, start = 0) {
            reads.slice(start, start + 2).forEach((read) => read.resolve(read.method === "eth_accounts" ? [account] : chain));
        },
    };
}
function mount() {
    const harness = reactHarness(), store = new Map();
    const state = { injected: null, wc: null };
    const events = { addEventListener() {}, removeEventListener() {} };
    const Provider = sourceLoader({
        react: harness.react,
        "../utils/selectedProvider": { useActiveProvider: () => state.injected },
        "@/utils/walletConnection": { WALLET_ACCOUNTS_EVENT: "test-accounts" },
        // Network setup is tested separately; keep these focused on read races.
        "@/utils/wallet-methods/chain": { ensurePolygon: () => new Promise(() => {}) },
        "@reown/appkit/react": {
            useAppKit: () => ({ open() {} }), useAppKitAccount: () => ({}), useAppKitNetwork: () => ({}),
            useAppKitProvider: () => ({ walletProvider: state.wc }),
            useDisconnect: () => ({ disconnect() {} }),
        },
    }, { window: { ...events, localStorage: { setItem: (key, value) => store.set(key, value) } }, document: events })("src/app/wizard/context/WalletRuntimeContext.jsx").WalletRuntimeProvider;
    return { state, store, render: () => harness.render(Provider, {}).props.value, unmount: harness.unmount };
}

for (const [transport, key] of [["injected", "injected"], ["wc", "walletConnect"]]) {
    test(`${transport}: an old wallet read cannot populate the newly selected provider`, async () => {
        const ui = mount(), a = wallet(), b = wallet();
        ui.state[transport] = a; ui.render(); await flush();
        ui.state[transport] = b;
        const changing = ui.render()[key];
        assert.equal(changing.address, null);
        assert.equal(changing.chainId, null);
        await flush(); b.settle(B, "0x1"); await flush();
        assert.equal(ui.render()[key].address, B);
        a.settle(A, "0x89"); await flush();
        const result = ui.render()[key];
        if (transport === 'injected') assert.equal(result.provider, b);
        else {
            assert.equal(result.provider.session, b.session);
            assert.equal(result.provider, result.walletProvider);
            assert.equal(result.provider, changing.provider, 'Stable facade for the same connection');
        }
        assert.equal(result.address, B); assert.equal(result.chainId, "0x1");
        if (transport === "injected") assert.equal(ui.store.get("wizard.lastAddress"), B);
        ui.unmount();
    });
    test(`${transport}: overlapping refreshes and disconnect ignore stale completions`, async () => {
        const ui = mount(), provider = wallet();
        ui.state[transport] = provider; ui.render(); await flush();
        const newer = ui.render()[key].refresh(); await flush();
        provider.settle(B, "0x1", 2); await newer;
        provider.settle(A, "0x89"); await flush();
        assert.equal(ui.render()[key].address, B);
        const pending = ui.render()[key].refresh(); await flush();
        ui.state[transport] = null; assert.equal(ui.render()[key].address, null);
        provider.settle(A, "0x89", 4); await pending;
        assert.equal(ui.render()[key].address, null);
        ui.unmount();
    });
}

test("injected: account and chain events take precedence over a pending read", async () => {
    const ui = mount(), provider = wallet();
    ui.state.injected = provider; ui.render(); await flush();
    provider.emit("accountsChanged", [B]); provider.emit("chainChanged", "0x1");
    provider.settle(A, "0x89"); await flush();
    assert.equal(ui.render().injected.address, B);
    assert.equal(ui.render().injected.chainId, "0x1");
    const lateEvent = provider.listeners.get("accountsChanged");
    ui.state.injected = wallet(); ui.render();
    lateEvent([A]); assert.equal(ui.render().injected.address, null);
    ui.unmount();
});

test("WalletConnect: replacing a session on the same provider discards its old RPC fallback", async () => {
    const ui = mount(), provider = wallet();
    ui.state.wc = provider; ui.render(); await flush();
    provider.session.topic = "session-2"; ui.render(); await flush();
    provider.settle(B, "0x1", 2); await flush();
    provider.settle(A, "0x89"); await flush();
    assert.equal(ui.render().walletConnect.address, B);
    assert.equal(ui.render().walletConnect.chainId, "0x1");
    ui.unmount();
});

test("unmounted runtime ignores late completions", async () => {
    const ui = mount(), provider = wallet();
    ui.state.injected = provider; ui.render(); await flush();
    ui.unmount(); provider.settle(A, "0x89"); await flush();
    assert.equal(ui.render().injected.address, null);
    assert.equal(ui.store.size, 0);
});

test('the real mobile runtime exposes the direct channel to every wizard consumer', async () => {
    const ui = mount(), provider = wallet(), sent = [];
    provider.session.namespaces = { eip155: { methods: [], accounts: [] } };
    provider.client = { request: async (args) => { sent.push(args); return null; } };
    ui.state.wc = provider; ui.render(); await flush();
    provider.settle(A, '0x89'); await flush();
    const first = ui.render().walletConnect;
    await first.provider.request({ method: 'wallet_watchAsset', params: [] });
    await first.walletProvider.request({ method: 'eth_signTypedData_v4', params: [A, '{}'] });
    assert.deepEqual(sent.map((args) => args.request.method), ['wallet_watchAsset', 'eth_signTypedData_v4']);
    assert(sent.every((args) => args.chainId === 'eip155:137' && args.topic === 'session-1'));
    assert(provider.reads.every((args) => ['eth_accounts', 'eth_chainId'].includes(args.method)));
    provider.session.topic = 'session-2';
    const second = ui.render().walletConnect;
    assert.notEqual(first.provider, second.provider);
    await assert.rejects(first.provider.request({ method: 'personal_sign' }), (e) => e.requestNotSent);
    await second.provider.request({ method: 'personal_sign', params: ['0xab', A] });
    assert.equal(sent.at(-1).topic, 'session-2');
    ui.unmount();
});
