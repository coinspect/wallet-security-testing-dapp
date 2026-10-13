"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Guidance / SETUP note — the ONE sober treatment for amber notes across the
 * wizard ("Mainnet safety…", "Not yet available on mobile…", wrong-network,
 * dedicated-test-wallet, etc.). Muted amber ink on a low-opacity amber wash
 * with a faint border, from the shared --wsr-note-* tokens — NOT bright
 * standalone amber text. Amber here means guidance, NEVER a verdict about the
 * wallet.
 */
const NoteBadge = ({ children, icon: Icon, className }) => (
    <div
        className={cn(
            "flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.8125rem] font-medium leading-[1.15rem]",
            "border-[var(--wsr-note-border)] bg-[var(--wsr-note-bg)] text-[var(--wsr-note-fg)]",
            className,
        )}
    >
        {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="min-w-0">{children}</span>
    </div>
);

export default NoteBadge;
