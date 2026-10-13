"use client";

import React, { useEffect, useState } from "react";
import { connectToWallet } from "@/utils/walletConnection";
import { handleCopyAccountClick } from "@/utils/buttons";
import { AlertCircle, Check, Copy, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppKitButton } from '@reown/appkit/react';
import { useInjectedWallet, useWalletConnectRuntime } from '@/app/wizard/context/WalletRuntimeContext';
import { POLYGON_CHAIN_ID } from '@/utils/wallet-methods/polygonPolicy.mjs';

/**
 * Wallet chip — touch-sized on mobile, compact on desktop, with an integrated
 * ghost copy affordance. Truncation: `0xABCD…1234`.
 */
const ConnectWalletButton = ({ wconnect, ready = true }) => {
    const injected = useInjectedWallet();
    const walletConnect = useWalletConnectRuntime();
    const runtime = wconnect ? walletConnect : injected;
    const accountsResult = injected.address;
    const [accountsError, setAccountsError] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const [switching, setSwitching] = useState(false);
    const wrongNetwork = !!runtime.provider && !!runtime.address && runtime.chainId !== POLYGON_CHAIN_ID;

    useEffect(() => {
        if (!isCopied) return undefined;
        const timer = setTimeout(() => setIsCopied(false), 1000);
        return () => clearTimeout(timer);
    }, [isCopied]);

    const truncate = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

    return (
        <div className="relative shrink-0 whitespace-nowrap">
            {!ready ? (
                // Until the persisted campaign is resolved (post-mount), render a
                // stable, neutral, disabled button — IDENTICAL markup on the
                // server and the client hydration pass, so the AppKit /
                // extension variants never appear until after hydration. This is
                // extension variants mount only after that first stable pass.
                <button
                    type="button"
                    disabled
                    data-testid="wallet-connect-placeholder"
                    aria-hidden="true"
                    className={cn(
                        'flex h-11 min-w-11 items-center justify-center gap-1 rounded-md md:h-7 md:min-w-0',
                        'border border-stealth-border/40 bg-stealth-elevated/40',
                        'px-1.5 md:px-2 text-[10px] md:text-[11px] font-medium text-stealth-muted',
                        'opacity-70'
                    )}
                >
                    <Wallet className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Connect Wallet</span>
                </button>
            ) : wrongNetwork || runtime.networkSetup?.busy ? (
                <button type="button" disabled={switching || runtime.networkSetup?.busy}
                    title={accountsError || runtime.networkSetup?.error || 'All checks start on Polygon'}
                    onClick={async () => {
                        setSwitching(true); setAccountsError(false);
                        try { await runtime.switchToPolygon(); }
                        catch (error) { setAccountsError(error.message); }
                        finally { setSwitching(false); }
                    }}
                    className="min-h-11 rounded-md border border-amber-500/60 px-3 text-xs text-amber-500 disabled:opacity-60 md:min-h-7">
                    {switching || runtime.networkSetup?.busy ? 'Connecting on Polygon…' : 'Switch to Polygon'}
                </button>
            ) : wconnect ? (
                // AppKit owns the WalletConnect button rendering and modal state.
                <div style={{
                    '--apkt-tokens-core-backgroundAccentPrimary': '#2563eb',
                    '--apkt-tokens-theme-textInvert': '#fff',
                    '--apkt-fontFamily-regular': 'var(--font-inter, Inter), system-ui, sans-serif',
                    '--apkt-borderRadius-2': '8px',
                    '--apkt-borderRadius-3': '8px',
                    '--apkt-spacing-3': '14px',
                }}>
                    <AppKitButton />
                </div>
            ) : (
                <>
                    {accountsResult ? (
                        <button
                            data-testid="wallet-chip"
                            onClick={() => handleCopyAccountClick(accountsResult, setIsCopied)}
                            aria-label={`Copy connected account ${accountsResult}`}
                            title={accountsResult}
                            className={cn(
                                'group flex h-11 items-center gap-1 rounded-md md:h-7',
                                'bg-stealth-elevated/70 hover:bg-stealth-elevated',
                                'border border-stealth-border/50 hover:border-stealth-border',
                                // Tighter padding + slightly smaller font on mobile.
                                'px-1.5 md:px-2 text-[10px] md:text-[11px] font-mono tracking-tight',
                                'transition-all duration-150 ease-out'
                            )}
                        >
                            <span className="whitespace-nowrap text-stealth-fg">{truncate(accountsResult)}</span>
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'inline-flex h-4 w-4 items-center justify-center rounded-sm',
                                    'text-stealth-dim group-hover:text-stealth-muted',
                                    'transition-colors duration-150'
                                )}
                            >
                                {isCopied ? (
                                    <Check className="h-3 w-3 text-stealth-accent" />
                                ) : (
                                    <Copy className="h-3 w-3" />
                                )}
                            </span>
                        </button>
                    ) : (
                        <div className="flex flex-col items-end gap-0.5">
                            <button
                                data-testid="wallet-connect-cta"
                                aria-label="Connect extension wallet"
                                onClick={() => {
                                    setAccountsError(false);
                                    connectToWallet(setAccountsError);
                                }}
                                className={cn(
                                    'flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg md:h-7 md:min-w-0 md:rounded-md',
                                    'border border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700',
                                    'px-2 text-xs md:text-[11px] font-medium',
                                    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action focus-visible:ring-offset-2 focus-visible:ring-offset-stealth-bg'
                                )}
                            >
                                <Wallet className="h-3.5 w-3.5" />
                                <span className="md:hidden">Connect</span><span className="hidden md:inline">Connect Ext</span>
                            </button>
                            {accountsError && (
                                <div
                                    className={cn(
                                        'absolute -bottom-5 left-1/2 -translate-x-1/2',
                                        'flex items-center justify-center gap-1 whitespace-nowrap',
                                        'text-[10px] text-destructive'
                                    )}
                                >
                                    <AlertCircle className="h-2.5 w-2.5" />
                                    <span>{accountsError}</span>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ConnectWalletButton;
