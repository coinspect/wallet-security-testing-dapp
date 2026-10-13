// Platform campaigns — Extension and Mobile are separate testing passes, and
// the mode also selects the TRANSPORT fed to handleAction(platform, …).

import wizardConfig from "../config/wizard";
import {
    baseCheckId,
    canonicalCheckBase as findCheckBase,
    checkBaseFromPath as findCheckBaseFromPath,
} from "./checkLookup.mjs";

export const PLATFORMS = ["extension", "mobile"];
export const DEFAULT_PLATFORM = "extension";
export const isPlatform = (p) => PLATFORMS.includes(p);

export const PLATFORM_LABEL = {
    extension: "Extension",
    mobile: "Mobile",
};

/**
 * Which campaign(s) a check belongs to — DERIVED from the canonicalId suffix,
 * never hardcoded per check. Corroborated by the snapshot `weight` field
 * (object {mobile,browser} = both platforms, plain number = single).
 *   ~Browser → Extension only · ~Mobile → Mobile only · no suffix → both.
 */
export const platformsForCheck = (canonicalId) => {
    const id = String(canonicalId ?? "");
    if (id.includes("~Browser")) return ["extension"];
    if (id.includes("~Mobile")) return ["mobile"];
    return ["extension", "mobile"];
};

export const checkInCampaign = (canonicalId, platform) =>
    platformsForCheck(canonicalId).includes(platform);

// ── Base-id routing ──────────────────────────────────────────────────────
// Routes carry the platform and BASE check id (no ~Browser/~Mobile suffix); the
// active campaign resolves which config variant renders.

const CHECKS = wizardConfig?.wizard?.checks ?? {};

// Strip the platform suffix from a check key/id → the base route id.
export { baseCheckId };
export const canonicalCheckBase = (id) => findCheckBase(id, CHECKS);
export const checkBaseFromPath = (pathname) => findCheckBaseFromPath(pathname, CHECKS);

/**
 * Given a BASE id + active platform, the actual checks{} KEY to render, or
 * null when this base has no variant in the active campaign.
 *   - unsuffixed shared check → the base id itself
 *   - variant check → base + "~Browser" (extension) / "~Mobile" (mobile)
 */
export const resolveCheckKey = (baseId, platform) => {
    if (Object.hasOwn(CHECKS, baseId)) return baseId;
    const key = baseId + (platform === "mobile" ? "~Mobile" : "~Browser");
    return Object.hasOwn(CHECKS, key) ? key : null;
};

// When a base isn't in the active campaign, which campaign DOES hold its
// variant (for the "switch campaigns" message). null if the base is unknown.
export const campaignHoldingBase = (baseId) => {
    if (Object.hasOwn(CHECKS, baseId)) return null; // shared — present in both
    if (Object.hasOwn(CHECKS, baseId + "~Browser")) return "extension";
    if (Object.hasOwn(CHECKS, baseId + "~Mobile")) return "mobile";
    return null;
};

// First check (as a BASE id) of a campaign, in checks{} order — the landing
// target when a manual campaign switch strands the tester off-campaign.
export const firstCampaignCheckBase = (platform) => {
    for (const [key, chk] of Object.entries(CHECKS)) {
        if (checkInCampaign(chk?.steps?.[0]?.canonicalId, platform)) return baseCheckId(key);
    }
    return null;
};

/**
 * Which TRANSPORT a step dispatches over. This is the single source of truth the
 * panels use — the ONLY way a mobile check reaches the injected window.ethereum
 * is by EXPLICITLY declaring `transport: "injected"` on its step (embedded-browser
 * checks like PERM-010~Mobile). Absent → mobile defaults to WalletConnect, so the
 * transport guarantee (no action silently reaches the injected provider)
 * holds for every check that does not opt out. The extension campaign is always
 * the injected/window.ethereum transport.
 *
 * Returns: "walletconnect" | "injected" | "extension".
 */
export const resolveTransport = (platform, step) => {
    if (platform !== "mobile") return "extension";
    return step?.transport === "injected" ? "injected" : "walletconnect";
};

// Human surface noun for a transport — for copy that names WHERE the request
// landed. extension → the browser extension; walletconnect → the paired mobile
// wallet; injected (mobile embedded browser) → just "wallet". Keyed off
// resolveTransport so panel copy is never hardcoded to one campaign.
export const TRANSPORT_SURFACE = {
    extension: "wallet extension",
    walletconnect: "mobile wallet",
    injected: "wallet",
};

// "Review or reject the request in your <surface>." — the pending-observation
// line, derived from the active transport instead of assuming the extension.
export const pendingReviewNote = (transport) =>
    `Review or reject the request in your ${TRANSPORT_SURFACE[transport] ?? "wallet"}.`;

// The handleAction `platform` selector for a NON-WalletConnect dispatch. Both the
// extension campaign and a mobile "injected" step run the byte-frozen extension
// path over window.ethereum, so both dispatch as "extension".
export const INJECTED_NO_PROVIDER_NOTE =
    "No in-wallet browser detected. Open this wizard page inside your wallet app's built-in browser to run this check.";
