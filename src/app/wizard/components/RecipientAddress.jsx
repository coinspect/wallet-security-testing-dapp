"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function RecipientAddress({ address, label }) {
    const [copyResult, setCopyResult] = useState(null);
    const status = copyResult?.address === address ? copyResult.status : null;
    const copy = async () => {
        if (!address) return;
        try {
            await navigator.clipboard.writeText(address);
            setCopyResult({ address, status: "copied" });
        } catch {
            setCopyResult({ address, status: "failed" });
        }
    };

    return <div className="space-y-1 rounded border border-[var(--wsr-border)] p-3">
        <div className="flex items-center justify-between gap-3">
            <p className="text-xs">{label}</p>
            <button type="button" onClick={copy} disabled={!address} aria-label="Copy recipient address"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-xs text-[var(--wsr-fg-secondary)] hover:text-[var(--wsr-fg)] disabled:opacity-50 md:min-h-0">
                {status === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                <span role="status">{status === "copied" ? "Copied" : "Copy"}</span>
            </button>
        </div>
        <code className="block select-all break-all">{address}</code>
        {status === "failed" && <p role="status" className="text-xs">Could not copy. Select the address and copy it manually.</p>}
    </div>;
}
