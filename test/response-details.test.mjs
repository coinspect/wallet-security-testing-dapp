import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatResponseDetails, responseErrorMessages } from '../src/app/wizard/utils/responseDetails.mjs';
import { sourceLoader } from './helpers/sourceHarness.mjs';

const permissions = {
    chain_id: 'eip155:137',
    requested_methods: Object.freeze(['eth_decrypt', 'wallet_watchAsset', 'personal_sign']),
    approved_methods: Object.freeze(['personal_sign']),
};
const row = {
    method: 'eth_decrypt', outcome: 'error: Unsupported method', elapsed_ms: 12,
    request_submitted: true, rpc_error: { code: 4200, message: 'Unsupported method' },
    runtime: { session_permissions: Object.freeze(permissions) },
};

test('response display summarizes permission lists without changing raw evidence', () => {
    const original = JSON.stringify(row);
    const display = JSON.parse(formatResponseDetails(row));
    assert.equal(display.runtime.session_permissions.requested_methods, '3 methods (see full evidence JSON)');
    assert.equal(display.runtime.session_permissions.approved_methods, '1 method (see full evidence JSON)');
    assert.equal(display.runtime.session_permissions.chain_id, 'eip155:137');
    assert.deepEqual(display.rpc_error, row.rpc_error);
    assert.equal(JSON.stringify(row), original);
    assert.deepEqual(JSON.parse(original).runtime.session_permissions, permissions);
});

test('auth image content retains the error without technical details', () => {
    const Result = sourceLoader()('src/app/wizard/components/GuidedRequestResult.jsx').default;
    const html = renderToStaticMarkup(Result({ action: 'runAuthBypass', success: [row] }));
    assert.doesNotMatch(html, /Requested at connection:|Approved for/);
    assert.match(html, /Unsupported method/);
    assert.doesNotMatch(html, /4200|elapsed_ms|session_permissions|rpc_error/);
    assert.match(html, /<details[^>]* open/);
    assert.doesNotMatch(html, /wallet_watchAsset|personal_sign/);
});

test('error messages preserve distinct causes and deduplicate repeated messages', () => {
    const input = { rpc_error: { message: 'Outer error', data: { cause: { message: 'Wallet explanation', cause: { message: 'Outer error' } } } } };
    const before = JSON.stringify(input);
    assert.deepEqual(responseErrorMessages(input, 'fallback'), ['Outer error', 'Wallet explanation']);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(responseErrorMessages({ cause: { message: 'Cause only' } }, 'fallback'), ['Cause only']);
    assert.deepEqual(responseErrorMessages({}, 'fallback'), ['fallback']);
    assert.deepEqual(responseErrorMessages({}, null), []);
    assert.deepEqual(responseErrorMessages({ ...input, late_settlement: { response_outcome: 'error', rpc_error: { message: 'Late failure' } } }, 'fallback'), ['Late failure']);
});

test('nested diagnostics summarize lists while keeping unknown permissions and response data', () => {
    const display = JSON.parse(formatResponseDetails({
        result: { session_permissions: permissions },
        late_settlement: { approved_methods: [], requested_methods: null },
        data_returned: ['first', 'second'],
    }));
    assert.equal(display.late_settlement.approved_methods, '0 methods (see full evidence JSON)');
    assert.equal(display.late_settlement.requested_methods, null);
    assert.deepEqual(display.data_returned, ['first', 'second']);
    assert.equal(display.result.session_permissions.chain_id, 'eip155:137');
});
