import { Buffer } from "buffer";
import { inspectEthSignSignature } from "../ethSignVerification.mjs";
import { simpleTransaction } from "../simpleTransaction.mjs";
import {
    APPROVE_AMOUNT,
    APPROVE_SPENDER,
    DIFFERENT_CHAIN_ID,
    LONG_SIGN_MESSAGE,
    LP_AMOUNT_IN,
    LP_TICK_SPACING,
    NONFUNGIBLE_POSITION_MANAGER,
    PERMIT_EIP712,
    PERSONAL_SIGN,
    PERSONAL_SIGN_MESSAGE,
    QUOTER_V2,
    SWAP_AMOUNT_IN,
    SWAP_FEE,
    SWAP_ROUTER_02,
    SWITCH_CHAINS_PARAMS,
    TEST_ERC20_ABI,
    TEST_ERC20_ADDRESS,
    TEST_ERC20_BYTECODE,
    UNISWAP_V3_FACTORY,
    USDC_E,
    WMATIC,
} from "@/utils/constants";
import { ethers } from "ethers";
import EIP_712 from "@/api/openSeaEIP_712.json";
import { runAuthBypassBatch } from "../authBypassBatch";
import { createAuthSessionRequest } from "./authSession.mjs";
import { readAuthPreflight } from "../authRunControl.mjs";
import {
    isDeadWalletConnectSession,
    isUserRejection,
} from "../walletErrors.mjs";
import { verifyWalletSignature } from "../signatureVerification";
import { buildSiweMismatchMessage, siweMessageRuntime } from "@/utils/signMessages";
import { snapshotError } from "../requestDiagnostics.mjs";
import { requestChainSwitch } from "../chainSwitchProbe.mjs";

// User declined the connection at the wallet — mirror the extension's
// isUserRejectionErr (ext/methods.js) so a rejection reads identically on both
// transports (recorded as { status: "rejected_by_user" }, never a crash).
const isUserRejectionErrWC = isUserRejection;

// An EXISTING WalletConnect session that has gone stale/expired surfaces as a
// transport-level error (or an empty accounts reply). These are re-pairable —
// the caller reopens the modal rather than reporting an opaque failure.
const isDeadSessionErrWC = isDeadWalletConnectSession;

// Normalize the WC chain to the SAME hex form the extension records: the
// extension's runtime.chain_id comes from eth_chainId, which returns hex like
// "0x89". AppKit's session reports chainId as a NUMBER (e.g. 137), so prefer
// a live eth_chainId read off the WC provider and fall back to hex-encoding the
// numeric session value.
const readChainHexWC = async (walletProvider, sessionChainId, request = (args) => walletProvider.request(args)) => {
    try {
        const hex = await request({ method: "eth_chainId" }, "transaction_chain_read");
        if (typeof hex === "string" && hex.startsWith("0x")) return hex;
        if (typeof hex === "number") return `0x${hex.toString(16)}`;
    } catch (error) {
        if (error?.authSetupStopped) throw error;
        /* provider refused — fall back to the session value */
    }
    if (typeof sessionChainId === "number") return `0x${sessionChainId.toString(16)}`;
    if (typeof sessionChainId === "string" && sessionChainId) {
        if (sessionChainId.startsWith("0x")) return sessionChainId;
        const n = parseInt(sessionChainId, 10);
        if (Number.isFinite(n)) return `0x${n.toString(16)}`;
    }
    return null;
};

// Build an ethers Web3Provider over the WALLETCONNECT SESSION for READ calls
// (eth_call / eth_getTransactionReceipt). The WC session provider serves reads by
// routing them to its configured HTTP RPC — WalletConnect wallets don't expose
// eth_call over the relay — so this is the same walletProvider, just wrapped for
// ethers. The network is PINNED (chainId from the session — a local property, no
// RPC) so ethers never runs its eager detectNetwork, which over a dead RPC throws
// a "could not detect network" rejection that escapes to the Next error overlay.
// These checks are Polygon-only (ensureChain forces it), so 137 is the fallback.
const wcReadProvider = (walletProvider, chainHex, sessionChainId) => {
    let netId =
        typeof sessionChainId === "number"
            ? sessionChainId
            : chainHex
                ? parseInt(chainHex, 16)
                : undefined;
    if (!Number.isFinite(netId)) netId = 137;
    return new ethers.providers.Web3Provider(walletProvider, netId);
};

// Neutral, contained result for an on-chain READ failure (quote / pool / receipt
// unreachable). The panel renders `note` as a calm in-panel message — never a
// verdict, never the Next error overlay. Mirrors the reconnect_required shape.
const readFailed = (note) => ({ status: "read_failed", note });

/**
 * WalletConnect twin of the extension `requestConnection` (ext/methods.js:256).
 * Confirms the WC session and reports the connected account, recording the SAME
 * evidence shape the extension does: `{ result, runtime: { connect_method, … } }`
 * (result → wallet_output; runtime merged into the evidence runtime block).
 *
 * The three unreliable-session cases (opening the modal for cases a/b is done by
 * the caller, which owns the AppKit hooks):
 *   (a) NO active session — detected before dispatch by the caller (isConnected
 *       false / walletProvider undefined); this function isn't reached, but if it
 *       is handed no provider it returns { status: "reconnect_required" }.
 *   (b) DEAD/EXPIRED session — an existing session that yields NO accounts or
 *       throws a transport session error → { status: "reconnect_required" }, the
 *       signal for the caller to re-pair (never an opaque throw).
 *   (c) USER REJECTION at the wallet — code 4001 / "user rejected" →
 *       { status: "rejected_by_user" }, exactly as the extension path records it.
 *
 * runtime.platform is NOT set here — ActionResult stamps it from the active
 * campaign (usePlatform), identically for both transports. GAP: the specific
 * mobile wallet's identity isn't exposed by the ethers5 hooks, so unlike the
 * extension's runtime.provider (window.ethereum identity) the WC path can only
 * record transport:"walletconnect" — documented, never faked.
 */
export const requestConnectionWC = async (walletProvider, sessionChainId) => {
    if (!walletProvider) return { status: "reconnect_required" };
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!Array.isArray(accounts) || accounts.length === 0) {
            // (b) session exists but grants no accounts → stale/expired. Re-pair.
            return { status: "reconnect_required" };
        }
        const chain_id = await readChainHexWC(walletProvider, sessionChainId);
        return {
            result: accounts,
            runtime: {
                connect_method: "eth_requestAccounts",
                transport: "walletconnect",
                ...(chain_id ? { chain_id } : {}),
                from: accounts[0],
            },
        };
    } catch (error) {
        if (isUserRejectionErrWC(error)) return { status: "rejected_by_user" }; // (c)
        if (isDeadSessionErrWC(error)) return { status: "reconnect_required" }; // (b)
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

const retrieveAddress = async (provider) => {
    try {
        const accounts = await provider.listAccounts();
        if (accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        return accounts[0];
    } catch (error) {
        console.error("Error retrieving address:", error);
        throw error;
    }
};

// START CHAIN METHODS //
// handleAddChainWC removed: it had no caller on either branch, and its
// EIP-3085 envelope was the only reader of SWITCH_CHAINS_PARAMS
// .nativeCurrencyDecimals. The auth-bypass batch is the live add-chain path.
export const handleSwitchChainWC = async (walletProvider, chainId, chainName, { signal } = {}) => {
    return requestChainSwitch({ provider: walletProvider, chainId, chainName, transport: "walletconnect", signal });
};

// END CHAIN METHODS //

/**
 * Send a minimal-envelope transaction through the WalletConnect session.
 *
 * Goes directly to the walletProvider's EIP-1193 `request` interface —
 * no ethers Web3Provider wrapping, no getNetwork / getGasPrice /
 * getTransactionCount preflight. The wallet fills gas / nonce / fees
 * and shows its own confirmation UI, which is the observable that
 * WSR-THRE-019 evaluates.
 *
 * User rejection returns `{ status: 'rejected_by_user' }` separately from
 * provider/session failures. The tester, not this helper, assesses the result.
 */
export const sendTransaction = async (to, walletProvider, sessionChainId, request = (args) => walletProvider.request(args), dataMode) => {
    // WC runtime recorded like the other WC actions (transport + normalized hex
    // chain_id + from). ActionResult merges this into evidence.runtime alongside
    // platform:"mobile"; available in both the sent and rejected branches.
    let runtime;
    try {
        const accounts = await request({ method: "eth_requestAccounts" }, "accounts_read");
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const from = accounts[0];

        const chain_id = await readChainHexWC(walletProvider, sessionChainId, request);
        runtime = {
            transport: "walletconnect",
            ...(chain_id ? { chain_id } : {}),
            from,
        };

        // Minimal envelope — no gas/nonce/fees/type; the wallet does its own
        // estimation, which is exactly what the check measures.
        const hash = await request({
            method: "eth_sendTransaction",
            params: [simpleTransaction(from, to, dataMode)],
        }, "transaction_request");
        return { hash, runtime };
    } catch (error) {
        if (error?.networkPrecondition) throw error;
        if (
            error?.code === 4001 ||
            /user (denied|rejected)/i.test(error?.message || "")
        ) {
            return runtime
                ? { status: "rejected_by_user", runtime }
                : { status: "rejected_by_user" };
        }
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

export const sendPersonalSignWC = async (walletProvider, useSiwe = false) => {
    let siweRuntime;
    try {
        const provider = new ethers.providers.Web3Provider(walletProvider);
        const address = await retrieveAddress(provider);

        const message = useSiwe ? buildSiweMismatchMessage(address) : PERSONAL_SIGN_MESSAGE;
        const hexMsg = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(message));
        const params = [hexMsg, address];
        if (useSiwe) siweRuntime = { from: address, ...siweMessageRuntime(message), siwe_request: { method: "personal_sign", params: [...params] } };
        const signature = await provider.send("personal_sign", params);

        const digest = ethers.utils.hashMessage(message);
        const verification = await verifyWalletSignature({
            walletProvider,
            account: address,
            digest,
            signature,
        });
        return {
            result: signature,
            runtime: {
                transport: "walletconnect",
                from: address,
                signature_verification: verification,
                ...siweRuntime,
            },
        };
    } catch (error) {
        console.error("Error signing message:", error.message);
        if (siweRuntime) throw Object.assign(new Error(error?.message ?? String(error)), snapshotError(error), { siweRuntime });
        throw error;
    }
};

/**
 * WC twin of the extension `signPermit` (ext/methods.js:309) — VERI-004. Signs
 * the SAME EIP-2612 permit typed data over eth_signTypedData_v4, byte-identical
 * {method, params} to the extension. Clones the shared PERMIT_EIP712 per call and
 * sets `message.owner` on the CLONE — never mutating the shared import (the same
 * leak that was fixed on sendTypedDataWC). params[1] is the JSON STRING form, the
 * standard eth_signTypedData wire shape. Records runtime like the other WC twins.
 */
export const signPermitWC = async (walletProvider, sessionChainId) => {
    let runtime;
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const address = accounts[0];

        const chain_id = await readChainHexWC(walletProvider, sessionChainId);
        runtime = {
            transport: "walletconnect",
            ...(chain_id ? { chain_id } : {}),
            from: address,
        };

        const typedData = JSON.parse(JSON.stringify(PERMIT_EIP712));
        typedData.message.owner = address;

        const signature = await walletProvider.request({
            method: "eth_signTypedData_v4",
            params: [address, JSON.stringify(typedData)],
        });
        return { result: signature, runtime };
    } catch (error) {
        if (isUserRejectionErrWC(error)) {
            return runtime
                ? { status: "rejected_by_user", runtime }
                : { status: "rejected_by_user" };
        }
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * WC twin of the extension `signLongMessage` (ext/methods.js:328) — VERI-007.
 * personal_sign of the SAME long message, hex-encoded the extension's exact way
 * (Buffer UTF-8 → hex), byte-identical {method, params}. Records runtime like the
 * other WC twins.
 */
export const signLongMessageWC = async (walletProvider, sessionChainId) => {
    let runtime;
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const address = accounts[0];

        const chain_id = await readChainHexWC(walletProvider, sessionChainId);
        runtime = {
            transport: "walletconnect",
            ...(chain_id ? { chain_id } : {}),
            from: address,
        };

        const msg = `0x${Buffer.from(LONG_SIGN_MESSAGE, "utf8").toString("hex")}`;
        const signature = await walletProvider.request({
            method: "personal_sign",
            params: [msg, address],
        });
        return { result: signature, runtime };
    } catch (error) {
        if (isUserRejectionErrWC(error)) {
            return runtime
                ? { status: "rejected_by_user", runtime }
                : { status: "rejected_by_user" };
        }
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

export const sendTypedDataWC = async (
    walletProvider,
    differentChainId = false,
    version = "Data_v4"
) => {
    try {
        const provider = new ethers.providers.Web3Provider(walletProvider);
        const address = await retrieveAddress(provider);

        // Clone per call — never mutate the shared EIP_712 import (mirrors the
        // sendTypedData fix on the extension path). Otherwise PERM-003
        // (differentChainId=true) leaves domain.chainId mutated on the shared
        // object and that leak reaches every later check — and the extension
        // path — that consumes the same import.
        const typedData = JSON.parse(JSON.stringify(EIP_712));
        // Offerer = connected account (mirrors signPermit's message.owner), set on
        // the CLONE only — byte-identical to the extension path. A self-authored
        // order drops the foreign-address flag that confounds VERI-006's truncation
        // observation; for PERM-003 it leaves the mismatched chainId as the sole
        // anomaly.
        typedData.message.offerer = address;
        if (differentChainId) {
            typedData.domain.chainId = DIFFERENT_CHAIN_ID;
        }

        const params = [address, JSON.stringify(typedData)];
        const signature = await provider.send(`eth_signTyped${version}`, params);

        const types = { ...typedData.types };
        delete types.EIP712Domain;
        const digest = ethers.utils._TypedDataEncoder.hash(
            typedData.domain,
            types,
            typedData.message,
        );
        const verification = await verifyWalletSignature({
            walletProvider,
            account: address,
            digest,
            signature,
        });
        return {
            result: signature,
            runtime: {
                transport: "walletconnect",
                from: address,
                signature_verification: verification,
            },
        };
    } catch (error) {
        console.error("Error signing typed data:", error.message);
        throw error;
    }
};

export const ethSignWC = async (walletProvider) => {
    try {
        const provider = new ethers.providers.Web3Provider(walletProvider);
        const address = await retrieveAddress(provider);

        // Create a 32-byte hash of the message
        const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(PERSONAL_SIGN));

        // Ensure the hash is exactly 32 bytes (66 characters including '0x')
        if (messageHash.length !== 66) {
            throw new Error("Invalid hash length");
        }
        console.log("Message hash (hex):", messageHash);

        const signature = await provider.send("eth_sign", [address, messageHash]);

        return inspectEthSignSignature(address, messageHash, signature);
    } catch (error) {
        let errorMessage;
        try {
            errorMessage = JSON.parse(error.message).message;
        } catch (parseError) {
            errorMessage = error.message;
        }
        console.error("Error signing message:", errorMessage);
        throw error;
    }
};

// Poll for a contract-creation receipt to recover the deployed address — the WC
// mirror of ext/methods.js `waitForContractAddress` (same method, same 30×2s
// polling, same revert check). Reads go through the WC provider's RPC. This is a
// CONFIRMATION-BLOCKING wait: it returns only once the deploy tx is mined.
const waitForContractAddressWC = async (walletProvider, hash, { tries = 30, delayMs = 2000 } = {}) => {
    for (let i = 0; i < tries; i++) {
        let receipt;
        try {
            receipt = await walletProvider.request({
                method: "eth_getTransactionReceipt",
                params: [hash],
            });
        } catch (readErr) {
            // The receipt READ (through the session's RPC) is unreachable. The
            // deploy tx was already broadcast, so bail with null rather than
            // retrying a persistent RPC error 30× (or throwing loose). The caller
            // returns the hash with an unconfirmed address; approve falls back to
            // the const token.
            console.warn("waitForContractAddressWC receipt read failed:", readErr?.message || readErr);
            return null;
        }
        if (receipt) {
            if (receipt.status === "0x0") {
                throw new Error("Deployment transaction reverted");
            }
            if (receipt.contractAddress) return receipt.contractAddress;
        }
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
};

/**
 * WC twin of the extension `deployTestErc20` (ext/methods.js:383) — VERI-005 p1.
 * Contract-creation tx: NO `to`, carries the hardcoded bytecode (this is the ONE
 * legitimate absent-`to`, a deploy — unlike the auth-bypass bug). Byte-identical
 * {method, params}. Waits for the receipt (blocking) to recover the deployed
 * address, so the approve part can target it. Records runtime like the other WC
 * twins plus the extension's tx_hash / deployed_address.
 */
export const deployTestErc20WC = async (walletProvider, sessionChainId) => {
    let runtime;
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const from = accounts[0];
        const chain_id = await readChainHexWC(walletProvider, sessionChainId);
        runtime = { transport: "walletconnect", ...(chain_id ? { chain_id } : {}), from };

        const hash = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [{ from, data: TEST_ERC20_BYTECODE, value: "0x0" }],
        });
        const contractAddress = await waitForContractAddressWC(walletProvider, hash);
        runtime = { ...runtime, tx_hash: hash, deployed_address: contractAddress };
        return { hash, contractAddress, runtime };
    } catch (error) {
        if (isUserRejectionErrWC(error)) {
            return runtime ? { status: "rejected_by_user", runtime } : { status: "rejected_by_user" };
        }
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * WC twin of the extension `approveTestErc20` (ext/methods.js:411) — VERI-005 p2.
 * Same `approve(spender, unlimited)` calldata (identical ethers Interface encode),
 * sent to the token from part 1 (or the TEST_ERC20_ADDRESS fallback).
 * Byte-identical {method, params}. Records transport/chain_id/from like the other
 * WC twins (the extension records no runtime for approve — this is additive).
 */
export const approveTestErc20WC = async (walletProvider, tokenAddress, sessionChainId) => {
    let runtime;
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const from = accounts[0];
        const chain_id = await readChainHexWC(walletProvider, sessionChainId);
        runtime = { transport: "walletconnect", ...(chain_id ? { chain_id } : {}), from };

        const iface = new ethers.utils.Interface(TEST_ERC20_ABI);
        const data = iface.encodeFunctionData("approve", [APPROVE_SPENDER, APPROVE_AMOUNT]);
        // Byte-identical parity with the extension: with a tokenAddress (the
        // deploy-part hand-off) approve THAT unknown token; otherwise USDC.e.
        const to = tokenAddress || USDC_E;
        const hash = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [{ from, to, data, value: "0x0" }],
        });
        return { hash, runtime };
    } catch (error) {
        if (isUserRejectionErrWC(error)) {
            return runtime ? { status: "rejected_by_user", runtime } : { status: "rejected_by_user" };
        }
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * WC twin of the extension `simulateSwap` (ext/methods.js:434) — VERI-003.
 * Uniswap v3 exact-input swap (native MATIC → USDC.e). Fetches the SAME QuoterV2
 * quote off-chain (callStatic) to derive amountOutMinimum (0.5% slippage), then
 * builds the SAME exactInputSingle calldata. The read never shapes the payload
 * differently from the extension — same quote, same slippage, same encode.
 *
 * BYTE-IDENTITY: construction is identical; `data` embeds the LIVE quote
 * (amountOutMinimum), which varies with pool state at call time — the same
 * run-to-run non-determinism the extension has. `value` (amountIn) is fixed.
 */
export const simulateSwapWC = async (walletProvider, sessionChainId) => {
    let runtime = {};
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const from = accounts[0];
        const chain_id = await readChainHexWC(walletProvider, sessionChainId);

        const amountIn = ethers.BigNumber.from(SWAP_AMOUNT_IN);

        // READ (wrapped + network-pinned): the QuoterV2 quote goes through the WC
        // session provider's RPC. A failure is CONTAINED here — returned as a
        // neutral status, never thrown loose to the Next error overlay.
        let amountOut;
        try {
            const provider = wcReadProvider(walletProvider, chain_id, sessionChainId);
            const quoterIface = new ethers.utils.Interface([
                "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
            ]);
            const quoter = new ethers.Contract(QUOTER_V2, quoterIface, provider);
            const quote = await quoter.callStatic.quoteExactInputSingle({
                tokenIn: WMATIC,
                tokenOut: USDC_E,
                amountIn,
                fee: SWAP_FEE,
                sqrtPriceLimitX96: 0,
            });
            amountOut = quote.amountOut ?? quote[0];
        } catch (readErr) {
            console.warn("simulateSwapWC quote read failed:", readErr?.message || readErr);
            return readFailed("Couldn't read the swap quote — check your connection and retry.");
        }
        const amountOutMinimum = amountOut.mul(9950).div(10000); // 0.5% slippage
        runtime = {
            transport: "walletconnect",
            ...(chain_id ? { chain_id } : {}),
            from,
            amount_in: amountIn.toString(),
            expected_amount_out: amountOut.toString(),
            amount_out_minimum: amountOutMinimum.toString(),
        };

        const routerIface = new ethers.utils.Interface([
            "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
        ]);
        const data = routerIface.encodeFunctionData("exactInputSingle", [
            {
                tokenIn: WMATIC,
                tokenOut: USDC_E,
                fee: SWAP_FEE,
                recipient: from,
                amountIn,
                amountOutMinimum,
                sqrtPriceLimitX96: 0,
            },
        ]);

        const hash = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [
                {
                    from,
                    to: SWAP_ROUTER_02,
                    data,
                    value: amountIn.toHexString(),
                },
            ],
        });
        return { hash, runtime };
    } catch (error) {
        if (isUserRejectionErrWC(error)) return { status: "rejected_by_user", runtime };
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * WC twin of the extension `provideLiquidity` (ext/methods.js:504) — VERI-003.
 * Single-sided WMATIC liquidity into the Uniswap v3 WMATIC/USDC.e (fee 500) pool.
 * Reads the pool (Factory.getPool) + current tick (pool.slot0) — the SAME reads
 * the extension does — to align an above-range window, then builds the SAME mint
 * calldata. Reads never shape the payload differently from the extension.
 *
 * BYTE-IDENTITY: construction is identical; `data` embeds the LIVE pool tick and
 * a time-based `deadline` (now + 1200s), so it varies run-to-run exactly as the
 * extension's does. `value` (amount0Desired) is fixed.
 */
export const provideLiquidityWC = async (walletProvider, sessionChainId) => {
    let runtime = {};
    try {
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const from = accounts[0];
        const chain_id = await readChainHexWC(walletProvider, sessionChainId);

        // READS (wrapped + network-pinned): getPool + slot0 go through the WC
        // session provider's RPC. A failure is CONTAINED here — returned as a
        // neutral status, never thrown loose to the Next error overlay.
        let pool;
        let currentTick;
        try {
            const provider = wcReadProvider(walletProvider, chain_id, sessionChainId);
            const factory = new ethers.Contract(
                UNISWAP_V3_FACTORY,
                ["function getPool(address,address,uint24) view returns (address)"],
                provider,
            );
            pool = await factory.getPool(WMATIC, USDC_E, SWAP_FEE);
            if (!pool || pool === ethers.constants.AddressZero) {
                throw new Error("No Uniswap v3 pool for WMATIC/USDC.e @ fee 500");
            }

            const poolContract = new ethers.Contract(
                pool,
                [
                    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
                ],
                provider,
            );
            const slot0 = await poolContract.slot0();
            currentTick = Number(slot0.tick);
        } catch (readErr) {
            console.warn("provideLiquidityWC pool read failed:", readErr?.message || readErr);
            return readFailed("Couldn't read pool state — check your connection and retry.");
        }

        const base = Math.ceil(currentTick / LP_TICK_SPACING) * LP_TICK_SPACING;
        const tickLower = base + LP_TICK_SPACING * 10;
        const tickUpper = tickLower + LP_TICK_SPACING * 50;

        const amount0Desired = ethers.BigNumber.from(LP_AMOUNT_IN);
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        runtime = {
            transport: "walletconnect",
            ...(chain_id ? { chain_id } : {}),
            from,
            pool,
            current_tick: currentTick,
            tick_lower: tickLower,
            tick_upper: tickUpper,
            deadline,
        };

        const nfpmIface = new ethers.utils.Interface([
            "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        ]);
        const data = nfpmIface.encodeFunctionData("mint", [
            {
                token0: WMATIC,
                token1: USDC_E,
                fee: SWAP_FEE,
                tickLower,
                tickUpper,
                amount0Desired,
                amount1Desired: 0,
                amount0Min: 0,
                amount1Min: 0,
                recipient: from,
                deadline,
            },
        ]);

        const hash = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [
                {
                    from,
                    to: NONFUNGIBLE_POSITION_MANAGER,
                    data,
                    value: amount0Desired.toHexString(),
                },
            ],
        });
        return { hash, runtime };
    } catch (error) {
        if (isUserRejectionErrWC(error)) return { status: "rejected_by_user", runtime };
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * WC twin of the extension `runAuthBypass` (ext/methods.js:760) — the Mobile
 * WalletConnect auth-bypass checks (PERM-002~Mobile locked, PERM-007~Mobile
 * unlocked). Fires the SAME 7-request privileged-RPC batch through the WC session
 * with BYTE-IDENTICAL payloads (shared authBypassParams), and returns the SAME
 * results array the Browser variants record as `wallet_output`.
 *
 * `account` is resolved by the caller (providedAddress → session eth_accounts →
 * persisted). A locked WC session still knows its paired account (a session
 * property), so the payloads stay valid while locked. A dropped/expired session
 * surfaces per request as outcome "session_dropped" — a transport failure to
 * re-pair, distinct from the locked wallet SERVING (resolved) or REFUSING (auth
 * code); only the latter two are the finding.
 */
export const runAuthBypassWC = async (methods, account, declaredChain, walletProvider, sessionChainId, accountSource = null, addChain, control) => {
    const request = (args) => walletProvider.request(args);
    // Numeric domain chainId for the typed-data payload: eth_chainId (session
    // property, no RPC) via readChainHexWC → 137 (these checks are Polygon).
    const hex = await readChainHexWC({ request: (args) => readAuthPreflight(request, args, control) }, sessionChainId);
    let chainId = hex ? parseInt(hex, 16) : NaN;
    if (!Number.isFinite(chainId) || chainId <= 0) chainId = 137;
    const sessionRequest = createAuthSessionRequest(walletProvider, chainId, account, control?.connectionAttempt);
    return runAuthBypassBatch({ request: sessionRequest, methods, account, chainId, addChain, accountSource, control });
};
