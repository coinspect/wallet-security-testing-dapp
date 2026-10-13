"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { UNKNOWN_POOL, polygonscanAddress } from "../utils/unknownPool";

const short = (a) => `${a.slice(0, 10)}…${a.slice(-8)}`;

/**
 * Best-effort freshness per candidate via PLAIN RPC on the connected provider:
 * nonce 0 AND balance 0 → "no outbound activity, zero balance". This is only a
 * hint — see the caveat below; it cannot detect an incoming zero-value burn.
 * Returns key → "fresh" | "activity" | "unchecked".
 */
const useFreshness = (provider, chainId) => {
    const [status, setStatus] = useState({});
    useEffect(() => {
        if (!provider?.request || chainId !== "0x89") return undefined;
        let active = true;
        (async () => {
            for (const c of UNKNOWN_POOL) {
                if (!active) break;
                try {
                    const [nonce, balance] = await Promise.all([
                        provider.request({ method: "eth_getTransactionCount", params: [c.address, "latest"] }),
                        provider.request({ method: "eth_getBalance", params: [c.address, "latest"] }),
                    ]);
                    const fresh = BigInt(nonce) === 0n && BigInt(balance) === 0n;
                    if (active) setStatus((s) => ({ ...s, [c.key]: { provider, chainId, value: fresh ? "fresh" : "activity" } }));
                } catch {
                    if (active) setStatus((s) => ({ ...s, [c.key]: { provider, chainId, value: "unchecked" } }));
                }
            }
        })();
        return () => {
            active = false;
        };
    }, [provider, chainId]);
    return Object.fromEntries(UNKNOWN_POOL.map((candidate) => {
        const record = status[candidate.key];
        return [candidate.key, record?.provider === provider && record?.chainId === chainId ? record.value : "unchecked"];
    }));
};

const FRESHNESS_TEXT = {
    fresh: "No outbound activity, zero balance.",
    activity: "Has outbound activity or a non-zero balance.",
    unchecked: "Freshness unchecked (connect to Polygon to read it).",
};

/**
 * THRE-005 candidate picker — a SELECTION among documented pool addresses (no
 * free-text input). Sets the send target for the run and reports the choice up.
 */
const UnknownAddressPicker = ({ selected, onSelect, provider, chainId }) => {
    const freshness = useFreshness(provider, chainId);
    return (
        <div className="rounded-lg border border-gray-200 bg-surface-light p-4 dark:border-gray-700 dark:bg-dark-surface">
            <h3 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Unknown-address candidate
            </h3>
            {/* Item 5 — guidance on the check. */}
            <p className="mt-1 text-[0.875rem] leading-[1.25rem] text-gray-600 dark:text-gray-300">
                If you suspect a candidate has already received a transaction from this wallet, pick
                another and note which one you used.
            </p>
            {/* Explicit about what the freshness signal does NOT prove. */}
            <details className="mt-2 text-[0.8125rem] leading-[1.1rem] text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer">What the activity hint checks</summary>
                <p className="mt-2">
                Freshness below is best-effort (nonce + balance on the connected chain). A zero-value
                transfer INTO an address changes neither, so this cannot detect the exact burn we care
                about. Inspect the wallet&apos;s history and Polygonscan for incoming transfers too.
                </p>
            </details>

            <div role="radiogroup" aria-label="Unknown-address candidate" className="mt-3 flex flex-col gap-1.5">
                {UNKNOWN_POOL.map((c) => {
                    const active = c.key === selected;
                    const f = freshness[c.key];
                    return (
                        <label
                            key={c.key}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors ${
                                active
                                    ? "border-blue-400/60 bg-blue-500/5 dark:border-blue-400/50"
                                    : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/40"
                            }`}
                        >
                            <input
                                type="radio"
                                name="unknown-candidate"
                                className="mt-1 shrink-0 accent-blue-500"
                                checked={active}
                                onChange={() => onSelect(c.key)}
                            />
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                        Candidate {c.index}
                                        {c.index === 1 && " · default"}
                                    </span>
                                    <span className="font-mono text-[0.8125rem] text-gray-500 dark:text-gray-400" title={c.address}>
                                        {short(c.address)}
                                    </span>
                                </div>
                                <div className="mt-0.5 text-[0.8125rem] leading-[1.1rem] text-gray-500 dark:text-gray-400">
                                    {FRESHNESS_TEXT[f] || "Freshness unchecked."}
                                </div>
                                <a
                                    href={polygonscanAddress(c.address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="mt-1 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                    View on Polygonscan
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </a>
                            </div>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

export default UnknownAddressPicker;
