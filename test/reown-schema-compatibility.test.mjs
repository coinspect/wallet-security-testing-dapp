import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const walletEntry = pathToFileURL(require.resolve('@reown/appkit-wallet'));
const schemas = await import(new URL('../src/W3mFrameSchema.js', walletEntry));
const { W3mFrameConstants: types } = await import(new URL('../src/W3mFrameConstants.js', walletEntry));
const walletRequire = createRequire(walletEntry);

test('patched Zod rejects oversized constrained arrays before processing elements', () => {
    const { z } = walletRequire('zod');
    let visits = 0;
    const schema = z.array(z.string().superRefine(() => { visits++; })).max(1);
    const result = schema.safeParse(Array(10000).fill('test'));
    assert.equal(result.success, false);
    assert.equal(visits, 0);
    assert.equal(result.error.issues.length, 1);
});

test('Reown loads patched Zod and the lockfile contains no vulnerable Zod or Web3', () => {
    assert.equal(walletRequire('zod/package.json').version, '4.6.7');
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
    for (const [name, pkg] of Object.entries(lock.packages)) {
        if (name.endsWith('/zod')) assert.equal(pkg.version, '4.6.7', name);
        assert.ok(!name.endsWith('/web3') && !name.endsWith('/web3-validator'), name);
    }
});

test('Reown validates connection, network, theme and metadata messages with patched Zod', () => {
    const fixtures = [
        ['APP_SWITCH_NETWORK', { chainId: 137 }],
        ['APP_GET_USER', { chainId: '137' }],
        ['APP_IS_CONNECTED', { token: 'test-session' }],
        ['APP_SYNC_THEME', { themeMode: 'dark', themeVariables: { size: 12, color: '#fff' } }],
        ['APP_SYNC_DAPP_DATA', { projectId: 'test', metadata: { name: 'Test', description: 'Test', url: 'https://example.test', icons: [] } }],
    ];
    for (const [key, payload] of fixtures) {
        const input = { id: 'test', type: types[key], payload };
        assert.deepEqual(schemas.W3mFrameSchema.appEvent.parse(input), input);
    }
    for (const payload of [{ chainId: {} }, { chainId: null }, {}]) {
        assert.equal(schemas.W3mFrameSchema.appEvent.safeParse({ type: types.APP_SWITCH_NETWORK, payload }).success, false);
    }
    assert.equal(schemas.AppSyncThemeRequest.safeParse({ themeVariables: { color: {} } }).success, false);
});

test('Reown preserves signing and approval payloads and rejects malformed RPC envelopes', () => {
    const address = '0x' + '12'.repeat(20);
    for (const payload of [
        { method: 'personal_sign', params: ['0x6869', address, ''] },
        { method: 'eth_signTypedData_v4', params: [address, '{"domain":{"chainId":137}}'] },
        { method: 'eth_sendTransaction', params: [{ from: address, to: address, data: '0x095ea7b3', value: '0x0' }] },
    ]) {
        const input = { id: 'test', type: types.APP_RPC_REQUEST, payload: { ...payload, chainId: '137', chainNamespace: 'eip155' } };
        assert.deepEqual(schemas.W3mFrameSchema.appEvent.parse(input), input);
    }
    for (const payload of [{ method: 'personal_sign', params: {} }, { method: 'unknown_method', params: [] }]) {
        assert.equal(schemas.W3mFrameSchema.appEvent.safeParse({ type: types.APP_RPC_REQUEST, payload }).success, false);
    }
});

test('Reown preserves account, signature and rejection responses', () => {
    for (const [key, payload] of [
        ['FRAME_GET_USER_SUCCESS', { address: '0x' + '12'.repeat(20), chainId: 137 }],
        ['FRAME_SWITCH_NETWORK_SUCCESS', { chainId: '137' }],
        ['FRAME_RPC_REQUEST_SUCCESS', '0x' + 'ab'.repeat(65)],
        ['FRAME_RPC_REQUEST_ERROR', { message: 'User rejected request' }],
        ['FRAME_IS_CONNECTED_SUCCESS', { isConnected: true }],
    ]) {
        const input = { id: 'test', type: types[key], payload };
        assert.deepEqual(schemas.W3mFrameSchema.frameEvent.parse(input), input);
    }
    assert.equal(schemas.W3mFrameSchema.frameEvent.safeParse({ type: types.FRAME_RPC_REQUEST_ERROR, payload: { message: 123 } }).success, false);
});
