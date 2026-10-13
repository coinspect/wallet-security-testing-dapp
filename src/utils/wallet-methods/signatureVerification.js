import { ethers } from "ethers";
import { isEip1271MagicValue } from "./signatureMagic.mjs";

export { isEip1271MagicValue } from "./signatureMagic.mjs";

const hasContractCode = (code) =>
    typeof code === "string" && !/^0x0*$/i.test(code);

/**
 * Classifies a wallet signature without turning an unverifiable smart-account
 * signature into an application error. No result here changes the wallet request;
 * it only annotates the returned evidence.
 */
export const verifyWalletSignature = async ({ walletProvider, account, digest, signature }) => {
    let recovered = null;
    try {
        recovered = ethers.utils.recoverAddress(digest, signature);
    } catch {
        recovered = null;
    }

    let code;
    try {
        code = await walletProvider.request({
            method: "eth_getCode",
            params: [account, "latest"],
        });
    } catch {
        return recovered?.toLowerCase() === account.toLowerCase()
            ? { status: "valid", mechanism: "ecrecover", recovered_address: recovered }
            : {
                status: "verification_unavailable",
                mechanism: "unknown",
                recovered_address: recovered,
            };
    }

    if (!hasContractCode(code)) {
        return {
            status: recovered?.toLowerCase() === account.toLowerCase() ? "valid" : "mismatch",
            mechanism: "ecrecover",
            recovered_address: recovered,
        };
    }

    try {
        const iface = new ethers.utils.Interface([
            "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
        ]);
        const result = await walletProvider.request({
            method: "eth_call",
            params: [
                {
                    to: account,
                    data: iface.encodeFunctionData("isValidSignature", [digest, signature]),
                },
                "latest",
            ],
        });
        return {
            status: isEip1271MagicValue(result) ? "valid" : "invalid",
            mechanism: "eip1271",
            recovered_address: recovered,
        };
    } catch {
        return {
            status: "verification_unavailable",
            mechanism: "eip1271",
            recovered_address: recovered,
        };
    }
};
