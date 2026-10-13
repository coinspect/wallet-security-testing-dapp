// Only zero-value sends without calldata. Never use this for approvals,
// deployments, swaps, or typed-data/signing payloads.
export const SIMPLE_SEND_ACTIONS = new Set([
    "sendScamTransaction", "sendPoisonTransaction", "sendFamiliarRecipientTransaction",
    "sendUnknownTransaction", "sendInvalidChecksumTransaction", "sendExplorerLinkTransaction",
]);

export const simpleTransaction = (from, to, dataMode = "explicit_empty_data") => {
    if (!["explicit_empty_data", "omitted_data"].includes(dataMode)) {
        throw new Error("Unknown transaction data format");
    }
    return { from, to, value: "0x0", ...(dataMode === "explicit_empty_data" ? { data: "0x" } : {}) };
};
