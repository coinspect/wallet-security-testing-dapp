'use client';

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    useAppKit,
    useAppKitAccount,
    useAppKitNetwork,
    useAppKitProvider,
    useDisconnect,
} from '@reown/appkit/react';
import { WALLET_ACCOUNTS_EVENT } from '@/utils/walletConnection';
import { normalizeChainId } from '@/utils/wallet-methods/chainId.mjs';
import { ensurePolygon } from '@/utils/wallet-methods/chain';
import { POLYGON_CHAIN_ID } from '@/utils/wallet-methods/polygonPolicy.mjs';
import { walletConnectProbeProvider } from '@/utils/wallet-methods/wc/probeProvider.mjs';
import { useActiveProvider } from '../utils/selectedProvider';

const noop = async () => ({ address: null, chainId: null });
const EMPTY_INJECTED = Object.freeze({
    address: null,
    account: null,
    chainId: null,
    status: 'unknown',
    provider: null,
    refresh: noop,
});
const EMPTY_WALLET_CONNECT = Object.freeze({
    address: null,
    account: null,
    chainId: null,
    status: 'unknown',
    provider: null,
    walletProvider: null,
    isConnected: false,
    open: noop,
    refresh: noop,
});

const WalletRuntimeContext = createContext(null);

/**
 * One state owner for the selected injected wallet and the WalletConnect
 * session. Consumers select a transport; they never start a second account or
 * chain subscription of their own.
 */
export function WalletRuntimeProvider({ children }) {
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const injectedProvider = useActiveProvider();
    const selectedInjected = useRef(injectedProvider);
    selectedInjected.current = injectedProvider;
    const injectedRead = useRef(0);
    const injectedEvents = useRef({ accounts: 0, chain: 0 });
    const [injectedState, setInjectedState] = useState({
        provider: null,
        address: null,
        chainId: null,
        status: 'unknown',
    });

    const refreshInjected = useCallback(async () => {
        const provider = injectedProvider;
        if (selectedInjected.current !== provider) return;
        const read = ++injectedRead.current;
        const events = { ...injectedEvents.current };
        if (!provider?.request) {
            const next = { provider, address: null, chainId: null, status: 'no_provider' };
            setInjectedState(next);
            return next;
        }

        const [accountsResult, chainResult] = await Promise.allSettled([
            Promise.resolve().then(() => provider.request({ method: 'eth_accounts' })),
            Promise.resolve().then(() => provider.request({ method: 'eth_chainId' })),
        ]);
        const accounts = accountsResult.status === 'fulfilled' && Array.isArray(accountsResult.value)
            ? accountsResult.value
            : null;
        setInjectedState((previous) => {
            if (selectedInjected.current !== provider || injectedRead.current !== read) return previous;
            const baseline = previous.provider === provider ? previous : { address: null, chainId: null, status: 'unknown' };
            const useAccounts = accounts && events.accounts === injectedEvents.current.accounts;
            return {
                provider,
                address: useAccounts ? (accounts[0] ?? null) : baseline.address,
                status: useAccounts
                    ? (accounts.length > 0 ? 'connected' : 'none')
                    : baseline.status,
                chainId: chainResult.status === 'fulfilled' && events.chain === injectedEvents.current.chain
                    ? normalizeChainId(chainResult.value)
                    : baseline.chainId,
            };
        });
    }, [injectedProvider]);

    useEffect(() => {
        const provider = injectedProvider;
        let active = true;
        setInjectedState({
            provider,
            address: null,
            chainId: null,
            status: provider ? 'unknown' : 'no_provider',
        });
        refreshInjected();

        const onAccountsChanged = (accounts) => {
            if (!active || selectedInjected.current !== provider) return;
            injectedEvents.current.accounts += 1;
            const address = Array.isArray(accounts) ? (accounts[0] ?? null) : null;
            setInjectedState((previous) => ({
                ...previous,
                address,
                status: address ? 'connected' : 'none',
            }));
        };
        const onChainChanged = (chainId) => {
            if (!active || selectedInjected.current !== provider) return;
            injectedEvents.current.chain += 1;
            setInjectedState((previous) => ({
                ...previous,
                chainId: normalizeChainId(chainId),
            }));
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshInjected();
        };

        provider?.on?.('accountsChanged', onAccountsChanged);
        provider?.on?.('chainChanged', onChainChanged);
        window.addEventListener('focus', refreshInjected);
        window.addEventListener(WALLET_ACCOUNTS_EVENT, refreshInjected);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active = false;
            injectedRead.current += 1;
            provider?.removeListener?.('accountsChanged', onAccountsChanged);
            provider?.removeListener?.('chainChanged', onChainChanged);
            window.removeEventListener('focus', refreshInjected);
            window.removeEventListener(WALLET_ACCOUNTS_EVENT, refreshInjected);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [injectedProvider, refreshInjected]);

    useEffect(() => {
        if (injectedState.provider !== injectedProvider || !injectedState.address) return;
        try {
            window.localStorage.setItem('wizard.lastAddress', injectedState.address);
        } catch {
            /* storage unavailable — non-fatal */
        }
    }, [injectedProvider, injectedState]);

    const { address: appKitAddress } = useAppKitAccount();
    const { chainId: appKitChainId } = useAppKitNetwork();
    const { walletProvider } = useAppKitProvider('eip155');
    const { open } = useAppKit();
    const { disconnect } = useDisconnect();
    const topic = walletProvider?.session?.topic;
    const probeProvider = useMemo(() => walletConnectProbeProvider(walletProvider, topic), [walletProvider, topic]);
    const selectedWalletConnect = useRef({ provider: walletProvider, topic });
    selectedWalletConnect.current = { provider: walletProvider, topic };
    const walletConnectRead = useRef(0);
    const [walletConnectRpc, setWalletConnectRpc] = useState({ provider: null, topic: null, address: null, chainId: null });
    const polygonSetup = useRef(null);
    const polygonPending = useRef(null);
    const [networkSetup, setNetworkSetup] = useState({ busy: false, error: null });

    const refreshWalletConnect = useCallback(async () => {
        const current = () => mounted.current && selectedWalletConnect.current.provider === walletProvider && selectedWalletConnect.current.topic === topic
            && walletProvider?.session?.topic === topic;
        if (!current()) return;
        const read = ++walletConnectRead.current;
        if (!walletProvider?.request) {
            const empty = { provider: walletProvider, topic, address: null, chainId: null };
            setWalletConnectRpc(empty);
            return empty;
        }
        const [accountsResult, chainResult] = await Promise.allSettled([
            Promise.resolve().then(() => walletProvider.request({ method: 'eth_accounts' })),
            Promise.resolve().then(() => walletProvider.request({ method: 'eth_chainId' })),
        ]);
        const accounts = accountsResult.status === 'fulfilled' && Array.isArray(accountsResult.value)
            ? accountsResult.value
            : [];
        const next = {
            provider: walletProvider,
            topic,
            address: accounts[0] ?? null,
            chainId: chainResult.status === 'fulfilled'
                ? normalizeChainId(chainResult.value)
                : null,
        };
        if (!current() || walletConnectRead.current !== read) return;
        setWalletConnectRpc((previous) => current() && walletConnectRead.current === read ? next : previous);
        return next;
    }, [walletProvider, topic]);

    useEffect(() => {
        refreshWalletConnect();
        return () => { walletConnectRead.current += 1; };
    }, [walletProvider, appKitChainId, refreshWalletConnect]);

    useEffect(() => {
        const onChainChanged = (value) => {
            if (!mounted.current || selectedWalletConnect.current.provider !== walletProvider
                || selectedWalletConnect.current.topic !== topic || walletProvider?.session?.topic !== topic) return;
            walletConnectRead.current += 1;
            setWalletConnectRpc((previous) => ({
                ...(previous.provider === walletProvider && previous.topic === topic ? previous : { address: null }),
                provider: walletProvider, topic, chainId: normalizeChainId(value),
            }));
        };
        walletProvider?.on?.('chainChanged', onChainChanged);
        return () => { walletProvider?.removeListener?.('chainChanged', onChainChanged); };
    }, [walletProvider, topic]);

    const switchWalletConnectToPolygon = useCallback(async () => {
        const provider = walletProvider;
        if (!provider?.request || selectedWalletConnect.current.provider !== provider) return;
        if (polygonPending.current?.provider === provider && polygonPending.current.topic === topic) return polygonPending.current.promise;
        const isCurrent = () => mounted.current && selectedWalletConnect.current.provider === provider
            && selectedWalletConnect.current.topic === topic && provider.session?.topic === topic;
        const pending = { provider, topic };
        pending.promise = (async () => {
            setNetworkSetup({ busy: true, error: null });
            try { await ensurePolygon(provider, { isCurrent }); }
            catch (error) {
                if (isCurrent()) setNetworkSetup({ busy: false, error: error.message });
                throw error;
            } finally {
                if (polygonPending.current === pending) polygonPending.current = null;
                if (isCurrent()) {
                    setNetworkSetup((previous) => ({ ...previous, busy: false }));
                    refreshWalletConnect();
                }
            }
        })();
        polygonPending.current = pending;
        return pending.promise;
    }, [walletProvider, topic, refreshWalletConnect]);

    // One setup attempt per new/restored session, never on ordinary chainChanged
    // events. A chain-switch test must retain its actual result without an
    // automatic switch-back or a second wallet prompt contaminating evidence.
    useEffect(() => {
        if (!walletProvider || !topic) { polygonSetup.current = null; setNetworkSetup({ busy: false, error: null }); return; }
        if (walletConnectRpc.provider !== walletProvider || walletConnectRpc.topic !== topic || !walletConnectRpc.chainId) return;
        if (polygonSetup.current?.provider === walletProvider && polygonSetup.current.topic === topic) return;
        polygonSetup.current = { provider: walletProvider, topic };
        setNetworkSetup({ busy: false, error: null });
        if (walletConnectRpc.chainId !== POLYGON_CHAIN_ID) switchWalletConnectToPolygon().catch(() => {});
    }, [walletProvider, topic, walletConnectRpc, switchWalletConnectToPolygon]);

    const switchInjectedToPolygon = useCallback(async () => {
        if (!injectedProvider?.request || selectedInjected.current !== injectedProvider) return;
        try { await ensurePolygon(injectedProvider, { isCurrent: () => mounted.current && selectedInjected.current === injectedProvider }); }
        finally { if (mounted.current && selectedInjected.current === injectedProvider) refreshInjected(); }
    }, [injectedProvider, refreshInjected]);

    const injected = useMemo(() => ({
        ...(injectedState.provider === injectedProvider ? injectedState : { address: null, chainId: null, status: injectedProvider ? 'unknown' : 'no_provider' }),
        account: injectedState.provider === injectedProvider ? injectedState.address : null,
        provider: injectedProvider ?? null,
        refresh: refreshInjected,
        switchToPolygon: switchInjectedToPolygon,
    }), [injectedProvider, injectedState, refreshInjected, switchInjectedToPolygon]);

    const walletConnect = useMemo(() => {
        const currentRpc = walletConnectRpc.provider === walletProvider && walletConnectRpc.topic === topic ? walletConnectRpc : {};
        const address = walletProvider ? appKitAddress ?? currentRpc.address ?? null : null;
        const chainId = walletProvider ? normalizeChainId(currentRpc.chainId) : null;
        return {
            address,
            account: address,
            chainId,
            status: address ? 'connected' : (walletProvider ? 'unknown' : 'no_provider'),
            provider: probeProvider ?? null,
            walletProvider: probeProvider ?? null,
            isConnected: Boolean(walletProvider),
            open,
            disconnect,
            refresh: refreshWalletConnect,
            switchToPolygon: switchWalletConnectToPolygon,
            networkSetup,
        };
    }, [appKitAddress, open, disconnect, refreshWalletConnect, walletConnectRpc, walletProvider, probeProvider, topic, switchWalletConnectToPolygon, networkSetup]);

    const value = useMemo(() => ({ injected, walletConnect }), [injected, walletConnect]);
    return <WalletRuntimeContext.Provider value={value}>{children}</WalletRuntimeContext.Provider>;
}

export const useInjectedWallet = () =>
    useContext(WalletRuntimeContext)?.injected ?? EMPTY_INJECTED;

export const useWalletConnectRuntime = () =>
    useContext(WalletRuntimeContext)?.walletConnect ?? EMPTY_WALLET_CONNECT;

export const useWalletRuntime = (transport = 'injected') => {
    const runtime = useContext(WalletRuntimeContext);
    if (!runtime) return transport === 'walletconnect' ? EMPTY_WALLET_CONNECT : EMPTY_INJECTED;
    return transport === 'walletconnect' ? runtime.walletConnect : runtime.injected;
};
