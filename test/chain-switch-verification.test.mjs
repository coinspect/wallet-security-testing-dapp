import test from 'node:test';
import assert from 'node:assert/strict';
import { requestChainVerification } from '../src/utils/wallet-methods/chainSwitchVerification.mjs';

const address = `0x${'12'.repeat(20)}`;
test('transaction inspection sends no selected chain and never switches or reconnects', async () => {
    const calls = [];
    const provider = { request: async (request) => { calls.push(request); throw { code: 4001, message: 'User rejected' }; } };
    const result = await requestChainVerification({ provider, address, chainId: '0x144', transport: 'extension' });
    assert.deepEqual(calls, [{ method: 'eth_sendTransaction', params: [{ from: address, to: address, value: '0x0', data: '0x' }] }]);
    assert.equal(result.routing_chain_id, null);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.request_submitted, true);
    assert.equal(result.automatic_verdict, null);
});
test('WalletConnect records a limitation without sending any request', async () => {
    const provider = { request: () => assert.fail('No request'), client: { request: () => assert.fail('No routing') } };
    const result = await requestChainVerification({ provider, address, chainId: '0x1', transport: 'walletconnect' });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.request_submitted, false);
    assert.equal(result.routing_chain_id, null);
    assert.match(result.message, /explicit routing chain/);
});
test('stop and timeout preserve the submitted request and ignore late responses', async () => {
    for (const stop of [true, false]) {
        let finish;
        const provider = { request: () => new Promise((resolve) => { finish = resolve; }) };
        const controller = new AbortController();
        const pending = requestChainVerification({ provider, address, chainId: '0x1', signal: controller.signal, timeoutMs: 10 });
        await Promise.resolve();
        if (stop) controller.abort();
        const result = await pending;
        assert.equal(result.status, stop ? 'stopped' : 'timeout');
        assert.equal(result.request_submitted, true);
        finish('0xlate');
        await Promise.resolve();
        assert.equal(result.wallet_output, undefined);
    }
});
test('connection failure, stop before dispatch and RPC errors remain distinct', async () => {
    const base = { address, chainId: '0x1' };
    assert.equal((await requestChainVerification(base)).status, 'not_sent');
    const controller = new AbortController(); controller.abort();
    const provider = { request: () => assert.fail('must not send') };
    const stopped = await requestChainVerification({ ...base, provider, signal: controller.signal });
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.request_submitted, false);
    const result = await requestChainVerification({ ...base, provider: { request: async () => { throw { code: 4200, message: 'Unsupported method' }; } } });
    assert.equal(result.status, 'error');
    assert.deepEqual(result.rpc_error, { code: 4200, message: 'Unsupported method' });
});
test('transaction response does not establish consent to a switch', async () => {
    const result = await requestChainVerification({ provider: { request: async () => '0xresponse' }, address, chainId: '0x1' });
    assert.equal(result.automatic_verdict, null);
    assert.match(result.message, /does not establish consent/);
    assert.equal(result.wallet_output, '0xresponse');
});
