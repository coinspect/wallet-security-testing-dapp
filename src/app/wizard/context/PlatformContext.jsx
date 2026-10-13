"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
    DEFAULT_PLATFORM,
    PLATFORMS,
    checkBaseFromPath,
    firstCampaignCheckBase,
    isPlatform,
    resolveCheckKey,
} from "../utils/platform";
import { safeDecodeRouteSegment } from "@/security/clientBoundary.mjs";

const PlatformContext = createContext(null);
const STORAGE_KEY = "wizard.platform";

// Pull the campaign out of a wizard path. The canonical shape is
// /wizard/<platform>/<BASE-ID>, so the platform lives in the FIRST segment.
// Returns null for /wizard itself and for non-wizard paths.
const platformFromPath = (pathname) => {
    const m = /^\/wizard\/([^/?#]+)/.exec(pathname || "");
    const seg = m ? safeDecodeRouteSegment(m[1]) : null;
    return isPlatform(seg) ? seg : null;
};

/**
 * Campaign/transport mode for the wizard. As of the platform-prefixed routes,
 * the URL is the SOURCE OF TRUTH: /wizard/<platform>/<BASE-ID> pins the
 * campaign so a link is self-sufficient (the checklist app can deep-link into a
 * specific campaign without depending on the recipient's localStorage).
 *
 * Resolution order:
 *   1. platform in the URL  (/wizard/<platform>/…)  — wins, and is persisted.
 *   2. persisted choice (localStorage)              — only when the URL has none
 *                                                      (/wizard landing route).
 *   3. default "extension".
 *
 * localStorage is read after mount only when the URL supplies no platform.
 */
export const PlatformProvider = ({ children }) => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const urlPlatform = platformFromPath(pathname);

    // Seed from the URL, otherwise use the default until the storage read below.
    // `ready` is true immediately when the URL
    // pins the campaign — no placeholder flash on a deep-linked check page.
    const [platform, setPlatformState] = useState(urlPlatform ?? DEFAULT_PLATFORM);
    const [ready, setReady] = useState(urlPlatform != null);

    // Reconcile against the URL. When the URL pins a platform it wins and is
    // persisted (overriding whatever was stored). When it doesn't, fall back to
    // the persisted choice. Re-runs on navigation as urlPlatform changes.
    useEffect(() => {
        if (urlPlatform) {
            setPlatformState(urlPlatform);
            try {
                window.localStorage.setItem(STORAGE_KEY, urlPlatform);
            } catch {
                /* non-fatal */
            }
            setReady(true);
            return;
        }
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (isPlatform(stored)) setPlatformState(stored);
        } catch {
            /* storage unavailable — keep the default */
        }
        setReady(true);
    }, [urlPlatform]);

    const setPlatform = useCallback(
        (next) => {
            if (!isPlatform(next)) return;
            setPlatformState(next);
            try {
                window.localStorage.setItem(STORAGE_KEY, next);
            } catch {
                /* non-fatal */
            }
            // Switching campaign navigates to the SAME check under the other
            // platform. If that check has no variant in the target campaign, land
            // on the target campaign's first check rather than 404 — the URL then
            // re-pins the campaign on arrival.
            const base = checkBaseFromPath(pathname);
            const targetBase =
                base && resolveCheckKey(base, next) ? base : firstCampaignCheckBase(next);
            if (targetBase) navigate(`/wizard/${next}/${targetBase}`);
        },
        [navigate, pathname],
    );

    return (
        <PlatformContext.Provider value={{ platform, setPlatform, ready }}>
            {children}
        </PlatformContext.Provider>
    );
};

// Returns null when no provider is mounted (i.e. non-wizard routes), so shared
// chrome can fall back to its default control.
export const usePlatform = () => useContext(PlatformContext);

export { PLATFORMS };
