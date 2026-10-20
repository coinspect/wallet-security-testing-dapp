import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { transformSync } = require('@swc/core');
const source = readFileSync('src/components/mainLayout/layoutBar/WalletConnectButton/WalletConnectButton.jsx', 'utf8');

test('both campaigns render the same connection button and keep their own connection flow', () => {
    const calls = [];
    const injected = {};
    const mobile = { open: (options) => calls.push(options) };
    const mocks = {
        react: { ...React, useEffect: () => {}, useState: (value) => [value, () => {}] },
        '@/utils/walletConnection': { connectToWallet: () => calls.push('extension') },
        '@/utils/buttons': { handleCopyAccountClick: () => {} },
        '@/lib/utils': { cn: (...values) => values.join(' ') },
        '@reown/appkit/react': { AppKitButton: () => React.createElement('span', null, 'Connected account') },
        '@/app/wizard/context/WalletRuntimeContext': { useInjectedWallet: () => injected, useWalletConnectRuntime: () => mobile },
        '@/utils/wallet-methods/polygonPolicy.mjs': { POLYGON_CHAIN_ID: '0x89' },
    };
    const { code } = transformSync(source, { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
    const exports = {};
    new Function('require', 'exports', code)((id) => mocks[id] ?? require(id), exports);
    const findCTA = (node) => {
        if (!node || typeof node !== 'object') return null;
        if (node.type === exports.ConnectWalletCTA) return node;
        return React.Children.toArray(node.props?.children).map(findCTA).find(Boolean);
    };
    const extension = findCTA(exports.default({ wconnect: false }));
    const walletConnect = findCTA(exports.default({ wconnect: true }));
    assert.ok(extension);
    assert.ok(walletConnect);
    assert.equal(renderToStaticMarkup(extension), renderToStaticMarkup(walletConnect));
    assert.match(renderToStaticMarkup(extension), /Connect Wallet/);
    extension.props.onClick();
    walletConnect.props.onClick();
    assert.deepEqual(calls, ['extension', { view: 'Connect' }]);
    mobile.address = '0x123';
    assert.equal(findCTA(exports.default({ wconnect: true })) ?? null, null);
});
