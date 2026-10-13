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
    SCAM_DAPP_URL,
    SWAP_AMOUNT_IN,
    SWAP_FEE,
    SWAP_ROUTER_02,
    UNISWAP_V3_FACTORY,
    TEST_ERC20_ABI,
    TEST_ERC20_BYTECODE,
    USDC_E,
    WMATIC,
} from "@/utils/constants";
import Web3 from "web3";
import { buildSiweMismatchMessage, siweMessageRuntime } from "@/utils/signMessages";
import { snapshotError } from "../requestDiagnostics.mjs";
import { ethers } from "ethers";
import EIP_712 from "@/api/openSeaEIP_712.json";
import {
    resolveAuthBypassChainId as resolveSharedAuthBypassChainId,
    runAuthBypassBatch,
} from "@/utils/wallet-methods/authBypassBatch";
import { requestChainSwitch } from "../chainSwitchProbe.mjs";


export const handleSwitchChain = async (chainId, chainName, provider, { signal } = {}) => {
    return requestChainSwitch({ provider, chainId, chainName, transport: "extension", signal });
};

/**
 * Send a minimal-envelope transaction through the injected provider.
 *
 * No dApp-side preflight (eth_call / estimateGas). No gas / nonce / type
 * / fee fields — the wallet fills them and shows its own confirmation
 * UI, which is the observable that WSR-THRE-019 evaluates. With no
 * `type` or fee fields in the envelope, no transaction-type fallback is needed.
 *
 * User rejection returns `{ status: 'rejected_by_user' }` separately from
 * provider/session failures. The tester, not this helper, assesses the result.
 */
export const sendTransactionWithFallback = async (targetAddress, provider, dataMode) => {
    try {
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected");
        }
        const from = accounts[0];

        return await provider.request({
            method: "eth_sendTransaction",
            params: [simpleTransaction(from, targetAddress, dataMode)],
        });
    } catch (error) {
        if (
            error?.code === 4001 ||
            /user (denied|rejected)/i.test(error?.message || "")
        ) {
            return { status: "rejected_by_user" };
        }
        // Preserve the provider's code and nested details for evidence. The UI
        // owns the compact display message; never truncate the original here.
        throw error;
    }
};

export const sendPersonalSign = async (address, provider) => {
    try {
        const msg = `0x${Buffer.from(PERSONAL_SIGN_MESSAGE, "utf8").toString("hex")}`;
        const sign = await provider.request({
            method: "personal_sign",
            params: [msg, address],
        });
        return sign;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

export const sendTypedData = async (address, differentChainId = false, version = "v4", provider) => {
    try {
        // Clone per call — never mutate the shared EIP_712 import.
        // Otherwise PERM-003 (differentChainId=true) leaves domain.chainId
        // mutated for later VERI-006 calls, since the import isn't
        // re-evaluated across client-side nav.
        const typedData = JSON.parse(JSON.stringify(EIP_712));
        // Offerer = connected account (mirrors signPermit's message.owner), set on
        // the CLONE only. A self-authored order drops the foreign-address flag that
        // confounds VERI-006's truncation observation; for PERM-003 it leaves the
        // mismatched chainId as the sole anomaly.
        typedData.message.offerer = address;
        if (differentChainId) {
            typedData.domain.chainId = DIFFERENT_CHAIN_ID;
        }
        const sign = await provider.request({
            method: `eth_signTypedData_${version}`,
            params: [address, JSON.stringify(typedData)],
        });
        return sign;
    } catch (err) {
        console.error("Signing error:", err);
        throw err;
    }
};

export const ethSign = async (address, provider) => {
    try {
        const web3 = new Web3(provider);

        const messageHash = web3.utils.keccak256(PERSONAL_SIGN);

        if (messageHash.length !== 66) {
            throw new Error("Invalid hash length");
        }
        const signature = await provider.request({
            method: "eth_sign",
            params: [address, messageHash],
        });

        return inspectEthSignSignature(address, messageHash, signature);
    } catch (err) {
        const short = err?.message?.split?.("\n")?.[0] || String(err);
        throw new Error(short);
    }
};

export const signInWithEthereum = async (provider) => {
    let runtime;
    try {
        const web3 = new Web3(provider);
        const [address] = await provider.request({ method: "eth_accounts" });
        if (!address) {
            throw new Error("No Ethereum accounts found.");
        }

        const message = buildSiweMismatchMessage(address);
        runtime = { from: address, ...siweMessageRuntime(message), siwe_request: {
            method: "personal_sign", params: [web3.utils.utf8ToHex(message), address, ""],
        } };

        const signature = await web3.eth.personal.sign(message, address, "");
        return { result: signature, runtime };
    } catch (error) {
        console.error("Error signing in with Ethereum:", error);
        const rpcError = !error?.message && error?.error?.message ? error.error : error;
        if (runtime) throw Object.assign(new Error(rpcError?.message ?? String(rpcError)), snapshotError(rpcError), { siweRuntime: runtime });
        throw error;
    }
};

const isUserRejectionErr = (e) =>
    e?.code === 4001 || /user (denied|rejected)/i.test(e?.message || "");

/**
 * Re-open the wallet's connection / permission dialog for the connect
 * checks (THRE-006 / THRE-004 / THRE-001).
 *
 * 1. Prefer `wallet_requestPermissions([{ eth_accounts: {} }])` — on
 *    MetaMask this re-shows the permission prompt WITHOUT disconnecting.
 * 2. Some wallets (e.g. Rainbow) reject that as unsupported (code 4200 /
 *    "method not supported"). Fall back: disconnect the current session,
 *    then `eth_requestAccounts` so the wallet shows its NATIVE connect
 *    prompt. The app's connection layer is Reown AppKit (header connect
 *    control), but this handler runs outside React, so the
 *    disconnect is done at the provider level via `wallet_revokePermissions`
 *    (best-effort — it may itself be unsupported).
 * 3. User rejection (either step) → `{ status: 'rejected_by_user' }`.
 *
 * A SUCCESS is returned as `{ result, runtime: { connect_method } }` so the
 * evidence records the RPC that actually executed — the two paths reach the
 * wallet differently, and reporting the one we tried first (Rainbow rejects it)
 * would document a method that never ran. `result` becomes `wallet_output`.
 *
 * After the fallback path the wallet may be left disconnected; the tester
 * reconnects via the header. Acceptable for a connection check.
 */
const taggedConnection = (result, connect_method) => ({ result, runtime: { connect_method } });

export const requestConnection = async (provider) => {

    // Run again must ALWAYS re-prompt with FRESH evidence. Revoke the existing
    // eth_accounts grant FIRST so wallet_requestPermissions cannot short-circuit
    // and return the already-granted permission (same id + hours-old granted
    // date) without showing a prompt. Best-effort: a wallet that doesn't support
    // revoke still re-prompts on most, and a truly-unsupported requestPermissions
    // takes the eth_requestAccounts fallback below (which needs this revoke too).
    try {
        await provider.request({
            method: "wallet_revokePermissions",
            params: [{ eth_accounts: {} }],
        });
    } catch (revokeErr) {
        // revoke unsupported/failed — proceed; the request below still re-prompts.
        console.warn(
            "wallet_revokePermissions failed:",
            revokeErr?.message || revokeErr
        );
    }

    try {
        const result = await provider.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
        });
        return taggedConnection(result, "wallet_requestPermissions");
    } catch (error) {
        if (isUserRejectionErr(error)) {
            return { status: "rejected_by_user" };
        }

        const unsupported =
            error?.code === 4200 ||
            /not supported|unsupported|method not/i.test(error?.message || "");
        if (!unsupported) {
            const short = error?.message?.split?.("\n")?.[0] || String(error);
            throw new Error(short);
        }

        // wallet_requestPermissions unsupported (e.g. Rainbow): the revoke above
        // already disconnected, so eth_requestAccounts shows the native prompt.
        try {
            const result = await provider.request({ method: "eth_requestAccounts" });
            return taggedConnection(result, "eth_requestAccounts");
        } catch (reqErr) {
            if (isUserRejectionErr(reqErr)) {
                return { status: "rejected_by_user" };
            }
            const short = reqErr?.message?.split?.("\n")?.[0] || String(reqErr);
            throw new Error(short);
        }
    }
};

/**
 * Sign a realistic ERC-20 Permit (EIP-712) for the VERI-004 message-parsing
 * check. Clones the shared PERMIT_EIP712 per call (never mutates the import,
 * mirroring the sendTypedData fix) and sets `message.owner` to the signer.
 */
export const signPermit = async (address, provider) => {
    try {
        const typedData = JSON.parse(JSON.stringify(PERMIT_EIP712));
        typedData.message.owner = address;
        const sign = await provider.request({
            method: "eth_signTypedData_v4",
            params: [address, JSON.stringify(typedData)],
        });
        return sign;
    } catch (err) {
        console.error("Permit signing error:", err);
        throw err;
    }
};

/**
 * personal_sign of a long multi-paragraph message for the VERI-007
 * mandatory-review check (the wallet should force a scroll-to-bottom).
 */
export const signLongMessage = async (address, provider) => {
    try {
        const msg = `0x${Buffer.from(LONG_SIGN_MESSAGE, "utf8").toString("hex")}`;
        const sign = await provider.request({
            method: "personal_sign",
            params: [msg, address],
        });
        return sign;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

/**
 * THRE-003 "Phishing dApp detection" — DOES NOT touch the wallet. Opens the
 * known phishing URL in a new tab so the tester can observe the wallet /
 * browser warning there. Returns a small descriptor for the inline result.
 */
export const openScamUrl = async () => {
    const url = /^https?:\/\//i.test(SCAM_DAPP_URL)
        ? SCAM_DAPP_URL
        : `https://${SCAM_DAPP_URL}`;
    if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener");
    }
    return `Opened ${url} in a new tab. Observe whether your wallet or browser warns/blocks it, then close the tab without interacting.`;
};

// Poll eth_getTransactionReceipt until the deploy is mined, then return the
// deployed contract address. Returns null if it doesn't land within the
// window (the result records the address as pending).
const waitForContractAddress = async (hash, provider, { tries = 30, delayMs = 2000 } = {}) => {
    for (let i = 0; i < tries; i++) {
        const receipt = await provider.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
        });
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
 * VERI-005 shot 1 — deploy the test token. Contract-creation transaction
 * (no `to`) carrying the compiled ERC-20 bytecode. Waits for the receipt and
 * returns `{ hash, contractAddress }` so the approve shot can target the
 * just-deployed token automatically.
 */
export const deployTestErc20 = async (fromAddress, provider) => {
    try {
        const hash = await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: fromAddress, data: TEST_ERC20_BYTECODE, value: "0x0" }],
        });
        const contractAddress = await waitForContractAddress(hash, provider);
        // Runtime provenance — no dApp version can freeze a freshly-deployed
        // address / tx hash, so they belong in THIS run's evidence.
        return {
            hash,
            contractAddress,
            runtime: { tx_hash: hash, deployed_address: contractAddress },
        };
    } catch (error) {
        if (isUserRejectionErr(error)) return { status: "rejected_by_user" };
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * VERI-005 shot 2 — approve a spender on the test token. `approve(spender,
 * amount)` (amount = unlimited) ABI-encoded via an ethers v5 Interface, sent
 * to the explicitly selected token (`tokenAddress`) or USDC.e by default.
 * The observable is the wallet's approval dialog (token / spender /
 * amount clarity).
 */
export const approveTestErc20 = async (fromAddress, tokenAddress, provider) => {
    try {
        const iface = new ethers.utils.Interface(TEST_ERC20_ABI);
        const data = iface.encodeFunctionData("approve", [APPROVE_SPENDER, APPROVE_AMOUNT]);
        // VERI-005 approves the SAME approve(spender, amount) two ways so the
        // tester can compare how the wallet renders a KNOWN token vs an UNKNOWN
        // one: with no tokenAddress → USDC.e (a recognizable Polygon token); with
        // a tokenAddress (the just-deployed custom ERC-20, handed off from the
        // deploy part) → that unknown token. The calldata is identical; only the
        // `to` differs.
        const to = tokenAddress || USDC_E;
        return await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: fromAddress, to, data, value: "0x0" }],
        });
    } catch (error) {
        if (isUserRejectionErr(error)) return { status: "rejected_by_user" };
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * VERI-003 "Transaction simulation" — build a real Uniswap v3 exact-input
 * swap (native MATIC → USDC.e, no approve needed) so the wallet can simulate
 * it before signing. Quote is fetched off-chain via QuoterV2.callStatic to
 * derive amountOutMinimum (0.5% slippage). The tester screenshots the
 * wallet's simulation and rejects. 4001 → rejected_by_user.
 */
export const simulateSwap = async (fromAddress, walletProvider) => {
    // Hoisted so the quote provenance survives into a rejection return.
    let runtime = {};
    try {
        const provider = new ethers.providers.Web3Provider(walletProvider);
        const amountIn = ethers.BigNumber.from(SWAP_AMOUNT_IN);

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
        const amountOut = quote.amountOut ?? quote[0];
        const amountOutMinimum = amountOut.mul(9950).div(10000); // 0.5% slippage
        runtime = {
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
                recipient: fromAddress,
                amountIn,
                amountOutMinimum,
                sqrtPriceLimitX96: 0,
            },
        ]);

        const hash = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [
                {
                    from: fromAddress,
                    to: SWAP_ROUTER_02,
                    data,
                    value: amountIn.toHexString(),
                },
            ],
        });
        return { hash, runtime };
    } catch (error) {
        if (isUserRejectionErr(error)) return { status: "rejected_by_user", runtime };
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};

/**
 * VERI-003 shot 1 — provide SINGLE-SIDED liquidity to the Uniswap v3
 * WMATIC/USDC.e (fee 500) pool. An above-current-tick range is token0-only
 * (WMATIC), and the NonfungiblePositionManager is payable (wraps native POL),
 * so we pay with `value` and need NO ERC-20 approvals. The wallet simulates
 * the mint; the tester screenshots the preview and rejects. 4001 → rejected.
 *
 * Reads the pool (Factory.getPool) + current tick (pool.slot0) via ethers v5,
 * which requires the wallet to already be on Polygon — run ensureChain first.
 */
export const provideLiquidity = async (fromAddress, walletProvider) => {
    // Hoisted so the resolved pool / tick range / deadline survive into a
    // rejection return (they're computed before the mint is sent).
    let runtime = {};
    try {
        const provider = new ethers.providers.Web3Provider(walletProvider);

        const factory = new ethers.Contract(
            UNISWAP_V3_FACTORY,
            ["function getPool(address,address,uint24) view returns (address)"],
            provider,
        );
        const pool = await factory.getPool(WMATIC, USDC_E, SWAP_FEE);
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
        const currentTick = Number(slot0.tick);

        // Above-range window aligned to tickSpacing → single-sided token0 (WMATIC).
        const base = Math.ceil(currentTick / LP_TICK_SPACING) * LP_TICK_SPACING;
        const tickLower = base + LP_TICK_SPACING * 10;
        const tickUpper = tickLower + LP_TICK_SPACING * 50;

        const amount0Desired = ethers.BigNumber.from(LP_AMOUNT_IN);
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        runtime = {
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
                recipient: fromAddress,
                deadline,
            },
        ]);

        const hash = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [
                {
                    from: fromAddress,
                    to: NONFUNGIBLE_POSITION_MANAGER,
                    data,
                    value: amount0Desired.toHexString(),
                },
            ],
        });
        return { hash, runtime };
    } catch (error) {
        if (isUserRejectionErr(error)) return { status: "rejected_by_user", runtime };
        const short = error?.message?.split?.("\n")?.[0] || String(error);
        throw new Error(short);
    }
};


/**
 * Auth-Bypass batch (WSR-PERM-010/002/008 ~Browser, PERM-004 part 2). Delegates
 * to the shared transport-agnostic batch so the extension no longer keeps a
 * hand-mirrored copy that can drift from the WalletConnect twin — the payloads,
 * the outcome vocabulary ("resolved" / "declined" / "empty" / "unstable" /
 * "no_response" / "rejected" / "error (internal)") and the eth_accounts
 * stability polling all live in authBypassBatch.js now.
 *
 * Every request uses the provider captured by the dispatcher, even if the
 * tester selects another extension while a read or prompt is pending.
 *
 * `classifySessionDrops: false` — session-drop classification is WalletConnect
 * transport semantics and must not relabel an injected wallet's refusal.
 * `addChain` is the step's add-chain preset (default Taiko); `accountSource`
 * records where the address came from.
 */
export const runAuthBypass = async (methods, account, declaredChain, accountSource = null, addChain, control, provider) => {
    const request = (args) => provider.request(args);
    const chainId = await resolveSharedAuthBypassChainId(request, declaredChain, control);
    return runAuthBypassBatch({
        request,
        methods,
        account,
        chainId,
        addChain,
        classifySessionDrops: false,
        accountSource,
        control,
    });
};
