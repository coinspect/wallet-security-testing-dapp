import {
    chains,
    familiarRecipientAddress,
    CHECKSUM_PROBE_BAD_CHECKSUM,
    poisonAddress,
    scamAddress,
    targets,
    unknownAddress,
    TEST_ERC20_ADDRESS,
    TESTER_WALLET_1,
    TESTER_WALLET_2,
} from "@/utils/constants";
import { ensureChain } from "./chain";
import { polygonGuardedProvider } from './polygonPolicy.mjs';
import { readAuthPreflight } from "./authRunControl.mjs";
import { withRequestDiagnostics } from "./requestDiagnostics.mjs";
import {
    nonSelfTarget,
    resolveAccountSource,
    resolveTargetAddress,
} from "./addressBoundary.mjs";
import {
    approveTestErc20WC,
    deployTestErc20WC,
    ethSignWC,
    handleSwitchChainWC,
    provideLiquidityWC,
    requestConnectionWC,
    runAuthBypassWC,
    sendPersonalSignWC,
    sendTransaction,
    sendTypedDataWC,
    signLongMessageWC,
    signPermitWC,
    simulateSwapWC,
} from "./wc/methods";
import {
    approveTestErc20,
    deployTestErc20,
    ethSign,
    handleSwitchChain,
    openScamUrl,
    provideLiquidity,
    requestConnection,
    runAuthBypass,
    sendPersonalSign,
    sendTransactionWithFallback,
    sendTypedData,
    signInWithEthereum,
    signLongMessage,
    signPermit,
    simulateSwap,
} from "./ext/methods";

// Truthy if ensureChain returned a "landed" result — i.e. the wallet
// is on the target chain (either already or after a successful switch).
// A `status` field means chain_switch was rejected / chain_read failed;
// in either case we must NOT proceed to the send.
const chainLanded = (r) => r && r.status === undefined;

// Resolve wizard-declared `params.target` (string key) against the
// `targets` catalog, with the caller's hardcoded constant as a
// belt-and-suspenders fallback when the key is missing or unresolved.
//
// `params.targetAddress` — a raw address picked from a DOCUMENTED pool (e.g.
// THRE-005's unknown-address candidates) — wins when present. It is never free
// text: the wizard only ever supplies a candidate from the frozen registry.
const resolveTarget = (params, fallback) => {
    return resolveTargetAddress({ params, catalog: targets, fallback });
};

// One send per invocation. Format changes are explicitly tester-selected,
// never an automatic retry after an ambiguous provider error.
const sendRecipientTransaction = async (platform, params, fallback, provider) => {
    const dataMode = params.__transactionDataMode ?? "explicit_empty_data";
    const execute = async (request) => {
        if (params.chain) {
            const chainResult = await ensureChain(params.chain, provider, request);
            if (!chainLanded(chainResult)) return chainResult;
        }
        const to = resolveTarget(params, fallback);
        if (platform === "mobile") return sendTransaction(to, provider, params?.__wcChainId, request, dataMode);
        if (platform === "extension") return sendTransactionWithFallback(to, provider, dataMode);
        throw new Error(`Unknown platform: ${platform}`);
    };
    return platform === "mobile" ? withRequestDiagnostics(provider, execute, dataMode) : execute();
};

export const handleAction = async (platform, action, provider, params = {}, authControl, requestOptions) => {
    if (typeof action !== "string" || action.trim() === "") {
        throw new Error(`Unknown action: ${String(action)}`);
    }
    // PERM-009 intentionally sends a different target network. Its separate
    // probe checks the Polygon starting state, then preserves the switch result.
    if (action !== 'switchChains' && action !== 'openScamUrl') provider = polygonGuardedProvider(provider);
    switch (action) {
            case "sendScamTransaction": {
                return sendRecipientTransaction(platform, params, scamAddress, provider);
            }
            case "sendPoisonTransaction": {
                return sendRecipientTransaction(platform, params, poisonAddress, provider);
            }
            case "sendFamiliarRecipientTransaction": {
                // THRE-002 SETUP — the ONE send in this check the tester APPROVES.
                // Establishes real send-history to the familiar recipient so the
                // poison lookalike (same first/last 4 chars) has a prior contact to
                // imitate; without it a history-based poisoning heuristic has nothing
                // to warn against — a false negative. Minimal envelope (value 0x0):
                // the SAME shape every other send here uses, only the target and the
                // approve-vs-reject intent differ.
                return sendRecipientTransaction(platform, params, familiarRecipientAddress, provider);
            }
            case "sendUnknownTransaction": {
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, provider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                const to = resolveTarget(params, unknownAddress);
                if (platform === "mobile") {
                    return await sendTransaction(to, provider, params?.__wcChainId, undefined, params.__transactionDataMode);
                } else if (platform === "extension") {
                    return await sendTransactionWithFallback(to, provider, params.__transactionDataMode);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "sendInvalidChecksumTransaction": {
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, provider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                const to = resolveTarget(params, CHECKSUM_PROBE_BAD_CHECKSUM);
                if (platform === "mobile") {
                    return await sendTransaction(to, provider, params?.__wcChainId, undefined, params.__transactionDataMode);
                } else if (platform === "extension") {
                    return await sendTransactionWithFallback(to, provider, params.__transactionDataMode);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "sendExplorerLinkTransaction": {
                // VERI-002 — open a confirmation screen to inspect for clickable
                // block-explorer links, then reject. Minimal envelope to a tester
                // wallet; NO chain gate (explorer links show on any network).
                const target = resolveTarget(params, TESTER_WALLET_2);
                if (platform === "mobile" || platform === "extension") {
                    // Apply the same non-self invariant to both transports. Reading
                    // the account does not submit or sign anything.
                    const method = platform === "mobile" ? "eth_requestAccounts" : "eth_accounts";
                    const [from] = await provider.request({ method });
                    const to = nonSelfTarget(target, from, [TESTER_WALLET_1, TESTER_WALLET_2]);
                    if (platform === "mobile") {
                        return await sendTransaction(to, provider, params?.__wcChainId, undefined, params.__transactionDataMode);
                    }
                    return await sendTransactionWithFallback(to, provider, params.__transactionDataMode);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "clearMethodSignRequest":
                if (platform === "mobile") {
                    const results = {};

                    try {
                        results.personalSign = await sendPersonalSignWC(provider);
                    } catch (error) {
                        console.log("Personal sign failed:", error.message);
                        results.personalSign = { error: error.message };
                    }

                    try {
                        results.typedData = await sendTypedDataWC(provider);
                    } catch (error) {
                        console.log("Typed data sign failed:", error.message);
                        results.typedData = { error: error.message };
                    }

                    // Third request: the ERC-2612 permit (PERMIT_EIP712, chainId 137,
                    // owner = connected account) — the SAME payload signPermit sends,
                    // reused (no new copy). Wrapped so its rejection doesn't swallow
                    // the earlier legs' evidence.
                    try {
                        results.permit = await signPermitWC(provider, params?.__wcChainId);
                    } catch (error) {
                        console.log("Permit sign failed:", error.message);
                        results.permit = { error: error.message };
                    }
                    return results;
                } else if (platform === "extension") {
                    // Ask the wallet for the connected account instead of
                    // reading provider.selectedAddress (empty on some
                    // wallets, e.g. Rainbow). The dispatch guard already
                    // ensured eth_accounts is non-empty.
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    const results = {};

                    try {
                        results.personalSign = await sendPersonalSign(account, provider);
                    } catch (error) {
                        console.log("Personal sign failed:", error.message);
                        results.personalSign = { error: error.message };
                    }

                    try {
                        results.typedData = await sendTypedData(account, false, "v4", provider);
                    } catch (error) {
                        console.log("Typed data sign failed:", error.message);
                        results.typedData = { error: error.message };
                    }

                    // Third request: the ERC-2612 permit (PERMIT_EIP712, chainId 137,
                    // owner = connected account) — the SAME payload signPermit sends,
                    // reused (no new copy). Wrapped so its rejection doesn't swallow
                    // the earlier legs' evidence.
                    try {
                        results.permit = await signPermit(account, provider);
                    } catch (error) {
                        console.log("Permit sign failed:", error.message);
                        results.permit = { error: error.message };
                    }

                    // Format results into a nice readable message
                    const formatResult = (label, result) => {
                        if (result.error) {
                            return `❌ ${label}: ${result.error}`;
                        } else {
                            const signature =
                                typeof result === "object"
                                    ? `Signature: ${result.signature || JSON.stringify(result)}`
                                    : `Signature: ${result}`;
                            return `✅ ${label}: Success\n   ${signature}`;
                        }
                    };

                    const personalSignResult = formatResult("Personal Sign", results.personalSign);
                    const typedDataResult = formatResult("Typed Data (Seaport)", results.typedData);
                    const permitResult = formatResult("Typed Data (Permit)", results.permit);

                    return `🔐 Signing Test Results:\n\n${personalSignResult}\n\n${typedDataResult}\n\n${permitResult}`;
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "ethSignMethod":
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await ethSign(account, provider);
                } else if (platform === "mobile") {
                    return await ethSignWC(provider);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "differentChainId":
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await sendTypedData(account, true, "v4", provider);
                } else if (platform === "mobile") {
                    return await sendTypedDataWC(provider, true);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "siweSign":
                if (platform === "extension") {
                    return await signInWithEthereum(provider);
                } else if (platform === "mobile") {
                    return await sendPersonalSignWC(provider, true);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "switchChains": {
                // Target chain comes from the sub-step's `switchTo` (a chains-catalog
                // key documented in the registry), never hardcoded in the handler —
                // so PERM-009 part 1 targets a common chain (prompt observable) and
                // part 2 an uncommon one (4902 observable). Same hex to both
                // transports → byte-identical payload.
                const target = chains[params?.switchTo] ?? chains.zksync;
                const targetChainId = target.chainId;
                const targetChainName = target.chainName;
                if (platform === "extension") {
                    return await handleSwitchChain(targetChainId, targetChainName, provider, requestOptions);
                } else if (platform === "mobile") {
                    return await handleSwitchChainWC(provider, targetChainId, targetChainName, requestOptions);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "requestConnection":
                if (platform === "extension") {
                    return await requestConnection(provider);
                } else if (platform === "mobile") {
                    // WC twin: `provider` is the walletProvider the panel handed
                    // down; params.__wcChainId is the numeric session chainId used
                    // to normalize runtime.chain_id to the extension's hex form.
                    return await requestConnectionWC(provider, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "signPermit":
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await signPermit(account, provider);
                } else if (platform === "mobile") {
                    return await signPermitWC(provider, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            // VERI-004 — fires BOTH EIP-712 payloads (ERC-2612 permit + Seaport
            // order) so the wallet's structured-parsing is exercised on a flat
            // permit AND a nested order. REUSES the existing signPermit/sendTypedData
            // handlers and the shared PERMIT_EIP712 / EIP_712 blobs (both chainId
            // 137, cloned per call) — no new payload. Each leg wrapped so one
            // rejection doesn't swallow the other's evidence, mirroring
            // clearMethodSignRequest. It deliberately does NOT fire personal_sign,
            // keeping VERI-004 about EIP-712 parsing (distinct from VERI-006).
            case "signPermitAndSeaport":
                if (platform === "mobile") {
                    const results = {};

                    try {
                        results.permit = await signPermitWC(provider, params?.__wcChainId);
                    } catch (error) {
                        console.log("Permit sign failed:", error.message);
                        results.permit = { error: error.message };
                    }

                    try {
                        results.seaport = await sendTypedDataWC(provider);
                    } catch (error) {
                        console.log("Seaport typed data sign failed:", error.message);
                        results.seaport = { error: error.message };
                    }
                    return results;
                } else if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    const results = {};

                    try {
                        results.permit = await signPermit(account, provider);
                    } catch (error) {
                        console.log("Permit sign failed:", error.message);
                        results.permit = { error: error.message };
                    }

                    try {
                        results.seaport = await sendTypedData(account, false, "v4", provider);
                    } catch (error) {
                        console.log("Seaport typed data sign failed:", error.message);
                        results.seaport = { error: error.message };
                    }

                    const formatResult = (label, result) => {
                        if (result.error) {
                            return `❌ ${label}: ${result.error}`;
                        } else {
                            const signature =
                                typeof result === "object"
                                    ? `Signature: ${result.signature || JSON.stringify(result)}`
                                    : `Signature: ${result}`;
                            return `✅ ${label}: Success\n   ${signature}`;
                        }
                    };

                    const permitResult = formatResult("Permit (EIP-712)", results.permit);
                    const seaportResult = formatResult("Seaport order (EIP-712)", results.seaport);

                    return `🔐 Signing Test Results:\n\n${permitResult}\n\n${seaportResult}`;
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "signLongMessage":
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await signLongMessage(account, provider);
                } else if (platform === "mobile") {
                    return await signLongMessageWC(provider, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            // VERI-007 — mirrors clearMethodSignRequest's single-action, two-signature
            // structure: ONE fire opens a large personal_sign (LONG_SIGN_MESSAGE) then a
            // large eth_signTypedData_v4 (the shared Seaport blob, reused via sendTypedData
            // — never copied), so the tester can observe scroll-gating on BOTH. The
            // criteria score eth_signTypedData and ignore personal_sign; firing only
            // personal_sign (the old signLongMessage) produced nothing scorable. Each leg
            // is wrapped so one rejection doesn't swallow the other's evidence.
            case "signLongMessageAndTypedData":
                if (platform === "mobile") {
                    const results = {};

                    try {
                        results.personalSign = await signLongMessageWC(provider, params?.__wcChainId);
                    } catch (error) {
                        console.log("Long personal sign failed:", error.message);
                        results.personalSign = { error: error.message };
                    }

                    try {
                        results.typedData = await sendTypedDataWC(provider);
                    } catch (error) {
                        console.log("Typed data sign failed:", error.message);
                        results.typedData = { error: error.message };
                    }
                    return results;
                } else if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    const results = {};

                    try {
                        results.personalSign = await signLongMessage(account, provider);
                    } catch (error) {
                        console.log("Long personal sign failed:", error.message);
                        results.personalSign = { error: error.message };
                    }

                    try {
                        results.typedData = await sendTypedData(account, false, "v4", provider);
                    } catch (error) {
                        console.log("Typed data sign failed:", error.message);
                        results.typedData = { error: error.message };
                    }

                    const formatResult = (label, result) => {
                        if (result.error) {
                            return `❌ ${label}: ${result.error}`;
                        } else {
                            const signature =
                                typeof result === "object"
                                    ? `Signature: ${result.signature || JSON.stringify(result)}`
                                    : `Signature: ${result}`;
                            return `✅ ${label}: Success\n   ${signature}`;
                        }
                    };

                    const personalSignResult = formatResult(
                        "Long Message (personal_sign)",
                        results.personalSign
                    );
                    const typedDataResult = formatResult(
                        "Typed Data (eth_signTypedData_v4)",
                        results.typedData
                    );

                    return `🔐 Signing Test Results:\n\n${personalSignResult}\n\n${typedDataResult}`;
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            case "openScamUrl":
                // Browser-only navigation — never touches the wallet, so no
                // platform branching.
                return await openScamUrl();
            case "deployTestErc20": {
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, provider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await deployTestErc20(account, provider);
                } else if (platform === "mobile") {
                    return await deployTestErc20WC(provider, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "approveTestErc20": {
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, provider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                // VERI-005 approves the SAME approve(spender, amount) two ways so
                // the tester compares a KNOWN vs an UNKNOWN token: `useTestToken`
                // targets WSRT (TEST_ERC20_ADDRESS — a deployed token the wallet
                // has no metadata for); otherwise the handler defaults to USDC.e.
                const tokenAddress = params.useTestToken ? TEST_ERC20_ADDRESS : params.tokenAddress;
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await approveTestErc20(account, tokenAddress, provider);
                } else if (platform === "mobile") {
                    return await approveTestErc20WC(provider, tokenAddress, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "simulateSwap": {
                // Run ensureChain BEFORE the handler so the swap AND its
                // off-chain QuoterV2 quote (which reads the wallet's chain via
                // Web3Provider) both target Polygon.
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, provider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await simulateSwap(account, provider);
                } else if (platform === "mobile") {
                    return await simulateSwapWC(provider, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "provideLiquidity": {
                // ensureChain BEFORE the handler so the Factory/pool reads AND
                // the mint both target Polygon.
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, provider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                if (platform === "extension") {
                    const [account] = await provider.request({ method: "eth_accounts" });
                    if (!account) throw new Error("No connected account");
                    return await provideLiquidity(account, provider);
                } else if (platform === "mobile") {
                    return await provideLiquidityWC(provider, params?.__wcChainId);
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }
            case "runAuthBypass": {
                const authProvider = { request: (args) => readAuthPreflight((payload) => provider.request(payload), args, authControl) };
                // Optional ensureChain (only the connected PERM-010 declares a
                // chain; the locked/disconnected checks can't switch anyway).
                if (params.chain) {
                    const chainResult = await ensureChain(params.chain, authProvider);
                    if (!chainLanded(chainResult)) return chainResult;
                }
                if (platform === "extension") {
                    // Resolution order: tester-provided (PERM-008) → connected
                    // account → persisted last-known address → null. For the
                    // LOCKED check eth_accounts is empty, so the persisted
                    // address is what builds valid per-method params (a null
                    // account would malform 5 of 7 requests and make the wallet
                    // error on the payload instead of at the auth gate).
                    let connected = null;
                    if (!params.providedAddress) {
                        try {
                            const [a] = await authProvider.request({ method: "eth_accounts" });
                            connected = a ?? null;
                        } catch (error) {
                            if (error?.authSetupStopped) throw error;
                            connected = null;
                        }
                    }
                    let persisted = null;
                    if (!params.providedAddress && !connected && typeof window !== "undefined") {
                        try {
                            persisted = window.localStorage.getItem("wizard.lastAddress") || null;
                        } catch {
                            persisted = null;
                        }
                    }
                    const { account, accountSource } = resolveAccountSource({
                        provided: params.providedAddress,
                        connected,
                        persisted,
                    });
                    if (!account) throw new Error("No valid account is available for the auth-bypass payloads");
                    return await runAuthBypass(params.methods, account, params.chain, accountSource, params.addChain, authControl, provider);
                } else if (platform === "mobile") {
                    // Resolve the account (providedAddress → session eth_accounts →
                    // persisted last-known), mirroring the extension. A locked WC
                    // session still knows its paired account, so the batch payloads
                    // stay valid while the wallet app is locked.
                    let connected = null;
                    if (!params.providedAddress) {
                        try {
                            const [a] = await authProvider.request({ method: "eth_accounts" });
                            connected = a ?? null;
                        } catch (error) {
                            if (error?.authSetupStopped) throw error;
                            connected = null;
                        }
                    }
                    let persisted = null;
                    if (!params.providedAddress && !connected && typeof window !== "undefined") {
                        try {
                            persisted = window.localStorage.getItem("wizard.lastAddress") || null;
                        } catch {
                            persisted = null;
                        }
                    }
                    const { account, accountSource } = resolveAccountSource({
                        provided: params.providedAddress,
                        connected,
                        persisted,
                    });
                    if (!account) throw new Error("No valid account is available for the auth-bypass payloads");
                    return await runAuthBypassWC(
                        params.methods,
                        account,
                        params.chain,
                        provider,
                        params?.__wcChainId,
                        accountSource,
                        params.addChain,
                        authControl,
                    );
                } else {
                    throw new Error(`Unknown platform: ${platform}`);
                }
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
};
