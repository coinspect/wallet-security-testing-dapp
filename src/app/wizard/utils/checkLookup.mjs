import { safeDecodeRouteSegment } from "../../../security/clientBoundary.mjs";

export const baseCheckId = (id) => String(id ?? "").replace(/~(Browser|Mobile)/, "");

// Only route identifiers are matched without case. Always return the registry's
// spelling; never normalize parameter values, addresses, messages or evidence.
export const canonicalCheckBase = (id, checks) => {
    if (typeof id !== "string" || !id) return null;
    const lookup = id.toLowerCase();
    for (const key of Object.keys(checks)) {
        const base = baseCheckId(key);
        if (base.toLowerCase() === lookup) return base;
    }
    return null;
};

export const checkBaseFromPath = (pathname, checks) => {
    const match = /^\/wizard\/(?:extension|mobile)\/([^/?#]+)\/?(?:[?#].*)?$/.exec(pathname || "");
    const id = match ? safeDecodeRouteSegment(match[1]) : null;
    return canonicalCheckBase(id, checks);
};

// Display-only lookup: keep the existing union of platform variants and direct
// usedBy/action matches, including environment-scoped entries (tester wallets).
export const paramsForCheck = (baseId, checks, registry) => {
    const canonical = canonicalCheckBase(baseId, checks);
    if (!canonical) return [];
    const actions = new Set();
    for (const [key, check] of Object.entries(checks)) {
        if (baseCheckId(key) !== canonical) continue;
        for (const step of check.steps ?? []) {
            const action = step?.ui?.content?.button?.action;
            if (action) actions.add(action);
        }
    }
    return registry.filter((entry) => {
        const usedBy = entry?.usedBy;
        if (!Array.isArray(usedBy) || usedBy.length === 0) return false;
        return usedBy.some((key) => actions.has(key)
            || baseCheckId(String(key ?? "").replace(/\.v\d+$/, "")) === canonical);
    });
};
