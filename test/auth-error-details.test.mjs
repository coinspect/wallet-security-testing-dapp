import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { authRequestFailure } from '../src/app/wizard/utils/guidedRequests.mjs';
import { sourceLoader, reactHarness, nodes } from './helpers/sourceHarness.mjs';

const load = sourceLoader();
const Result = load('src/app/wizard/components/GuidedRequestResult.jsx').default;
const renderRow = (row) => Result({ action: 'runAuthBypass', success: [{ method: 'eth_decrypt', elapsed_ms: 10, ...row }] });
const details = (tree) => nodes(tree).find((node) => node.type === 'details');

for (const row of [
    { outcome: 'cancelled_by_tester', code: 4001, rpc_error: { message: 'User rejected' } },
    { outcome: 'cancelled_by_tester', code: -32000 },
    { outcome: 'error: User canceled', code: -32000 },
    { outcome: 'error: Cancelled', code: -2 },
    { outcome: 'rejected', code: 4001 },
    { outcome: 'resolved', data_returned: '0xreply' },
    { outcome: 'empty' },
    { outcome: 'declined', data_returned: false },
    { outcome: 'skipped_by_tester', request_submitted: false },
    { outcome: 'not_attempted', request_submitted: false },
    { outcome: 'stopped_waiting', late_settlement: 'pending' },
    { outcome: 'stopped_waiting', late_settlement: { response_outcome: 'cancelled_by_tester', rpc_error: { message: 'User canceled' } } },
    { outcome: 'no_response', late_settlement: { response_outcome: 'cancelled_by_tester', code: 4001, rpc_error: { message: 'User rejected' } } },
]) {
    test(`auth error details are omitted for ${row.outcome}/${row.code ?? row.late_settlement?.response_outcome ?? ''}`, () => {
        const before = JSON.stringify(row);
        assert.equal(authRequestFailure(row), null);
        const tree = renderRow(row);
        assert.equal(details(tree), undefined);
        assert.doesNotMatch(renderToStaticMarkup(tree), /<details[^>]*\sopen|Reason:|Error code:/);
        assert.equal(JSON.stringify(row), before);
    });
}

for (const [row, message] of [
    [{ outcome: 'error: First line', code: -32602, rpc_error: { message: 'First line\nFull provider detail', code: -32602, data: { reason: 'Invalid ciphertext' } } }, 'First line\nFull provider detail'],
    [{ outcome: 'error (internal): User canceled', code: -32603 }, 'User canceled'],
    [{ outcome: 'error: Transport cancelled', code: -32000 }, 'Transport cancelled'],
    [{ outcome: 'error: Method unavailable', code: -32601 }, 'Method unavailable'],
    [{ outcome: 'method_not_approved', transport_reason: 'method_not_approved', request_submitted: false }, 'not included in the approved WalletConnect session'],
    [{ outcome: 'session_dropped', transport_reason: 'account_not_approved', request_submitted: false }, 'account is not approved'],
    [{ outcome: 'session_dropped', transport_reason: 'session_changed', request_submitted: false }, 'session changed before dispatch'],
    [{ outcome: 'session_dropped', transport_reason: 'session_unavailable', request_submitted: false }, 'No active WalletConnect session'],
    [{ outcome: 'session_dropped', transport_reason: 'chain_not_approved', request_submitted: false }, 'network is not approved'],
    [{ outcome: 'network_required', network_precondition: 'polygon_required' }, 'Polygon network precondition'],
    [{ outcome: 'session_dropped' }, 'does not establish a wallet rejection'],
    [{ outcome: 'request_expired', rpc_error: { message: 'Request expired. Please try again.', code: 'EXPIRED' } }, 'Request expired. Please try again.'],
    [{ outcome: 'no_response', late_settlement: 'pending' }, 'No response arrived before the wait timed out'],
    [{ outcome: 'unstable', samples: [[], ['0xaccount']] }, 'Account readings did not stabilize'],
    [{ outcome: 'rejected' }, 'without a recorded reason'],
    [{ outcome: 'stopped_waiting', late_settlement: { response_outcome: 'error: Late failure', code: -32603, rpc_error: { message: 'Late failure\nOriginal details' } } }, 'Late failure\nOriginal details'],
]) {
    test(`auth failures expand with recorded details: ${row.outcome}/${row.transport_reason ?? row.code ?? ''}`, () => {
        const before = JSON.stringify(row);
        const failure = authRequestFailure(row);
        assert(failure.message.includes(message));
        const tree = renderRow(row);
        assert.equal(details(tree).props.open, true);
        const html = renderToStaticMarkup(tree);
        assert.match(html, /<details[^>]*\sopen=""/);
        assert(html.includes(message));
        assert.doesNotMatch(html, /Error code:|elapsed_ms|rpc_error/);
        if (failure.late) assert.match(html, /Late error:/);
        assert.equal(JSON.stringify(row), before);
    });
}

const checks = load('src/app/wizard/config/wizard.json').wizard.checks;
const { runAuthBypassBatch } = load('src/utils/wallet-methods/authBypassBatch.js');
for (const check of Object.values(checks).filter((check) => check.steps[0]?.ui?.content?.button?.action === 'runAuthBypass')) {
    test(`${check.canonicalId}: exported evidence panel includes expanded errors and unchanged JSON`, async (t) => {
        const hooks = reactHarness(), copied = [], captured = [], saved = [];
        t.after(() => hooks.unmount());
        const step = check.steps[0], methods = step.data.params.methods;
        const platform = check.canonicalId.includes('~Mobile') ? 'mobile' : 'extension';
        const success = await runAuthBypassBatch({
            methods, account: `0x${'11'.repeat(20)}`, chainId: 137,
            request: async ({ method }) => {
                if (method === methods[0]) throw { code: -32602, message: 'Invalid request\nProvider explanation', data: { reason: 'Fixture failure', secret: 'must-not-leak' } };
                throw { code: 4001, message: 'User rejected the request' };
            },
        });
        const before = JSON.stringify(success);
        const ActualResult = sourceLoader({
            react: hooks.react,
            '../context/PlatformContext': { usePlatform: () => ({ platform }) },
            '../context/WalletRuntimeContext': { useWalletRuntime: () => ({}) },
            '../utils/providerIdentity': { getProviderIdentity: () => null },
            '../utils/evidenceStorage.mjs': { persistEvidenceRecord: (record) => saved.push(record) },
            '../utils/panelToImage': { panelToPngBlob: async (panel) => { captured.push(panel); return new Blob(['mock image'], { type: 'image/png' }); } },
        }, {
            window: { location: { origin: 'https://example.test' }, addEventListener() {}, removeEventListener() {}, ClipboardItem: class {} },
            navigator: { clipboard: { writeText: async (text) => copied.push(text), write: async () => {} } },
        })('src/app/wizard/components/ActionResult.jsx').default;
        const tree = hooks.render(ActualResult, { step, success, guided: true });
        const panel = nodes(tree).find((node) => node.props?.ref);
        panel.props.ref.current = panel;
        const actions = nodes(tree).find((node) => node.props?.onCopyImage).props;
        await actions.onCopyImage();
        assert.equal(captured[0], panel);
        const html = renderToStaticMarkup(captured[0]);
        assert.equal((html.match(/<details[^>]*\sopen=""/g) ?? []).length, 1);
        assert.match(html, /Invalid request\nProvider explanation/);
        assert.doesNotMatch(html, /Error code:|Fixture failure/);
        assert.doesNotMatch(html, /must-not-leak/);
        await actions.onCopyEvidence();
        assert.equal(JSON.stringify(JSON.parse(copied[0]).wallet_output), before);
        assert.equal(JSON.stringify(saved[0].evidence.wallet_output), before);
        assert.equal(JSON.stringify(success), before);
    });
}
