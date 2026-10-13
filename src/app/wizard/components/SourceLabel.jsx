"use client";

import React from "react";
import { Zap, Wallet, Globe } from "lucide-react";

// Icon + text badge saying WHERE a step happens. Derived, never colour-only.
// Shared by the left "How to test" rows and the right "Current action" card so
// the two surfaces always name a step the same way.
export const SOURCE_LABELS = {
    wizard: { Icon: Zap, text: "In the wizard", title: "The wizard fires this step's request" },
    browser: { Icon: Globe, text: "In your browser", title: "You do this step in the browser — open a URL, or switch/close a tab" },
    wallet: { Icon: Wallet, text: "In your wallet", title: "You do this step by hand in your wallet" },
};

const SourceLabel = ({ source }) => {
    const { Icon, text, title } = SOURCE_LABELS[source] ?? SOURCE_LABELS.wallet;
    return (
        <span
            className='inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.6875rem] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'
            title={title}
        >
            <Icon className='h-3 w-3' aria-hidden='true' />
            {text}
        </span>
    );
};

export default SourceLabel;
