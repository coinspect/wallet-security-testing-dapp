import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    cloneReadonly,
    safeDecodeRouteSegment,
    sanitizeWizardEventData,
} from "../src/security/clientBoundary.mjs";
import {
    isDeadWalletConnectSession,
    isUserRejection,
} from "../src/utils/wallet-methods/walletErrors.mjs";
import {
    nonSelfTarget,
    resolveAccountSource,
    resolveTargetAddress,
} from "../src/utils/wallet-methods/addressBoundary.mjs";
import {
    clearWizardStorage,
    persistEvidenceRecord,
    loadCampaignEvidence,
    loadCheckEvidence,
    sanitizeEvidenceForStorage,
} from "../src/app/wizard/utils/evidenceStorage.mjs";
import {
    isAuthenticSentinelRoot,
    markSentinelRoot,
    SENTINEL_VERSION,
} from "../src/security/sentinelIdentity.mjs";
import { normalizeChainId } from "../src/utils/wallet-methods/chainId.mjs";
import {
    EIP1271_MAGIC_VALUE,
    isEip1271MagicValue,
} from "../src/utils/wallet-methods/signatureMagic.mjs";
import { walletChecksFirst } from "../src/app/wizard/utils/campaignOrder.mjs";
import {
    isReadFailure,
    isReconnectSignal,
    planWcConnect,
    WC_CONNECT_OPEN_NOTE,
} from "../src/app/wizard/utils/wcSession.mjs";
import { hasValidEip55Checksum } from "../src/app/wizard/utils/eip55.mjs";

test("wallet errors distinguish refusal from a genuinely dead WC session", () => {
    assert.equal(isUserRejection({ code: 4001, message: "User rejected" }), true);
    assert.equal(
        isDeadWalletConnectSession({ message: "Missing or invalid parameters" }),
        false,
    );
    assert.equal(
        isDeadWalletConnectSession({ message: "Unsupported method in session namespace" }),
        false,
    );
    assert.equal(
        isDeadWalletConnectSession({ message: "No matching key. Session topic does not exist" }),
        true,
    );
    assert.equal(isDeadWalletConnectSession({ message: "Session expired" }), true);
});

// authBypassBatch.js is ESM-for-the-bundler inside a CJS package, so
// `node --test` cannot import it. These two tests therefore assert against its
// SOURCE: they lock the reverted behaviour against silent reintroduction, but
// they do not execute runAuthBypassBatch.
const AUTH_BYPASS_BATCH_SRC = readFileSync(
    fileURLToPath(new URL("../src/utils/wallet-methods/authBypassBatch.js", import.meta.url)),
    "utf8",
);
const batchLoopBody = AUTH_BYPASS_BATCH_SRC.slice(
    AUTH_BYPASS_BATCH_SRC.indexOf("export const runAuthBypassBatch"),
);
const ROOT_LAYOUT_SRC = readFileSync(
    fileURLToPath(new URL("../index.html", import.meta.url)),
    "utf8",
);
const PACKAGE_JSON = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
const VITE_CONFIG_SRC = readFileSync(
    fileURLToPath(new URL("../vite.config.mjs", import.meta.url)),
    "utf8",
);
const STATIC_HEADERS_SRC = readFileSync(
    fileURLToPath(new URL("../public/_headers", import.meta.url)),
    "utf8",
);
const STATIC_REDIRECTS_SRC = readFileSync(
    fileURLToPath(new URL("../public/_redirects", import.meta.url)),
    "utf8",
);
const STEP_PAGE_SRC = readFileSync(
    fileURLToPath(new URL("../src/app/wizard/[platform]/[step]/StepPageClient.jsx", import.meta.url)),
    "utf8",
);
const NAV_STATUS_STRIP_SRC = readFileSync(
    fileURLToPath(new URL("../src/components/mainLayout/layoutBar/navBar/NavStatusStrip.jsx", import.meta.url)),
    "utf8",
);
const ACTION_RESULT_SRC = readFileSync(
    fileURLToPath(new URL("../src/app/wizard/components/ActionResult.jsx", import.meta.url)),
    "utf8",
);
const WIZARD_CONFIG = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("../src/app/wizard/config/wizard.json", import.meta.url)),
        "utf8",
    ),
);

test("the batch retains every remaining method; recovery controls the pause rather than silently dropping methods", () => {
    assert.match(batchLoopBody, /for \(const method of list\.slice\(results.length\)\) \{/);
    assert.equal(batchLoopBody.includes("break;"), false);
    assert.equal(AUTH_BYPASS_BATCH_SRC.includes("skippedRequestsAfterTimeout"), false);
    assert.equal(AUTH_BYPASS_BATCH_SRC.includes("not_attempted_after_timeout"), false);
});

test("the static entry publishes metadata and bootstraps theme before the application", () => {
    assert.match(ROOT_LAYOUT_SRC, /<title>Wallet Security Ranking — Testing Tool<\/title>/);
    assert.match(ROOT_LAYOUT_SRC, /name="description" content="Standalone testing wizard for the Wallet Security Ranking\."/);
    assert.match(ROOT_LAYOUT_SRC, /<script id="theme-bootstrap">/);
    assert(ROOT_LAYOUT_SRC.indexOf('theme-bootstrap') < ROOT_LAYOUT_SRC.indexOf('/src/main.jsx'));
    assert.match(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"), /<AppProviders>/);
});

test("wallet runtime values wait until hydration before rendering in shared chrome", () => {
    assert.match(NAV_STATUS_STRIP_SRC, /const \[hydrated, setHydrated\] = React\.useState\(false\)/);
    assert.match(NAV_STATUS_STRIP_SRC, /const displayedChainId = hydrated \? chainId : null/);
    assert.match(NAV_STATUS_STRIP_SRC, /data-chain=\{displayedChainId \|\| ''\}/);
});

test("build produces a static site without application backend routes", () => {
    assert.equal(PACKAGE_JSON.scripts.dev, "vite --port 3000");
    assert.equal(PACKAGE_JSON.scripts.build, "vite build");
    assert.equal(PACKAGE_JSON.scripts.start, undefined);
    assert.match(VITE_CONFIG_SRC, /outDir:\s*["']dist["']/);
    assert.equal(PACKAGE_JSON.dependencies.next, undefined);
    assert.equal(PACKAGE_JSON.devDependencies["eslint-config-next"], undefined);
    assert.match(STATIC_HEADERS_SRC, /X-Content-Type-Options:\s*nosniff/);
    assert.doesNotMatch(STATIC_HEADERS_SRC, /Content-Security-Policy|report-uri/i);
    assert.match(STATIC_REDIRECTS_SRC, /^\/\s+\/wizard\/\s+302/m);
    assert.match(STATIC_REDIRECTS_SRC, /^\/\*\s+\/index.html\s+200/m);
    assert.equal(existsSync(fileURLToPath(new URL("../src/proxy.js", import.meta.url))), false);
    assert.equal(existsSync(fileURLToPath(new URL("../src/app/api/csp-report/route.js", import.meta.url))), false);
});

test("malformed route encoding cannot throw during render", () => {
    assert.equal(safeDecodeRouteSegment("mobile"), "mobile");
    assert.equal(safeDecodeRouteSegment("%E0%A4%A"), null);
});

test("sentinel state is cloned and deeply read-only", () => {
    const source = { wizard: { stepsStatus: { one: { status: "done" } } } };
    const snapshot = cloneReadonly(source);
    assert.notEqual(snapshot, source);
    assert.equal(Object.isFrozen(snapshot.wizard.stepsStatus.one), true);
    assert.throws(() => { snapshot.wizard.stepsStatus.one.status = "forged"; });
    assert.equal(source.wizard.stepsStatus.one.status, "done");
});

test("wizard telemetry strips screenshot bytes", () => {
    const safe = sanitizeWizardEventData({
        step: "one",
        images: [{ annotation: "wallet", data: "data:image/png;base64,secret" }],
    });
    assert.deepEqual(safe.images, [{ annotation: "wallet", bytes: 28 }]);
    assert.equal(JSON.stringify(safe).includes("secret"), false);
});

test("wallet address boundary rejects inherited targets and records account source", () => {
    const a = "0x1111111111111111111111111111111111111111";
    const b = "0x2222222222222222222222222222222222222222";
    assert.throws(
        () => resolveTargetAddress({ params: { target: "constructor" }, catalog: { safe: a }, fallback: b }),
        /Unknown target catalog key/,
    );
    assert.throws(
        () => resolveTargetAddress({ params: { targetAddress: "0x1234" }, catalog: {}, fallback: b }),
        /Invalid targetAddress/,
    );
    assert.deepEqual(resolveAccountSource({ persisted: a }), {
        account: a,
        accountSource: "persisted",
    });
    assert.deepEqual(resolveAccountSource({ persisted: "not-an-address" }), {
        account: null,
        accountSource: null,
    });
    assert.equal(nonSelfTarget(a, a, [a, b]), b);
});

test("session evidence keeps findings but strips signatures and screenshots", () => {
    const signature = `0x${"ab".repeat(65)}`;
    const safe = sanitizeEvidenceForStorage({
        wallet_output: [{ method: "personal_sign", data_returned: signature }],
        runtime: { from: "0x1111111111111111111111111111111111111111" },
        screenshot: "data:image/png;base64,secret",
    });
    assert.equal(safe.wallet_output[0].data_returned, "[signature omitted]");
    assert.equal(safe.screenshot, "[sensitive value omitted]");
    assert.equal(safe.runtime.from, "0x1111111111111111111111111111111111111111");
});

const mockEvidenceStorage = (t, values = new Map()) => {
    const previousWindow = globalThis.window;
    globalThis.window = { sessionStorage: {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); },
        removeItem(key) { values.delete(key); },
    }, dispatchEvent() {} };
    t.after(() => {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
    return values;
};

test("session evidence isolates checks and campaigns even when each uses step 1/1", (t) => {
    const values = mockEvidenceStorage(t);
    for (const [platform, checkId] of [["extension", "WSR-PERM-001.v1"], ["extension", "WSR-PERM-003.v1"], ["mobile", "WSR-PERM-001.v1"]]) {
        assert.equal(persistEvidenceRecord({ platform, checkId, step: "1/1", evidence: { wallet_output: `0x${"ab".repeat(65)}` } }), true);
    }
    assert.equal(values.size, 3);
    assert.equal(loadCampaignEvidence("extension").length, 2);
    assert.equal(loadCampaignEvidence("mobile").length, 1);
    assert.equal(loadCheckEvidence("WSR-PERM-003.v1", "extension")[0].evidence.wallet_output, "[signature omitted]");
    persistEvidenceRecord({ platform: "extension", checkId: "WSR-PERM-001.v1", step: "1/1", evidence: { wallet_output: "Cancelled" } });
    assert.equal(values.size, 3);
    assert.equal(loadCheckEvidence("WSR-PERM-001.v1", "extension")[0].evidence.wallet_output, "Cancelled");
});

test("session evidence preserves a legacy record until that same check is rerun", (t) => {
    const legacyKey = "wsr-evidence:extension:undefined:1%2F1";
    const values = mockEvidenceStorage(t, new Map([[legacyKey, JSON.stringify({ platform: "extension", check: "WSR-PERM-003.v1", step: "1/1", evidence: { wallet_output: "previous" } })]]));
    persistEvidenceRecord({ platform: "extension", checkId: "WSR-PERM-001.v1", step: "1/1", evidence: { wallet_output: "Cancelled" } });
    assert.equal(values.has(legacyKey), true);
    assert.equal(loadCampaignEvidence("extension").length, 2);
    persistEvidenceRecord({ platform: "extension", checkId: "WSR-PERM-003.v1", step: "1/1", evidence: { wallet_output: "current" } });
    assert.equal(values.has(legacyKey), false);
    assert.equal(loadCheckEvidence("WSR-PERM-003.v1", "extension").length, 1);
    assert.equal(loadCheckEvidence("WSR-PERM-003.v1", "extension")[0].evidence.wallet_output, "current");
});

test("session clearing removes every wizard namespace and preserves unrelated data", () => {
    const values = new Map([
        ["wizard.lastAddress", "0xsecret"],
        ["wizard.platform", "mobile"],
        ["wsr-progress:check:mobile", "[1]"],
        ["wsr-evidence:mobile:check:step", "{}"],
        ["theme", "dark"],
    ]);
    const storage = {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        removeItem(key) { values.delete(key); },
    };
    assert.equal(clearWizardStorage(storage), 4);
    assert.deepEqual([...values], [["theme", "dark"]]);
});

test("auth-bypass records the raw value the wallet returned, unredacted", () => {
    // HEAD behaviour: data_returned is whatever came back, for every method
    // including the signing/decrypt ones. No redaction wrapper.
    assert.match(batchLoopBody, /data_returned = r \?\? null;/);
    assert.equal(AUTH_BYPASS_BATCH_SRC.includes("summarizeAuthBypassData"), false);
    assert.equal(AUTH_BYPASS_BATCH_SRC.includes("sensitive_data_returned"), false);
});

test("sentinel consumers reject lookalike globals without module provenance", () => {
    const forged = { version: SENTINEL_VERSION, actions: Object.freeze({}) };
    assert.equal(isAuthenticSentinelRoot(forged), false);

    const authentic = { version: SENTINEL_VERSION, actions: Object.freeze({}) };
    assert.equal(markSentinelRoot(authentic), true);
    assert.equal(isAuthenticSentinelRoot(authentic), true);
});

test("chain ids compare in one canonical hexadecimal representation", () => {
    assert.equal(normalizeChainId(137), "0x89");
    assert.equal(normalizeChainId("137"), "0x89");
    assert.equal(normalizeChainId("0x089"), "0x89");
    assert.equal(normalizeChainId("not-a-chain"), null);
    assert.equal(normalizeChainId(-1), null);
});

test("EIP-1271 accepts only the contract signature magic value", () => {
    assert.equal(isEip1271MagicValue(EIP1271_MAGIC_VALUE), true);
    assert.equal(isEip1271MagicValue(`${EIP1271_MAGIC_VALUE}${"00".repeat(28)}`), true);
    assert.equal(isEip1271MagicValue("0xffffffff"), false);
    assert.equal(isEip1271MagicValue(null), false);
});

test("Full dApp URL display is the ninth celeste check in both campaigns", () => {
    const all = Object.entries(WIZARD_CONFIG.wizard.checks).map(([id, check]) => ({
        id,
        canonicalId: check.steps?.[0]?.canonicalId ?? "",
        walletOnly: check.walletOnly === true,
    }));
    const inCampaign = (check, platform) =>
        platform === "mobile"
            ? !check.canonicalId.includes("~Browser")
            : !check.canonicalId.includes("~Mobile");

    for (const platform of ["extension", "mobile"]) {
        const ordered = walletChecksFirst(all.filter((check) => inCampaign(check, platform)));
        assert.equal(ordered[8]?.id, "WSR-THRE-006");
        assert.equal(ordered.slice(0, 9).every((check) => check.walletOnly), true);
        assert.equal(ordered[9]?.walletOnly, false);
    }
});

test("WalletConnect dispatches when its provider exists even if AppKit state lags", () => {
    const provider = { request: async () => null };
    assert.deepEqual(planWcConnect({ isConnected: false, walletProvider: null }), {
        mode: "open",
        note: WC_CONNECT_OPEN_NOTE,
    });
    assert.deepEqual(
        planWcConnect({ isConnected: false, walletProvider: provider, chainId: 137 }),
        { mode: "dispatch", provider, params: { __wcChainId: 137 } },
    );
    assert.equal(isReconnectSignal({ status: "reconnect_required" }), true);
    assert.equal(isReadFailure({ status: "read_failed" }), true);
});

test("Every check starts on Polygon using the action transport, with setup separate from test requests", () => {
    assert.match(STEP_PAGE_SRC, /const chainProvider = runtime\.provider/);
    assert.match(STEP_PAGE_SRC, /const runtime = useWalletRuntime\(transport\)/);
    assert.match(STEP_PAGE_SRC, /const requiredChain = POLYGON_CHAIN_ID/);
    assert.match(STEP_PAGE_SRC, /runtime\.switchToPolygon\(\)/);
    assert.doesNotMatch(STEP_PAGE_SRC, /runSwitch\(true\)/);
    assert.doesNotMatch(STEP_PAGE_SRC, /if \(platform !== "extension"\) return;/);
});

test("EIP-55 telemetry accepts checksummed mixed-case addresses only", () => {
    assert.equal(hasValidEip55Checksum("0x8ba1f109551bD432803012645Ac136ddd64DBA72"), true);
    assert.equal(hasValidEip55Checksum("0x8ba1f109551bd432803012645ac136ddd64dba72"), false);
    assert.equal(hasValidEip55Checksum("0x8ba1f109551bd432803012645Ac136ddd64DBA72"), false);
    assert.equal(hasValidEip55Checksum("not-an-address"), false);
});

test("the standalone wizard has no direct UI framework or animation dependency", () => {
    const dependencies = PACKAGE_JSON.dependencies ?? {};
    for (const name of ["framer-motion", "web3-validator", "@mui/material", "@emotion/react"]) {
        assert.equal(Object.hasOwn(dependencies, name), false, `${name} must not be a direct dependency`);
    }
});

test("Mobile uses the shared ten-entry phishing URL list", () => {
    const check = WIZARD_CONFIG.wizard.checks["WSR-THRE-003"];
    assert.equal(check.canonicalId, "WSR-THRE-003.v1");
    assert.deepEqual(check.steps[0].ui.content.links, [
        "scam_dapp_url",
        "scam_dapp_url_2",
        "scam_dapp_url_3",
        "scam_dapp_url_4",
        "scam_dapp_url_5",
        "scam_dapp_url_6",
        "scam_dapp_url_7",
        "scam_dapp_url_8",
        "scam_dapp_url_9",
        "scam_dapp_url_10",
    ]);
});

test("Mismatching EIP-712 chainId detection records an approved signature on both platforms", () => {
    const step = WIZARD_CONFIG.wizard.checks["WSR-PERM-003"].steps[0];
    assert.equal(step.expectedOutcome, "approve");
    assert.equal(step.ui.content.steps[1].action, "Approve the request.");
    assert.match(step.ui.content.steps[1].expect, /signature is recorded as evidence/i);
    assert.match(ACTION_RESULT_SRC, /const genericResult = typeof success === 'string'/);
    assert.match(ACTION_RESULT_SRC, /typeof success\.result === 'string'/);
});
