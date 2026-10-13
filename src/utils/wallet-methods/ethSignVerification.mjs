import { ethers } from "ethers";

export function inspectEthSignSignature(account, messageHash, signature) {
    const attempts = [
        ["raw_eth_sign", () => ethers.utils.recoverAddress(messageHash, signature)],
        ["personal_sign_bytes", () => ethers.utils.verifyMessage(ethers.utils.arrayify(messageHash), signature)],
        ["personal_sign_text", () => ethers.utils.verifyMessage(messageHash, signature)],
    ].map(([format, recover]) => {
        try {
            const recovered = recover();
            return { format, recovered_address: recovered, matches_signing_account: recovered.toLowerCase() === account.toLowerCase() };
        } catch {
            return { format, recovered_address: null, matches_signing_account: false, error: "Signature could not be recovered for this format." };
        }
    });
    const matched = attempts.find((attempt) => attempt.matches_signing_account)?.format ?? null;
    const result = matched === "raw_eth_sign"
        ? "eth_sign returned a verified raw signature for the signing account."
        : matched
            ? "eth_sign returned a signature matching the personal_sign format, not raw signing."
            : "eth_sign returned a signature, but it matched neither raw signing nor personal_sign for the signing account. Inconclusive.";
    return {
        result,
        eth_sign_verification: {
            requested_method: "eth_sign",
            message_hash: messageHash,
            signing_account: account,
            matched_format: matched,
            status: matched ? "matched" : "inconclusive",
            attempts,
        },
    };
}
