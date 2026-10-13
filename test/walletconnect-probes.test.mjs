import assert from 'node:assert/strict';
import test from 'node:test';
import { walletConnectProbeProvider, isWalletProbeMethod } from '../src/utils/wallet-methods/wc/probeProvider.mjs';
import { WALLETCONNECT_METHODS } from '../src/utils/wallet-methods/wc/requestedMethods.mjs';
import { createComparisonRequest } from '../src/utils/wallet-methods/comparisonRequest.mjs';
import { sourceLoader, deferred, flush, reactHarness, nodes } from './helpers/sourceHarness.mjs';

const account = `0x${'11'.repeat(20)}`;
const cancellation = { code: 4001, message: 'User rejected' };
function fixture(reply = async () => { throw cancellation; }) {
    const remote = [], local = [];
    const raw = {
        session: { topic: 'original', namespaces: {} },
        request(args) {
            assert.equal(this, raw);
            local.push(args);
            if (args.method === 'eth_chainId') return Promise.resolve('0x89');
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return Promise.resolve([account]);
            assert.fail(`Wallet probe reached local/HTTP fallback: ${args.method}`);
        },
        client: { request(envelope) {
            assert.equal(this, raw.client);
            remote.push(envelope);
            return reply(envelope);
        } },
    };
    raw.client.session = { get: () => raw.session };
    return { raw, remote, local, provider: walletConnectProbeProvider(raw) };
}

test('all proposed wallet methods use SignClient without approval filtering, mutation or retries', async () => {
    const f = fixture();
    const initial = structuredClone(f.raw.session);
    for (const method of WALLETCONNECT_METHODS.filter((m) => !['eth_accounts', 'eth_requestAccounts'].includes(m))) {
        assert(isWalletProbeMethod(method), method);
        const args = { method, params: ['unaltered test payload'] };
        await assert.rejects(f.provider.request(args), (error) => error === cancellation);
        assert.equal(f.remote.at(-1).request, args);
        assert.equal(f.remote.at(-1).chainId, 'eip155:137');
        assert.equal(f.remote.at(-1).topic, 'original');
    }
    assert.equal(f.remote.length, WALLETCONNECT_METHODS.length - 2);
    assert.deepEqual(f.local, []);
    assert.deepEqual(f.raw.session, initial);
});

test('read-only preparation retains provider binding and frozen providers remain usable', async () => {
    const f = fixture(async () => null);
    Object.freeze(f.raw);
    const provider = walletConnectProbeProvider(f.raw);
    assert.deepEqual(await provider.request({ method: 'eth_accounts' }), [account]);
    assert.equal(await provider.request({ method: 'eth_chainId' }), '0x89');
    assert.equal(await provider.request({ method: 'wallet_watchAsset', params: [] }), null);
    assert.equal(f.remote.length, 1);
    assert.equal(f.local.length, 2);
});

test('wrapped providers preserve errors and never redirect a pending run into a new connection', async () => {
    const error = Object.assign(new Error('Unauthorized method'), { code: 5101, data: { details: 'SDK validation' } });
    const f = fixture(async () => { throw error; });
    const provider = walletConnectProbeProvider({ signer: f.raw, request: f.raw.request.bind(f.raw) });
    await assert.rejects(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }), (e) => e === error);
    f.raw.session.topic = 'replacement';
    await assert.rejects(provider.request({ method: 'personal_sign' }), (e) => e.requestNotSent === true);
    assert.equal(f.remote.length, 1);
    assert.deepEqual(f.local, []);
});

test('stopping a preparation read never dispatches a late transaction through the direct channel', async () => {
    const f = fixture(), read = deferred(), controller = new AbortController();
    f.raw.request = () => read.promise;
    const controlled = createComparisonRequest(f.provider, { signal: controller.signal, timeoutMs: 1000 });
    const pending = controlled.provider.request({ method: 'eth_chainId' });
    controller.abort();
    await assert.rejects(pending);
    read.resolve('0x89'); await flush();
    await assert.rejects(controlled.provider.request({ method: 'eth_sendTransaction', params: [] }));
    assert.deepEqual(f.remote, []);
    assert.equal(controlled.diagnostics.transaction_request_invoked, false);
});

test('stopped direct transactions retain the original late error without a duplicate send', async () => {
    const reply = deferred(), late = [], f = fixture(() => reply.promise), controller = new AbortController();
    const controlled = createComparisonRequest(f.provider, { signal: controller.signal, onLateSettlement: (row) => late.push(row) });
    const pending = controlled.provider.request({ method: 'eth_sendTransaction', params: [{ from: account, value: '0x0' }] });
    await flush(); controller.abort(); await assert.rejects(pending);
    reply.reject(cancellation); await flush();
    assert.equal(f.remote.length, 1);
    assert.equal(late[0].outcome, 'cancelled_by_tester');
    assert.equal(late[0].rpc_error.code, 4001);
    assert.equal(controlled.interruption.request_submitted, true);
});

test('wizard signing, checksum, recipient, token and auth handlers attempt all selected wallet requests', async () => {
    const { handleAction } = sourceLoader()('src/utils/wallet-methods/actionMethods.js');
    const cases = [
        ['siweSign', ['personal_sign']],
        ['differentChainId', ['eth_signTypedData_v4']],
        ['ethSignMethod', ['eth_sign']],
        ['clearMethodSignRequest', ['personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData_v4']],
        ['signPermitAndSeaport', ['eth_signTypedData_v4', 'eth_signTypedData_v4']],
        ['signLongMessageAndTypedData', ['personal_sign', 'eth_signTypedData_v4']],
        ...['sendInvalidChecksumTransaction', 'sendFamiliarRecipientTransaction', 'sendScamTransaction',
            'sendPoisonTransaction', 'sendExplorerLinkTransaction', 'sendUnknownTransaction', 'approveTestErc20']
            .map((action) => [action, ['eth_sendTransaction']]),
        ['runAuthBypass', ['wallet_addEthereumChain', 'wallet_watchAsset', 'eth_decrypt',
            'eth_getEncryptionPublicKey', 'eth_signTypedData_v4', 'personal_sign', 'eth_sendTransaction']],
        ['switchChains', ['wallet_switchEthereumChain']],
    ];
    for (const [action, expected] of cases) {
        const f = fixture();
        try { await handleAction('mobile', action, f.provider, { chain: 'polygon', methods: expected, __wcChainId: 137 }); }
        catch (error) { assert.match(error.message, /User rejected/, action); }
        assert.deepEqual(f.remote.map((call) => call.request.method), expected, action);
        assert(f.remote.every((call) => call.chainId === 'eip155:137'), action);
    }
});

test('switch errors are immediately visible in the evidence panel; cancellations remain compact', async (t) => {
    for (const error of [{ code: 5101, message: 'Unauthorized method' }, cancellation]) {
        const hooks = reactHarness(), f = fixture(async () => { throw error; });
        t.after(() => hooks.unmount());
        const runtime = { provider: f.provider, address: account, chainId: '0x89' };
        const load = sourceLoader({ react: hooks.react,
            '../context/WalletRuntimeContext': { useWalletRuntime: () => runtime },
            '../utils/providerIdentity': { getProviderIdentity: () => ({ name: 'Test wallet' }) },
            '../utils/evidenceStorage.mjs': { persistEvidenceRecord() {} },
            '../utils/panelToImage': {}, './RuntimeIdentity': () => null, './PersistedEvidence': () => null,
            './WizardStepHeader': () => null,
        }, { window: { location: { origin: 'https://example.test' } } });
        const check = load('src/app/wizard/config/wizard.json').wizard.checks['WSR-PERM-009'];
        const presentation = load('src/app/wizard/utils/guidedComparison.mjs').GUIDED_COMPARISONS[check.canonicalId];
        const Component = load('src/app/wizard/components/GuidedComparisonCheck.jsx').default;
        const render = () => hooks.render(Component, { check, platform: 'mobile', presentation });
        const button = nodes(render()).find((n) => n.props?.onClick && n.props.children === 'Switch to Ethereum Mainnet');
        assert(button && !button.props.disabled);
        await button.props.onClick();
        assert.equal(f.remote.length, 1);
        const details = nodes(render()).filter((n) => n.type === 'details' &&
            nodes(n).some((child) => child.type === 'summary' && child.props.children === 'Response details'));
        assert.equal(details.length, error === cancellation ? 0 : 1);
        if (details.length) {
            assert.equal(details[0].props.open, true);
            const text = nodes(details[0]).find((n) => n.type === 'pre').props.children;
            assert.equal(JSON.parse(text).error.code, 5101);
            assert.equal(JSON.parse(text).request_submitted, true);
        }
    }
});
