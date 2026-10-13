"use client";

import { getActiveInfo, getActiveProvider } from "./selectedProvider";

/**
 * Identity of the wallet a run talked to, as `{ rdns, name }` for evidence
 * (runtime.provider). The AUTHORITY is the SELECTED provider's EIP-6963 info
 * (rdns + name) — see selectedProvider.js — so a wallet that spoofs the legacy
 * `isMetaMask` flag (Ambire sets isAmbire AND isMetaMask) is still named
 * correctly from its rdns.
 *
 * Legacy vendor flags are a LAST-RESORT fallback only (no EIP-6963 announcement),
 * and every flag read is WRAPPED — a gated Proxy getter that throws cannot
 * propagate. When several legacy flags are true at once (spoofing), we record ALL
 * of them rather than silently picking one: the true wallet is unknowable from
 * flags alone, and EIP-6963 rdns is the only real authority.
 */

// rdns/name per legacy vendor flag, checked vendor-specific-first.
const FLAG_VENDORS = [
    { flag: "isRabby", rdns: "io.rabby", name: "Rabby" },
    { flag: "isBraveWallet", rdns: "com.brave.wallet", name: "Brave Wallet" },
    { flag: "isCoinbaseWallet", rdns: "com.coinbase.wallet", name: "Coinbase Wallet" },
    { flag: "isTrust", rdns: "com.trustwallet.app", name: "Trust Wallet" },
    { flag: "isTrustWallet", rdns: "com.trustwallet.app", name: "Trust Wallet" },
    { flag: "isFrame", rdns: "sh.frame", name: "Frame" },
    { flag: "isMetaMask", rdns: "io.metamask", name: "MetaMask" },
];

// A single gated-getter read, wrapped: a Proxy that THROWS on the property (some
// smart-account wallets) is treated as "flag absent", never an exception.
const readFlag = (eth, flag) => {
    try {
        return !!eth[flag];
    } catch {
        return false;
    }
};

// Identity from legacy flags alone. One match → that vendor; several → recorded
// as ambiguous (all names, rdns null); none → an explicit unknown.
const legacyFlagIdentity = (eth) => {
    if (!eth) return null;
    const matched = [];
    for (const v of FLAG_VENDORS) {
        if (readFlag(eth, v.flag) && !matched.some((m) => m.rdns === v.rdns)) {
            matched.push(v);
        }
    }
    if (matched.length === 0) return { rdns: null, name: "Unknown injected provider" };
    if (matched.length === 1) return { rdns: matched[0].rdns, name: matched[0].name };
    // Several flags set (wallets spoof isMetaMask). Record every one — do NOT
    // silently pick a winner; the real identity needs EIP-6963 rdns.
    return {
        rdns: null,
        name: `Ambiguous legacy flags: ${matched.map((m) => m.name).join(" + ")}`,
    };
};

/**
 * Identify the wallet the current run used, as `{ rdns, name }`, or null when
 * there is no provider at all. Prefers the SELECTED provider's EIP-6963 info;
 * falls back to the active provider's (wrapped) legacy flags.
 */
export const getProviderIdentity = () => {
    if (typeof window === "undefined") return null;
    // 1) The selected provider's EIP-6963 identity is authoritative.
    const info = getActiveInfo();
    if (info?.rdns) return { rdns: info.rdns, name: info.name ?? "Unknown wallet" };
    // 2) No EIP-6963 identity (legacy window.ethereum fallback) → vendor flags.
    const eth = getActiveProvider();
    if (!eth) return null;
    return legacyFlagIdentity(eth);
};

/** Two identities refer to the same wallet? Compares rdns when both have it,
 *  else falls back to the display name. Unknown vs unknown is treated as same. */
export const sameProvider = (a, b) => {
    if (!a || !b) return true; // can't tell → don't warn
    if (a.rdns && b.rdns) return a.rdns === b.rdns;
    return (a.name ?? null) === (b.name ?? null);
};
