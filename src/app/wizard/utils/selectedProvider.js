"use client";

import { useCallback, useEffect, useState } from "react";
import { getProviders, subscribeProviders } from "./providerRegistry";

/**
 * Which announced wallet this session uses (Defect D). The selection is a single
 * rdns persisted in localStorage. The runtime resolves the selection here, then
 * each run retains that provider instead of re-reading selection between RPCs.
 *
 * The provider object is passed through UNCHANGED — nothing wraps or shapes it
 * (house style: raw provider.request).
 */
const STORAGE_KEY = "wizard.selectedWalletRdns";
const selectionListeners = new Set();

let selectedRdns = (() => {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
})();

const notifySelection = () => {
    for (const cb of selectionListeners) {
        try {
            cb();
        } catch {
            /* ignore */
        }
    }
};

/**
 * The resolved active ENTRY `{ info, provider }`, applying selection + auto-select:
 *   • a stored rdns that matches an announced provider wins;
 *   • else if exactly ONE provider is present it is auto-selected (no friction);
 *   • else null → callers fall back to window.ethereum (the injected default,
 *     unchanged until the tester picks among several).
 */
export const getActiveEntry = () => {
    const providers = getProviders();
    if (selectedRdns) {
        const hit = providers.find((p) => p.info.rdns === selectedRdns);
        if (hit) return hit;
    }
    if (providers.length === 1) return providers[0];
    return null;
};

/**
 * The raw selected provider object (passed through unchanged), or window.ethereum
 * as the last-resort default. Resolve at the connection boundary; a running
 * request must keep its captured provider even if the selection changes.
 */
export const getActiveProvider = () => {
    const entry = getActiveEntry();
    if (entry) return entry.provider;
    return typeof window !== "undefined" ? window.ethereum : undefined;
};

/** EIP-6963 info of the active entry, or null (legacy fallback carries null rdns). */
export const getActiveInfo = () => getActiveEntry()?.info ?? null;


/** Persist + broadcast a new selection (null clears it back to auto/default). */
export const selectProvider = (rdns) => {
    selectedRdns = rdns ?? null;
    if (typeof window !== "undefined") {
        try {
            if (selectedRdns) window.localStorage.setItem(STORAGE_KEY, selectedRdns);
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* storage unavailable — selection is still live for this session */
        }
    }
    notifySelection();
};

/** Subscribe to selection changes. Returns an unsubscribe function. */
export const subscribeSelection = (cb) => {
    selectionListeners.add(cb);
    return () => selectionListeners.delete(cb);
};

/**
 * The live active provider OBJECT for React readers, re-rendering on BOTH new
 * announcements and selection changes. Depend on the returned object identity in
 * an effect (`[provider]`) to re-subscribe/re-read cleanly when the wallet changes.
 */
export const useActiveProvider = () => {
    const [provider, setProvider] = useState(() => getActiveProvider());
    useEffect(() => {
        const sync = () => setProvider(getActiveProvider());
        sync();
        const unProviders = subscribeProviders(sync);
        const unSelection = subscribeSelection(sync);
        return () => {
            unProviders();
            unSelection();
        };
    }, []);
    return provider;
};

/**
 * The full selection view for the navbar selector: the provider list, the active
 * entry, the stored rdns, and a stable `select`. Re-renders on announcements and
 * selection changes.
 */
export const useSelectedProvider = () => {
    const [, force] = useState(0);
    useEffect(() => {
        const bump = () => force((n) => n + 1);
        const unProviders = subscribeProviders(bump);
        const unSelection = subscribeSelection(bump);
        return () => {
            unProviders();
            unSelection();
        };
    }, []);
    return {
        providers: getProviders(),
        active: getActiveEntry(),
        selectedRdns,
        select: useCallback((rdns) => selectProvider(rdns), []),
    };
};
