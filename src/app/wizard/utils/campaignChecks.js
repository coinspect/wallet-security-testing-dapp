// The ordered check list that the navigator dots AND the check-index panel
// both consume — one entry per check in the ACTIVE campaign, in checks{} order.
// Nothing is hardcoded: ids come from wizard.json, titles from the snapshot,
// and the wallet-only family is the single `walletOnly` flag from wizard.json.

import wizardConfig from "../config/wizard";
import { checkTitle } from "./checkMeta";
import { checkInCampaign } from "./platform";
import { walletChecksFirst } from "./campaignOrder.mjs";

export const campaignChecks = (platform) => {
    const checks = wizardConfig?.wizard?.checks ?? {};
    const list = Object.entries(checks)
        .map(([id, check]) => ({
            id,
            canonicalId: check.steps?.[0]?.canonicalId,
            // Canonical name — same source the page title uses.
            title: checkTitle(check.steps?.[0]),
            // Wallet-only family: tested entirely inside the wallet, no dApp
            // action — the SINGLE source, declared in wizard.json.
            walletOnly: check.walletOnly === true,
        }))
        .filter((c) => checkInCampaign(c.canonicalId, platform));
    // Keep the wallet-only (celeste) family contiguous before the dApp checks.
    // Array#sort is stable, so each family's existing authored order remains
    // unchanged. In particular WSR-THRE-006 (authored as wallet-only order 9)
    // occupies navigator position 9 instead of being split from its family.
    const ordered = walletChecksFirst(list);
    // This is the CANONICAL navigator order the dots render from — every dot's
    // position, colour, aria-label and tooltip read from one entry of THIS
    // array. Freeze it so no consumer (e.g. the index panel's within-group sort)
    // can ever reorder it in place and desync a dot's slot from its content.
    return Object.freeze(ordered);
};

// Category prefix (PERM / THRE / VERI / PHYS …) from a check id, for grouping.
export const checkCategory = (id) => {
    const m = /WSR-([A-Z]+)-/.exec(String(id ?? ""));
    return m ? m[1] : "OTHER";
};

// Sort key within a category: the numeric part of the id, then the platform
// suffix alphabetically (PHYS-006~Browser before PHYS-006~Mobile). Used by the
// index panel only — the navigator dots keep checks{} order.
export const checkSortKey = (id) => {
    const s = String(id ?? "");
    const num = Number((/WSR-[A-Z]+-(\d+)/.exec(s) || [])[1] ?? Number.MAX_SAFE_INTEGER);
    const suffix = (/~(\w+)/.exec(s) || [])[1] ?? "";
    return { num, suffix };
};

// Celeste (lighter blue) accent for the wallet-only family. One definition,
// shared by the SVG dots (inline style) and the panel, so they always match.
export const CELESTE_LIGHT = "#8D246A";
export const CELESTE_DARK = "#F25EBF";
