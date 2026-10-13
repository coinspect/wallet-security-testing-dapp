"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSelectedProvider } from "@/app/wizard/utils/selectedProvider";
import { useInjectedWallet } from "@/app/wizard/context/WalletRuntimeContext";

/**
 * Extension-campaign wallet picker (Defect D). Lists the EIP-6963 wallets that
 * announced themselves and lets the tester point this session at one — every
 * extension-path provider access then routes through the selection (see
 * selectedProvider.js). Persisted via localStorage inside selectedProvider.
 *
 * Zero-friction rules:
 *   • 0 wallets → render nothing (the neutral no-provider state stands elsewhere).
 *   • 1 wallet  → a static chip naming the auto-selected wallet, no menu.
 *   • ≥2 wallets → a dropdown; the active one is checked.
 *
 * HYDRATION: the provider list comes from EIP-6963 announcements + a
 * localStorage selection, which exist only in the browser — so the server (and
 * the client's first render) must NOT emit any wallet icon/name, or the markup
 * won't match. A `ready` flag
 * that is false on the server and the first client render, flipped true in a
 * mount effect. Until then we render a stable, wallet-agnostic placeholder; then
 * we swap ONCE to the real selector.
 */
const WalletIcon = ({ icon, name }) =>
    icon ? (
        <img src={icon} alt="" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
    ) : (
        <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    );

const WalletSelector = () => {
    const { providers, active, select } = useSelectedProvider();
    // Connection state from the SINGLE shared source (AccountProvider now wraps the
    // navbar too). Drives the label so the chip reads as the active wallet, and
    // NEVER claims a connection that isn't there:
    //   • connected      → "Connected to <wallet>"
    //   • present, not connected (none/unknown/no_provider) → "Wallet <wallet>"
    //   • no provider    → the selector renders nothing (no label at all).
    const { status } = useInjectedWallet();
    const connLabel = status === "connected" ? "Connected to" : "Wallet";
    const [open, setOpen] = useState(false);
    // false on the server AND the first client render → identical markup; the
    // mount effect flips it true, after which the real selector renders.
    const [ready, setReady] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        setReady(true);
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    // Until the registry has been read post-mount, emit a stable, wallet-agnostic
    // placeholder — SAME structure as a chip, but no icon image and no wallet
    // name, so server and first-client render match exactly. Swaps once when ready.
    if (!ready) {
        return (
            <div
                data-testid="wallet-selector-placeholder"
                aria-hidden="true"
                className={cn(
                    "flex h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1.5 md:h-7 md:min-w-0 md:px-2",
                    "border border-stealth-border/40 bg-stealth-elevated/40",
                    "text-[10px] md:text-[11px] font-medium text-stealth-muted opacity-70"
                )}
            >
                <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </div>
        );
    }

    // No wallet at all → nothing to show; the neutral no-provider state stands.
    if (providers.length === 0) return null;

    // Exactly one → auto-selected; a static, non-interactive chip. No friction.
    if (providers.length === 1) {
        const only = providers[0];
        return (
            <div
                data-testid="wallet-selector-single"
                title={only.info.name}
                aria-label={`${connLabel} ${only.info.name}`}
                className={cn(
                    "flex h-11 items-center gap-1 rounded-md px-1.5 md:h-7 md:px-2",
                    "border border-stealth-border/40 bg-stealth-elevated/40",
                    "text-[10px] md:text-[11px] font-medium text-stealth-muted"
                )}
            >
                <span className="hidden font-semibold uppercase tracking-wide text-stealth-dim md:inline">
                    {connLabel}
                </span>
                <WalletIcon icon={only.info.icon} name={only.info.name} />
                <span className="hidden sm:inline">{only.info.name}</span>
            </div>
        );
    }

    const activeName = active?.info?.name ?? "Choose wallet";

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                data-testid="wallet-selector"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                title={activeName}
                aria-label={`Choose wallet. Current wallet: ${activeName}`}
                className={cn(
                    "flex h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1.5 md:h-7 md:min-w-0 md:px-2",
                    "border border-stealth-border/50 hover:border-stealth-border",
                    "bg-stealth-elevated/70 hover:bg-stealth-elevated",
                    "text-[10px] md:text-[11px] font-medium text-stealth-fg transition-colors duration-150"
                )}
            >
                <span className="hidden font-semibold uppercase tracking-wide text-stealth-dim md:inline">
                    {connLabel}
                </span>
                <WalletIcon icon={active?.info?.icon} name={activeName} />
                <span className="hidden sm:inline max-w-[8rem] truncate">{activeName}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-stealth-muted" aria-hidden="true" />
            </button>

            {open && (
                <ul
                    role="listbox"
                    className={cn(
                        "absolute right-0 z-50 mt-1 min-w-[11rem] overflow-hidden rounded-md py-1",
                        "border border-stealth-border/60 bg-stealth-elevated shadow-lg"
                    )}
                >
                    {providers.map((p) => {
                        const isActive = active?.info?.uuid === p.info.uuid;
                        return (
                            <li key={p.info.uuid} role="option" aria-selected={isActive}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        select(p.info.rdns);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        "flex min-h-11 w-full items-center gap-2 px-2.5 py-1.5 text-left md:min-h-0",
                                        "text-[11px] font-medium text-stealth-fg hover:bg-stealth-border/30"
                                    )}
                                >
                                    <WalletIcon icon={p.info.icon} name={p.info.name} />
                                    <span className="flex-1 truncate">{p.info.name}</span>
                                    {isActive && (
                                        <Check className="h-3.5 w-3.5 shrink-0 text-stealth-accent" aria-hidden="true" />
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default WalletSelector;
