import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceLoader, reactHarness, nodes } from './helpers/sourceHarness.mjs';

const hookPath = 'src/app/wizard/hooks/useActiveTransport.js';

test('route transport keeps embedded requests in the mobile campaign', () => {
    const load = sourceLoader({
        'react-router': {},
        '../context/PlatformContext': {},
    });
    const { transportForRoute } = load(hookPath);
    assert.equal(transportForRoute('/wizard/mobile/WSR-PERM-010'), 'injected');
    assert.equal(transportForRoute('/wizard/mobile/WSR-PERM-010/'), 'injected');
    assert.equal(transportForRoute('/wizard/mobile/WSR-PERM-010', 'extension'), 'injected');
    assert.equal(transportForRoute('/wizard/mobile/WSR-PERM-002'), 'walletconnect');
    assert.equal(transportForRoute('/wizard/extension/WSR-PERM-010', 'mobile'), 'extension');
    assert.equal(transportForRoute('/params', 'mobile'), 'walletconnect');
});

test('navbar and network badge follow the embedded provider, not an existing WalletConnect session', () => {
    let pathname = '/wizard/mobile/WSR-PERM-010';
    const injected = { chainId: '0x1' };
    const walletconnect = { chainId: '0x89' };
    const harness = reactHarness();
    const Connect = () => null;
    const Selector = () => null;
    const overrides = {
        react: harness.react,
        'react-router': { useLocation: () => ({ pathname }) },
        '../context/PlatformContext': { usePlatform: () => ({ platform: 'mobile', ready: true }) },
        '@/app/wizard/context/PlatformContext': { usePlatform: () => ({ platform: 'mobile', ready: true }) },
        '@/app/wizard/context/WalletRuntimeContext': {
            useWalletRuntime: (transport) => transport === 'walletconnect' ? walletconnect : injected,
        },
        '../WalletConnectButton/WalletConnectButton': Connect,
        '../WalletSelector/WalletSelector': Selector,
        '../controls/NavControls': () => null,
        '@/app/wizard/components/ParamsPanel': () => null,
    };
    const load = sourceLoader(overrides);
    const NavBar = load('src/components/mainLayout/layoutBar/navBar/NavBar.jsx').default;
    const Status = load('src/components/mainLayout/layoutBar/navBar/NavStatusStrip.jsx').default;
    const connection = () => nodes(NavBar()).find((node) => node.type === Connect);
    const badge = () => nodes(harness.render(Status)).find((node) => node.props?.['data-testid'] === 'nav-status-strip');
    assert.equal(connection().props.wconnect, false);
    assert.equal(nodes(NavBar()).some((node) => node.type === Selector), false);
    badge();
    assert.equal(badge().props['data-chain'], '0x1');
    injected.chainId = '0x89';
    assert.equal(badge().props['data-chain'], '0x89');
    injected.chainId = null;
    assert.equal(badge().props['data-chain'], '');
    assert.equal(connection().props.wconnect, false);
    pathname = '/wizard/mobile/WSR-PERM-002';
    assert.equal(connection().props.wconnect, true);
    assert.equal(badge().props['data-chain'], '0x89');
    pathname = '/wizard/extension/WSR-PERM-010';
    assert.equal(connection().props.wconnect, false);
    assert.equal(nodes(NavBar()).some((node) => node.type === Selector), true);
    harness.unmount();
});
