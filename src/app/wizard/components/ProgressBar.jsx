"use client";

import React, { useState, useRef, useLayoutEffect } from "react";
import { useNavigate } from "react-router";
import { useTheme } from "../context/ThemeContext";
import { baseCheckId, DEFAULT_PLATFORM } from "../utils/platform";
import { campaignChecks, CELESTE_DARK, CELESTE_LIGHT } from "../utils/campaignChecks";
import CheckIndexPanel from "./CheckIndexPanel";
import EvidenceExportButton from "./EvidenceExportButton";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Top bar = CHECK NAVIGATOR across every check in wizard.json (one dot per
 * check, in checks{} order). The dot for the current route ([step]) is
 * highlighted/larger; hovering shows the check's canonical name; clicking
 * routes to that check via the Next router (client-side push, no reload).
 *
 * Sub-steps of a multi-shot check are NO LONGER shown here — they render
 * inline below, each carrying its own run indicator. The legacy
 * `activeIndex`/`ranFlags` props are gone.
 */
// Tooltip for one navigator dot. ALL horizontal placement is derived from the
// dot and kept OFF the animated element:
//   - the outer wrapper's positioned ancestor is the dot's `relative` wrapper,
//     so `left: 50%` is exactly the dot's centre (the dot is items-centre'd);
//   - it centres the box on the dot and clamps it to the viewport by shifting
//     ONLY the box (`dx`); the caret is offset by the SAME `dx` so it stays
//     exactly over the dot;
//   - the inner element animates opacity + a vertical slide only — never an X
//     transform. Horizontal centring stays on its non-animated wrapper.
const TIP_MARGIN = 8; // viewport inset the box is kept within
const DotTooltip = ({ check, isDarkMode, celeste, titleColor }) => {
    const boxRef = useRef(null);
    const [dx, setDx] = useState(0);
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el || typeof window === "undefined") return;
        // Measured from the centred (dx = 0) box, so the shift is exact.
        const rect = el.getBoundingClientRect();
        let shift = 0;
        if (rect.left < TIP_MARGIN) shift = TIP_MARGIN - rect.left;
        else if (rect.right > window.innerWidth - TIP_MARGIN)
            shift = window.innerWidth - TIP_MARGIN - rect.right;
        // Never shift so far that the caret would leave the box (14px inset).
        const max = Math.max(0, rect.width / 2 - 14);
        setDx(Math.max(-max, Math.min(max, shift)));
    }, [check.id]);
    return (
        <div
            className="absolute z-50"
            style={{ top: "100%", left: "50%", transform: `translateX(calc(-50% + ${dx}px))` }}>
            <div className="animate-wsr-tooltip-in">
                <div
                    ref={boxRef}
                    className={`relative px-2.5 py-1 rounded-lg shadow-lg font-[var(--default-font)] ${
                        isDarkMode
                            ? "bg-dark-surface border border-primary-dark/20"
                            : "bg-surface-light border border-primary-light/20"
                    }`}
                    style={{ minWidth: 200, maxWidth: 280 }}>
                    {/* Caret pinned over the dot: box centre is dot + dx, so the
                        caret sits at (50% − dx) of the box. */}
                    <div
                        className="absolute -top-2 w-4 h-4"
                        style={{
                            left: `calc(50% - ${dx}px)`,
                            transform: "translateX(-50%) rotate(45deg)",
                            background: isDarkMode ? "#18181B" : "white",
                            borderLeft: `1px solid ${isDarkMode ? "rgb(133 242 231 / 0.2)" : "#e6e6e6"}`,
                            borderTop: `1px solid ${isDarkMode ? "rgb(133 242 231 / 0.2)" : "#e6e6e6"}`,
                        }}
                    />
                    {/* Name wraps if long; the versioned id stays on one line in
                        small muted mono — mirrors the step header. */}
                    <div style={{ color: titleColor }} className="text-sm leading-snug font-[var(--default-font)]">
                        {check.title}
                    </div>
                    <div className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-gray-500 dark:text-gray-400">
                        {check.canonicalId}
                    </div>
                    {check.walletOnly && (
                        <div className="mt-1 text-[11px] font-medium" style={{ color: celeste }}>
                            Tested entirely in the wallet
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ProgressBar = ({ currentStep, platform = DEFAULT_PLATFORM, contained = true }) => {
    const [hoveredCheck, setHoveredCheck] = useState(null);
    const { isDarkMode } = useTheme();
    const navigate = useNavigate();

    // Same ordered list the check-index panel consumes — active campaign only.
    const checks = campaignChecks(platform);
    const celeste = isDarkMode ? CELESTE_DARK : CELESTE_LIGHT;
    // First dApp dot — the two families are separated by a gap here.
    const familyBoundary = checks.findIndex((c) => !c.walletOnly);
    // The route param is the BASE id — match each check by its base id.
    const currentIndex = checks.findIndex((c) => baseCheckId(c.id) === currentStep);
    const denom = Math.max(1, checks.length - 1);
    const fillPercent = currentIndex > 0 ? (currentIndex / denom) * 100 : 0;

    const colors = {
        track: isDarkMode ? "rgb(32 32 35)" : "#e5e7eb",
        progress: isDarkMode ? "#85F2E7" : "#126B63",
    };

    // The URL is the source of truth for the campaign, so every link carries the
    // platform prefix: /wizard/<platform>/<BASE-ID>. The active campaign then
    // resolves which ~Browser/~Mobile variant renders.
    const goTo = (baseId) => navigate(`/wizard/${platform}/${baseId}`);

    return (
        <div className='py-2 mb-1 mt-1 z-40'>
            {/* `contained` gives the navigator its own centered max-w-7xl band
                (two-column layout). Pass contained={false} to let a parent column
                own the width + left edge (walletOnly full-width layout). */}
            <div className={contained ? 'w-full max-w-7xl mx-auto md:px-4' : 'w-full'}>
                <div className='mb-1 flex items-center gap-0.5 rounded-xl border border-stealth-border bg-stealth-panel p-1 shadow-sm md:gap-2 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none' aria-label="Check navigation">
                    <button type="button" aria-label="Previous check" disabled={currentIndex <= 0}
                        onClick={() => goTo(baseCheckId(checks[currentIndex - 1].id))}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-stealth-muted transition-colors hover:bg-stealth-elevated hover:text-stealth-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action disabled:pointer-events-none disabled:opacity-30 lg:hidden">
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span className='whitespace-nowrap px-1 text-xs tabular-nums text-stealth-muted lg:px-0 lg:font-mono lg:text-[0.8125rem]' aria-live="polite" aria-label={`Check ${currentIndex >= 0 ? currentIndex + 1 : '—'} of ${checks.length}`}>
                        <span className="hidden min-[360px]:inline">Check </span><span className="font-semibold text-stealth-fg lg:font-normal lg:text-stealth-muted">{currentIndex >= 0 ? currentIndex + 1 : '—'}</span><span className="lg:hidden"> / </span><span className="hidden lg:inline"> of </span>{checks.length}
                    </span>
                    <button type="button" aria-label="Next check" disabled={currentIndex < 0 || currentIndex >= checks.length - 1}
                        onClick={() => goTo(baseCheckId(checks[currentIndex + 1].id))}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-stealth-fg transition-colors hover:bg-stealth-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action disabled:pointer-events-none disabled:opacity-30 lg:hidden">
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-stealth-border lg:hidden" />
                    <CheckIndexPanel checks={checks} currentIndex={currentIndex} platform={platform} />
                    <EvidenceExportButton platform={platform} />
                </div>
                <div className='relative hidden h-7 overflow-visible p-2 lg:block'>
                    {/* Connecting line (shimmer contained here). */}
                    <div
                        className={`absolute top-1/2 left-6 right-6 h-px -translate-y-1/2 overflow-hidden
            ${isDarkMode ? "bg-dark-surface" : "bg-gray-200"}`}>
                        <div
                            className='wsr-progress-shimmer absolute top-1/2 left-0 w-full h-[1px] -translate-y-1/2 opacity-50'
                            style={{
                                background: `linear-gradient(90deg, transparent, ${colors.progress}, transparent)`,
                            }}
                        />
                    </div>

                    {/* Fill up to the current check. */}
                    <div
                        className='absolute top-1/2 left-6 h-px -translate-y-1/2 transition-[width] duration-300 ease-out'
                        style={{
                            background: colors.progress,
                            boxShadow: `0 0 10px ${colors.progress}80`,
                            maxWidth: "calc(100% - 3rem)",
                            width: `${(fillPercent * (100 - 8)) / 100}%`,
                        }}
                    />

                    {/* One dot per check, evenly distributed across the line. */}
                    <div className='absolute top-1/2 left-6 right-6 flex justify-between items-center -translate-y-1/2'>
                        {checks.map((c, index) => {
                            const isCurrent = index === currentIndex;
                            const isVisited = currentIndex >= 0 && index <= currentIndex;
                            // Wallet-only checks wear the celeste accent; the rest
                            // Keep the campaign accent.
                            const dotColor = c.walletOnly ? celeste : colors.progress;

                            return (
                                <div
                                    key={c.id}
                                    className={`relative flex flex-col items-center p-2.5 ${
                                        index === familyBoundary && familyBoundary > 0 ? 'ml-4' : ''
                                    }`}
                                    aria-current={isCurrent ? 'true' : undefined}
                                    onMouseEnter={() => setHoveredCheck(c.id)}
                                    onMouseLeave={() => setHoveredCheck(null)}
                                    onFocus={() => setHoveredCheck(c.id)}
                                    onBlur={() => setHoveredCheck(null)}
                                    onClick={() => goTo(baseCheckId(c.id))}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            goTo(baseCheckId(c.id));
                                        }
                                    }}
                                    role='button'
                                    tabIndex={0}
                                    aria-label={c.walletOnly ? `${c.title} — tested entirely in the wallet` : c.title}>
                                    <div
                                        className={`relative flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 hover:scale-125
                      ${isCurrent ? "w-3 h-3" : "w-2 h-2"}`}
                                        style={
                                            c.walletOnly
                                                ? {
                                                    // Wallet-only family: hollow ring — filled only once visited.
                                                    backgroundColor: isCurrent || isVisited ? dotColor : "transparent",
                                                    boxShadow: `${isCurrent ? `0 0 0 2px ${dotColor}66, ` : ""}inset 0 0 0 1.5px ${dotColor}`,
                                                }
                                                : {
                                                    backgroundColor: isCurrent || isVisited ? dotColor : colors.track,
                                                    boxShadow: isCurrent ? `0 0 0 2px ${dotColor}66` : "none",
                                                }
                                        }>
                                        {isCurrent && (
                                            <div
                                                className='wsr-current-dot-pulse absolute w-full h-full rounded-full'
                                                style={{ border: `2px solid ${dotColor}` }}
                                            />
                                        )}
                                    </div>

                                    {hoveredCheck === c.id && (
                                        <DotTooltip
                                            check={c}
                                            isDarkMode={isDarkMode}
                                            celeste={celeste}
                                            titleColor={colors.progress}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProgressBar;
