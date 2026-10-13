import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import { renderToStaticMarkup } from 'react-dom/server';
import { sourceLoader, reactHarness, nodes, deferred, flush } from './helpers/sourceHarness.mjs';

const load = sourceLoader();
const { buildSiweMismatchMessage, siweMessageRuntime } = load('src/utils/signMessages.js');
const account = ethers.utils.getAddress(`0x${'ab'.repeat(20)}`);
const fields = { nonce: '0123456789abcdef', issuedAt: '2026-09-29T19:06:28.337Z' };
const cancelled = () => { throw { code: 4001, message: 'User rejected the request' }; };

test('SIWE uses the shared Polygon template with a valid nonce and current issue time', () => {
    assert.equal(buildSiweMismatchMessage(account, fields), `https://opensea.io wants you to sign in with your Ethereum account:\n${account}\n\nSign in with Ethereum to the app.\n\nURI: https://opensea.io\nVersion: 1\nChain ID: 137\nNonce: ${fields.nonce}\nIssued At: ${fields.issuedAt}`);
    const before = Date.now();
    const fresh = siweMessageRuntime(buildSiweMismatchMessage(account));
    assert.match(fresh.siwe_nonce, /^[a-f0-9]{32}$/);
    assert(Date.parse(fresh.siwe_issued_at) >= before && Date.parse(fresh.siwe_issued_at) <= Date.now());
    assert.notEqual(siweMessageRuntime(buildSiweMismatchMessage(account)).siwe_nonce, fresh.siwe_nonce);
    assert.equal(fresh.siwe_chain_id, 137);
    assert.equal(fresh.siwe_domain, 'opensea.io');
    assert.equal(fresh.siwe_uri, 'https://opensea.io');
});

test('SIWE rejects the six-character regression and other malformed input', () => {
    for (const nonce of ['', '1', '853722', '1234567', 'has spaces', 'abcdefg!', 'abcd\nefgh']) {
        assert.throws(() => buildSiweMismatchMessage(account, { ...fields, nonce }), /at least 8 alphanumeric/);
    }
    assert.match(buildSiweMismatchMessage(account, { ...fields, nonce: '12345678' }), /Nonce: 12345678\n/);
    assert.throws(() => buildSiweMismatchMessage('0x123', fields), /valid wallet address/);
    assert.throws(() => buildSiweMismatchMessage(account, { ...fields, issuedAt: 'invalid' }), /Invalid SIWE issue time/);
});

test('SIWE nonces retain leading zeros and never fall back to short decimal randomness', (t) => {
    t.mock.method(globalThis.crypto, 'getRandomValues', (bytes) => bytes.fill(0));
    assert.equal(siweMessageRuntime(buildSiweMismatchMessage(account)).siwe_nonce, '0'.repeat(32));
});

test('SIWE fails closed when secure randomness is unavailable', (t) => {
    t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('Randomness unavailable'); });
    assert.throws(() => buildSiweMismatchMessage(account), /Randomness unavailable/);
});

function fixture({ platform = 'mobile', reply = cancelled, address = account } = {}) {
    const hooks = reactHarness(), calls = [], saved = [], copied = [], images = [];
    const state = { address, chainId: '0x89' };
    const provider = {
        session: { topic: 'original', peer: { metadata: { name: 'Test wallet', url: 'https://wallet.test' } } },
        async request(args) {
            calls.push(structuredClone(args));
            if (args.method === 'eth_chainId') return state.chainId;
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return [state.address];
            assert.equal(args.method, 'personal_sign');
            return reply(args);
        },
    };
    const runtime = { provider, address, chainId: '0x89' };
    provider.client = { request: ({ request }) => provider.request(request) };
    const loadFixture = sourceLoader({
        react: hooks.react,
        '../context/WalletRuntimeContext': { useWalletRuntime: () => runtime },
        '../utils/providerIdentity': { getProviderIdentity: () => ({ name: 'Test wallet' }) },
        '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => saved.push(structuredClone(record)) },
        '../utils/panelToImage': { panelToPngBlob: async (panel) => { images.push(panel); throw new Error('Mock capture'); } },
        './PersistedEvidence': () => null, './WizardStepHeader': () => null,
        '../signatureVerification': { verifyWalletSignature: async () => ({ valid: true }) },
    }, {
        process: { env: { NODE_ENV: 'production' } },
        window: { location: { origin: 'https://wsf.tools' } },
        navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    });
    const check = loadFixture('src/app/wizard/config/wizard.json').wizard.checks['WSR-PERM-001'];
    const comparison = loadFixture('src/app/wizard/utils/guidedComparison.mjs');
    const Component = loadFixture('src/app/wizard/components/GuidedComparisonCheck.jsx').default;
    const props = { check, presentation: comparison.GUIDED_COMPARISONS[check.canonicalId], platform };
    const render = () => hooks.render(Component, props);
    const button = (text) => nodes(render()).find((node) => node.props?.onClick && node.props.children === text);
    const click = async (text) => {
        const control = button(text);
        assert(control, `Missing ${text}`);
        assert(!control.props.disabled, `Disabled ${text}`);
        await control.props.onClick();
    };
    const evidence = async () => {
        await nodes(render()).find((node) => node.props?.onCopyEvidence).props.onCopyEvidence();
        return JSON.parse(copied.at(-1));
    };
    return { hooks, calls, saved, images, state, check, render, button, click, evidence };
}

for (const platform of ['extension', 'mobile']) for (const outcome of ['cancelled', 'error', 'signed']) {
    test(`${platform}/${outcome}: valid SIWE request, evidence and copied image agree without diagnostics`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const signature = `0x${'ab'.repeat(65)}`;
        const ui = fixture({ platform, reply: outcome === 'signed' ? () => signature : outcome === 'cancelled' ? cancelled
            : () => { throw { code: -32603, message: 'Wallet failure', data: { reason: 'fixture' } }; } });
        t.after(() => ui.hooks.unmount());
        const untouched = JSON.stringify(ui.check);
        assert.doesNotMatch(renderToStaticMarkup(ui.render()), /Advanced controls|reference request|Comparison/);
        const before = Date.now();
        await ui.click('Send SIWE message');
        const [row] = await ui.evidence();
        const requests = ui.calls.filter((call) => call.method === 'personal_sign');
        assert.equal(requests.length, 1, 'Never retry automatically');
        const message = ethers.utils.toUtf8String(requests[0].params[0]);
        assert.equal(row.runtime.siwe_message, message);
        assert.equal(message, buildSiweMismatchMessage(account, { nonce: row.runtime.siwe_nonce, issuedAt: row.runtime.siwe_issued_at }));
        assert.equal(row.runtime.from, account);
        assert.equal(row.runtime.siwe_chain_id, 137);
        assert.equal(row.runtime.chain_id, '0x89');
        assert.equal(row.runtime.dapp_origin, 'https://wsf.tools');
        assert.notEqual(row.runtime.siwe_domain, 'wsf.tools');
        assert.match(row.runtime.siwe_nonce, /^[a-f0-9]{32}$/);
        assert(Date.parse(row.runtime.siwe_issued_at) >= before && Date.parse(row.runtime.siwe_issued_at) <= Date.now());
        assert.deepEqual(row.runtime.siwe_request, { method: requests[0].method, params: requests[0].params });
        assert.equal(requests[0].params.length, platform === 'mobile' ? 2 : 3);
        assert.equal(row.automatic_verdict, null);
        assert.equal(row.diagnostic_variant, undefined);
        assert.equal(row.diagnostic_change, undefined);
        if (outcome === 'cancelled') assert.equal(row.request_outcome, 'cancelled_by_tester');
        if (outcome === 'signed') assert.equal(row.wallet_output, signature);
        if (outcome === 'error') assert.equal(row.code, -32603);
        assert.equal(ui.saved.length, 1);
        assert.deepEqual(ui.saved[0].evidence, row);
        const tree = ui.render(), panel = nodes(tree).find((node) => node.props?.ref);
        panel.props.ref.current = panel;
        await nodes(tree).find((node) => node.props?.onCopyImage).props.onCopyImage();
        assert.equal(ui.images[0], panel);
        const html = renderToStaticMarkup(ui.images[0]);
        for (const value of [row.runtime.siwe_nonce, row.runtime.siwe_issued_at, 'opensea.io', 'https://wsf.tools']) assert(html.includes(value));
        assert.match(html, /Message chain ID: <code>137<\/code>/);
        assert.match(html, /Wallet chain ID: <code>0x89<\/code>/);
        assert.doesNotMatch(html, /Comparison|Original request · 2024|Intentionally invalid/);
        await ui.click('Run this request again');
        const [rerun, extra] = await ui.evidence();
        assert.equal(extra, undefined);
        assert.notEqual(rerun.runtime.siwe_nonce, row.runtime.siwe_nonce);
        assert.equal(rerun.runtime.siwe_chain_id, 137);
        assert(!ui.calls.some((call) => ['wallet_switchEthereumChain', 'wallet_addEthereumChain'].includes(call.method)));
        assert.equal(JSON.stringify(ui.check), untouched);
    });
}

test('SIWE uses the in-flight guard and never retries automatically', async (t) => {
    t.mock.method(console, 'error', () => {});
    const pending = deferred();
    const ui = fixture({ reply: () => pending.promise });
    t.after(() => ui.hooks.unmount());
    const click = ui.button('Send SIWE message').props.onClick;
    const running = click();
    await flush();
    assert.equal(ui.button('Waiting for wallet…').props.disabled, true);
    await click();
    pending.reject({ code: 4001, message: 'User rejected' });
    await running;
    assert.equal(ui.calls.filter((call) => call.method === 'personal_sign').length, 1);
});

for (const platform of ['extension', 'mobile']) test(`${platform}: SIWE refuses a different live network before signing`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const ui = fixture({ platform });
    t.after(() => ui.hooks.unmount());
    ui.state.chainId = '0x1';
    await ui.click('Send SIWE message');
    assert.equal(ui.calls.filter((call) => call.method === 'personal_sign').length, 0);
    const [row] = await ui.evidence();
    assert.match(row.error_details.message, /Polygon/);
    assert.notEqual(row.request_outcome, 'cancelled_by_tester');
    assert.equal(row.automatic_verdict, null);
});

for (const platform of ['extension', 'mobile']) test(`${platform}: SIWE reads the live account instead of reusing the displayed address`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const ui = fixture({ platform });
    t.after(() => ui.hooks.unmount());
    ui.state.address = ethers.utils.getAddress(`0x${'cd'.repeat(20)}`);
    await ui.click('Send SIWE message');
    const [row] = await ui.evidence();
    assert.equal(row.runtime.from, ui.state.address);
    assert.equal(row.runtime.siwe_message.split('\n')[1], ui.state.address);
    assert.equal(row.runtime.siwe_request.params[1].toLowerCase(), ui.state.address.toLowerCase());
    assert.equal(row.runtime.siwe_chain_id, 137);
});
