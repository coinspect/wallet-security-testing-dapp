import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { networkVerificationData, requestChainVerification } from '../src/utils/wallet-methods/chainSwitchVerification.mjs';

const address = `0x${'12'.repeat(20)}`;
for (const chainId of ['0x1', '0x144']) {
    test(`valid diagnostic EIP-712 payload for ${chainId}`, () => {
        const data = networkVerificationData(chainId);
        assert.equal(data.domain.chainId, Number(BigInt(chainId)));
        assert.equal(data.primaryType, 'NetworkVerification');
        assert.equal(data.domain.verifyingContract, undefined);
        assert.match(ethers.utils._TypedDataEncoder.hash(data.domain, { NetworkVerification: data.types.NetworkVerification }, data.message), /^0x[0-9a-f]{64}$/);
    });
    for (const transport of ['extension', 'walletconnect']) {
        test(`${transport} targets ${chainId} without switching, preflight or method filters`, async () => {
            const calls = [];
            const send = async (request) => { calls.push(request); throw { code: 4001, message: 'User rejected' }; };
            const provider = { request: send, session: { topic: 'test', namespaces: {} }, client: { request: send } };
            const result = await requestChainVerification({ provider, address, chainId, transport });
            assert.equal(calls.length, 1);
            const request = transport === 'walletconnect' ? calls[0].request : calls[0];
            assert.equal(request.method, 'eth_signTypedData_v4');
            assert.equal(request.params[0], address);
            assert.equal(JSON.parse(request.params[1]).domain.chainId, Number(BigInt(chainId)));
            assert.equal(result.routing_chain_id, transport === 'walletconnect' ? `eip155:${BigInt(chainId)}` : null);
            if (transport === 'walletconnect') assert.equal(calls[0].chainId, result.routing_chain_id);
            assert.equal(result.status, 'cancelled');
            assert.equal(result.request_submitted, true);
            assert.equal(result.automatic_verdict, null);
        });
    }
}

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

test('missing connection, abort before dispatch and RPC errors remain distinct', async () => {
    const base = { address, chainId: '0x1' };
    assert.equal((await requestChainVerification(base)).status, 'not_sent');
    const controller = new AbortController(); controller.abort();
    const provider = { request: () => { throw new Error('must not send'); } };
    const stopped = await requestChainVerification({ ...base, provider, signal: controller.signal });
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.request_submitted, false);
    const result = await requestChainVerification({ ...base, provider: { request: async () => { throw { code: 4200, message: 'Unsupported method' }; } } });
    assert.equal(result.status, 'error');
    assert.deepEqual(result.rpc_error, { code: 4200, message: 'Unsupported method' });
});

test('a response does not establish that the previous switch succeeded', async () => {
    const result = await requestChainVerification({ provider: { request: async () => '0xresponse' }, address, chainId: '0x1' });
    assert.equal(result.automatic_verdict, null);
    assert.match(result.message, /Network change not confirmed/);
    assert.equal(result.wallet_output, '0xresponse');
});
