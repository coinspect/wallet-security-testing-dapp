import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceLoader } from './helpers/sourceHarness.mjs';

for (const origin of [null, 'http://localhost:3000', 'https://preview.example.test']) {
    test(`WalletConnect uses a public PNG without changing test identity (${origin ?? 'static build'})`, () => {
        const configurations = [];
        sourceLoader({
            '@reown/appkit/react': { createAppKit: (options) => configurations.push(options) },
            '@reown/appkit/networks': { polygon: { id: 137 } },
            '@reown/appkit-adapter-ethers5': { Ethers5Adapter: class {} },
        }, origin ? { window: { location: { origin } } } : {})('src/components/context/AppKitProvider.jsx');

        assert.equal(configurations.length, 1);
        assert.deepEqual(configurations[0].metadata, {
            name: 'Wallet Testing',
            description: 'Wallet Testing Website',
            url: 'https://mywebsite.com',
            icons: ['https://www.coinspect.com/icon-512.png'],
        });
    });
}
