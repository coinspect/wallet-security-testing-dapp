import { chains } from "@/utils/constants";
import { normalizeChainId } from "./chainId.mjs";
import { assertPolygon } from "./polygonPolicy.mjs";

export { normalizeChainId } from "./chainId.mjs";

// Connection/setup only. Never call this from a locked-wallet probe.
export async function ensurePolygon(provider, { isCurrent = () => true } = {}) {
    const request = async (args) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(() => {
                    if (!isCurrent()) throw new Error('Wallet connection changed. Connect on Polygon again.');
                    return provider.request(args);
                }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Polygon setup did not finish. Select Polygon in your wallet, then try again.')), 15000); }),
            ]);
        } finally { clearTimeout(timer); }
    };
    const result = await ensureChain('polygon', provider, request);
    if (result?.status) throw new Error(result.message || 'Connect on Polygon to continue.');
    await assertPolygon({ request });
    if (!isCurrent()) throw new Error('Wallet connection changed. Connect on Polygon again.');
    return result;
}

/**
 * Normalize a chain entry to the EIP-3085 shape expected by
 * `wallet_addEthereumChain`. The catalog in `constants.chains` mixes
 * two shapes:
 *   - `mainnet` — minimal (only chainId + chainName).
 *   - `polygon` / `zksync` — legacy denormalized shape from
 *     SWITCH_CHAINS_PARAMS_2 / SWITCH_CHAINS_PARAMS (top-level
 *     `nativeCurrencyName` / `symbol` / `rpcUrl` / `blockExplorerUrl`,
 *     not the nested EIP-3085 structure).
 * This helper handles both and returns whatever fields it can populate.
 */
export const toAddChainParams = (chain) => {
    if (chain?.nativeCurrency && Array.isArray(chain?.rpcUrls)) {
        return chain;
    }
    if (!chain?.rpcUrl || !chain?.symbol) {
        throw new Error(`Chain ${chain?.chainName ?? "(unknown)"} lacks EIP-3085 add-chain metadata`);
    }
    return {
        chainId: chain.chainId,
        chainName: chain.chainName,
        nativeCurrency: {
            name: chain.nativeCurrencyName ?? chain.chainName,
            symbol: chain.symbol,
            decimals: 18,
        },
        rpcUrls: chain.rpcUrl ? [chain.rpcUrl] : [],
        blockExplorerUrls: chain.blockExplorerUrl ? [chain.blockExplorerUrl] : [],
    };
};

const isUserRejection = (err) =>
    err?.code === 4001 || /user (denied|rejected)/i.test(err?.message || "");

const isChainNotAdded = (err) =>
    err?.code === 4902 || err?.data?.originalError?.code === 4902;

/**
 * Ensure the wallet is on the target chain before proceeding with a
 * send-transaction check. Works with any EIP-1193 provider — both the
 * injected `window.ethereum` and the WalletConnect `walletProvider`
 * expose a compatible `.request()` interface.
 *
 * Return shapes:
 *   { switched: false }                              — already on target
 *   { switched: true }                               — switched (or added + switched) OK
 *   { status: 'rejected_by_user', at: 'chain_switch' } — user cancelled the wallet prompt
 *   { status: 'error', at: 'chain_read', message }   — could not read current chainId
 *
 * Throws (with a compact message) on unexpected switch/add failures
 * other than user rejection.
 */
export const ensureChain = async (chainKey, provider, request = (args) => provider.request(args)) => {
    const target = Object.hasOwn(chains, chainKey) ? chains[chainKey] : null;
    if (!target) {
        throw new Error(`Unknown chain key: ${chainKey}`);
    }

    let currentHex;
    try {
        currentHex = await request({ method: "eth_chainId" }, "chain_read");
    } catch (err) {
        return {
            status: "error",
            at: "chain_read",
            message: err?.message?.split?.("\n")?.[0] || String(err),
        };
    }

    const targetHex = normalizeChainId(target.chainId);
    const nowHex = normalizeChainId(currentHex);
    if (!targetHex || !nowHex) {
        return {
            status: "error",
            at: "chain_read",
            message: "Wallet returned an invalid chainId",
        };
    }
    if (nowHex === targetHex) {
        return { switched: false };
    }

    try {
        await request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: target.chainId }],
        }, "chain_switch");
        return { switched: true };
    } catch (err) {
        if (isUserRejection(err)) {
            return { status: "rejected_by_user", at: "chain_switch" };
        }

        if (isChainNotAdded(err)) {
            try {
                await request({
                    method: "wallet_addEthereumChain",
                    params: [toAddChainParams(target)],
                }, "chain_add");
                // After add, most wallets are already on the new chain;
                // an explicit follow-up switch keeps behavior uniform.
                await request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: target.chainId }],
                }, "chain_switch_after_add");
                return { switched: true };
            } catch (addErr) {
                if (isUserRejection(addErr)) {
                    return { status: "rejected_by_user", at: "chain_switch" };
                }
                const short = addErr?.message?.split?.("\n")?.[0] || String(addErr);
                throw new Error(short);
            }
        }

        const short = err?.message?.split?.("\n")?.[0] || String(err);
        throw new Error(short);
    }
};
