"use client";

import React from "react";
import { Loader2, Network } from "lucide-react";

/**
 * Network-gate note shown inside the action card when the wallet is on the
 * wrong chain for a `requiredChain` check. Instructional setup guidance (amber),
 * not a verdict — the wizard documents, it does not judge.
 *
 * Setup is separate from check requests. PERM-009 also starts on Polygon but
 * may deliberately request another chain; its result must not auto-switch back.
 */
const ChainGate = ({ chainName = "Polygon", switching = false, autoSwitching = false, onSwitch, error }) => {
    if (autoSwitching) {
        return (
            <div className="rounded-md border px-3 py-2 border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)]">
                <p className="flex items-center gap-2 text-[0.8125rem] leading-[1.15rem] text-[var(--wsr-note-fg)]">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    Switching your wallet to {chainName}…
                </p>
            </div>
        );
    }
    return (
        <div className="rounded-md border px-3 py-2 border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)]">
            <p className="flex items-start gap-2 text-[0.8125rem] leading-[1.15rem] text-[var(--wsr-note-fg)]">
                <Network className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Connect on {chainName} before running this check.</span>
            </p>
            {error && <p role="status" className="mt-2 text-xs text-[var(--wsr-note-fg)]">{error}</p>}
            <button
                type="button"
                onClick={onSwitch}
                disabled={switching}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.8125rem] font-medium border-[var(--wsr-note-border)] text-[var(--wsr-note-fg)] hover:bg-[var(--wsr-note-bg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                {switching ? "Check your wallet…" : `Switch to ${chainName}`}
            </button>
        </div>
    );
};

export default ChainGate;
