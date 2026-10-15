import testTokenArtifact from "@/app/wizard/config/test-token-artifact.json";
import OPENSEA_EIP712 from "@/api/openSeaEIP_712.json";
import { ethers } from "ethers";
import {
    buildAddEthereumChain,
    buildWatchAsset,
    buildWizardAuthBypassRequest,
    AUTH_BYPASS_PLACEHOLDER_CIPHERTEXT,
    ETH_DECRYPT_PLACEHOLDER_NOTE,
} from "@/utils/wallet-methods/authBypassPayloads";
import { DEFAULT_SEND_TO, LONG_SIGN_MESSAGE, SIWE_FAKE_DOMAIN } from "./signMessages";

export const txOptions = {
    default: DEFAULT_SEND_TO,
    scam: "0x873050043AF661fE9d5611369B10139eB7B4Da54",
    checksum: "0x6603E7c1F985D0E75C9C326e86E6C7E8a1898577",
    tornadoScam: "0x592340957eBC9e4Afb0E9Af221d06fDDDF789de9",
    ens: "0x225f137127d9067788314bc7fcc1f36746a3c3B5",
    unknown: "0xcd75f32FB6f10857F97DdDdf22102716E9335554",
    poison: "0x8730aeb8FE951cfa6e17f82341ECD95C921FDa54",
};

// Bug-fix in transit: the `unknownAddress` alias historically pointed at
// `txOptions.default` (0x873050…Da54), which is NOT the canonical unknown
// target. Repointing to `txOptions.unknown` (0xcd75f32…5554) so
// sendUnknownTransaction actually targets an address the wallet has never
// seen. Only two external consumers exist (actionMethods.js import + the
// `targets` re-aggregation below); test cards read `txOptions.default`
// directly and are unaffected.
export const {
    unknown: unknownAddress,
    tornadoScam: scamAddress,
    checksum: invalidChecksumAddress,
    ens: ensAddress,
    poison: poisonAddress,
    // The previously-used recipient THRE-002's poison lookalike imitates (same
    // first/last 4 chars, 8730…Da54). THRE-002's setup send establishes real
    // history to it so a history-based poisoning heuristic has a match.
    default: familiarRecipientAddress,
} = txOptions;

export const SWITCH_CHAINS_PARAMS = {
    chainName: "zkSync Era Mainnet",
    chainId: "0x144",
    nativeCurrencyName: "ETH",
    symbol: "ETH",
    nativeCurrencyDecimals: 18,
    rpcUrl: "https://mainnet.era.zksync.io",
    blockExplorerUrl: "https://explorer.zksync.io/",
};

export const SWITCH_CHAINS_PARAMS_2 = {
    chainName: "Polygon Mainnet",
    chainId: "0x89",
    nativeCurrencyName: "MATIC",
    symbol: "MATIC",
    rpcUrl: "https://polygon-rpc.com",
    blockExplorerUrl: "https://polygonscan.com/",
};

// ── Auth-bypass wallet_addEthereumChain targets (EIP-3085) ───────────────────
// The auth-bypass batch fires wallet_addEthereumChain as one of its seven
// privileged requests. If the chain is one wallets ship PRECONFIGURED, a wallet
// answers with a no-op ("already have it") and the row measures nothing about the
// authorization gate. So the target must be a chain wallets do NOT preconfigure —
// then the request is a genuine add and the wallet's authorization behaviour is
// what is observed. NOTE: this is deliberately SEPARATE from
// POLYGON_ADD_CHAIN_PARAMS below, which is real infrastructure (the network gate's
// 4902 fallback) and must keep adding Polygon with a working RPC.
//
// chainId hex ⇄ decimal verified: 0x28C58 = 167000 · 0x76ADF1 = 7777777 · 0x144 = 324.
// Each rpcUrl was probed with eth_chainId and returned its own chainId.
export const ADD_CHAIN_TAIKO = {
    chainId: "0x28C58", // 167000
    chainName: "Taiko Mainnet",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.taiko.xyz"],
    blockExplorerUrls: ["https://taikoscan.io"],
};

export const ADD_CHAIN_ZORA = {
    chainId: "0x76ADF1", // 7777777
    chainName: "Zora",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.zora.energy"],
    blockExplorerUrls: ["https://explorer.zora.energy"],
};

// zkSync Era — the chain the batch has been sending all along. Derived from
// SWITCH_CHAINS_PARAMS (PERM-009's switch target) so the literals stay in one
// place; kept as an alternate, not the primary.
export const ADD_CHAIN_ZKSYNC = {
    chainId: SWITCH_CHAINS_PARAMS.chainId, // 0x144 / 324
    chainName: SWITCH_CHAINS_PARAMS.chainName,
    nativeCurrency: {
        name: SWITCH_CHAINS_PARAMS.nativeCurrencyName,
        symbol: SWITCH_CHAINS_PARAMS.symbol,
        decimals: 18,
    },
    rpcUrls: [SWITCH_CHAINS_PARAMS.rpcUrl],
    blockExplorerUrls: [SWITCH_CHAINS_PARAMS.blockExplorerUrl],
};

// Taiko is the PRIMARY (least commonly preconfigured). Zora and zkSync Era are
// documented alternates: a check whose wallet already ships Taiko declares
// `addChain: "zora"` (or "zksync") in its data.params — no picker UI, just a
// parameter. Unknown/absent keys fall back to the primary.
export const ADD_CHAIN_PRESETS = {
    taiko: ADD_CHAIN_TAIKO,
    zora: ADD_CHAIN_ZORA,
    zksync: ADD_CHAIN_ZKSYNC,
};
export const DEFAULT_ADD_CHAIN = "taiko";
export const resolveAddChain = (key) => ADD_CHAIN_PRESETS[key] ?? ADD_CHAIN_PRESETS[DEFAULT_ADD_CHAIN];

// EIP-3085 params for wallet_addEthereumChain — the fallback the wizard's
// network gate uses when wallet_switchEthereumChain returns 4902 (Polygon not
// yet known to the wallet). Derived from SWITCH_CHAINS_PARAMS_2 so the literals
// live in one place.
export const POLYGON_ADD_CHAIN_PARAMS = {
    chainId: SWITCH_CHAINS_PARAMS_2.chainId,
    chainName: SWITCH_CHAINS_PARAMS_2.chainName,
    nativeCurrency: {
        name: SWITCH_CHAINS_PARAMS_2.nativeCurrencyName,
        symbol: SWITCH_CHAINS_PARAMS_2.symbol,
        decimals: 18,
    },
    rpcUrls: [SWITCH_CHAINS_PARAMS_2.rpcUrl],
    blockExplorerUrls: [SWITCH_CHAINS_PARAMS_2.blockExplorerUrl],
};

export const PERSONAL_SIGN_MESSAGE =
    "On the other hand, we denounce with righteous indignation and dislike men who are so beguiled and demoralized by the charms of pleasure of the moment, so blinded by desire, that they cannot foresee the pain and trouble that are bound to ensue; and equal blame belongs to those who fail in their duty through weakness of will, which is the same as saying through shrinking from toil and pain. These cases are perfectly simple and easy to distinguish. In a free hour, when our power of choice is untrammelled and when nothing prevents our being able to do what we like best, every pleasure is to be welcomed and every pain avoided. But in certain circumstances and owing to the claims of duty or the obligations of business it will frequently occur that pleasures have to be repudiated and annoyances accepted. The wise man therefore always holds in these matters to this principle of selection: he rejects pleasures to secure other greater pleasures, or else he endures pains to avoid worse pains. At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat. But I must explain to you how all this mistaken idea of denouncing pleasure and praising pain was born and I will give you a complete account of the system, and expound the actual teachings of the great explorer of the truth, the master-builder of human happiness. No one rejects, dislikes, or avoids pleasure itself, because it is pleasure, but because those who do not know how to pursue pleasure rationally encounter consequences that are extremely painful. Nor again is there anyone who loves or pursues or desires to obtain pain of itself, because it is pain, but because occasionally circumstances occur in which toil and pain can procure him some great pleasure. To take a trivial example, which of us ever undertakes laborious physical exercise, except to obtain some advantage from it? But who has any right to find fault with a man who chooses to enjoy a pleasure that has no annoying consequences, or one who avoids a pain that produces no resultant pleasure?";

export const PERSONAL_SIGN = "Example `personal_sign` message";
export const DIFFERENT_CHAIN_ID = "1223123";

// Shared test Permit: the claimed USD Coin name deliberately does NOT match
// verifyingContract (a fixed random address, not USDC). This tests whether the
// wallet trusts the supplied name. All signing/auth-bypass uses share it.
// `message.owner` is set on a per-call clone; the template is never mutated.
export const PERMIT_EIP712 = {
    domain: {
        name: "USD Coin (PoS)",
        version: "1",
        chainId: 137,
        verifyingContract: "0xC08f20F90193C1124C83d0237374e91f910ea64e",
    },
    types: {
        EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
        ],
        Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
        ],
    },
    primaryType: "Permit",
    message: {
        owner: "0x0000000000000000000000000000000000000000",
        spender: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        value: "1000000000000000000000",
        nonce: "0",
        deadline: "1893456000",
    },
};

// LONG_SIGN_MESSAGE now lives in the neutral ./signMessages module (so the
// auth-bypass builder can import it without a circular dependency on constants).
// Imported for local use in the registry below AND re-exported, so every existing
// `import { LONG_SIGN_MESSAGE } from "@/utils/constants"` keeps working.
export { LONG_SIGN_MESSAGE };

// THRE-003 "Phishing dApp detection" — the URL opened in a new tab (this
// check documents + hands off; the wizard origin can't be blocklisted).
export const SCAM_DAPP_URL = "https://cryptocom-wallet-review.com";

// The testing dApp's own origin is a RUNTIME fact, not a frozen constant: it is
// whatever domain the wizard is actually served from. Resolve it from the browser
// so the params popover and the evidence `parameters` always agree with
// runtime.dapp_origin — no hardcoded deploy URL that goes stale when the domain
// changes. Backs the `siwe_true_domain` and `testing_dapp_origin` rows.
export const getDappOrigin = () =>
    typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : null;

// Resolve a registry row's display value: rows flagged `runtimeOrigin` yield the
// LIVE dApp origin (falling back to the row's placeholder before the browser is
// available); every other row is its static `value`.
export const resolveParamValue = (row) =>
    row?.runtimeOrigin ? (getDappOrigin() ?? row.value) : row?.value;

// VERI-005 "Clear token approval dialog" — deploy a test token, then approve
// a spender, observing whether the wallet clearly shows token/spender/amount.
//
// Real minimal ERC-20 — contracts/WSRTestToken.sol, compiled to
// test-token-artifact.json by `npm run compile:token` (solc 0.8.25). Deploying
// this creates a functional token so the wallet can simulate it, and the ABI
// carries the standard `approve`/`Transfer`/`Approval` fragments so the
// approval dialog renders legibly. Compiled at build time — never at runtime.
export const TEST_ERC20_BYTECODE = testTokenArtifact.bytecode;
export const TEST_ERC20_ABI = testTokenArtifact.abi;
// TODO(tester): after running "Deploy Test Token" (shot 1), read the deployed
// contract address from the tx receipt (`contractAddress`) and paste it here
// so "Approve Spender" (shot 2) targets the real token.
export const TEST_ERC20_ADDRESS = "0x068c3e0aa004dd2abd8b2dae90b3a3848946bd49";
export const APPROVE_SPENDER = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // Uniswap V3 SwapRouter
export const APPROVE_AMOUNT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; // max uint256 (unlimited)

// VERI-003 "Transaction simulation" — a native-MATIC → USDC.e exact-input
// swap on Uniswap v3 (Polygon). Quoted off-chain, then sent for the wallet to
// simulate; the tester screenshots the preview and rejects.
export const SWAP_ROUTER_02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
export const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
export const WMATIC = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const SWAP_FEE = 500;
export const SWAP_AMOUNT_IN = "10000000000000000"; // 0.01 MATIC (wei)

// VERI-003 shot 1 — provide SINGLE-SIDED WMATIC liquidity into the same
// Uniswap v3 pool (fee 500). A tick range entirely ABOVE the current price is
// token0-only (WMATIC, since WMATIC < USDC.e), and the
// NonfungiblePositionManager is payable + wraps native POL, so NO ERC-20
// approvals are needed — we pay with `value`.
export const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
export const NONFUNGIBLE_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
export const LP_TICK_SPACING = 10; // fee 500 → tickSpacing 10
export const LP_AMOUNT_IN = "10000000000000000"; // ~0.01 POL (wei)

/**
 * Wizard params catalogs — resolved by string key from wizard.json's
 * `data.params.{target,chain}` blocks. Reuse the existing objects; no
 * data duplication.
 *
 * Shape note: `polygon` and `zksync` reference the legacy denormalized
 * SWITCH_CHAINS_PARAMS(_2) objects (top-level `nativeCurrencyName` /
 * `symbol` / `rpcUrl` / `blockExplorerUrl` — not the nested
 * EIP-3085 shape). Only `chainId` + `chainName` are read by the wizard
 * params panel, so no normalization is done here. A future consumer
 * that wants to pass one of these to `wallet_addEthereumChain` should
 * reshape at the call site (or refactor here and update the
 * wallet-methods/* consumers together).
 */
export const chains = {
    mainnet: { chainId: "0x1", chainName: "Ethereum Mainnet" },
    polygon: SWITCH_CHAINS_PARAMS_2,
    zksync:  SWITCH_CHAINS_PARAMS,
};

// Tester wallets — the recipients VERI-002 sends its 0-value probe tx to, so the
// confirmation screen has an address/identifier to inspect for explorer links.
// TESTER_WALLET_2 is the default target; TESTER_WALLET_1 is the fallback used
// when the connected account IS wallet 2 (avoids a self-send where the wallet
// shows the same address twice). Named here so the registry entries and the send
// action share one literal each.
export const TESTER_WALLET_1 = "0xfF501B324DC6d78dC9F983f140B9211c3EdB4dc7";
export const TESTER_WALLET_2 = "0x462A0d4fE4C2b10aadFBD4628f697d09a76Cd954";

// A FIXED, arbitrary recipient for VERI-001's checksum-DISPLAY probe. Deliberately
// NOT a tester wallet and NOT any contract/token we reference: a wallet nicknames a
// recipient it knows ("To Wallet 2 / Account 1") and then hides the address string —
// but this check is ENTIRELY about whether the tester can see the address CASING, so
// the recipient must be one the wallet has no name for, forcing it to render the raw
// hex. Derived as the last 20 bytes of keccak256("coinspect.wsr.veri-001.checksum-
// probe.v1") — a hash point with no known private key and no deployed code, so it
// carries no ENS or explorer label and is owned by no one. Frozen here as a literal
// (version-stable, documentable); verified not to collide with any address in this file.
export const CHECKSUM_PROBE_ADDRESS = "0x02970ea171a97eb0D627cb7ec9abAc308253c716";

// The same address with its EIP-55 checksum deliberately BROKEN — every alphabetic
// hex digit's case inverted, so it fails the checksum while remaining the SAME
// underlying address. VERI-001 sends 0 value here so the tester can observe whether
// the wallet warns, blocks, silently re-checksums the casing, or shows it as-is.
// Derived (not a hand-typed literal) so it stays in sync with CHECKSUM_PROBE_ADDRESS.
export const CHECKSUM_PROBE_BAD_CHECKSUM =
    "0x" +
    [...CHECKSUM_PROBE_ADDRESS.slice(2)]
        .map((ch) => (/[a-f]/.test(ch) ? ch.toUpperCase() : /[A-F]/.test(ch) ? ch.toLowerCase() : ch))
        .join("");

export const targets = {
    unknownAddress,
    scamAddress,
    invalidChecksumAddress,
    ensAddress,
    poisonAddress,
    familiarRecipient: familiarRecipientAddress,
    testerWallet1: TESTER_WALLET_1,
    testerWallet2: TESTER_WALLET_2,
    checksumProbeBadChecksum: CHECKSUM_PROBE_BAD_CHECKSUM,
};

// THRE-005 unknown-address POOL — additional candidates (candidate 1 is
// `txOptions.unknown`, kept for continuity with v0.1.0/v0.2.0 evidence). A
// single accidental approval burns a candidate silently, so the tester picks
// from this documented pool. Randomly generated, VALID EIP-55 checksums — do
// NOT change their casing: a wrong checksum would trip VERI-001's checksum
// warning instead, confounding the two checks.
export const UNKNOWN_ADDRESS_CANDIDATE_2 = "0x77cdFe21286c19191f6F5C7dB31Ed2f30Bc6E462";
export const UNKNOWN_ADDRESS_CANDIDATE_3 = "0x5f640D16BF02b31D50aE9E20E6faA07170c86181";
export const UNKNOWN_ADDRESS_CANDIDATE_4 = "0xc08eaC3d2aAC4220A721255D28111eE76a2B637B";
export const UNKNOWN_ADDRESS_CANDIDATE_5 = "0x9eb91Fbc0291180088a7ff279FA7d35d26a42516";
export const UNKNOWN_ADDRESS_CANDIDATE_6 = "0x50Bb16e48eaA265C125858926A1187D045518c71";

/**
 * Canonical keccak256 (ethers v5 `utils.id`) of a signing payload — objects
 * are hashed as their JSON, strings as their UTF-8 bytes. Computed from the
 * LIVE constant so the registry can never drift from what the wallet is
 * actually asked to sign (no retyped hash literals to fall stale).
 */
const hashOf = (payload) =>
    ethers.utils.id(typeof payload === "string" ? payload : JSON.stringify(payload));

// Byte length of a 0x-hex blob (bytecode), so the registry records the size
// rather than the blob itself.
const byteLen = (hex) => String(hex).replace(/^0x/, "").length / 2;

// Default human label for a registry key: snake_case → Sentence case.
// scam_address_target → "Scam address target". Used as the default so the 40
// entries don't carry hand-written strings; LABEL_OVERRIDES only names the few
// where a proper acronym / product spelling reads better.
const toTitle = (key) => {
    const s = String(key ?? "").replace(/_/g, " ").trim().toLowerCase();
    return s ? s[0].toUpperCase() + s.slice(1) : s;
};

// Per-key label overrides — data, keyed by registry key, kept beside the
// registry (not a formatter in a component). Only acronyms / product names that
// toTitle can't recover.
const LABEL_OVERRIDES = {
    // Auth-bypass rows are labelled with the exact RPC method name.
    bypass_wallet_add_ethereum_chain: "wallet_addEthereumChain",
    bypass_wallet_watch_asset: "wallet_watchAsset",
    bypass_eth_get_encryption_public_key: "eth_getEncryptionPublicKey",
    bypass_eth_decrypt: "eth_decrypt",
    bypass_eth_sign_typed_data_v4: "eth_signTypedData_v4",
    bypass_personal_sign: "personal_sign",
    bypass_eth_send_transaction: "eth_sendTransaction",
    eip712_mismatched_chainid: "EIP-712 mismatched chainId",
    opensea_eip712: "OpenSea order (EIP-712)",
    permit_eip712: "ERC-2612 permit (EIP-712)",
    weak_pin: "Weak PIN",
    checksum_probe_bad_checksum: "Bad-checksum address",
    add_chain_taiko: "Taiko Mainnet",
    add_chain_zora: "Zora",
    add_chain_zksync: "zkSync Era",
    familiar_recipient_target: "Familiar recipient",
    scam_address_target: "Malicious address",
    poison_address_target: "Lookalike address",
    unknown_address_target: "Fresh address",
    scam_dapp_url: "Scam dApp URL",
    verified_dapp_url: "Verified dApp URL",
    testing_dapp_origin: "Testing dApp origin",
    siwe_fake_domain: "SIWE fake domain",
    siwe_true_domain: "SIWE true domain",
    polygon_chain_id: "Polygon chainId",
    polygon_add_chain_params: "Polygon addEthereumChain params",
    lp_amount_in: "LP amount in",
    lp_tick_spacing: "LP tick spacing",
    usdc_e: "USDC.e",
    wmatic: "WMATIC",
    quoter_v2: "QuoterV2",
    swap_router_02: "SwapRouter02",
    uniswap_v3_factory: "Uniswap V3 factory",
    nonfungible_position_manager: "NonfungiblePositionManager",
};

// Registry group order — the single source consumed by both the in-wizard
// params panel and the global /params document (no re-declared list).
export const PARAM_GROUPS = [
    "Recipient addresses",
    "Suggested credentials",
    "URLs & domains",
    "Signing payloads",
    "Auth-bypass payloads",
    "Contracts & tokens",
    "Chains & numeric params",
    "Tester wallets",
];

// Optional per-group note, rendered under the group heading.
export const PARAM_GROUP_NOTES = {
    "Tester wallets":
        "Environment-level — not tied to any one check. runtime.from records which one signed each run.",
};

/**
 * Global test-parameter registry — the SINGLE SOURCE of every hardcoded
 * literal the auditor may encounter across the wizard. Rows are
 * shown in WizardParamsPanel and highlighted when their `usedBy` intersects
 * the current step's ACTION or its CHECK id (see `isParamUsedByStep` in
 * resolveCheckParams — check-id keying lets the three shared `requestConnection`
 * checks highlight different rows). Nothing here is duplicated into the panel.
 *
 * Every `value` is sourced VERBATIM from the constants above / the token
 * artifact — never retyped. Signing payloads carry a short `value` summary +
 * a `hash` (keccak256) and keep the `full` payload for on-expand reveal, so
 * the giant blobs never sit in the row itself. Fields:
 *   key · group · value · usedBy   (+ optional hash · full · bytes · note)
 */
/**
 * Auth-bypass payloads — DERIVED from the shared builder
 * (src/utils/wallet-methods/authBypassPayloads.js) that BOTH RunBypass paths now
 * consume, so the registry can no longer drift from what the wallet is asked to
 * approve (the previous hand-mirrored copies are gone). Runtime-only fields
 * (connected account, gas/nonce/fees) are passed as named placeholders — the
 * SHAPE is the builder's real output, only the runtime value is a placeholder.
 * The builder defaults ARE the extension payloads; each entry's `note` records
 * where the WalletConnect twin diverges.
 */
const BYPASS_ACCOUNT = "<connected account — runtime>";
// DERIVED from the SAME request builder the wire uses, fed the SAME payload
// decisions: the uncommon-chain add-chain preset (default Taiko), the WSRT
// test-token watchAsset, and the non-decryptable eth_decrypt placeholder. The
// popover therefore cannot document a different chain, token or ciphertext than
// the batch actually sends. domain.chainId is the active chain at runtime
// (137/Polygon shown); message.owner is the connected account at runtime.
const bypassDoc = (method) => buildWizardAuthBypassRequest({
    method,
    account: BYPASS_ACCOUNT,
    chainId: 137,
    permit: PERMIT_EIP712,
    addChain: buildAddEthereumChain(resolveAddChain(DEFAULT_ADD_CHAIN)).params[0],
    watchAsset: buildWatchAsset({ address: TEST_ERC20_ADDRESS }).params,
    ciphertext: AUTH_BYPASS_PLACEHOLDER_CIPHERTEXT,
    message: LONG_SIGN_MESSAGE,
});

// The auth-bypass checks that fire these RPCs. Browser variants run the
// extension RunBypass; Mobile variants run the WalletConnect twin (which sends
// several payloads differently and skips eth_getEncryptionPublicKey/eth_decrypt).
const BYPASS_BROWSER_CHECKS = [
    "WSR-PERM-002~Browser",
    "WSR-PERM-008~Browser",
    "WSR-PERM-010~Browser",
];
// PERM-008 is Browser-only; the Mobile auth-bypass variants that exist are 002/010.
const BYPASS_ALL_CHECKS = [...BYPASS_BROWSER_CHECKS, "WSR-PERM-002~Mobile", "WSR-PERM-010~Mobile"];

const RAW_TEST_PARAMS = [
    // ── Recipient addresses ──────────────────────────────────────────────
    { key: "scam_address_target",     group: "Recipient addresses", value: txOptions.tornadoScam, usedBy: ["sendScamTransaction"] },
    { key: "poison_address_target",   group: "Recipient addresses", value: txOptions.poison,      usedBy: ["sendPoisonTransaction"] },
    { key: "unknown_address_target",   group: "Recipient addresses", value: txOptions.unknown,            usedBy: ["sendUnknownTransaction"] },
    { key: "unknown_address_target_2", group: "Recipient addresses", value: UNKNOWN_ADDRESS_CANDIDATE_2, usedBy: ["sendUnknownTransaction"] },
    { key: "unknown_address_target_3", group: "Recipient addresses", value: UNKNOWN_ADDRESS_CANDIDATE_3, usedBy: ["sendUnknownTransaction"] },
    { key: "unknown_address_target_4", group: "Recipient addresses", value: UNKNOWN_ADDRESS_CANDIDATE_4, usedBy: ["sendUnknownTransaction"] },
    { key: "unknown_address_target_5", group: "Recipient addresses", value: UNKNOWN_ADDRESS_CANDIDATE_5, usedBy: ["sendUnknownTransaction"] },
    { key: "unknown_address_target_6", group: "Recipient addresses", value: UNKNOWN_ADDRESS_CANDIDATE_6, usedBy: ["sendUnknownTransaction"] },
    // The previously-used recipient that poison_address_target imitates (same
    // first/last 4 chars) — THRE-002's poison lookalike needs it to exist.
    { key: "familiar_recipient_target", group: "Recipient addresses", value: familiarRecipientAddress, note: "the previously-used recipient that poison_address_target mimics — same first and last 4 characters (8730…Da54); THRE-002's setup send establishes real history to it.", usedBy: ["WSR-THRE-002", "sendFamiliarRecipientTransaction"] },
    { key: "checksum_probe_bad_checksum", group: "Recipient addresses", value: CHECKSUM_PROBE_BAD_CHECKSUM, note: "a FIXED, arbitrary address (keccak-derived, owned by no one, no ENS/explorer label) with its EIP-55 checksum deliberately broken (case inverted) — canonical form 0x02970ea171a97eb0D627cb7ec9abAc308253c716. VERI-001's approved 0-value send targets this: a recipient the wallet has no nickname for, so it must render the raw address string and the tester can see the casing.", usedBy: ["WSR-VERI-001", "sendInvalidChecksumTransaction"] },

    // ── Suggested credentials ────────────────────────────────────────────
    { key: "weak_pin",          group: "Suggested credentials", value: "1234", note: "suggested weak PIN", usedBy: ["WSR-PHYS-002~Mobile"] },
    { key: "trivial_passwords", group: "Suggested credentials", value: "1234, 12345678, qwertyui, password", note: "suggested trivial passwords", usedBy: ["WSR-PHYS-002~Browser"] },

    // ── URLs & domains ───────────────────────────────────────────────────
    { key: "scam_dapp_url",       group: "URLs & domains", value: SCAM_DAPP_URL,                                        note: "Team-curated phishing list, supplied 2026-08-24 — NOT the MetaMask list. Phishing domains die fast; re-verify before relying on these.", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_2",     group: "URLs & domains", value: "flagship-web3-v1-336a757b5b637a684207a3.webflow.io", note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_3",     group: "URLs & domains", value: "clawmintwlfi.xyz",                                   note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_4",     group: "URLs & domains", value: "trustwallet.sendandconfirm.in",                     note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_5",     group: "URLs & domains", value: "hyperliqdrop.com",                                   note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_6",     group: "URLs & domains", value: "venofinance.net",                                    note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_7",     group: "URLs & domains", value: "token-2049.world",                                   note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_8",     group: "URLs & domains", value: "chainbank-network.pages.dev",                        note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_9",     group: "URLs & domains", value: "maga-mem-pages-dev.pages.dev",                       note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "scam_dapp_url_10",    group: "URLs & domains", value: "master--ethereumorg.netlify.app",                   note: "Team-curated phishing list, supplied 2026-08-24; re-verify (domains die fast).", usedBy: ["openScamUrl", "WSR-THRE-003"] },
    { key: "verified_dapp_url",   group: "URLs & domains", value: "https://app.uniswap.org", linkLabel: "Uniswap", usedBy: ["WSR-THRE-001", "WSR-PERM-004"] },
    { key: "aave_dapp_url",       group: "URLs & domains", value: "https://app.aave.com",    linkLabel: "Aave",    usedBy: ["WSR-THRE-001"] },
    { key: "curve_dapp_url",      group: "URLs & domains", value: "https://curve.fi",        linkLabel: "Curve",   usedBy: ["WSR-THRE-001"] },
    { key: "polygon_staking_dapp_url", group: "URLs & domains", value: "https://staking.polygon.technology", note: "THRE-006 — verified dApp with a longer origin; connect here and observe how the wallet renders the origin.", usedBy: ["WSR-THRE-006"] },
    { key: "polygon_portal_dapp_url",  group: "URLs & domains", value: "https://portal.polygon.technology",  note: "THRE-006 — verified dApp with a longer origin; connect here and observe how the wallet renders the origin.", usedBy: ["WSR-THRE-006"] },
    { key: "olympusdao_dapp_url",      group: "URLs & domains", value: "https://app.olympusdao.finance",     note: "THRE-006 — verified dApp with a longer origin; connect here and observe how the wallet renders the origin.", usedBy: ["WSR-THRE-006"] },
    { key: "siwe_fake_domain",    group: "URLs & domains", value: SIWE_FAKE_DOMAIN,          usedBy: ["siweSign"] },
    { key: "siwe_true_domain",    group: "URLs & domains", value: "(the dApp's own origin — resolved at run time)", runtimeOrigin: true, note: "the origin the SIWE message is compared against; equals runtime.dapp_origin (resolved from window.location.origin).", usedBy: ["siweSign"] },
    { key: "testing_dapp_origin", group: "URLs & domains", value: "(the dApp's own origin — resolved at run time)", runtimeOrigin: true, note: "the dApp's own origin; equals runtime.dapp_origin (resolved from window.location.origin).", usedBy: ["WSR-THRE-006", "WSR-THRE-004", "WSR-THRE-001"] },

    // ── Signing payloads (short summary + keccak256; full kept for reveal) ─
    { key: "opensea_eip712",        group: "Signing payloads", value: "OpenSea Seaport order — EIP-712 OrderComponents", templateHash: hashOf(OPENSEA_EIP712),        full: OPENSEA_EIP712,        usedBy: ["clearMethodSignRequest", "differentChainId", "signLongMessageAndTypedData", "signPermitAndSeaport"] },
    { key: "permit_eip712",         group: "Signing payloads", value: "ERC-2612 Permit — USD Coin (PoS), EIP-712",       templateHash: hashOf(PERMIT_EIP712),         full: PERMIT_EIP712, note: "Intentionally claims USD Coin (PoS) with a fixed random verifyingContract, not the USDC address.", usedBy: ["signPermit", "signPermitAndSeaport", "clearMethodSignRequest"] },
    { key: "personal_sign_message", group: "Signing payloads", value: "personal_sign — long lorem-ipsum message",        templateHash: hashOf(PERSONAL_SIGN_MESSAGE), full: PERSONAL_SIGN_MESSAGE, usedBy: ["clearMethodSignRequest"] },
    { key: "eth_sign_message",      group: "Signing payloads", value: "eth_sign — Example personal_sign message",        templateHash: hashOf(PERSONAL_SIGN),         full: PERSONAL_SIGN,         usedBy: ["ethSignMethod"] },
    { key: "long_sign_message",     group: "Signing payloads", value: "personal_sign — long multi-section ToS (scroll review)", templateHash: hashOf(LONG_SIGN_MESSAGE), full: LONG_SIGN_MESSAGE, usedBy: ["signLongMessage", "signLongMessageAndTypedData"] },

    { key: "signing_methods",       group: "Signing payloads", value: "personal_sign + eth_signTypedData_v4",            usedBy: ["clearMethodSignRequest", "signLongMessageAndTypedData"] },

    // ── Auth-bypass payloads (one row per RPC the bypass test fires) ──────
    // Documentation of RunBypass.jsx (off-limits) — see the mirror consts above.
    // usedBy keys on the auth-bypass check ids; the popover strips the variant to
    // the base id, so a row surfaces on both the ~Browser and ~Mobile route of
    // each check. `note` flags where the Mobile (WalletConnect) twin differs.
    { key: "bypass_wallet_add_ethereum_chain", group: "Auth-bypass payloads", value: `adds ${bypassDoc("wallet_addEthereumChain").params[0].chainName} (${bypassDoc("wallet_addEthereumChain").params[0].chainId})`, full: bypassDoc("wallet_addEthereumChain").params, note: "An uncommon chain wallets do not ship preconfigured, so the request is a genuine add rather than an 'already have it' no-op. Identical on extension and WalletConnect; a check can declare addChain \"zora\" or \"zksync\" to use an alternate.", usedBy: BYPASS_ALL_CHECKS },
    { key: "bypass_wallet_watch_asset", group: "Auth-bypass payloads", value: `ERC-20 ${bypassDoc("wallet_watchAsset").params.options.symbol}, ${bypassDoc("wallet_watchAsset").params.options.decimals} decimals; options.address is the WSRT test-token contract`, full: bypassDoc("wallet_watchAsset").params, note: "options.address is a real ERC-20 (WSRT) the wallet has no metadata for, so the request is a genuine add; symbol/decimals match the contract. Identical on extension and WalletConnect.", usedBy: BYPASS_ALL_CHECKS },
    { key: "bypass_eth_get_encryption_public_key", group: "Auth-bypass payloads", value: "params [account]; the connected account (runtime)", full: bypassDoc("eth_getEncryptionPublicKey").params, note: "Browser only — the Mobile twin's getEncryptionKey call is commented out of its run.", usedBy: BYPASS_BROWSER_CHECKS },
    { key: "bypass_eth_decrypt", group: "Auth-bypass payloads", value: "params [ciphertext, account]; the ciphertext is a NON-DECRYPTABLE placeholder (a valid one needs a NaCl-box library we don't have, and its bytes are zero), the account is the connected account (runtime)", full: bypassDoc("eth_decrypt").params, note: ETH_DECRYPT_PLACEHOLDER_NOTE, usedBy: BYPASS_ALL_CHECKS },
    { key: "bypass_eth_sign_typed_data_v4", group: "Auth-bypass payloads", value: "ERC-2612 Permit — USD Coin (PoS) EIP-712 (message.owner + domain.chainId set at runtime); params [account, JSON]", full: bypassDoc("eth_signTypedData_v4").params, note: "Browser and Mobile (WalletConnect) send the byte-identical Permit payload — both derive from the shared request builder. It intentionally claims USD Coin (PoS) with a fixed random verifyingContract, not the USDC address.", usedBy: BYPASS_ALL_CHECKS },
    { key: "bypass_personal_sign", group: "Auth-bypass payloads", value: "message = the long multi-section ToS (LONG_SIGN_MESSAGE), UTF-8 hex; params [hexMsg, account]", full: bypassDoc("personal_sign").params, note: "Browser and Mobile send the same two-parameter payload.", usedBy: BYPASS_ALL_CHECKS },
    { key: "bypass_eth_send_transaction", group: "Auth-bypass payloads", value: "minimal self-send envelope; from/to the connected account, value 0x0", full: bypassDoc("eth_sendTransaction").params, note: "Browser and Mobile send the same minimal wizard batch payload.", usedBy: BYPASS_ALL_CHECKS },

    // ── Contracts & tokens ───────────────────────────────────────────────
    { key: "test_token_address",   group: "Contracts & tokens", value: TEST_ERC20_ADDRESS, note: "WSRT — a deployed test ERC-20 the wallet has no metadata for; VERI-005 approves it as the UNKNOWN token (standard approve to APPROVE_SPENDER, unlimited).", usedBy: ["approveTestErc20"] },
    { key: "test_token_bytecode",  group: "Contracts & tokens", value: `ERC-20 creation bytecode · ${byteLen(TEST_ERC20_BYTECODE)} bytes`, bytes: byteLen(TEST_ERC20_BYTECODE), hash: hashOf(TEST_ERC20_BYTECODE), usedBy: ["deployTestErc20"] },
    { key: "solc_version",         group: "Contracts & tokens", value: testTokenArtifact.solcVersion, usedBy: ["deployTestErc20"] },
    { key: "approve_spender",      group: "Contracts & tokens", value: APPROVE_SPENDER, usedBy: ["approveTestErc20"] },
    { key: "approve_amount",       group: "Contracts & tokens", value: APPROVE_AMOUNT, note: "unlimited (max uint256)", usedBy: ["approveTestErc20"] },
    { key: "swap_router_02",       group: "Contracts & tokens", value: SWAP_ROUTER_02, usedBy: ["simulateSwap"] },
    { key: "quoter_v2",            group: "Contracts & tokens", value: QUOTER_V2, usedBy: ["simulateSwap"] },
    { key: "wmatic",               group: "Contracts & tokens", value: WMATIC, usedBy: ["simulateSwap", "provideLiquidity"] },
    { key: "usdc_e",               group: "Contracts & tokens", value: USDC_E, note: "VERI-005 p2 approves this token (a standard ERC-20 approve to APPROVE_SPENDER, unlimited); also the simulateSwap output token.", usedBy: ["simulateSwap", "approveTestErc20"] },
    { key: "uniswap_v3_factory",   group: "Contracts & tokens", value: UNISWAP_V3_FACTORY, usedBy: ["provideLiquidity", "simulateSwap"] },
    { key: "nonfungible_position_manager", group: "Contracts & tokens", value: NONFUNGIBLE_POSITION_MANAGER, usedBy: ["provideLiquidity"] },

    // ── Chains & numeric params ──────────────────────────────────────────
    { key: "polygon_chain_id",    group: "Chains & numeric params", value: chains.polygon.chainId, note: chains.polygon.chainName, usedBy: ["sendScamTransaction", "sendPoisonTransaction", "sendUnknownTransaction", "sendInvalidChecksumTransaction", "deployTestErc20", "approveTestErc20", "simulateSwap", "provideLiquidity"] },
    // EIP-3085 params the network gate passes to wallet_addEthereumChain when a
    // switch returns 4902. usedBy = the gated checks that RENDER the switch
    // button (PERM-010 is gated but switches manually, so it is not listed).
    { key: "add_chain_taiko",      group: "Chains & numeric params", value: `${ADD_CHAIN_TAIKO.chainName} (${ADD_CHAIN_TAIKO.chainId} / 167000)`, full: ADD_CHAIN_TAIKO, note: "PRIMARY auth-bypass add-chain target — an uncommon chain wallets do not ship preconfigured, so wallet_addEthereumChain is a genuine add and the wallet's authorization behaviour is what is measured (not an 'already have it' no-op).", usedBy: BYPASS_ALL_CHECKS },
    { key: "add_chain_zora",       group: "Chains & numeric params", value: `${ADD_CHAIN_ZORA.chainName} (${ADD_CHAIN_ZORA.chainId} / 7777777)`, full: ADD_CHAIN_ZORA, note: "Alternate auth-bypass add-chain target, also uncommon — used when a wallet already ships the primary. Selected by declaring addChain: \"zora\" on the check.", usedBy: BYPASS_ALL_CHECKS },
    { key: "add_chain_zksync",     group: "Chains & numeric params", value: `${ADD_CHAIN_ZKSYNC.chainName} (${ADD_CHAIN_ZKSYNC.chainId} / 324)`, full: ADD_CHAIN_ZKSYNC, note: "Alternate auth-bypass add-chain target, also uncommon — the chain the batch sent before this pass. Selected by declaring addChain: \"zksync\" on the check.", usedBy: BYPASS_ALL_CHECKS },
    { key: "polygon_add_chain_params", group: "Chains & numeric params", value: "wallet_addEthereumChain params — Polygon Mainnet (0x89)", full: POLYGON_ADD_CHAIN_PARAMS, note: "the network gate's 4902 fallback", usedBy: ["WSR-THRE-002", "WSR-THRE-005", "WSR-VERI-001", "WSR-VERI-006", "WSR-PERM-003", "WSR-VERI-004", "WSR-VERI-005", "WSR-VERI-003"] },
    { key: "switch_chain_common",   group: "Chains & numeric params", value: chains.mainnet.chainId, note: `${chains.mainnet.chainName} — PERM-009 part 1 target; wallets almost always already have it, so the confirmation prompt itself can be observed.`, usedBy: ["switchChains", "WSR-PERM-009"] },
    { key: "switch_chain_uncommon", group: "Chains & numeric params", value: chains.zksync.chainId,  note: `${chains.zksync.chainName} — PERM-009 part 2 target; most wallets lack it, so a 4902 (unrecognized chain) response is a valid observation of how the wallet handles a non-approved network.`, usedBy: ["switchChains", "WSR-PERM-009"] },
    // Mismatched chainId claimed in the EIP-712 domain for PERM-003 — this IS
    // the DIFFERENT_CHAIN_ID literal (key kept: ACTION_SALIENT references it).
    { key: "eip712_mismatched_chainid", group: "Chains & numeric params", value: DIFFERENT_CHAIN_ID, usedBy: ["differentChainId"] },
    { key: "swap_fee_tier",       group: "Chains & numeric params", value: SWAP_FEE, note: "Uniswap v3 fee tier (0.05%)", usedBy: ["simulateSwap", "provideLiquidity"] },
    { key: "swap_amount_in",      group: "Chains & numeric params", value: SWAP_AMOUNT_IN, note: "0.01 MATIC (wei)", usedBy: ["simulateSwap"] },
    { key: "lp_amount_in",        group: "Chains & numeric params", value: LP_AMOUNT_IN, note: "~0.01 POL (wei)", usedBy: ["provideLiquidity"] },
    { key: "lp_tick_spacing",     group: "Chains & numeric params", value: LP_TICK_SPACING, note: "fee 500 → tickSpacing 10", usedBy: ["provideLiquidity"] },

    // ── Tester wallets (environment-level) ───────────────────────────────
    // scope:"environment" → shown on /params but never part of a check's
    // "USED BY THIS CHECK" highlight (that would be noise on every check).
    { key: "tester_wallet_1", group: "Tester wallets", value: TESTER_WALLET_1, note: "VERI-002 fallback recipient when the connected account is tester wallet 2 (keeps from ≠ to).", scope: "environment", usedBy: ["WSR-VERI-002"] },
    { key: "tester_wallet_2", group: "Tester wallets", value: TESTER_WALLET_2, scope: "environment", usedBy: ["WSR-VERI-002"] },
];

// Materialise a `label` onto every entry — the human name (override, else the
// toTitle default). Labels are DATA on the row, consumed by the params popover
// and /params; the raw `key` stays the join reference to /params and the code.
export const testParams = RAW_TEST_PARAMS.map((p) => ({
    ...p,
    label: LABEL_OVERRIDES[p.key] ?? toTitle(p.key),
}));
