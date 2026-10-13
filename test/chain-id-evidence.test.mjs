import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { sourceLoader, reactHarness, nodes } from './helpers/sourceHarness.mjs';

const account = `0x${'11'.repeat(20)}`;
const signature = `0x${'ab'.repeat(65)}`;

function fixture({ platform = 'mobile', outcome = 'signed', chainId = '0x89', id = 'WSR-PERM-003' } = {}) {
    const hooks = reactHarness(), calls = [], copied = [], saved = [];
    const provider = {
        session: { topic: 'original', peer: { metadata: { name: 'Test wallet' } } },
        async request(args) {
            calls.push(structuredClone(args));
            if (args.method === 'eth_chainId') return '0x89';
            if (['eth_accounts', 'eth_requestAccounts'].includes(args.method)) return [account];
            if (args.method === 'eth_getCode') return '0x';
            if (args.method === 'eth_sign') throw { code: -32601, message: 'Method not supported' };
            assert.equal(args.method, 'eth_signTypedData_v4');
            if (outcome === 'cancelled') throw { code: 4001, message: 'User rejected the request' };
            if (outcome === 'error') throw { code: -32603, message: 'Wallet test error' };
            return signature;
        },
    };
    const runtime = { provider, address: account, chainId };
    provider.client = { request: ({ request }) => provider.request(request) };
    const load = sourceLoader({
        react: hooks.react,
        '../context/WalletRuntimeContext': { useWalletRuntime: () => runtime },
        '../utils/providerIdentity': { getProviderIdentity: () => ({ name: 'Test wallet' }) },
        '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => saved.push(structuredClone(record)) },
        '../utils/panelToImage': {}, './PersistedEvidence': () => null, './WizardStepHeader': () => null,
    }, {
        window: { location: { origin: 'http://localhost:3000' } },
        navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    });
    const check = load('src/app/wizard/config/wizard.json').wizard.checks[id];
    const presentation = load('src/app/wizard/utils/guidedComparison.mjs').GUIDED_COMPARISONS[check.canonicalId];
    const Component = load('src/app/wizard/components/GuidedComparisonCheck.jsx').default;
    const render = () => hooks.render(Component, { check, presentation, platform });
    const run = () => nodes(render()).find((node) => node.props?.onClick && node.props.children === presentation.stages[0].button).props.onClick();
    // This is the same summary container referenced by Copy result as image;
    // do not accidentally satisfy assertions with the raw JSON details below it.
    const summary = () => renderToStaticMarkup(nodes(render()).find((node) => node.props?.['aria-live'] === 'polite'));
    const evidence = async () => {
        await nodes(render()).find((node) => node.props?.onCopyEvidence).props.onCopyEvidence();
        return JSON.parse(copied.at(-1))[0];
    };
    return { hooks, calls, saved, runtime, run, summary, evidence, render };
}

for (const platform of ['mobile', 'extension']) for (const outcome of ['signed', 'cancelled', 'error']) {
    test(`${platform}/${outcome}: mismatch summary and exported image show the payload chain and captured wallet chain`, async (t) => {
        t.mock.method(console, 'error', () => {});
        const ui = fixture({ platform, outcome });
        t.after(() => ui.hooks.unmount());
        assert.doesNotMatch(renderToStaticMarkup(ui.render()), /Message chain ID \(EIP-712\):/);
        await ui.run();
        const requests = ui.calls.filter((call) => call.method === 'eth_signTypedData_v4');
        assert.equal(requests.length, 1, 'The display change must not send an additional request');
        const payload = JSON.parse(requests[0].params[1]);
        assert.equal(payload.domain.chainId, '1223123');
        assert.equal(payload.message.offerer, account);
        const evidence = await ui.evidence();
        assert.equal(evidence.parameters.params.eip712_mismatched_chainid, payload.domain.chainId);
        assert.equal(evidence.runtime.chain_id, '0x89');
        assert.deepEqual(evidence, ui.saved[0].evidence);
        assert.equal(evidence.automatic_verdict, null);
        if (outcome === 'signed') assert.equal(evidence.wallet_output, signature);
        else assert.equal(evidence.code, outcome === 'cancelled' ? 4001 : -32603);
        const html = ui.summary();
        assert.match(html, /Message chain ID \(EIP-712\):/);
        assert.match(html, />1223123</);
        assert.match(html, /Wallet chain ID at request:/);
        assert.match(html, />137 \(0x89\)</);
        ui.runtime.chainId = '0x1';
        assert.equal(ui.summary(), html, 'Changing the live network must not relabel the saved run');
        assert.deepEqual(await ui.evidence(), evidence);
    });
}

test('a missing recorded wallet chain is not replaced with the expected Polygon chain', async (t) => {
    const ui = fixture({ chainId: null });
    t.after(() => ui.hooks.unmount());
    await ui.run();
    assert.match(ui.summary(), />1223123</);
    assert.match(ui.summary(), /Not recorded/);
    assert.doesNotMatch(ui.summary(), />137 \(0x89\)</);
    assert.equal((await ui.evidence()).runtime.chain_id, null);
});

test('other checks do not display the EIP-712 chain mismatch fields', async (t) => {
    t.mock.method(console, 'error', () => {});
    const ui = fixture({ id: 'WSR-PERM-006', platform: 'extension' });
    t.after(() => ui.hooks.unmount());
    await ui.run();
    assert.doesNotMatch(ui.summary(), /Message chain ID|Wallet chain ID at request/);
});
