'use client';

/**
 * Read-only state bridge for browser-driven test agents.
 *
 * Agents operate the visible controls. No wallet method, signature request,
 * transaction request, or synthetic status setter is exposed globally.
 * Same-origin JavaScript can observe the snapshots, so this is an integrity
 * boundary rather than a confidentiality boundary.
 */

import * as React from 'react';

import { cloneReadonly } from '../../security/clientBoundary.mjs';
import {
    isAuthenticSentinelRoot,
    markSentinelRoot,
    SENTINEL_VERSION,
} from '../../security/sentinelIdentity.mjs';
import { usePlatform } from '@/app/wizard/context/PlatformContext';
import { useWalletRuntime } from '@/app/wizard/context/WalletRuntimeContext';
import { hasValidEip55Checksum } from '@/app/wizard/utils/eip55.mjs';

const installSentinelGlobal = (stateRef) => {
    if (typeof window === 'undefined') return false;

    const existing = Object.getOwnPropertyDescriptor(window, 'sentinel');
    if (existing && !existing.configurable) {
        return isAuthenticSentinelRoot(existing.value);
    }

    const root = Object.create(null);
    Object.defineProperties(root, {
        state: {
            get: () => cloneReadonly(stateRef.current),
            enumerable: true,
            configurable: false,
        },
        actions: {
            value: Object.freeze({}),
            enumerable: true,
            configurable: false,
            writable: false,
        },
        version: {
            value: SENTINEL_VERSION,
            enumerable: true,
            configurable: false,
            writable: false,
        },
    });
    markSentinelRoot(root);
    Object.freeze(root);

    Object.defineProperty(window, 'sentinel', {
        value: root,
        enumerable: true,
        configurable: false,
        writable: false,
    });
    return window.sentinel === root && isAuthenticSentinelRoot(root);
};

function SentinelBridge({ children }) {
    const platform = usePlatform()?.platform;
    const { address } = useWalletRuntime(platform === 'mobile' ? 'walletconnect' : 'injected');
    const isValidChecksum = hasValidEip55Checksum(address);
    const stateRef = React.useRef({
        evm: { address: '', isValidChecksum: false },
        btc: { connected: false, walletType: null, address: null, network: 'signet' },
        wizard: { currentStep: null, stepsStatus: {}, lastEvent: null },
        tx: { status: 'unavailable', hash: null, error: null, updatedAt: null },
    });
    const [installState, setInstallState] = React.useState('pending');

    React.useEffect(() => {
        setInstallState(installSentinelGlobal(stateRef) ? 'ready' : 'blocked');
    }, []);

    React.useEffect(() => {
        stateRef.current = {
            ...stateRef.current,
            evm: { address: address || '', isValidChecksum: Boolean(isValidChecksum) },
        };
    }, [address, isValidChecksum]);

    return (
        <>
            {children}
            {installState === 'ready' && (
                <div
                    id="sentinel-ready"
                    data-testid="sentinel-ready"
                    data-sentinel-version={SENTINEL_VERSION}
                    aria-hidden="true"
                    style={{ display: 'none' }}
                />
            )}
            {installState === 'blocked' && (
                <div
                    role="alert"
                    data-testid="sentinel-install-blocked"
                    className="fixed bottom-3 left-3 right-3 z-[100] rounded-md border border-red-500/70 bg-red-950 px-4 py-3 text-sm text-red-100 shadow-lg"
                >
                    Agent bridge unavailable: another script reserved window.sentinel before the app loaded. Reload in a clean browser session and do not trust agent state from this page.
                </div>
            )}
        </>
    );
}

export function SentinelProvider({ children }) {
    return <SentinelBridge>{children}</SentinelBridge>;
}

export default SentinelProvider;
