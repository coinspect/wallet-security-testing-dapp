"use client";

import { getActiveProvider } from "./selectedProvider";

/**
 * SETUP-ONLY disconnect, shared by the PreconditionNote affordance and the
 * PERM-008 action gate. It revokes the eth_accounts grant so a "disconnected"
 * check runs in that absence. It NEVER reconnects or prompts, and is never routed
 * through the action/evidence path. Runs against the SELECTED provider.
 *
 * Returns: "done" | "unsupported" | "failed" | "no_provider".
 */

// A revoke that failed because the method is unknown/unsupported (degrade to a
// manual disconnect) vs a real rejection/other error.
export const isUnsupportedRevoke = (err) => {
    const code = err?.code;
    if (code === 4200 || code === -32601) return true;
    return /not\s+(support|found|exist|available)|unsupported method/i.test(
        String(err?.message ?? "")
    );
};

export const disconnectDapp = async () => {
    const eth = getActiveProvider();
    if (typeof window === "undefined" || !eth) return "no_provider";
    try {
        await eth.request({
            method: "wallet_revokePermissions",
            params: [{ eth_accounts: {} }],
        });
        return "done";
    } catch (err) {
        return isUnsupportedRevoke(err) ? "unsupported" : "failed";
    }
};
