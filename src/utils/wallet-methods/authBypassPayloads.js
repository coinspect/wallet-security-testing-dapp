// Auth-bypass RPC payload builders — the SINGLE source of the {method, params}
// each auth-bypass request carries. Both transport paths consume these, and
// the params registry documents them from here, so the payload can no longer be
// hand-mirrored in three places and drift.
//
// Contract:
//   • Each builder returns ONLY { method, params } — no transport, no provider,
//     no side effects, no reads from globals. Every runtime value (connected
//     account, ciphertext, active chainId, gas/nonce/fees) is an explicit arg.
//   • House style: raw payloads. No ethers/web3 signer shapes the object — the
//     wallet must display exactly what the check measures.
//   • The wizard and parameter registry use the same config-driven builder.

// Imported from the neutral signMessages module (NOT constants) to avoid a
// circular import — constants imports these builders and calls them at load time.
import { Buffer } from "buffer";
import { DEFAULT_SEND_TO, LONG_SIGN_MESSAGE } from "../signMessages.js";
import { simpleTransaction } from "./simpleTransaction.mjs";

// UTF-8 → 0x-hex, matching the extension's `Buffer.from(msg,"utf8").toString("hex")`.
const utf8Hex = (text) => `0x${Buffer.from(text, "utf8").toString("hex")}`;

export { DEFAULT_SEND_TO };


// ── wallet_addEthereumChain ──────────────────────────────────────────────────
// Extension default: Polygon (0x89). WC divergence args: chainId "0x1" +
// chainName/nativeCurrency/rpcUrls/blockExplorerUrls for Ethereum Mainnet.
export const buildAddEthereumChain = ({
    chainId = "0x89",
    chainName = "Polygon Mainnet",
    nativeCurrency = { name: "MATIC", decimals: 18, symbol: "MATIC" },
    rpcUrls = ["https://polygon-rpc.com/"],
    blockExplorerUrls = ["https://polygonscan.com/"],
} = {}) => ({
    method: "wallet_addEthereumChain",
    params: [{ chainId, chainName, nativeCurrency, rpcUrls, blockExplorerUrls }],
});


// ── wallet_watchAsset (EIP-747) ──────────────────────────────────────────────
// options.address MUST be an ERC-20 CONTRACT (per EIP-747), and symbol/decimals
// must match that contract or a validating wallet rejects with -32602 ("The
// symbol…"). Defaults describe WSRT — our deployed test ERC-20 (symbol "WSRT",
// 18 decimals) — a token the wallet is unlikely to already hold, so the request
// is a GENUINE add rather than a no-op. Callers pass `address` (the WSRT
// contract) so this module needs no constants import (constants imports it at
// load time). No `image`: EIP-747's image is optional and a non-resolving
// placeholder only invited failures, so the payload omits it.
export const buildWatchAsset = ({
    address,
    symbol = "WSRT",
    decimals = 18,
} = {}) => ({
    method: "wallet_watchAsset",
    params: {
        type: "ERC20",
        options: { address, symbol, decimals },
    },
});


// A non-decryptable PLACEHOLDER eth_decrypt ciphertext. A REAL one must be
// x25519-xsalsa20-poly1305-encrypted to the CONNECTED ACCOUNT's encryption public
// key — obtainable only at runtime via eth_getEncryptionPublicKey (itself in this
// batch, and deprecated in several wallets) and produced only with a NaCl-box
// library we do not have (ethers v5.7 / web3 v4 provide none; no new deps). So the
// envelope carries SPEC-CORRECT field lengths (24-byte nonce, 32-byte
// ephemPublicKey) but ZERO bytes — it CANNOT be decrypted. A wallet that decodes
// or decrypts before its auth gate therefore errors on the payload; that error is
// a payload artifact, NOT evidence about the auth gate (see ETH_DECRYPT_PLACEHOLDER_NOTE).
const b64zeros = (nBytes) => Buffer.alloc(nBytes).toString("base64");
export const AUTH_BYPASS_PLACEHOLDER_CIPHERTEXT =
    "0x" + Buffer.from(JSON.stringify({
        version: "x25519-xsalsa20-poly1305",
        nonce: b64zeros(24),
        ephemPublicKey: b64zeros(32),
        ciphertext: b64zeros(32),
    }), "utf8").toString("hex");

// Shown on the eth_decrypt results row AND in the registry, so neither a tester
// nor a reviewer reads a decode/decrypt error as an auth-gate observation.
export const ETH_DECRYPT_PLACEHOLDER_NOTE =
    "Placeholder ciphertext — a decode or decrypt error here is a payload artifact, not evidence about the auth gate.";


// ── auth-bypass eth_signTypedData_v4 (the payload the WIZARD actually sends) ──
// Both transports and the registry use a clone of the same ERC-2612 Permit,
// with message.owner = connected account and domain.chainId = active chain.
// `permit` is injected to avoid a circular import with constants. Never mutate it.
export const buildAuthBypassTypedDataV4 = ({ permit, account, chainId, serialize = true } = {}) => {
    const typedData = JSON.parse(JSON.stringify(permit));
    if (account) typedData.message.owner = account;
    typedData.domain.chainId = chainId;
    return {
        method: "eth_signTypedData_v4",
        params: [account, serialize ? JSON.stringify(typedData) : typedData],
    };
};

// ── personal_sign ────────────────────────────────────────────────────────────
// Both wizard transports use [hexMsg, account]. Encode UTF-8 identically and
// retain the long ToS payload as the default message.
export const buildPersonalSign = ({ account, message = LONG_SIGN_MESSAGE, password } = {}) => ({
    method: "personal_sign",
    params:
        password === undefined
            ? [utf8Hex(message), account]
            : [utf8Hex(message), account, password],
});


/**
 * Exact request builder for the config-driven wizard auth-bypass batch. All
 * constants that would create a dependency cycle are explicit inputs, allowing
 * both the wire path and /params registry to consume this same function.
 */
export const buildWizardAuthBypassRequest = ({
    method,
    account,
    chainId,
    permit,
    addChain,
    watchAsset,
    ciphertext,
    message = LONG_SIGN_MESSAGE,
} = {}) => {
    switch (method) {
        case "eth_accounts":
        case "wallet_getPermissions":
            return { method };
        case "wallet_addEthereumChain":
            return { method, params: [addChain] };
        case "wallet_watchAsset":
            return { method, params: watchAsset };
        case "eth_decrypt":
            return { method, params: [ciphertext, account] };
        case "eth_getEncryptionPublicKey":
            return { method, params: [account] };
        case "eth_signTypedData_v4":
            return buildAuthBypassTypedDataV4({ permit, account, chainId });
        case "personal_sign":
            return buildPersonalSign({ account, message });
        case "eth_sendTransaction":
            return { method, params: [simpleTransaction(account, account)] };
        default:
            return { method };
    }
};
