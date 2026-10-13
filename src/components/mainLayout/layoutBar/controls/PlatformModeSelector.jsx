"use client";

import React from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORMS, PLATFORM_LABEL } from "@/app/wizard/utils/platform";

const ICON = { extension: Monitor, mobile: Smartphone };

// Per-option tooltip explaining what each campaign tests — replaces the old
// "Campaign:" text label, which took navbar width to say what the icons + hover
// copy now convey.
const TOOLTIP = {
    extension: "Test the browser extension wallet",
    mobile: "Test the mobile wallet over WalletConnect",
};

/**
 * Campaign switch for the wizard navbar — a two-option segmented control
 * (Extension / Mobile) with the ACTIVE option always visibly filled, so a
 * tester can never mistake which campaign + transport they are in. The old
 * "Campaign:" text label is dropped; each option carries a tooltip instead.
 */
const PlatformModeSelector = ({ platform, setPlatform }) => (
    <div
        className="flex items-center gap-1.5"
        role="radiogroup"
        aria-label="Testing campaign"
        data-testid="platform-mode"
    >
        <div className="flex items-center rounded-md border border-stealth-border/60 bg-stealth-elevated/60 p-0.5">
            {PLATFORMS.map((p) => {
                const Icon = ICON[p];
                const active = p === platform;
                return (
                    <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setPlatform(p)}
                        title={TOOLTIP[p] ?? `${PLATFORM_LABEL[p]} campaign`}
                        className={cn(
                            "inline-flex min-h-11 items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors md:min-h-0 md:px-2 md:text-[11px]",
                            active
                                ? "bg-stealth-action/15 text-stealth-action"
                                : "text-stealth-muted hover:text-stealth-fg",
                        )}
                    >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {PLATFORM_LABEL[p]}
                    </button>
                );
            })}
        </div>
    </div>
);

export default PlatformModeSelector;
