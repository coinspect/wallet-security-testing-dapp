import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WALLETCONNECT_METHODS } from '../src/utils/wallet-methods/wc/requestedMethods.mjs';
import { sessionPermissions } from '../src/utils/wallet-methods/wc/sessionPermissions.mjs';
import { createAuthSessionRequest } from '../src/utils/wallet-methods/wc/authSession.mjs';
import { sourceLoader, reactHarness, nodes } from './helpers/sourceHarness.mjs';

const load = sourceLoader();
const checks = load('src/app/wizard/config/wizard.json').wizard.checks;
const methods = checks['WSR-PERM-002~Mobile'].steps[0].data.params.methods;
const account = `0x${'11'.repeat(20)}`;
const route = 'eip155:137';
const { runAuthBypassBatch } = load('src/utils/wallet-methods/authBypassBatch.js');
const Result = load('src/app/wizard/components/GuidedRequestResult.jsx').default;

test('the real AppKit connector proposes every auth method as optional on Polygon', async () => {
    let options;
    const polygon = { id: 137, chainNamespace: 'eip155', caipNetworkId: route, rpcUrls: { default: { http: ['https://rpc.example.test'] } } };
    sourceLoader({
        '@reown/appkit/react': { createAppKit: (value) => { options = value; } },
        '@reown/appkit/networks': { polygon },
        '@reown/appkit-adapter-ethers5': { Ethers5Adapter: class {} },
    })('src/components/context/AppKitProvider.jsx');
    const { WcHelpersUtil } = sourceLoader({
        '@reown/appkit-common': { ParseUtil: {} },
        '../controllers/EnsController.js': { EnsController: {} },
    })('node_modules/@reown/appkit-controllers/dist/esm/src/utils/WalletConnectUtil.js');
    for (const method of WcHelpersUtil.getMethodsByChainNamespace('eip155')) {
        assert(WALLETCONNECT_METHODS.includes(method), `Retain AppKit method ${method}`);
    }
    const { WalletConnectConnector } = sourceLoader({
        '@walletconnect/universal-provider': {},
        '@reown/appkit-common': { ConstantsUtil: { CONNECTOR_ID: { WALLET_CONNECT: 'walletConnect' } } },
        '../../utils/SIWXUtil.js': { SIWXUtil: { universalProviderAuthenticate: async () => false } },
        '../../utils/WalletConnectUtil.js': { WcHelpersUtil },
        '../ChainController.js': { ChainController: { getCaipNetworks: () => options.networks } },
        '../OptionsController.js': { OptionsController: { state: options } },
    })('node_modules/@reown/appkit-controllers/dist/esm/src/controllers/AdapterController/WalletConnectConnector.js');
    const proposals = [];
    const provider = { connect: async (proposal) => proposals.push(structuredClone(proposal)),
        client: { core: { crypto: { getClientId: async () => 'mock' } } } };
    await new WalletConnectConnector({ provider, namespace: 'eip155' }).connectWalletConnect();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].requiredNamespaces, undefined, 'Unsupported optional methods must not prevent connection');
    const proposed = proposals[0].optionalNamespaces.eip155;
    assert.deepEqual(proposed.chains, [route]);
    assert.equal(options.defaultNetwork, polygon);
    assert.equal(options.allowUnsupportedChain, false);
    assert.equal(new Set(proposed.methods).size, proposed.methods.length);
    for (const check of Object.values(checks)) for (const step of check.steps) {
        if (step.ui?.content?.button?.action !== 'runAuthBypass') continue;
        for (const method of step.data.params.methods) assert(proposed.methods.includes(method), `${check.canonicalId}: ${method}`);
    }
});

function wallet({ approved = methods, requested = WALLETCONNECT_METHODS, reply } = {}) {
    const calls = [];
    const session = { topic: 'private-topic', expiry: Date.now() / 1000 + 3600,
        peer: { metadata: { name: 'Test wallet' } },
        namespaces: { eip155: { accounts: [`${route}:${account}`], methods: [...approved] } },
        ...(requested === null ? {} : { requiredNamespaces: {}, optionalNamespaces: { eip155: { chains: [route], methods: [...requested] } } }),
    };
    const provider = { session,
        async request(args) {
            assert.equal(args.method, 'eth_chainId', 'Never forward privileged requests to an HTTP RPC');
            return '0x89';
        },
        client: { session: { get: () => session }, async request(args) {
            calls.push(structuredClone(args));
            if (reply) return reply(args);
            throw { code: -32601, message: `The method ${args.request.method} is not supported`, data: { reason: 'wallet response' } };
        } },
    };
    return { session, provider, calls };
}

async function batch(fixture, list = methods, connectionAttempt = 1) {
    const request = createAuthSessionRequest(fixture.provider, 137, account, connectionAttempt);
    return runAuthBypassBatch({ request, methods: list, account, chainId: 137 });
}

test('all seven approved methods reach the wallet and their original errors are preserved', async () => {
    const f = wallet();
    const rows = await batch(f);
    assert.deepEqual(f.calls.map((call) => call.request.method), methods);
    for (const [index, row] of rows.entries()) {
        assert.equal(row.request_submitted, true);
        assert.equal(row.code, -32601);
        assert.equal(row.rpc_error.message, `The method ${methods[index]} is not supported`);
        assert.equal(row.rpc_error.data.reason, 'wallet response');
        assert.deepEqual(row.runtime.session_permissions.requested_methods, WALLETCONNECT_METHODS);
        assert.deepEqual(row.runtime.session_permissions.approved_methods, methods);
        assert.equal(row.runtime.chain_id, '0x89');
        assert.equal(f.calls[index].chainId, route);
    }
});

test('partial approval never skips a method; actual transport errors and cancellations are recorded', async () => {
    const f = wallet({ approved: methods.slice(4), reply: ({ request }) => {
        throw methods.slice(4).includes(request.method) ? { code: 4001, message: 'User rejected' }
            : { code: 5101, message: 'Unauthorized method from SignClient' };
    } });
    const rows = await batch(f);
    assert.deepEqual(f.calls.map((call) => call.request.method), methods);
    for (const row of rows.slice(0, 4)) {
        assert.equal(row.outcome, 'error: Unauthorized method from SignClient');
        assert.equal(row.request_submitted, true);
        assert.equal(row.rpc_error.code, 5101);
        assert(row.runtime.session_permissions.requested_methods.includes(row.method));
    }
    for (const row of rows.slice(4)) assert.equal(row.outcome, 'cancelled_by_tester');
    const html = renderToStaticMarkup(Result({ action: 'runAuthBypass', success: rows }));
    assert.match(html, /7 responses recorded/);
    assert.doesNotMatch(html, /not sent/);
    assert.doesNotMatch(html, /Requested at connection:|Approved for|session_permissions/);
    assert.equal((html.match(/<details[^>]* open=""/g) ?? []).length, 4);
});

test('old proposals do not block attempts for methods never requested at connection', async () => {
    const f = wallet({ requested: ['personal_sign'], approved: ['personal_sign'], reply: async () => null });
    const rows = await batch(f, ['eth_decrypt', 'personal_sign']);
    assert.equal(rows[0].outcome, 'empty');
    assert.equal(rows[0].transport_reason, undefined);
    assert.equal(rows[0].request_submitted, true);
    assert.deepEqual(f.calls.map((call) => call.request.method), ['eth_decrypt', 'personal_sign']);
    assert.equal(rows[1].outcome, 'empty');
    const html = renderToStaticMarkup(Result({ action: 'runAuthBypass', success: rows }));
    assert.doesNotMatch(html, /Reconnect to request all test methods/);
    assert.doesNotMatch(html, /Requested at connection:/);
    assert.doesNotMatch(html, /Session lost/);
});

test('missing proposal history stays unknown instead of using the new application config as evidence', async () => {
    const f = wallet({ requested: null, approved: [] });
    const [row] = await batch(f, ['eth_decrypt']);
    assert.equal(row.code, -32601);
    assert.equal(row.request_submitted, true);
    assert.equal(f.calls.length, 1);
    assert.equal(row.runtime.session_permissions.requested_methods, null);
    assert.doesNotMatch(renderToStaticMarkup(Result({ action: 'runAuthBypass', success: [row] })), /Requested at connection:/);
});

test('permissions are scoped to Polygon and combine required and optional proposals', () => {
    const f = wallet({ requested: [], approved: [] });
    f.session.requiredNamespaces = { 'eip155:137': { methods: ['personal_sign'] } };
    f.session.optionalNamespaces = {
        eip155: { chains: [route], methods: ['eth_decrypt', 'personal_sign'] },
        'eip155:1': { methods: ['eth_getEncryptionPublicKey'] },
    };
    f.session.namespaces = {
        'eip155:137': { accounts: [`${route}:${account}`], methods: ['personal_sign'] },
        'eip155:1': { accounts: [`eip155:1:${account}`], methods: ['eth_decrypt'] },
    };
    assert.deepEqual(sessionPermissions(f.session, route), {
        chain_id: route, requested_methods: ['personal_sign', 'eth_decrypt'], approved_methods: ['personal_sign'],
    });
});

test('session updates and reconnections do not overwrite earlier permission evidence', async () => {
    const f = wallet({ approved: ['personal_sign'], reply: async () => null });
    const request = createAuthSessionRequest(f.provider, 137, account);
    const rows = await runAuthBypassBatch({ request, methods: ['personal_sign'], account, chainId: 137 });
    const original = JSON.stringify(rows[0]);
    f.session.namespaces.eip155.methods.push('eth_decrypt');
    await request({ method: 'eth_decrypt', params: ['0x', account] });
    assert.deepEqual(request.authContext.session_permissions.approved_methods, ['personal_sign', 'eth_decrypt']);
    assert.equal(JSON.stringify(rows[0]), original);
    const next = await batch(wallet({ approved: methods }), ['eth_decrypt'], 2);
    assert.equal(next[0].runtime.connection_attempt, 2);
    assert.equal(JSON.stringify(rows[0]), original);
});

test('copied and saved evidence includes negotiation facts without session secrets', async (t) => {
    const rows = await batch(wallet({ approved: [] }), ['eth_decrypt']);
    const hooks = reactHarness(), copied = [], saved = [], images = [];
    t.after(() => hooks.unmount());
    const ActionResult = sourceLoader({
        react: hooks.react,
        '../context/PlatformContext': { usePlatform: () => ({ platform: 'mobile' }) },
        '../context/WalletRuntimeContext': { useWalletRuntime: () => ({}) },
        '../utils/providerIdentity': { getProviderIdentity: () => null },
        '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => saved.push(record) },
        '../utils/panelToImage': { panelToPngBlob: async (panel) => { images.push(panel); return new Blob(['image'], { type: 'image/png' }); } },
    }, {
        window: { location: { origin: 'https://example.test' }, addEventListener() {}, removeEventListener() {}, ClipboardItem: class {} },
        navigator: { clipboard: { writeText: async (text) => copied.push(text), write: async () => {} } },
    })('src/app/wizard/components/ActionResult.jsx').default;
    const tree = hooks.render(ActionResult, { step: checks['WSR-PERM-002~Mobile'].steps[0], success: rows, guided: true });
    const panel = nodes(tree).find((node) => node.props?.ref);
    panel.props.ref.current = panel;
    const actions = nodes(tree).find((node) => node.props?.onCopyEvidence).props;
    await actions.onCopyEvidence();
    await actions.onCopyImage();
    assert.deepEqual(JSON.parse(copied[0]).wallet_output, rows);
    assert.deepEqual(saved[0].evidence.wallet_output, rows);
    assert.doesNotMatch(copied[0], /private-topic/);
    assert.doesNotMatch(renderToStaticMarkup(images[0]), /Requested at connection:|Approved for|session_permissions/);
});
