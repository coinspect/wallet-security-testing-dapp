"use client";

/**
 * EIP-6963 provider registry — THE single source of announced injected wallets.
 *
 * At import it dispatches `eip6963:requestProvider` once, then listens for
 * `eip6963:announceProvider` FOREVER (never removes the listener) so a wallet
 * that injects AFTER first paint is still picked up. Consumers subscribe and are
 * notified on every new announcement.
 *
 * De-duplication:
 *   • Announcements are deduped by uuid, by rdns, and by provider-object
 *     identity, so a wallet that answers every requestProvider (it re-announces
 *     each time) is stored ONCE.
 *   • `window.ethereum` is offered only as a LEGACY FALLBACK entry, and ONLY when
 *     nothing has announced. So an EIP-6963 wallet that also owns window.ethereum
 *     appears exactly once (from its announcement) — never doubled by the legacy
 *     entry. rdns identity is what distinguishes it; the legacy entry has none.
 *
 * Late announcement after selection: the listener stays live, so a provider that
 * announces later is appended and subscribers re-render; a selection made by
 * rdns (see selectedProvider.js) resolves to it as soon as it appears, and until
 * then callers fall back to window.ethereum — nothing is lost.
 */

// [{ info: { uuid, rdns, name, icon }, provider }]
const announced = [];
const listeners = new Set();

const notify = () => {
    for (const cb of listeners) {
        try {
            cb();
        } catch {
            /* a bad subscriber must not break the rest */
        }
    }
};

if (typeof window !== "undefined") {
    window.addEventListener("eip6963:announceProvider", (event) => {
        const detail = event?.detail;
        const info = detail?.info;
        const provider = detail?.provider;
        if (!info?.uuid || !provider) return;
        const dup = announced.some(
            (a) =>
                a.info.uuid === info.uuid ||
                (info.rdns && a.info.rdns === info.rdns) ||
                a.provider === provider
        );
        if (dup) return;
        announced.push({
            info: {
                uuid: info.uuid,
                rdns: info.rdns ?? null,
                name: info.name ?? "Unknown wallet",
                icon: info.icon ?? null,
            },
            provider,
        });
        notify();
    });
    try {
        window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch {
        /* non-browser env — ignore */
    }
}


// Synthetic LEGACY entry for window.ethereum, so a single non-EIP-6963 wallet is
// still selectable. rdns is null on purpose — its true identity is resolved from
// legacy flags elsewhere (providerIdentity.js), wrapped so a gated getter can't
// throw here.
const legacyEntry = () => {
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    if (!eth) return null;
    return {
        info: { uuid: "legacy:window.ethereum", rdns: null, name: "Injected wallet", icon: null },
        provider: eth,
    };
};

/**
 * The selectable providers: the announced list, or — only when nothing announced
 * — a single legacy window.ethereum entry. Empty when there is no wallet at all.
 */
export const getProviders = () => {
    if (announced.length > 0) return announced.slice();
    const legacy = legacyEntry();
    return legacy ? [legacy] : [];
};


/**
 * Subscribe to registry changes (new announcements). Re-asks wallets to announce
 * on every new subscription, so a late-mounting consumer never misses one.
 * Returns an unsubscribe function.
 */
export const subscribeProviders = (cb) => {
    listeners.add(cb);
    if (typeof window !== "undefined") {
        try {
            window.dispatchEvent(new Event("eip6963:requestProvider"));
        } catch {
            /* ignore */
        }
    }
    return () => listeners.delete(cb);
};
