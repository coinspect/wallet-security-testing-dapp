"use client";

import React from "react";

/**
 * Two lines behind a neutral left accent: the check TITLE (white) on top,
 * the versioned ID (muted mono) below it. The risk note is action-derived
 * and lives in the action panel, not here. No "Step N of N", no time.
 *
 * `contained` (default) wraps the header in its own centered max-w-7xl band.
 * Pass `contained={false}` to render just the accent block so a parent column
 * owns the width + left edge — used by the walletOnly full-width layout, where
 * the header must share the steps' column exactly.
 */
const HeaderBlock = ({ checkId, title, wrapTitle = false }) => (
    <div className="border-l-2 border-gray-300 pl-3 dark:border-gray-600">
        <h1 className={`text-2xl font-semibold leading-8 text-gray-900 dark:text-white md:text-[2.25rem] md:leading-[2.75rem] ${wrapTitle ? "" : "md:truncate"}`}>
            {title}
        </h1>
        <div className="mt-1 break-words font-mono text-[0.875rem] leading-[1.25rem] text-gray-500 dark:text-gray-400">
            {checkId}
        </div>
    </div>
);

const WizardStepHeader = ({ checkId, title, contained = true, wrapTitle = false }) => {
    if (!contained) return <HeaderBlock checkId={checkId} title={title} wrapTitle={wrapTitle} />;
    return (
        <div className="mx-auto mt-4 w-full max-w-7xl md:mt-14 md:px-4 lg:px-6 font-[var(--default-font)]">
            <HeaderBlock checkId={checkId} title={title} wrapTitle={wrapTitle} />
        </div>
    );
};

export default WizardStepHeader;
