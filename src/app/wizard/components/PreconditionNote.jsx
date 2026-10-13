"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink, ChevronRight, PlugZap, Check } from "lucide-react";
import { DEFAULT_PLATFORM } from "../utils/platform";
import { disconnectDapp } from "../utils/disconnectDapp";

/**
 * A quiet "Before you start" precondition/environment note declared per-step as
 * `ui.content.precondition = { text, link?, shortcut?, action? }`. It sits at the
 * TOP of the left "How to test" column, above step 01 — no box or fill, so it
 * reads as setup guidance, not a heavy container.
 *
 * `collapsed` (true once the check has recorded evidence) folds the note to its
 * single "Before you start" line; clicking the line expands it again.
 *
 * `shortcut` (a resolved URL) is pure SETUP — a one-click open of a second dApp
 * (window.open, noopener). `action` is another declarative SETUP affordance,
 * generic so future checks can reuse it:
 *   - "disconnect" → a [Disconnect this dApp] button that revokes the
 *     eth_accounts permission (wallet_revokePermissions). Extension only.
 * Neither is a wizard action; NEITHER is ever recorded in evidence.
 */


const PreconditionNote = ({ text, link, shortcut, action, platform = DEFAULT_PLATFORM, collapsed = false }) => {
    const [open, setOpen] = useState(!collapsed);
    // Disconnect flow state: idle | pending | done | unsupported | failed.
    const [disc, setDisc] = useState("idle");

    useEffect(() => {
        setOpen(!collapsed);
    }, [collapsed]);

    if (!text) return null;

    const openShortcut = () => {
        if (typeof window !== "undefined") window.open(shortcut, "_blank", "noopener");
    };

    // SETUP ONLY — revokes the eth_accounts grant so a "disconnected" check runs
    // in that absence. It does NOT reconnect or prompt for connection, and it is
    // never routed through the action/evidence path. Shared with the PERM-008
    // action gate (disconnectDapp) and routed through the SELECTED provider.
    const disconnect = async () => {
        setDisc("pending");
        const r = await disconnectDapp();
        // The AccountProvider (accountsChanged → null, or its focus/visibility
        // re-read) advances the active step on its own; nothing else to do here.
        setDisc(r === "no_provider" ? "unsupported" : r);
    };

    // The disconnect affordance is Extension-only (WalletConnect is out of scope).
    const showDisconnect = action === "disconnect" && platform === "extension";

    const noteLine = "text-[0.75rem] leading-[1.1rem] text-gray-500 dark:text-gray-400";

    return (
        <div className="mt-1">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
                <ChevronRight
                    className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                    aria-hidden="true"
                />
                Before you start
            </button>
            {open && (
                <div className="mt-0.5 pl-4">
                    <p className="text-[0.8125rem] leading-[1.15rem] text-gray-500 dark:text-gray-400">
                        {text}
                    </p>
                    {link && (
                        <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 break-all text-[0.8125rem] font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                            {link.replace(/^https?:\/\//, "")}
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                    )}
                    {shortcut && (
                        <button
                            type="button"
                            onClick={openShortcut}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[0.8125rem] font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50"
                        >
                            Open {shortcut.replace(/^https?:\/\//, "")}
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </button>
                    )}

                    {showDisconnect && disc === "done" && (
                        <p className={`mt-1.5 flex items-center gap-1 ${noteLine}`}>
                            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Disconnected — you can run the test now.
                        </p>
                    )}
                    {showDisconnect && disc === "unsupported" && (
                        <p className={`mt-1.5 ${noteLine}`}>
                            This wallet doesn&apos;t support programmatic disconnect — disconnect it manually (above).
                        </p>
                    )}
                    {showDisconnect && disc !== "done" && disc !== "unsupported" && (
                        <>
                            <button
                                type="button"
                                onClick={disconnect}
                                disabled={disc === "pending"}
                                className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[0.8125rem] font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50"
                            >
                                <PlugZap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {disc === "pending" ? "Disconnecting…" : "Disconnect this dApp"}
                            </button>
                            {disc === "failed" && (
                                <p className={`mt-1 ${noteLine}`}>
                                    Couldn&apos;t disconnect automatically — disconnect it manually (above).
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default PreconditionNote;
