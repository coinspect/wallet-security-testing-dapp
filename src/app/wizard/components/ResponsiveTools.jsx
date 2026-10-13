"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Inline desktop controls, with a touch-friendly disclosure on small screens. */
export default function ResponsiveTools({ label, accessibleLabel, children }) {
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    const trigger = useRef(null);
    const id = useId();
    useEffect(() => {
        if (!open) return;
        const outside = (event) => {
            if (!root.current?.contains(event.target)) setOpen(false);
        };
        const escape = (event) => {
            if (event.key === "Escape") {
                setOpen(false);
                trigger.current?.focus();
            }
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    return <div ref={root} className="relative shrink-0">
        <button ref={trigger} type="button" aria-label={accessibleLabel} aria-expanded={open} aria-controls={id}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-stealth-muted transition-colors hover:bg-stealth-elevated hover:text-stealth-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stealth-action aria-expanded:bg-stealth-elevated aria-expanded:text-stealth-fg md:hidden">
            {label}
        </button>
        <div id={id} role="group" aria-label={accessibleLabel}
            className={`${open ? "flex" : "hidden"} absolute right-0 top-full z-[70] mt-2 w-max max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border border-stealth-border bg-stealth-panel p-2 shadow-xl md:static md:mt-0 md:flex md:max-w-none md:flex-row md:items-center md:gap-2 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
            {children(() => setOpen(false))}
        </div>
    </div>;
}
