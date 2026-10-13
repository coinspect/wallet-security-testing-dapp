import wizardConfig from "../config/wizard";
import { chains, targets, testParams, resolveParamValue } from "@/utils/constants";
import pkg from "../../../../package.json";
import { SIMPLE_SEND_ACTIONS } from "@/utils/wallet-methods/simpleTransaction.mjs";

// key → value view of the global registry, so `salient` can resolve
// non-address checks (domains, mismatched chainId, signing-method
// identity) straight from the same source of truth the panel shows.
// Origin rows resolve at read time (see resolveParamValue); this module-load
// snapshot only feeds salient lookups (no action's salient IS the origin), while
// the evidence path (surfacedParams) re-resolves per run below.
const PARAM_VALUES = Object.fromEntries(testParams.map((p) => [p.key, resolveParamValue(p)]));

// Version-stripped check id (WSR-THRE-006.v1 → WSR-THRE-006).
const stripCheckVersion = (id) => String(id ?? "").replace(/\.v\d+$/, "");

/**
 * Whether a registry entry is "used by" a given wizard step. An entry matches
 * when its `usedBy` names EITHER the step's action OR the step's check id.
 *
 * Both id forms are accepted — fully versioned (`WSR-THRE-006.v1`) and
 * version-stripped (`WSR-THRE-006`) — so authors can key by whichever is
 * stable (we key by the stripped base in constants.js, which survives version
 * bumps). Action-only keying can't distinguish the three checks that share
 * `requestConnection` (THRE-001/004/006); check-id keying can.
 *
 * @param {object} entry a testParams row ({ usedBy: string[] })
 * @param {object} step  the current wizard sub-step
 */
export const isParamUsedByStep = (entry, step) => {
    // Environment-level entries (e.g. tester wallets) never highlight per-check.
    if (entry?.scope === "environment") return false;
    const usedBy = entry?.usedBy;
    if (!Array.isArray(usedBy) || usedBy.length === 0) return false;
    const action = step?.ui?.content?.button?.action ?? null;
    const canonicalId = step?.canonicalId ?? null;
    const stepId = step?.id ?? null; // already version-stripped (URL slug)
    const baseId = stripCheckVersion(canonicalId ?? stepId);
    return usedBy.some(
        (k) => k === action || k === canonicalId || k === stepId || k === baseId,
    );
};

/**
 * Single source of truth for wizard-step params — used by both
 * WizardParamsPanel (display) and ActionResult / EvidenceBlock
 * (auto-documented outcome capture). Fields that a step doesn't
 * declare come back as safe placeholder strings so downstream
 * renderers can print them uniformly (no undefined).
 *
 * Transaction mapping: the currently-declared send actions all
 * dispatch `eth_sendTransaction`; the field is exposed here so the
 * evidence block can print the RPC method used and, on failure, the
 * one that failed.
 *
 * `checkId` returns the fully-versioned canonical id
 * (step.canonicalId) when the step declares one, falling back to
 * step.id (which is the URL slug, version stripped). The wizard.json
 * schema uses the public wallet-security-ranking checks.json keys.
 *
 * `salient` is the single most auditor-relevant value for the action.
 * For the three send actions, that is the resolved target address;
 * URL-based checks (phishing dApp, SIWE domains) will be wired here
 * once their wizard steps land — see the ACTION_SALIENT map below.
 *
 * @param {object} step  the current wizard sub-step (from wizardConfig.wizard.checks[*].steps).
 */
const SEND_ACTIONS = new Set([
    "sendScamTransaction",
    "sendPoisonTransaction",
    "sendFamiliarRecipientTransaction",
    "sendUnknownTransaction",
    "sendInvalidChecksumTransaction",
    "deployTestErc20",
    "approveTestErc20",
    "simulateSwap",
    "provideLiquidity",
]);

/**
 * Risk note derived from the ACTION type — never a manual flag, so new
 * checks inherit the right note automatically:
 *   - deployTestErc20 is the ONLY action the tester approves; it deploys a
 *     contract and costs real POL → its own note.
 *   - every other send action is a transaction the tester rejects → the
 *     standard mainnet note.
 *   - sign / SIWE / typed-data / connect / navigation / switch (no tx) → null.
 */
export const riskNote = (action, methods) => {
    if (action === "deployTestErc20") {
        return "⚠ Mainnet safety: this deploys a contract and costs real POL. You approve this one.";
    }
    if (action === "sendFamiliarRecipientTransaction") {
        // THRE-002 setup — the ONE approved send here; every other send is rejected.
        return "⚠ Mainnet safety: this sends a real 0-value transaction and costs gas. APPROVE this one — it seeds the history the poison lookalike imitates; reject every other request in this check.";
    }
    if (action === "sendInvalidChecksumTransaction") {
        // VERI-001 — the ONE approved send in this check; the manual send-screen
        // step is a rejection. What the check measures lives in the step copy.
        return "⚠ Mainnet safety: a real 0-value transaction to our tester wallet — costs gas. Approve this one; the manual send-screen step is a rejection.";
    }
    if (SEND_ACTIONS.has(action)) {
        return "⚠ Mainnet safety: Polygon mainnet uses real funds. Reject every request.";
    }
    if (action === "runAuthBypass") {
        // Only warn when the batch actually includes a real transaction. The
        // non-destructive revocation probe (PERM-004 part 2 — eth_accounts +
        // wallet_getPermissions) sends nothing, so it gets no mainnet note.
        const sendsTx = Array.isArray(methods) && methods.includes("eth_sendTransaction");
        // The "Reject every prompt." step carries the instruction; the note carries
        // WHY — one of the batched requests is a real transaction.
        return sendsTx
            ? "⚠ Mainnet safety: Polygon mainnet uses real funds — one of these requests is a real transaction."
            : null;
    }
    return null;
};

// action → the salientLookup key holding the single most auditor-relevant
// ("Copy target") value. Address checks point at the resolved `target`;
// non-address checks point at a registry key (resolved via PARAM_VALUES).
// Unmapped actions fall back to `target`.
const ACTION_SALIENT = {
    sendScamTransaction: "target",
    sendPoisonTransaction: "target",
    sendUnknownTransaction: "target",
    sendInvalidChecksumTransaction: "target",
    // SIWE domain mismatch → the spoofed (mismatched) domain being signed.
    siweSign: "siwe_fake_domain",
    // EIP-712 chainId mismatch → the mismatched chainId in the payload.
    differentChainId: "eip712_mismatched_chainid",
    // Clear-signing / mandatory-review → the payload identity (RPC methods exercised).
    clearMethodSignRequest: "signing_methods",
    signLongMessageAndTypedData: "signing_methods",
    // Phishing-URL doc check → the scam URL that was opened.
    openScamUrl: "scam_dapp_url",
};

// action → the real JSON-RPC method the handler dispatches, so evidence
// records the RPC used (not the internal action name). Send actions are
// handled separately via SEND_ACTIONS (all eth_sendTransaction); unmapped
// actions fall back to the action string.
const ACTION_METHOD = {
    siweSign: "personal_sign",
    clearMethodSignRequest: "personal_sign + eth_signTypedData_v4",
    differentChainId: "eth_signTypedData_v4",
    ethSignMethod: "eth_sign",
    switchChains: "wallet_switchEthereumChain",
    requestConnection: "wallet_requestPermissions",
    signPermit: "eth_signTypedData_v4",
    signPermitAndSeaport: "eth_signTypedData_v4 (permit + Seaport)",
    signLongMessage: "personal_sign",
    signLongMessageAndTypedData: "personal_sign + eth_signTypedData_v4",
    openScamUrl: "navigation",
    runAuthBypass: "auth_bypass_batch",
    checkRevokedAccess: "revocation_probe",
    // VERI-002 send probe — a real eth_sendTransaction, but deliberately NOT in
    // SEND_ACTIONS: it carries no Polygon chain gate, so it must not inherit the
    // "Polygon mainnet uses real funds" note. The reject instruction lives in the
    // step copy; the rejection is the expected outcome.
    sendExplorerLinkTransaction: "eth_sendTransaction",
};

export const resolveCheckParams = (step, opts = {}) => {
    // `opts.targetAddress` — the raw address ACTUALLY sent to, when a documented
    // pool (THRE-005) overrode the keyed target. It must win here so the evidence
    // `parameters.target` records what was tested, not the frozen default key.
    //
    // Locate the check that owns this sub-step, then scope
    // stepNumber/totalSteps to that check's sub-steps — a single-sub-step
    // check resolves to 1 of 1.
    const checks = wizardConfig?.wizard?.checks ?? {};
    let totalSteps = 0;
    let stepNumber = 0;
    if (step) {
        for (const key of Object.keys(checks)) {
            const subSteps = checks[key]?.steps ?? [];
            const idx = subSteps.findIndex((s) => s.id === step.id);
            if (idx !== -1) {
                totalSteps = subSteps.length;
                stepNumber = idx + 1;
                break;
            }
        }
    }

    const declared = step?.data?.params;
    const action = step?.ui?.content?.button?.action ?? null;
    const method = SEND_ACTIONS.has(action)
        ? "eth_sendTransaction"
        : (ACTION_METHOD[action] ?? action ?? "(no action)");

    const targetKey = declared?.target ?? null;
    const keyedTarget = targetKey
        ? (Object.hasOwn(targets, targetKey) ? targets[targetKey] : "(unresolved)")
        : "(none)";
    // A picked pool candidate (opts.targetAddress) is the address actually sent.
    const target = opts.targetAddress ?? keyedTarget;

    // The global execution policy now requires Polygon, including auth checks
    // whose frozen step config does not declare a chain. This is the starting
    // network; intentional switch targets and EIP-712 domains stay unchanged.
    const chainKey = declared?.chain ?? (action && action !== 'openScamUrl' ? 'polygon' : null);
    const chainEntry = chainKey && Object.hasOwn(chains, chainKey) ? chains[chainKey] : null;
    const chainId = chainEntry?.chainId ?? (chainKey ? "(unresolved)" : "(current)");
    const chainName = chainEntry?.chainName ?? (chainKey ? "(unresolved)" : "(current chain)");

    const salientField = ACTION_SALIENT[action] ?? "target";
    // Rows for salientField are resolved off the local bindings above (or
    // the registry via PARAM_VALUES) so adding a new mapping only requires
    // exposing the field/key here.
    const salientLookup = { target, chainId, chainName, ...PARAM_VALUES };
    const salient = Object.hasOwn(salientLookup, salientField)
        ? salientLookup[salientField]
        : target;

    // Evidence `parameters` is shaped by action TYPE so non-send checks
    // don't carry irrelevant target:"(none)" / value:"0x0" noise. Type
    // detection reuses the existing SEND_ACTIONS set; the single switch
    // action is matched by name; everything else is a sign check.
    //   - simple send → { target, chain, method, value, data }
    //   - switch → { method, targetChain }
    //   - sign   → { method, chain, [params] }        (params = the
    //              registry entries whose usedBy includes this action)
    const surfacedParams = testParams
        .filter((p) => isParamUsedByStep(p, step))
        .reduce((acc, p) => ({ ...acc, [p.key]: resolveParamValue(p) }), {});

    let parameters;
    if (SIMPLE_SEND_ACTIONS.has(action)) {
        parameters = { target, chain: chainId, method, value: "0x0", data: "0x" };
    } else if (SEND_ACTIONS.has(action)) {
        parameters = { target, chain: chainId, method, value: "0x0" };
    } else if (action === "switchChains") {
        // Per-part target: PERM-009 declares `switchTo` (a chains key); fall back
        // to zksync for continuity if a step omits it.
        const t = chains[declared?.switchTo] ?? chains.zksync;
        parameters = {
            method,
            targetChain: `${t.chainName} · ${t.chainId}`,
        };
    } else if (action === "openScamUrl") {
        // Documentation/hand-off check — no wallet call. Records the URL.
        parameters = { method: "navigation", url: PARAM_VALUES.scam_dapp_url };
    } else if (action === "runAuthBypass" || action === "checkRevokedAccess") {
        // Batch of privileged RPCs — the method LIST is the auditor-facing param.
        parameters = { method, chain: chainId, params: { methods: declared?.methods ?? [] } };
    } else {
        parameters = { method, chain: chainId };
        if (Object.keys(surfacedParams).length > 0) {
            parameters.params = surfacedParams;
        }
    }

    return {
        checkId: step?.canonicalId ?? step?.id ?? "(unknown)",
        stepNumber,
        totalSteps,
        action: action ?? "(no action)",
        target,
        chainKey,
        chainId,
        chainName,
        method,
        value: "0x0",
        dappVersion: pkg?.version ?? "?",
        salient,
        parameters,
    };
};
