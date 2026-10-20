"use client";

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { List, X } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { baseCheckId, DEFAULT_PLATFORM } from "../utils/platform";
import { checkCategory, checkSortKey, CELESTE_DARK, CELESTE_LIGHT } from "../utils/campaignChecks";

/**
 * Popover index of every check in the ACTIVE campaign, opened from a trigger
 * beside the "Check N of M" label. Entries are grouped by category prefix
 * (PERM / THRE / VERI / PHYS …) in the navigator's own order; each row shows
 * the base check id and the canonical name. POSITION ONLY — no status or
 * completion marks. Clicking a row routes to
 * /wizard/{platform}/{BASE-ID} and closes the panel; Esc and click-outside also
 * close it.
 *
 * `checks` is the SAME array the navigator dots consume (passed down from
 * ProgressBar) — no hardcoded id list lives here. dApp-only entries carry the
 * celeste accent AND an explicit "Tested entirely in the wallet" line, so the
 * distinction never rests on colour alone.
 */
const CheckIndexPanel = ({ checks, currentIndex, platform = DEFAULT_PLATFORM }) => {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const { isDarkMode } = useTheme();
    const rootRef = useRef(null);
    const celeste = isDarkMode ? CELESTE_DARK : CELESTE_LIGHT;
    const blue = isDarkMode ? "#85F2E7" : "#126B63";

    // Esc + click-outside close, only wired while the panel is open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === "Escape") setOpen(false);
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
    }, [open]);

    const go = (id) => {
        setOpen(false);
        // Prefixed path — the campaign lives in the URL, not just localStorage.
        navigate(`/wizard/${platform}/${baseCheckId(id)}`);
    };

    // Group by category, preserving first-seen (navigator) order for the GROUPS.
    // CRUCIAL: each group holds COPIES ({ ...c, index }) — never the entries of
    // the shared `checks` prop — and we sort only those private group arrays. We
    // must never sort `checks` itself: it is the array the navigator dots render
    // from, so reordering it would slide a dot's position out of sync with its
    // colour/aria/tooltip (all read per-entry). Each copy keeps its navigator
    // `index` so the current-check highlight stays correct after the sort.
    const order = [];
    const byCat = new Map();
    checks.forEach((c, index) => {
        const cat = checkCategory(c.id);
        if (!byCat.has(cat)) {
            byCat.set(cat, []);
            order.push(cat);
        }
        byCat.get(cat).push({ ...c, index });
    });
    // Within each group, sort by check number ascending, then platform suffix
    // (~Browser before ~Mobile). Panel-only; the navigator dots are untouched.
    for (const list of byCat.values()) {
        list.sort((a, b) => {
            const ka = checkSortKey(a.id);
            const kb = checkSortKey(b.id);
            return ka.num - kb.num || ka.suffix.localeCompare(kb.suffix);
        });
    }

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label="Open the check index"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium text-stealth-muted transition-colors hover:bg-stealth-elevated hover:text-stealth-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action aria-expanded:bg-stealth-elevated aria-expanded:text-stealth-fg lg:min-h-0 lg:rounded-md lg:text-[0.8125rem]">
                <List className="h-4 w-4" aria-hidden="true" />
                Index
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Check index"
                    className="fixed left-4 right-4 top-[164px] z-50 max-h-[calc(100dvh-180px)] overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-surface-light p-2 shadow-xl dark:border-gray-700 dark:bg-dark-surface md:absolute md:left-0 md:right-auto md:top-full md:mt-1 md:max-h-[70vh] md:w-72">
                    <div className="mb-1.5 flex items-center justify-between px-1">
                        <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Checks in this campaign
                        </span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close the check index"
                            className="flex h-11 w-11 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200 md:h-auto md:w-auto md:p-0.5">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {order.map((cat) => (
                        <div key={cat} className="mb-2 last:mb-0">
                            <div className="px-1 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                {cat}
                            </div>
                            <ul>
                                {byCat.get(cat).map((c) => {
                                    const isCurrent = c.index === currentIndex;
                                    return (
                                        <li key={c.id}>
                                            <button
                                                type="button"
                                                onClick={() => go(c.id)}
                                                aria-current={isCurrent ? "true" : undefined}
                                                title={c.walletOnly ? "Tested entirely in the wallet" : undefined}
                                                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                                                    isCurrent
                                                        ? "bg-gray-100 dark:bg-gray-800"
                                                        : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                                                }`}>
                                                <span
                                                    aria-hidden="true"
                                                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                                                    style={{ backgroundColor: c.walletOnly ? celeste : blue }}
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block font-mono text-[0.75rem] text-gray-500 dark:text-gray-400">
                                                        {baseCheckId(c.id)}
                                                    </span>
                                                    <span
                                                        className={`block text-[0.8125rem] leading-snug ${
                                                            isCurrent
                                                                ? "font-semibold text-gray-900 dark:text-gray-100"
                                                                : "text-gray-700 dark:text-gray-200"
                                                        }`}>
                                                        {c.title}
                                                    </span>
                                                    {c.walletOnly && (
                                                        <span
                                                            className="mt-0.5 block text-[0.6875rem] font-medium"
                                                            style={{ color: celeste }}>
                                                            Tested entirely in the wallet
                                                        </span>
                                                    )}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CheckIndexPanel;
