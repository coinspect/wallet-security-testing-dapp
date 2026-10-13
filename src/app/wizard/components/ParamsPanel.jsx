"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Copy, Check, ChevronDown, Eye, ArrowLeft, X } from "lucide-react";
import { checkBaseFromPath } from "../utils/platform";
import { paramsForCheck } from "../utils/checkLookup.mjs";
import { testParams, CHECKS_SNAPSHOT_URL } from "@/utils/constants";
import wizardConfig from "../config/wizard";

// The FULL value to copy: the structured payload where an entry carries one,
// otherwise the value string — never the truncated on-screen text.
const copyText = (entry) =>
    entry?.full != null
        ? typeof entry.full === "string"
            ? entry.full
            : JSON.stringify(entry.full, null, 2)
        : String(entry?.value ?? "");

/**
 * Contextual params popover — a sibling of CheckIndexPanel (same anchored-
 * popover interaction + styling). The PARAMS trigger in the top bar opens a
 * small panel listing only the registry params the current check uses; each row
 * copies the FULL value. The footer links to the complete /params registry.
 * Esc and click-outside close it.
 */
const ParamsPanel = ({ onOpenChange }) => {
    const [open, setOpen] = useState(false);
    const [copiedKey, setCopiedKey] = useState(null);
    // key of the entry shown in the in-popover detail view, or null for the list.
    const [detailKey, setDetailKey] = useState(null);
    const rootRef = useRef(null);
    const listScrollRef = useRef(null);
    const savedScrollRef = useRef(0);
    const { pathname } = useLocation();
    const baseId = checkBaseFromPath(pathname);
    const params = open ? paramsForCheck(baseId, wizardConfig.wizard.checks, testParams) : [];
    const activeEntry = detailKey ? params.find((p) => p.key === detailKey) : null;

    // Report open-state up so the navbar can suppress the network chip's hover
    // tooltip while this popover is open (else it overlaps the title).
    useEffect(() => {
        onOpenChange?.(open);
    }, [open, onOpenChange]);

    // Closing always drops back to the list, so a reopen starts on the list.
    useEffect(() => {
        if (!open) setDetailKey(null);
    }, [open]);

    // Restore the list's scroll position when returning from the detail view.
    useLayoutEffect(() => {
        if (!detailKey && listScrollRef.current) {
            listScrollRef.current.scrollTop = savedScrollRef.current;
        }
    }, [detailKey]);

    // Enter the detail view for an entry, remembering where the list was scrolled.
    const openDetail = (entry) => {
        savedScrollRef.current = listScrollRef.current?.scrollTop ?? 0;
        setDetailKey(entry.key);
    };

    // Esc + click-outside. Esc is two-stage: from the detail view the first Esc
    // returns to the list, a second closes the popover; from the list it closes.
    // Click-outside closes from either view. (detailKey in deps so the handler
    // sees the current view.)
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key !== "Escape") return;
            if (detailKey) setDetailKey(null);
            else setOpen(false);
        };
        const onDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onDown);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onDown);
        };
    }, [open, detailKey]);

    const copy = async (entry) => {
        try {
            await navigator.clipboard.writeText(copyText(entry));
            setCopiedKey(entry.key);
            setTimeout(() => setCopiedKey((k) => (k === entry.key ? null : k)), 1500);
        } catch {
            /* clipboard unavailable — silent */
        }
    };

    return (
        <span ref={rootRef} className="relative ml-1 inline-flex before:absolute before:-left-0.5 before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-stealth-border">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={open}
                title="Parameters used by this check"
                className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium text-stealth-muted transition-colors hover:bg-stealth-elevated hover:text-stealth-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action aria-expanded:bg-stealth-elevated aria-expanded:text-stealth-fg md:min-h-7 md:rounded-md md:text-[11px]"
            >
                Params
                <ChevronDown
                    className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden="true"
                />
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Check parameters"
                    className="fixed left-4 right-4 top-[104px] z-[60] flex max-h-[calc(100dvh-120px)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-surface-light font-[var(--default-font)] shadow-xl dark:border-gray-700 dark:bg-dark-surface md:absolute md:left-auto md:top-full md:mt-1.5 md:max-h-[70vh] md:w-72 [&_button]:min-h-11 [&_button]:min-w-11 md:[&_button]:min-h-0 md:[&_button]:min-w-0"
                >
                    <button type="button" aria-label="Close check parameters" onClick={() => setOpen(false)}
                        className="ml-auto flex items-center justify-center text-stealth-muted md:hidden"><X className="h-4 w-4" /></button>
                    {activeEntry ? (
                        /* ── DETAIL VIEW — same popover, no modal, width unchanged.
                           The back control replaces the footer here. ── */
                        <>
                            {/* Detail header — pinned: back control + label + Copy. */}
                            <div className="shrink-0 border-b border-gray-200 px-2 pb-1.5 pt-2 dark:border-gray-700">
                                <div className="flex items-center justify-between gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setDetailKey(null)}
                                        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wide text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                    >
                                        <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                                        All parameters
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => copy(activeEntry)}
                                        title="Copy the full value"
                                        aria-label={`Copy ${activeEntry.key}`}
                                        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                                    >
                                        {copiedKey === activeEntry.key ? (
                                            <Check className="h-3 w-3" aria-hidden="true" />
                                        ) : (
                                            <Copy className="h-3 w-3" aria-hidden="true" />
                                        )}
                                        {copiedKey === activeEntry.key ? "Copied" : "Copy"}
                                    </button>
                                </div>
                                <div
                                    className="mt-1 break-words text-[0.8125rem] font-medium leading-snug text-gray-800 dark:text-gray-100"
                                    title={activeEntry.key}
                                >
                                    {activeEntry.label}
                                </div>
                            </div>

                            {/* Detail body — the full value, monospace, wrapped,
                                selectable, scrollable within the popover height. */}
                            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                                <pre className="select-text whitespace-pre-wrap break-all font-mono text-[0.75rem] leading-snug text-gray-700 dark:text-gray-300">
                                    {copyText(activeEntry)}
                                </pre>
                            </div>
                        </>
                    ) : (
                        /* ── LIST VIEW — rows are label + eye + Copy; the footer
                           (snapshot + All N) stays pinned below. ── */
                        <>
                            {/* Header — pinned. */}
                            <div className="shrink-0 px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Params for this check
                            </div>

                            {/* Only the LIST scrolls; header + footer stay pinned. */}
                            <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-1">
                                {params.length === 0 ? (
                                    <div className="px-2 py-1.5 text-[0.8125rem] text-gray-500 dark:text-gray-400">
                                        No parameters specific to this check
                                    </div>
                                ) : (
                                    <div className="space-y-0.5">
                                        {params.map((p) => (
                                            <div
                                                key={p.key}
                                                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                                            >
                                                {/* Label wraps; the FULL value lives on the
                                                    hover title so nothing is lost from the row. */}
                                                <div
                                                    className="min-w-0 flex-1 break-words text-[0.8125rem] font-medium leading-snug text-gray-800 dark:text-gray-100"
                                                    title={copyText(p)}
                                                >
                                                    {p.label}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => openDetail(p)}
                                                    title="View the full value"
                                                    aria-label={`View ${p.key}`}
                                                    className="inline-flex shrink-0 items-center rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                                                >
                                                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => copy(p)}
                                                    title="Copy the full value"
                                                    aria-label={`Copy ${p.key}`}
                                                    className="inline-flex shrink-0 items-center rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                                                >
                                                    {copiedKey === p.key ? (
                                                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                                    ) : (
                                                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer — pinned OUTSIDE the scroll region. */}
                            <div className="shrink-0 space-y-1 border-t border-gray-200 px-3 py-1.5 dark:border-gray-700">
                                {CHECKS_SNAPSHOT_URL && (
                                    <a
                                        href={CHECKS_SNAPSHOT_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[0.75rem] text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        checks.json snapshot ↗
                                    </a>
                                )}
                                <Link
                                    to="/params"
                                    onClick={() => setOpen(false)}
                                    className="block text-[0.75rem] font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                    All {testParams.length} parameters →
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            )}
        </span>
    );
};

export default ParamsPanel;
