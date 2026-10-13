// Per-sub-step wallet-state PRECONDITION. Lives on the sub-step (not the check)
// so a multi-part check can require different states across its parts.
//
//   "connected"    — connected + unlocked. THE DEFAULT (absent field ⇒ this):
//                    behaves exactly as before — gate the button on an account.
//   "any"          — never gated; the connection dialog itself is the subject
//                    (the connect checks run best while disconnected).
//   "disconnected" — must NOT be connected; instruct, never block.
//   "locked"       — connected but locked; instruct, never block.
//
// DETECTION LIMIT (by design): an empty eth_accounts means locked OR not
// connected, indistinguishably — so "disconnected" and "locked" only INSTRUCT;
// the tester owns the precondition. We never try to detect "locked".

export const WALLET_STATES = ["connected", "any", "disconnected", "locked"];
export const DEFAULT_WALLET_STATE = "connected";

const normalize = (s) => (WALLET_STATES.includes(s) ? s : DEFAULT_WALLET_STATE);

/**
 * Whether this state gates the button on a connected account. ONLY the default
 * "connected" state does; "any"/"disconnected"/"locked" never disable on
 * account presence (a missing mobile twin still disables — handled separately).
 */
export const gatesOnAccount = (walletState) => normalize(walletState) === "connected";

/**
 * The inverse gate: this state requires the dApp to be DISCONNECTED, so a
 * CONFIRMED-connected wallet must block the run (PERM-008 runs disconnected by
 * design). Only "disconnected" requires this.
 */
export const requiresDisconnected = (walletState) => normalize(walletState) === "disconnected";

/**
 * Guidance to show for a state + current account, or null when there's nothing
 * to say. For "connected" with a CONFIRMED-absent account it's a soft reminder
 * (the button stays ENABLED — clicking does a live eth_accounts read and lets the
 * wallet answer); for "disconnected"/"locked" it's a precondition reminder, also
 * shown while the button stays ENABLED.
 */
export const walletStateGuidance = (walletState, hasAccount) => {
    switch (normalize(walletState)) {
        case "connected":
            return hasAccount ? null : "Connect your wallet — this check needs a connected account.";
        case "disconnected":
            return hasAccount
                ? "Disconnect this dApp in your wallet first — this check tests access before permission is granted."
                : null;
        case "locked":
            return "Lock your wallet before running this — the check is whether a locked wallet still serves requests.";
        case "any":
        default:
            return null;
    }
};
