'use client';

/**
 * @file NavStatusStrip — Chain Badge command bridge for the Inspector.
 *
 *   [ ● Polygon ] [ PARAMS ] — visible on every viewport.
 *
 * The strip is the primary Inspector toggle. Click
 * dispatches `sentinel:inspector-toggle`; the workstation page flips
 * `configOpen` in response and rebroadcasts `sentinel:inspector-state`
 * so the strip's active state stays in sync. Its chain comes from the same
 * transport runtime used by the active campaign.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import ParamsPanel from '@/app/wizard/components/ParamsPanel';
import { useActiveTransport } from '@/app/wizard/hooks/useActiveTransport';
import { useWalletRuntime } from '@/app/wizard/context/WalletRuntimeContext';

/** Detect Apple platforms once at module load so the shortcut hint
 *  reads the right glyph (⌘ vs Ctrl). Safe in SSR — defaults to ⌘. */
const SHORTCUT_HINT = (() => {
    if (typeof navigator === 'undefined') return '⌘ I';
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    return isMac ? '⌘ I' : 'Ctrl I';
})();

// Human-readable network name for the chain badge (falls back to the raw id).
const CHAIN_NAMES = {
    "0x1": "Ethereum",
    "0x89": "Polygon",
    "0x144": "zkSync Era",
    "0x5": "Goerli",
    "0xaa36a7": "Sepolia",
};
const chainLabel = (id) => (id ? CHAIN_NAMES[id.toLowerCase?.() ?? id] || id : "—");

export default function NavStatusStrip() {
    const [inspectorOpen, setInspectorOpen] = React.useState(true);
    // Wallet and AppKit state can exist during the browser's first render but
    // not during static HTML generation. Hold it back until after hydration so
    // the server and first client tree always match.
    const [hydrated, setHydrated] = React.useState(false);
    const transport = useActiveTransport();
    const runtime = useWalletRuntime(transport);
    const chainId = runtime.chainId;
    const displayedChainId = hydrated ? chainId : null;
    // Whether the PARAMS popover is open — while it is, the chip's hover tooltip
    // is suppressed so it can't overlap the popover's title.
    const [paramsOpen, setParamsOpen] = React.useState(false);

    // Listen for inspector visibility changes from the workstation page.
    React.useEffect(() => {
        setHydrated(true);
    }, []);

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onState = (e) => {
            const next = e?.detail?.open;
            if (typeof next === 'boolean') setInspectorOpen(next);
        };
        window.addEventListener('sentinel:inspector-state', onState);
        return () => window.removeEventListener('sentinel:inspector-state', onState);
    }, []);

    const onClick = () => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('sentinel:inspector-toggle'));
    };

    return (
        <span className="group/tip relative inline-flex max-w-full items-center">
            <button
                type="button"
                onClick={onClick}
                data-testid="nav-status-strip"
                data-chain={displayedChainId || ''}
                data-active={inspectorOpen ? 'true' : 'false'}
                aria-pressed={inspectorOpen}
                aria-label={inspectorOpen ? 'Hide Runtime Params' : 'Show Runtime Params'}
                className={cn(
                    'inline-flex h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 md:h-7 md:rounded-md',
                    'text-xs font-medium md:text-[11px]',
                    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action',
                    inspectorOpen
                        ? 'bg-stealth-action/10 text-stealth-action hover:bg-stealth-action/15'
                        : 'text-stealth-fg hover:bg-stealth-elevated'
                )}
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        displayedChainId ? 'bg-stealth-accent' : 'bg-stealth-dim'
                    )}
                />
                <span className="max-w-[5rem] truncate md:max-w-none">
                    {chainLabel(displayedChainId)}
                </span>
            </button>
            {/* PARAMS is its OWN trigger now — an anchored popover of the
                current check's registry params (sibling of CheckIndexPanel). The
                chain chip above keeps toggling the runtime inspector. */}
            <ParamsPanel onOpenChange={setParamsOpen} />
            {/* Hover tooltip — anchored below the chip. Hidden while the PARAMS
                popover is open so it never overlaps the popover title. */}
            <span
                role="tooltip"
                className={cn(
                    'pointer-events-none absolute right-0 top-full z-50 mt-1.5 hidden whitespace-nowrap md:block',
                    'rounded-md border border-stealth-border bg-stealth-elevated px-2 py-1',
                    'font-sans text-[11px] tracking-tight text-stealth-fg',
                    'shadow-[0_4px_18px_-6px_rgb(0_0_0_/_0.6)]',
                    'opacity-0 translate-y-0.5 group-hover/tip:opacity-100 group-hover/tip:translate-y-0',
                    'transition-all duration-150 ease-out',
                    paramsOpen && 'md:hidden'
                )}
            >
                {inspectorOpen ? 'Hide Runtime Params' : 'Show Runtime Params'}
                <span className="ml-1.5 rounded bg-stealth-bg/80 px-1 py-0.5 font-mono text-[10px] text-stealth-muted">
                    {SHORTCUT_HINT}
                </span>
            </span>
        </span>
    );
}
