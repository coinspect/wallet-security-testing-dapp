// Neutral home for shared sign-message payloads, imported by BOTH constants.js
// and the auth-bypass payload builder (authBypassPayloads.js). It lives here — not
// in constants.js — precisely to break a circular import: constants.js imports the
// builders (and calls them at module load), so if the builder imported the message
// back from constants.js the two would deadlock in a TDZ on whichever loads first.
// This module imports nothing, so the graph stays a DAG.

export const DEFAULT_SEND_TO = "0x873050043AF661fe9d5633369B10139eb7b4Da54";
export const SIWE_FAKE_DOMAIN = "https://opensea.io";

export const buildSiweMismatchMessage = (address, {
    nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    issuedAt = new Date().toISOString(),
} = {}) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("A valid wallet address is required for SIWE.");
    if (!/^[a-zA-Z0-9]{8,}$/.test(nonce)) throw new Error("SIWE requires at least 8 alphanumeric nonce characters.");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt))) throw new Error("Invalid SIWE issue time.");
    return `${SIWE_FAKE_DOMAIN} wants you to sign in with your Ethereum account:\n${address}\n\nSign in with Ethereum to the app.\n\nURI: ${SIWE_FAKE_DOMAIN}\nVersion: 1\nChain ID: 137\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
};

export const siweMessageRuntime = (message) => ({
    siwe_domain: new URL(SIWE_FAKE_DOMAIN).host,
    siwe_uri: SIWE_FAKE_DOMAIN,
    siwe_chain_id: Number(message.match(/^Chain ID: (\d+)$/m)[1]),
    siwe_nonce: message.match(/^Nonce: (.+)$/m)[1],
    siwe_issued_at: message.match(/^Issued At: (.+)$/m)[1],
    siwe_variant: message.startsWith("https://") ? "with_scheme" : "without_scheme",
    siwe_scheme: message.startsWith("https://") ? "https" : null,
    siwe_message: message,
});

// Long multi-paragraph message for the VERI-007 "Mandatory message review" check —
// long enough that the wallet must scroll to show all of it. Also the payload every
// generic personal_sign now carries (auth-bypass batch + the shared builder).
export const LONG_SIGN_MESSAGE = [
    "TERMS OF SERVICE AND CONDITIONS OF USE",
    "By signing this message you acknowledge that you have read, understood, and agree to be bound by the following terms in their entirety. This signature does not authorize any transfer of funds, token approval, or on-chain transaction; it is used solely to authenticate your ownership of this account for the purposes described below.",
    "1. ACCOUNT AUTHENTICATION. You confirm that you are the rightful owner of the wallet address that produces this signature, and that you are signing of your own free will, without coercion, and with full understanding of the consequences of cryptographic authentication.",
    "2. NO FINANCIAL AUTHORIZATION. Nothing in this message grants any party the right to move, spend, stake, lend, or otherwise control any asset held by this account. Any request that asks you to sign a message granting such rights should be treated as suspicious and rejected.",
    "3. DATA AND PRIVACY. You understand that your public address and the fact that you produced this signature may be recorded for auditing and security-research purposes. No private keys, seed phrases, or other secret material are ever transmitted or requested by this process.",
    "4. SECURITY ACKNOWLEDGEMENT. You understand that a well-behaved wallet should require you to scroll through and review the entirety of a message like this one before enabling the Sign button, and that skipping review is a common vector for blind-signing attacks.",
    "5. FINAL CONFIRMATION. Having read all of the sections above from beginning to end, you now confirm your intent to authenticate this account. If you did not read every section, do not sign — cancel this request and review it again.",
].join("\n\n");
