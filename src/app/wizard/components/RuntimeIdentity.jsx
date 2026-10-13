"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

export default function RuntimeIdentity({ runtime }) {
    const [status, setStatus] = useState("");
    const address = runtime?.from;
    const name = runtime?.provider?.name;
    if (!name && !address) return null;
    const short = /^0x[0-9a-f]{40}$/i.test(address ?? "") ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
    return <div className="text-xs text-[var(--wsr-fg-secondary)]">
        <div data-capture-skip className="flex flex-wrap items-center gap-x-2">
            {name && <span>{name}</span>}
            {address && <>
                <span className="hidden break-all md:inline">· Wallet address: {address}</span>
                <button type="button" title={address} aria-label={`Copy account ${address}`}
                    onClick={async () => {
                        try { await navigator.clipboard.writeText(address); setStatus("Account copied"); }
                        catch { setStatus("Could not copy account"); }
                    }} className="inline-flex min-h-11 items-center gap-2 break-all md:hidden">
                    Wallet address: {short}<Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
            </>}
            {status && <span role="status" className="md:hidden">{status}</span>}
        </div>
        {/* Keep the complete identity in exported result images. */}
        <p data-capture-only className="hidden break-all">{[name, address ? `Wallet address: ${address}` : null].filter(Boolean).join(" · ")}</p>
    </div>;
}
