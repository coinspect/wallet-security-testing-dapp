import { normalizeChainId } from "../../../utils/wallet-methods/chainId.mjs";
import { POLYGON_CHAIN_ID } from '../../../utils/wallet-methods/polygonPolicy.mjs';

export const authConnection = (runtime) => {
    const session = runtime?.provider?.session ?? runtime?.provider?.signer?.session;
    return { topic: session?.topic, address: runtime?.address, chainId: normalizeChainId(runtime?.chainId),
        wallet: session?.peer?.metadata?.name, provider: runtime?.provider };
};

export function authRecoveryGuard(original, runtime) {
    const current = authConnection(runtime);
    if (!current.topic || !current.address) return "Reconnect the same wallet and account to continue.";
    if (current.topic === original.topic) return "Disconnect the previous session before reconnecting.";
    if (current.address.toLowerCase() !== original.address?.toLowerCase()) return "Select the same account used before reconnecting.";
    if (current.chainId !== POLYGON_CHAIN_ID) return "Return to Polygon before resuming.";
    if (original.chainId !== POLYGON_CHAIN_ID) return "This run started on another network. Start a new run on Polygon; the previous evidence is preserved.";
    if (original.wallet && current.wallet !== original.wallet) return "Reconnect the same wallet to keep these observations comparable.";
    return null;
}

export function authResumePlan(results, nextIndex) {
    if (!Array.isArray(results) || !Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= results.length) {
        throw new Error("No remaining methods to resume");
    }
    // Keep the original row objects so a late reply stays attached to its own
    // attempt. Only replace unsent placeholders for the methods still to run.
    if (results.slice(nextIndex).some((row) => row.request_submitted !== false || row.outcome !== "not_attempted")) {
        throw new Error("Cannot resume over methods already attempted");
    }
    return { previousResults: results.slice(0, nextIndex),
        connectionAttempt: (results.runtime?.connection_attempts ?? 1) + 1 };
}

export async function disconnectForRecovery(disconnect, timeoutMs = 15000) {
    let timer;
    try {
        await Promise.race([
            Promise.resolve().then(() => disconnect({ namespace: "eip155" })),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Disconnect did not finish")), timeoutMs); }),
        ]);
    } finally { clearTimeout(timer); }
}
