import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ethers } from "ethers";
import { inspectEthSignSignature } from "../src/utils/wallet-methods/ethSignVerification.mjs";
import { Web3 } from "web3";
import { sanitizeEvidenceForStorage } from "../src/app/wizard/utils/evidenceStorage.mjs";
import { compareChecksumDisplay, checksumComparisonSummary, visibleChecksumInput } from "../src/app/wizard/utils/checksumComparison.mjs";
import { nonSelfTarget, resolveTargetAddress } from "../src/utils/wallet-methods/addressBoundary.mjs";
import { requestChainSwitch } from "../src/utils/wallet-methods/chainSwitchProbe.mjs";
import { snapshotError, withRequestDiagnostics } from "../src/utils/wallet-methods/requestDiagnostics.mjs";
import { simpleTransaction } from "../src/utils/wallet-methods/simpleTransaction.mjs";
import { polygonGuardedProvider } from "../src/utils/wallet-methods/polygonPolicy.mjs";
import { MANUAL_GUIDANCE } from "../src/app/wizard/utils/manualGuidance.mjs";
import { GUIDED_COMPARISONS, comparisonContextsDiffer, comparisonEvidence, comparisonObservation, runComparisonStep, sameGuidedContext } from "../src/app/wizard/utils/guidedComparison.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const checks = JSON.parse(read("src/app/wizard/config/wizard.json")).wizard.checks;
const constantSource = read("src/utils/constants.js");
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"ab".repeat(32)}`;
const step = checks["WSR-VERI-005"].steps[0];
const provider = { request: async () => [ACCOUNT], session: { peer: { metadata: { name: "Mobile mock" } } } };
const runtime = { provider, address: ACCOUNT, chainId: "0x89" };

test("guided presentation is limited to nine reviewed checks, preserving configured order and params", () => {
    assert.deepEqual(Object.keys(GUIDED_COMPARISONS).sort(), ["WSR-PERM-001.v1", "WSR-PERM-003.v1", "WSR-PERM-006.v1", "WSR-PERM-009.v1", "WSR-THRE-002.v2", "WSR-VERI-001.v1", "WSR-VERI-002.v1", "WSR-VERI-003.v1", "WSR-VERI-005.v1"]);
    for (const [id, actions, params] of [
        ["WSR-VERI-001", ["sendInvalidChecksumTransaction"], [{ target: "checksumProbeBadChecksum", chain: "polygon" }]],
        ["WSR-VERI-005", ["approveTestErc20", "approveTestErc20"], [{ chain: "polygon" }, { chain: "polygon", useTestToken: true }]],
        ["WSR-VERI-003", ["provideLiquidity", "simulateSwap"], [{ chain: "polygon" }, { chain: "polygon" }]],
        ["WSR-THRE-002", ["sendFamiliarRecipientTransaction", "sendScamTransaction", "sendPoisonTransaction"], [
            { target: "familiarRecipient", chain: "polygon" }, { target: "scamAddress", chain: "polygon" }, { target: "poisonAddress", chain: "polygon" },
        ]],
    ]) {
        assert.equal(checks[id].requiredChain, "0x89");
        assert.deepEqual(checks[id].steps.map((s) => s.ui.content.button.action), actions);
        assert.deepEqual(checks[id].steps.map((s) => s.data.params), params);
        assert.equal(GUIDED_COMPARISONS[checks[id].canonicalId].stages.length, checks[id].steps.length);
    }
    for (const [id, actions, params] of [
        ["WSR-VERI-002", ["sendExplorerLinkTransaction"], [{ target: "testerWallet2" }]],
        ["WSR-PERM-006", ["ethSignMethod"], [undefined]],
        ["WSR-PERM-009", ["switchChains", "switchChains"], [{ switchTo: "mainnet" }, { switchTo: "zksync" }]],
    ]) {
        assert.equal(checks[id].requiredChain, undefined);
        assert.deepEqual(checks[id].steps.map((s) => s.ui.content.button.action), actions);
        assert.deepEqual(checks[id].steps.map((s) => s.data.params), params);
        assert.equal(GUIDED_COMPARISONS[checks[id].canonicalId].stages.length, checks[id].steps.length);
    }
});

test("manual guidance covers only wallet-only checks and preserves every original instruction slot", () => {
    const manual = Object.values(checks).filter((check) => check.walletOnly);
    assert.equal(manual.length, 11);
    assert.deepEqual(Object.keys(MANUAL_GUIDANCE).sort(), manual.map((check) => check.canonicalId).sort());
    for (const check of manual) {
        assert.equal(check.steps.length, 1);
        assert.equal(check.steps[0].ui.content.button, undefined);
        const guidance = MANUAL_GUIDANCE[check.canonicalId];
        assert.equal(guidance.titles.length, check.steps[0].ui.content.steps.length);
        assert(guidance.objective.length > 0);
        assert(guidance.titles.every((title) => typeof title === "string" && title.length > 0));
    }
});

test("guided signing keeps SIWE rejection and EIP-712 approval instructions separate", () => {
    for (const [id, action, outcome] of [["WSR-PERM-001", "siweSign", "reject"], ["WSR-PERM-003", "differentChainId", "approve"]]) {
        const check = checks[id];
        assert.equal(check.steps.length, 1);
        assert.equal(check.steps[0].ui.content.button.action, action);
        assert.equal(check.steps[0].expectedOutcome ?? "reject", outcome);
        assert.equal(check.steps[0].data.params, undefined);
        assert.equal(GUIDED_COMPARISONS[check.canonicalId].stages.length, 1);
    }
    assert.equal(checks["WSR-PERM-001"].requiredChain, undefined);
    assert.equal(checks["WSR-PERM-003"].requiredChain, "0x89");
    assert.match(GUIDED_COMPARISONS["WSR-PERM-001.v1"].safety, /cancel/);
    assert.match(GUIDED_COMPARISONS["WSR-PERM-003.v1"].safety, /approving/);
});

test("Mobile comparison uses only its WC provider and preserves declared params", async () => {
    const before = JSON.stringify(step);
    const result = await runComparisonStep({ platform: "mobile", step, runtime, identity: { name: "Wrong extension" }, dispatch: async (platform, action, suppliedProvider, params) => {
        assert.equal(platform, "mobile"); assert.equal(action, "approveTestErc20"); assert.equal(suppliedProvider, provider);
        assert.deepEqual(params, { chain: "polygon", __wcChainId: "0x89" });
        return { status: "rejected_by_user", runtime: { from: ACCOUNT, quote: "preserved" } };
    } });
    assert.equal(result.runtime.provider.name, "Mobile mock");
    assert.equal(result.runtime.transport, "walletconnect");
    assert.equal(result.runtime.quote, "preserved");
    assert.equal(JSON.stringify(step), before);
});

test("missing connection and failed extension preflight never dispatch a test", async () => {
    let dispatched = false;
    const dispatch = async () => { dispatched = true; };
    for (const platform of ["extension", "mobile"]) {
        assert.deepEqual(await runComparisonStep({ platform, step, runtime: {}, dispatch }), { needsConnection: true });
    }
    assert.deepEqual(await runComparisonStep({ platform: "extension", step, runtime: { provider: { request: async () => [] } }, dispatch }), { needsConnection: true });
    const failed = await runComparisonStep({ platform: "extension", step, runtime: { provider: { request: async () => { throw { code: -32000, message: "Read failed" }; } } }, dispatch });
    assert.equal(failed.preflightFailed, true);
    assert.equal(failed.error.code, -32000);
    assert.equal(comparisonObservation(failed).inconclusive, true);
    assert.equal(dispatched, false);
});

test("tester cancellation is a neutral outcome and preserves the raw wallet error in evidence", async () => {
    const run = await runComparisonStep({ platform: "mobile", step, runtime, dispatch: async () => { throw { code: -2, message: "Cancelled" }; } });
    assert.deepEqual(run.error, { code: -2, message: "Cancelled" });
    assert.deepEqual(comparisonObservation(run), { title: "Cancelled by tester", inconclusive: false, cancelled: true });
    const params = { method: "eth_sendTransaction", target: "unchanged", value: "0x0" };
    const evidence = comparisonEvidence({ checkId: "WSR-VERI-005.v1", stepNumber: 1, totalSteps: 2, parameters: params }, run, "https://example.test");
    assert.equal(evidence.parameters, params);
    assert.equal(evidence.wallet_output, "Cancelled");
    assert.equal(evidence.code, -2);
    assert.equal(evidence.request_outcome, "cancelled_by_tester");
    assert.equal(evidence.automatic_verdict, null);
});

test("only explicit tester refusals are presented as cancellations, not transport errors", () => {
    for (const error of [
        { code: 4001, message: "Request rejected" }, { message: "User denied transaction signature." },
        { message: "Cancelled" }, { message: "Canceled" }, { code: -2, message: "Cancelled" },
        { message: "  cancelled. " }, { message: "User canceled" }, { message: "Cancelled by user" },
        { message: "Returned error: Cancelled" },
    ]) assert.equal(comparisonObservation({ error }).cancelled, true, JSON.stringify(error));
    for (const error of [
        { code: -2, message: "Internal error" }, { code: -2 }, { message: "Request timed out" },
        { message: "Session expired" }, { message: "RPC request cancelled by timeout" },
        { message: "AbortError" }, { message: "Connection cancelled" }, { message: "Not support" },
    ]) {
        const run = { error };
        assert.equal(comparisonObservation(run).inconclusive, true, JSON.stringify(error));
        assert.equal(comparisonObservation(run).cancelled, undefined);
        assert.equal(comparisonEvidence({}, run, "https://example.test").request_outcome, undefined);
    }
});

test("error summaries are concise without claiming wallet rejection or changing raw evidence", () => {
    for (const error of [
        { code: -1, message: "Not support" },
        { code: -32603, message: "Internal error" },
        { message: "Connection lost" },
        { message: "Request timed out" },
    ]) {
        const run = { error };
        assert.deepEqual(comparisonObservation(run, { method: "eth_sign" }), { title: "Request returned an error", inconclusive: true });
        const evidence = comparisonEvidence({ method: "eth_sign" }, run, "https://example.test");
        assert.equal(evidence.wallet_output, error.message);
        assert.equal(evidence.code, error.code);
        assert.equal(evidence.automatic_verdict, null);
    }
    assert.deepEqual(comparisonObservation({ error: { code: -2, message: "Cancelled" } }, { method: "eth_sign" }), {
        title: "Cancelled by tester", inconclusive: false, cancelled: true,
    });
});

test("unrecognized responses omit the redundant review instruction without becoming a verdict", () => {
    assert.deepEqual(comparisonObservation({ result: "some other report" }, { method: "eth_sign" }), {
        title: "Response recorded", inconclusive: true,
    });
    assert.doesNotMatch(read("src/app/wizard/utils/guidedComparison.mjs"), /review the observation/);
});

test("setup, RPC failures, empty responses and context drift remain inconclusive", () => {
    for (const run of [null, { result: null }, { result: { status: "read_failed" } }, { result: { status: "reconnect_required" } },
        { result: { status: "rejected_by_user", at: "chain_switch" } }, { result: { status: "error", at: "chain_read" } },
        { result: { status: "rejected_by_user" }, contextChanged: true },
        { error: { message: "Cancelled" }, preflightFailed: true },
        { error: { message: "Cancelled" }, contextChanged: true }]) {
        assert.equal(comparisonObservation(run).inconclusive, true);
        assert.equal(comparisonObservation(run).cancelled, undefined);
    }
    assert.equal(comparisonObservation({ result: { status: "rejected_by_user" } }).title, "Cancelled by tester");
    assert.equal(comparisonObservation({ result: HASH }).sent, true);
    assert.equal(comparisonObservation({ result: { hash: HASH } }).sent, true);
});

// Execute the actual, unchanged handlers using real ethers encoding. Only the
// provider, on-chain reads and clock are mocked. No network or real wallet.
// These named arrow functions all close with a top-level `\n};` in the source.
function sourceFunction(path, name, bindings) {
    bindings = { polygonGuardedProvider, ...bindings };
    const source = read(path);
    const start = source.indexOf(`const ${name} =`);
    assert(start >= 0, `Missing function ${name}`);
    const end = source.indexOf("\n};", start) + 4;
    return new Function(...Object.keys(bindings), `${source.slice(start, end)}\nreturn ${name};`)(...Object.values(bindings));
}

const SIGNATURE = `0x${"ab".repeat(65)}`;
const messages = await import(`data:text/javascript;base64,${Buffer.from(read("src/utils/signMessages.js")).toString("base64")}`);
const siweFields = { nonce: "545216abcd123456", issuedAt: "2026-09-17T00:00:00.000Z" };
const typedDataTemplate = JSON.parse(read("src/api/openSeaEIP_712.json"));
const mismatchedChainId = JSON.parse(constantSource.match(/export const DIFFERENT_CHAIN_ID = ([^;]+);/)[1]);

function signingFixture(rejection = null, rawSigner = null) {
    const sent = [];
    const wallet = { request: async (request) => {
        if (request.method === "eth_accounts") return [rawSigner?.address ?? ACCOUNT];
        if (request.method === "eth_chainId") return "0x89";
        assert(["personal_sign", "eth_signTypedData_v4", "eth_sign"].includes(request.method), `Unexpected RPC ${request.method}`);
        sent.push(structuredClone(request));
        if (rejection) throw rejection;
        if (rawSigner && request.method === "eth_sign") return ethers.utils.joinSignature(rawSigner._signingKey().signDigest(request.params[1]));
        return SIGNATURE;
    } };
    const verificationCalls = [];
    wallet.identity = {};
    const mockEthers = { ...ethers, providers: { Web3Provider: class {
        constructor(provider) { assert.equal(provider.identity, wallet.identity); this.provider = provider; }
        listAccounts() { return this.provider.request({ method: "eth_accounts" }); }
        send(method, params) { return this.provider.request({ method, params }); }
    } } };
    const bindings = {
        ...messages, ethers: mockEthers, Web3, getActiveProvider: () => wallet,
        buildSiweMismatchMessage: (address, options) => messages.buildSiweMismatchMessage(address, { ...siweFields, ...options }),
        snapshotError, inspectEthSignSignature,
        EIP_712: typedDataTemplate, DIFFERENT_CHAIN_ID: mismatchedChainId,
        PERSONAL_SIGN_MESSAGE: "unused for SIWE",
        PERSONAL_SIGN: JSON.parse(constantSource.match(/export const PERSONAL_SIGN = ([^;]+);/)[1]),
        Date: class extends Date { constructor() { super("2026-09-17T00:00:00.000Z"); } },
        Math: { floor: Math.floor, random: () => 0.545216 },
        console: { error() {}, log() {} }, // Expected rejections still follow the real catch/rethrow.
        verifyWalletSignature: async ({ account, digest, signature }) => {
            verificationCalls.push({ account, digest, signature });
            return { verified: true, fixture: true };
        },
    };
    bindings.retrieveAddress = sourceFunction("src/utils/wallet-methods/wc/methods.js", "retrieveAddress", bindings);
    for (const [path, name] of [
        ["ext", "signInWithEthereum"], ["ext", "sendTypedData"],
        ["wc", "sendPersonalSignWC"], ["wc", "sendTypedDataWC"],
        ["ext", "ethSign"], ["wc", "ethSignWC"],
    ]) bindings[name] = sourceFunction(`src/utils/wallet-methods/${path}/methods.js`, name, bindings);
    const dispatch = sourceFunction("src/utils/wallet-methods/actionMethods.js", "handleAction", bindings);
    return { wallet, dispatch, sent, verificationCalls };
}

test("signing observations show returned bytes without confusing signatures, transaction hashes or errors", () => {
    const options = { method: "eth_signTypedData_v4", expectedOutcome: "approve" };
    for (const result of [SIGNATURE, { result: SIGNATURE, runtime: {} }, "0x12345678"]) {
        const observation = comparisonObservation({ result }, options);
        assert.match(observation.title, /Action completed/);
        assert.equal(observation.inconclusive, false);
        assert.equal(observation.sent, undefined);
        assert.equal(observation.returnedValue, typeof result === "string" ? result : result.result);
    }
    assert.match(comparisonObservation({ result: SIGNATURE }, { method: "personal_sign" }).title, /was not cancelled/);
    for (const result of ["0x", "0x123", "not a signature", {}, null]) {
        assert.equal(comparisonObservation({ result }, options).inconclusive, true);
        assert.equal(comparisonObservation({ result }, options).returnedValue, undefined);
    }
    const cancelled = comparisonObservation({ error: { message: "Cancelled" } }, options);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.inconclusive, true);
    assert.match(cancelled.title, /no signature returned/);
    assert.equal(comparisonObservation({ result: SIGNATURE, contextChanged: true }, options).inconclusive, true);
});

for (const platform of ["extension", "mobile"]) {
    for (const [id, method] of [["WSR-PERM-001", "personal_sign"], ["WSR-PERM-003", "eth_signTypedData_v4"]]) {
        test(`${id} ${platform}: guided and direct signing send identical payloads and preserve returned evidence`, async () => {
            const s = checks[id].steps[0];
            const previous = signingFixture();
            const guided = signingFixture();
            const baseline = JSON.stringify(typedDataTemplate);
            await previous.dispatch(platform, s.ui.content.button.action, previous.wallet, platform === "mobile" ? { __wcChainId: "0x89" } : {});
            const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: guided.wallet }, dispatch: guided.dispatch });
            assert.equal(run.error, undefined, JSON.stringify(run));
            // Web3 assigns a fresh correlation id; compare the actual method
            // and all payload params, including the complete encoded message.
            const payloads = (requests) => requests.map(({ method, params }) => ({ method, params }));
            assert.deepEqual(payloads(guided.sent), payloads(previous.sent));
            assert.deepEqual(guided.verificationCalls, previous.verificationCalls);
            assert.equal(guided.sent.length, 1);
            assert.equal(guided.sent[0].method, method);
            assert.equal(JSON.stringify(typedDataTemplate), baseline);
            if (method === "personal_sign") {
                const message = ethers.utils.toUtf8String(guided.sent[0].params[0]);
                assert.match(message, /opensea\.io wants you to sign in/);
                assert.match(message, /URI: https:\/\/opensea\.io/);
                assert.equal(message, messages.buildSiweMismatchMessage(ACCOUNT, siweFields));
                assert.match(message, /Chain ID: 137\nNonce: 545216abcd123456\nIssued At: 2026-09-17T00:00:00.000Z/);
                assert.equal(run.runtime.siwe_message, message);
            } else {
                const typed = JSON.parse(guided.sent[0].params[1]);
                assert.equal(typed.domain.chainId, mismatchedChainId);
                assert.equal(typed.message.offerer, ACCOUNT);
            }
            const resolved = { checkId: s.canonicalId, stepNumber: 1, totalSteps: 1, method, parameters: { method } };
            const evidence = comparisonEvidence(resolved, run, "https://example.test");
            assert.equal(evidence.step, "1/1");
            assert.equal(evidence.parameters, resolved.parameters);
            assert.equal(evidence.wallet_output, SIGNATURE);
            assert.equal(evidence.runtime.platform, platform);
            assert.equal(evidence.runtime.from.toLowerCase(), ACCOUNT.toLowerCase());
            assert.equal(evidence.automatic_verdict, null);
            assert.equal(sanitizeEvidenceForStorage(evidence).wallet_output, "[signature omitted]");
            assert.equal(comparisonObservation(run, { method, expectedOutcome: s.expectedOutcome }).returnedValue, SIGNATURE);
        });
        test(`${id} ${platform}: cancelled signing is preserved and never invents a signature`, async () => {
            const s = checks[id].steps[0];
            for (const rejection of [{ code: 4001, message: "User rejected the request." }, { code: -2, message: "Cancelled" }]) {
                const mock = signingFixture(rejection);
                const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: mock.wallet }, dispatch: mock.dispatch });
                assert.equal(mock.sent.length, 1);
                assert.equal(mock.verificationCalls.length, 0);
                assert.equal(run.error.message, platform === "extension" && id === "WSR-PERM-001"
                    ? `Returned error: ${rejection.message}` : rejection.message);
                const observation = comparisonObservation(run, { method, expectedOutcome: s.expectedOutcome });
                assert.equal(observation.cancelled, true);
                assert.equal(observation.returnedValue, undefined);
                assert.equal(observation.inconclusive, id === "WSR-PERM-003");
                const evidence = comparisonEvidence({ method }, run, "https://example.test");
                assert.equal(evidence.wallet_output, run.error.message);
                assert.equal(evidence.failed_method, method);
                assert.equal(evidence.automatic_verdict, null);
            }
        });
    }
}

const constants = Object.fromEntries([
    "APPROVE_AMOUNT", "APPROVE_SPENDER", "TEST_ERC20_ADDRESS", "USDC_E", "WMATIC", "SWAP_FEE", "SWAP_AMOUNT_IN",
    "LP_AMOUNT_IN", "LP_TICK_SPACING", "SWAP_ROUTER_02", "QUOTER_V2", "UNISWAP_V3_FACTORY", "NONFUNGIBLE_POSITION_MANAGER",
    "TESTER_WALLET_1", "TESTER_WALLET_2",
].map((name) => {
    const literal = constantSource.match(new RegExp(`export const ${name} = ([^;]+);`));
    assert(literal, `Missing constant ${name}`);
    return [name, JSON.parse(literal[1])];
}));
constants.TEST_ERC20_ABI = JSON.parse(read("src/app/wizard/config/test-token-artifact.json")).abi;
// Evaluate the actual frozen derivation: never rebuild or normalize the target
// in the presentation or in the payload-parity fixture.
const checksumSource = constantSource.slice(constantSource.indexOf("export const CHECKSUM_PROBE_ADDRESS ="), constantSource.indexOf("export const targets ="));
Object.assign(constants, new Function(`${checksumSource.replaceAll("export const", "const")}\nreturn { CHECKSUM_PROBE_ADDRESS, CHECKSUM_PROBE_BAD_CHECKSUM };`)());
const txOptions = new Function("DEFAULT_SEND_TO", `${constantSource.match(/export const txOptions = ([\s\S]*?);/)[0].replace("export const", "const")}\nreturn txOptions;`)(messages.DEFAULT_SEND_TO);
Object.assign(constants, { familiarRecipientAddress: txOptions.default, scamAddress: txOptions.tornadoScam, poisonAddress: txOptions.poison });

function fixture(rejection = { code: 4001, message: "User rejected" }, account = ACCOUNT) {
    const sent = [];
    const wallet = { request: async (request) => {
        if (request.method === "eth_accounts" || request.method === "eth_requestAccounts") return [account];
        if (request.method === "eth_chainId") return "0x89";
        if (request.method === "eth_sendTransaction") {
            sent.push(structuredClone(request));
            if (rejection) throw rejection;
            return HASH;
        }
        throw new Error(`Unexpected method ${request.method}`);
    } };
    wallet.identity = {};
    const mockEthers = { ...ethers,
        providers: { Web3Provider: class { constructor(p) { assert.equal(p.identity, wallet.identity); } } },
        Contract: class {
            async getPool() { return POOL; }
            async slot0() { return { tick: 127 }; }
            callStatic = { quoteExactInputSingle: async () => ({ amountOut: ethers.BigNumber.from(123456) }) };
        },
    };
    const bindings = { ...constants, nonSelfTarget, simpleTransaction, ethers: mockEthers, Date: { now: () => 1_789_000_000_000 },
        getActiveProvider: () => wallet,
        isUserRejectionErr: (error) => error.code === 4001,
        isUserRejectionErrWC: (error) => error.code === 4001,
        readChainHexWC: async (p) => p.request({ method: "eth_chainId" }),
        wcReadProvider: (p) => { assert.equal(p.identity, wallet.identity); return {}; },
        readFailed: (note) => ({ status: "read_failed", note }),
    };
    for (const name of ["approveTestErc20", "provideLiquidity", "simulateSwap"]) {
        bindings[name] = sourceFunction("src/utils/wallet-methods/ext/methods.js", name, bindings);
        bindings[`${name}WC`] = sourceFunction("src/utils/wallet-methods/wc/methods.js", `${name}WC`, bindings);
    }
    bindings.sendTransactionWithFallback = sourceFunction("src/utils/wallet-methods/ext/methods.js", "sendTransactionWithFallback", bindings);
    bindings.sendTransaction = sourceFunction("src/utils/wallet-methods/wc/methods.js", "sendTransaction", bindings);
    bindings.resolveTarget = sourceFunction("src/utils/wallet-methods/actionMethods.js", "resolveTarget", {
        resolveTargetAddress, targets: { checksumProbeBadChecksum: constants.CHECKSUM_PROBE_BAD_CHECKSUM, testerWallet2: constants.TESTER_WALLET_2,
            familiarRecipient: constants.familiarRecipientAddress, scamAddress: constants.scamAddress, poisonAddress: constants.poisonAddress },
    });
    bindings.ensureChain = async (chain, p) => { assert.equal(chain, "polygon"); assert.equal(p.identity, wallet.identity); return { switched: false }; };
    bindings.chainLanded = (r) => r && r.status === undefined;
    bindings.withRequestDiagnostics = withRequestDiagnostics;
    bindings.sendRecipientTransaction = sourceFunction("src/utils/wallet-methods/actionMethods.js", "sendRecipientTransaction", bindings);
    const dispatch = sourceFunction("src/utils/wallet-methods/actionMethods.js", "handleAction", bindings);
    return { sent, wallet, dispatch };
}

function switchFixture(response) {
    const sent = [];
    const wallet = { request: async (request) => {
        if (request.method === "eth_accounts") return [ACCOUNT];
        if (request.method === "eth_chainId") return "0x89";
        assert.equal(request.method, "wallet_switchEthereumChain");
        sent.push(structuredClone(request));
        if (response) throw response;
        return null;
    } };
    wallet.session = { topic: "switch-test", namespaces: { eip155: { chains: ["eip155:137"], methods: ["wallet_switchEthereumChain"] } } };
    wallet.client = { session: { get: () => wallet.session }, request: ({ request }) => wallet.request(request) };
    const catalogNames = ["SWITCH_CHAINS_PARAMS", "SWITCH_CHAINS_PARAMS_2", "chains"];
    const catalog = catalogNames.map((name) => constantSource.match(new RegExp(`export const ${name} = ([\\s\\S]*?);`))[0].replace("export const", "const")).join("\n");
    const bindings = {
        chains: new Function(`${catalog}\nreturn chains;`)(),
        getActiveProvider: () => wallet,
        requestChainSwitch,
        console: { error() {} },
        isUserRejectionErrWC: (error) => error.code === 4001,
        ethers: { providers: { Web3Provider: class {
            constructor(provider) { assert.equal(provider, wallet); }
            send(method, params) { return wallet.request({ method, params }); }
        } } },
    };
    bindings.handleSwitchChain = sourceFunction("src/utils/wallet-methods/ext/methods.js", "handleSwitchChain", bindings);
    bindings.handleSwitchChainWC = sourceFunction("src/utils/wallet-methods/wc/methods.js", "handleSwitchChainWC", bindings);
    return { wallet, sent, dispatch: sourceFunction("src/utils/wallet-methods/actionMethods.js", "handleAction", bindings) };
}

test("chain-switch observations distinguish the test itself from preparation for a transaction", () => {
    for (const status of ["switch_response", "switch_cancelled", "chain_not_added"]) {
        const run = { result: { status, at: "chain_switch" } };
        assert.equal(comparisonObservation(run, { method: "wallet_switchEthereumChain" }).inconclusive, status === "chain_not_added");
        assert.equal(comparisonObservation(run, { method: "eth_sendTransaction" }).inconclusive, true);
        assert.equal(comparisonObservation({ ...run, preflightFailed: true }, { method: "wallet_switchEthereumChain" }).inconclusive, true);
        assert.equal(comparisonObservation({ ...run, contextChanged: true }, { method: "wallet_switchEthereumChain" }).inconclusive, true);
    }
});

test("poisoning guidance approves only setup and requires confirmed history before testing the lookalike", () => {
    const presentation = GUIDED_COMPARISONS["WSR-THRE-002.v2"];
    assert.equal(presentation.historySetup, true);
    assert.match(presentation.safety, /Approve ONLY.*0-value.*costs gas.*Cancel both/);
    assert.equal(presentation.stages[0].expectedOutcome, "approve");
    assert.match(presentation.stages[0].instruction, /confirmed outgoing transaction/);
    for (const stage of presentation.stages.slice(1)) {
        assert.equal(stage.expectedOutcome, undefined);
        assert.match(stage.instruction, /cancel/);
    }
    assert.match(presentation.review, /by hand.*cancel both.*Do not send/);
});

test("history prerequisites are scoped to the same account, provider, WC session and normalized chain", () => {
    const context = { provider, topic: "original-session", address: ACCOUNT, chainId: "0x89" };
    assert.equal(sameGuidedContext(context, { ...context, address: ACCOUNT.toUpperCase(), chainId: 137 }), true);
    for (const changed of [{ provider: {} }, { topic: "new-session" }, { address: POOL }, { chainId: "0x1" }]) {
        assert.equal(sameGuidedContext(context, { ...context, ...changed }), false);
    }
    assert.equal(sameGuidedContext(context, { ...context, chainId: "0x1" }, true), true);
    assert.equal(sameGuidedContext(context, { ...context, address: POOL }, true), false);
});

test("cross-part warnings include the third request and still work when setup used existing history", () => {
    const first = { runtime: { from: ACCOUNT, chain_id: "0x89", provider: { name: "Mock" } } };
    const other = { runtime: { ...first.runtime, from: POOL } };
    assert.equal(comparisonContextsDiffer([first, first, first]), false);
    assert.equal(comparisonContextsDiffer([first, first, other]), true);
    assert.equal(comparisonContextsDiffer([null, first, other]), true);
    assert.equal(comparisonContextsDiffer([null, first, first]), false);
    assert.equal(comparisonContextsDiffer([null, null, null]), false);
    const switched = { runtime: { ...first.runtime, chain_id: "0x1" } };
    assert.equal(comparisonContextsDiffer([first, switched]), true);
    assert.equal(comparisonContextsDiffer([first, switched], true), false);
});

test("eth_sign summaries preserve known handler reports without inventing a block or automatic verdict", () => {
    for (const result of ["Wallet used personal_sign", "Wallet used personal_sign, converted to bytes"]) {
        const observation = comparisonObservation({ result }, { method: "eth_sign" });
        assert.equal(observation.title, result);
        assert.equal(observation.inconclusive, false);
    }
    assert.equal(comparisonObservation({ result: "Could not recover address" }, { method: "eth_sign" }).inconclusive, true);
    for (const run of [{ error: { message: "Method not found" } }, { error: { message: "Connection lost" } }, { result: "some other report" }]) {
        assert.equal(comparisonObservation(run, { method: "eth_sign" }).inconclusive, true);
        assert.equal(comparisonEvidence({ method: "eth_sign" }, run, "https://example.test").automatic_verdict, null);
    }
});

for (const platform of ["extension", "mobile"]) {
    test(`WSR-THRE-002 ${platform}: setup, malicious and poisoned requests keep their exact ordered addresses and zero value`, async () => {
        const previous = fixture(null);
        const guided = fixture(null);
        const check = checks["WSR-THRE-002"];
        const frozen = JSON.stringify(check);
        for (const [index, s] of check.steps.entries()) {
            const params = { ...s.data.params, ...(platform === "mobile" ? { __wcChainId: "0x89" } : {}) };
            await previous.dispatch(platform, s.ui.content.button.action, previous.wallet, params);
            const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: guided.wallet }, dispatch: guided.dispatch });
            assert.equal(run.error, undefined, JSON.stringify(run));
            const observation = comparisonObservation(run, { method: "eth_sendTransaction", expectedOutcome: index === 0 ? "approve" : undefined });
            assert.equal(observation.title, index === 0 ? "Transaction hash returned" : "Transaction hash returned — the request was not rejected");
            const evidence = comparisonEvidence({ method: "eth_sendTransaction", stepNumber: index + 1, totalSteps: 3, parameters: s.data.params }, run, "https://example.test");
            assert.equal(evidence.step, `${index + 1}/3`);
            assert.equal(evidence.parameters, s.data.params);
            assert.equal(evidence.wallet_output, HASH);
            assert.equal(evidence.automatic_verdict, null);
        }
        assert.deepEqual(guided.sent, previous.sent);
        assert.deepEqual(guided.sent, [constants.familiarRecipientAddress, constants.scamAddress, constants.poisonAddress]
            .map((to) => ({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to, value: "0x0", data: "0x" }] })));
        assert.equal(JSON.stringify(check), frozen);
        for (const [index, s] of check.steps.entries()) {
            const mock = fixture({ code: -2, message: "Cancelled" });
            const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: mock.wallet }, dispatch: mock.dispatch });
            const observation = comparisonObservation(run, { method: "eth_sendTransaction", expectedOutcome: index === 0 ? "approve" : undefined });
            assert.equal(observation.cancelled, true);
            assert.equal(observation.inconclusive, index === 0);
            assert.equal(observation.transactionHash, undefined);
        }
    });
    test(`WSR-VERI-002 ${platform}: explorer probe preserves zero-value payload and the non-self recipient`, async () => {
        const s = checks["WSR-VERI-002"].steps[0];
        for (const account of [ACCOUNT, constants.TESTER_WALLET_2]) {
            const previous = fixture(null, account);
            const guided = fixture(null, account);
            await previous.dispatch(platform, s.ui.content.button.action, previous.wallet, { ...s.data.params, ...(platform === "mobile" ? { __wcChainId: "0x89" } : {}) });
            const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, address: account, provider: guided.wallet }, dispatch: guided.dispatch });
            assert.equal(run.error, undefined, JSON.stringify(run));
            assert.deepEqual(guided.sent, previous.sent);
            const expectedTo = account === constants.TESTER_WALLET_2 ? constants.TESTER_WALLET_1 : constants.TESTER_WALLET_2;
            assert.deepEqual(guided.sent, [{ method: "eth_sendTransaction", params: [{ from: account, to: expectedTo, value: "0x0", data: "0x" }] }]);
            assert.equal(nonSelfTarget(constants.TESTER_WALLET_2, run.runtime.from, [constants.TESTER_WALLET_1, constants.TESTER_WALLET_2]), expectedTo);
            const mock = fixture({ code: -2, message: "Cancelled" }, account);
            const cancelled = await runComparisonStep({ platform, step: s, runtime: { ...runtime, address: account, provider: mock.wallet }, dispatch: mock.dispatch });
            assert.equal(comparisonObservation(cancelled).cancelled, true);
            assert.equal(comparisonEvidence({ method: "eth_sendTransaction" }, cancelled, "https://example.test").request_outcome, "cancelled_by_tester");
        }
    });
    test(`WSR-PERM-006 ${platform}: eth_sign preserves the original hash and neutral cancellation`, async () => {
        const s = checks["WSR-PERM-006"].steps[0];
        for (const error of [{ code: 4001, message: "User rejected the request." }, { code: -2, message: "Cancelled" }, { code: -32601, message: "Method not found" }]) {
            const previous = signingFixture(error);
            const guided = signingFixture(error);
            await assert.rejects(previous.dispatch(platform, "ethSignMethod", previous.wallet, {}));
            const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: guided.wallet }, dispatch: guided.dispatch });
            assert.deepEqual(guided.sent, previous.sent);
            const message = JSON.parse(constantSource.match(/export const PERSONAL_SIGN = ([^;]+);/)[1]);
            assert.deepEqual(guided.sent, [{ method: "eth_sign", params: [ACCOUNT, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message))] }]);
            assert.equal(comparisonObservation(run).cancelled, error.code === -32601 ? undefined : true);
            assert.equal(comparisonEvidence({ method: "eth_sign" }, run, "https://example.test").wallet_output, error.message);
        }
    });
    test(`WSR-PERM-006 ${platform}: real raw-signature reports remain visible without altering evidence`, async () => {
        // Ephemeral offline signer; never funded, persisted or sent to a network.
        const signer = ethers.Wallet.createRandom();
        const mock = signingFixture(null, signer);
        const run = await runComparisonStep({ platform, step: checks["WSR-PERM-006"].steps[0], runtime: { ...runtime, address: signer.address, provider: mock.wallet }, dispatch: mock.dispatch });
        assert.deepEqual(comparisonObservation(run, { method: "eth_sign" }), { title: "eth_sign returned a verified raw signature for the signing account.", inconclusive: false });
        assert.equal(comparisonEvidence({ method: "eth_sign" }, run, "https://example.test").wallet_output,
            "eth_sign returned a verified raw signature for the signing account.");
        const evidence = comparisonEvidence({ method: "eth_sign" }, run, "https://example.test");
        assert.equal(evidence.eth_sign_verification.matched_format, "raw_eth_sign");
        assert.equal(evidence.eth_sign_verification.signing_account, signer.address);
        assert.equal(evidence.eth_sign_verification.attempts.length, 3);
        assert.equal(comparisonObservation({ ...run, contextChanged: true }, { method: "eth_sign" }).inconclusive, true);
    });
    test(`WSR-PERM-009 ${platform}: both original switch payloads stay ordered without add-chain fallback`, async () => {
        for (const response of [null, { code: 4001, message: "User rejected the request." }, { code: 4902, message: "Unrecognized chain" }, { code: -2, message: "Cancelled" }]) {
            const previous = switchFixture(response);
            const guided = switchFixture(response);
            for (const s of checks["WSR-PERM-009"].steps) {
                await previous.dispatch(platform, "switchChains", previous.wallet, s.data.params).catch(() => {});
                const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: guided.wallet }, dispatch: guided.dispatch });
                const observation = comparisonObservation(run, { method: "wallet_switchEthereumChain" });
                const evidence = comparisonEvidence({ method: "wallet_switchEthereumChain" }, run, "https://example.test");
                if (response?.code === 4001 || response?.code === -2) {
                    assert.equal(observation.title, "Cancelled by tester");
                    assert.equal(evidence.request_outcome, "cancelled_by_tester");
                } else if (response?.code === 4902) {
                    assert.equal(observation.title, "Network not configured — 4902");
                    assert.equal(evidence.wallet_output.code, 4902);
                } else assert.equal(observation.title, "Switch request completed");
                assert.equal(observation.inconclusive, response?.code === 4902);
                assert.equal(evidence.automatic_verdict, null);
            }
            assert.deepEqual(guided.sent, previous.sent);
            assert.deepEqual(guided.sent, ["0x1", "0x144"].map((chainId) => ({ method: "wallet_switchEthereumChain", params: [{ chainId }] })));
        }
    });
}

test("checksum guidance keeps approval of the dApp request separate from cancellation of manual entry", () => {
    const check = checks["WSR-VERI-001"];
    const presentation = GUIDED_COMPARISONS[check.canonicalId];
    assert.equal(check.steps[0].expectedOutcome, "approve");
    assert.equal(presentation.stages.length + presentation.manualStages.length + 1, 3);
    assert.match(presentation.safety, /0-value.*Polygon.*costs gas/);
    assert.match(presentation.stages[0].instruction, /Approve the request if the wallet allows it/);
    assert.match(presentation.review, /then cancel.*Do not send/);
    assert.equal(constants.CHECKSUM_PROBE_BAD_CHECKSUM, "0x02970EA171A97EB0d627CB7EC9ABaC308253C716");
});

test("checksum comparison distinguishes changed casing, different addresses and unusable tester text", () => {
    const sent = constants.CHECKSUM_PROBE_BAD_CHECKSUM;
    for (const input of ["", "  ", null]) assert.deepEqual(compareChecksumDisplay(sent, input), { state: "empty" });
    for (const input of ["0x0297…c716", "not an address", sent.slice(0, -1), sent + "0"]) {
        assert.equal(compareChecksumDisplay(sent, input).state, "invalid");
    }
    assert.deepEqual(compareChecksumDisplay(sent, sent), { state: "compared", displayed: sent, validChecksum: false, matchesSent: true, casingDiffers: false });
    assert.deepEqual(compareChecksumDisplay(sent, ` ${constants.CHECKSUM_PROBE_ADDRESS} `), {
        state: "compared", displayed: constants.CHECKSUM_PROBE_ADDRESS, validChecksum: true, matchesSent: true, casingDiffers: true,
    });
    for (const input of [sent.toLowerCase(), "0x" + sent.slice(2).toUpperCase()]) {
        const facts = compareChecksumDisplay(sent, input);
        assert.equal(facts.validChecksum, false);
        assert.equal(facts.matchesSent, true);
        assert.equal(facts.casingDiffers, true);
    }
    assert.deepEqual(compareChecksumDisplay(sent, ACCOUNT), { state: "compared", displayed: ACCOUNT, validChecksum: false, matchesSent: false, casingDiffers: null });
});

test("checksum results report only a hash, tester cancellation or inconclusive errors, never a checksum verdict", () => {
    const options = { method: "eth_sendTransaction", expectedOutcome: "approve" };
    for (const result of [HASH, { hash: HASH }]) {
        assert.deepEqual(comparisonObservation({ result }, options), { title: "Transaction hash returned", inconclusive: false, sent: true, transactionHash: HASH });
    }
    const cancelled = comparisonObservation({ error: { message: "Cancelled" } }, options);
    assert.equal(cancelled.title, "Cancelled by tester — transaction not approved");
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.inconclusive, true);
    for (const run of [{ error: { message: "Insufficient funds" } }, { error: { message: "Invalid checksum" } }, { result: { status: "rejected_by_user", at: "chain_switch" } }]) {
        assert.equal(comparisonObservation(run, options).inconclusive, true);
        assert.equal(comparisonObservation(run, options).transactionHash, undefined);
        assert.equal(comparisonObservation(run, options).cancelled, undefined);
    }
});

test("checksum paste errors explain the exact obstacle without correcting the pasted address", () => {
    const sent = constants.CHECKSUM_PROBE_BAD_CHECKSUM;
    for (const [input, reason, message] of [
        ["0x0297…c716", "truncated", /shortened address cannot be compared/],
        ["0x0297...c716", "truncated", /ellipsis/],
        [HASH, "hash", /64 hex characters.*transaction hash.*address has 40/],
        [sent.slice(2), "missing-prefix", /no 0x prefix/],
        [`Recipient: ${sent}`, "prefix", /without a label/],
        [sent.slice(0, 5) + " " + sent.slice(5), "characters", /spaces or invisible characters/],
        [sent.slice(0, 5) + "\u200e" + sent.slice(5), "characters", /spaces or invisible characters/],
        [sent.slice(0, -1), "length", /39 hex characters.*exactly 40/],
        [sent + "0", "length", /41 hex characters.*exactly 40/],
    ]) {
        const facts = compareChecksumDisplay(sent, input);
        assert.equal(facts.state, "invalid");
        assert.equal(facts.displayed, input);
        assert.equal(facts.reason, reason);
        assert.equal(facts.matchesSent, undefined);
        const summary = checksumComparisonSummary(facts);
        assert.equal(summary.title, "Address not compared yet");
        assert.match(summary.detail, message);
    }
});

test("checksum conclusions distinguish exact match, corrected casing, no mixed-case checksum and a different recipient", () => {
    const sent = constants.CHECKSUM_PROBE_BAD_CHECKSUM;
    const summary = (input) => checksumComparisonSummary(compareChecksumDisplay(sent, input));
    assert.match(summary("").title, /Paste the wallet's recipient/);
    assert.equal(summary(sent).title, "Same address — letter case unchanged");
    assert.match(summary(sent).detail, /deliberately invalid checksum.*does not tell us whether the wallet warned/);
    assert.deepEqual(summary(constants.CHECKSUM_PROBE_ADDRESS), { title: "Same address — the wallet changed the letter case to fix the checksum" });
    assert.match(summary(sent.toLowerCase()).detail, /does not show a mixed-case checksum/);
    assert.match(summary("0x" + sent.slice(2).toUpperCase()).detail, /does not show a mixed-case checksum/);
    const stillInvalid = sent.replace("E", "e");
    assert.match(summary(stillInvalid).detail, /checksum is still invalid/);
    assert.equal(summary(ACCOUNT).title, "Different address — not just different letter case");
    assert.match(summary(ACCOUNT).detail, /not your account or another address/);
});

test("corrected checksum title is reserved for the same recipient with a valid changed checksum", () => {
    const sent = constants.CHECKSUM_PROBE_BAD_CHECKSUM;
    for (const input of ["", "0x0297…c716", HASH, sent, sent.toLowerCase(), "0x" + sent.slice(2).toUpperCase(), sent.replace("E", "e"), ethers.utils.getAddress("0x" + "ab".repeat(20))]) {
        assert.doesNotMatch(checksumComparisonSummary(compareChecksumDisplay(sent, input)).title, /fix the checksum/);
    }
});

test("checksum paste artifacts are visible but never silently stripped or case-normalized", () => {
    const sent = constants.CHECKSUM_PROBE_BAD_CHECKSUM;
    assert.equal(visibleChecksumInput(sent), sent);
    assert.equal(visibleChecksumInput("0x12\u200e34 56\n78"), "0x12[U+200E]34[U+0020]56[U+000A]78");
    assert.equal(visibleChecksumInput("0x12\u202e34"), "0x12[U+202E]34");
    assert.equal(compareChecksumDisplay(sent, "0x12\u200e34 56\n78").state, "invalid");
});

for (const platform of ["extension", "mobile"]) {
    test(`WSR-VERI-001 ${platform}: guided request preserves the exact bad casing and zero-value payload`, async () => {
        const s = checks["WSR-VERI-001"].steps[0];
        const before = JSON.stringify(s);
        const previous = fixture(null);
        const guided = fixture(null);
        await previous.dispatch(platform, s.ui.content.button.action, previous.wallet, { ...s.data.params, ...(platform === "mobile" ? { __wcChainId: "0x89" } : {}) });
        const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: guided.wallet }, dispatch: guided.dispatch });
        assert.equal(run.error, undefined, JSON.stringify(run));
        assert.deepEqual(guided.sent, previous.sent);
        assert.deepEqual(guided.sent, [{ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to: constants.CHECKSUM_PROBE_BAD_CHECKSUM, value: "0x0", data: "0x" }] }]);
        assert.equal(JSON.stringify(s), before);
        const parameters = { target: constants.CHECKSUM_PROBE_BAD_CHECKSUM, chain: "0x89", method: "eth_sendTransaction", value: "0x0" };
        const resolved = { checkId: s.canonicalId, stepNumber: 1, totalSteps: 1, method: "eth_sendTransaction", parameters };
        const evidence = comparisonEvidence(resolved, run, "https://example.test");
        assert.equal(evidence.wallet_output, HASH);
        assert.equal(evidence.runtime.from, ACCOUNT);
        assert.equal(evidence.runtime.platform, platform);
        assert.equal(evidence.runtime.chain_id, "0x89");
        assert.equal(evidence.automatic_verdict, null);
        const saved = JSON.stringify(evidence);
        compareChecksumDisplay(parameters.target, constants.CHECKSUM_PROBE_ADDRESS);
        compareChecksumDisplay(parameters.target, ACCOUNT);
        assert.equal(JSON.stringify(comparisonEvidence(resolved, run, "https://example.test")), saved);
        assert.equal(evidence.parameters.target, constants.CHECKSUM_PROBE_BAD_CHECKSUM);
    });
    test(`WSR-VERI-001 ${platform}: real handlers preserve refusal without claiming a checksum block`, async () => {
        for (const rejection of [{ code: 4001, message: "User rejected" }, { code: -2, message: "Cancelled" }]) {
            const mock = fixture(rejection);
            const run = await runComparisonStep({ platform, step: checks["WSR-VERI-001"].steps[0], runtime: { ...runtime, provider: mock.wallet }, dispatch: mock.dispatch });
            const observation = comparisonObservation(run, { method: "eth_sendTransaction", expectedOutcome: "approve" });
            assert.equal(mock.sent.length, 1);
            assert.equal(observation.cancelled, true, JSON.stringify(run));
            assert.equal(observation.transactionHash, undefined);
            assert.equal(observation.inconclusive, true);
            assert.equal(comparisonEvidence({}, run, "https://example.test").request_outcome, "cancelled_by_tester");
        }
    });
}

for (const platform of ["extension", "mobile"]) {
    for (const id of ["WSR-VERI-005", "WSR-VERI-003"]) {
        test(`${id} ${platform}: actual handlers preserve TokenPocket cancellation as a neutral observation`, async () => {
            const { sent, wallet, dispatch } = fixture({ code: -2, message: "Cancelled" });
            for (const s of checks[id].steps) {
                const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: wallet }, dispatch });
                assert.equal(run.error?.message, "Cancelled");
                assert.equal(comparisonObservation(run).cancelled, true);
                const evidence = comparisonEvidence({ parameters: s.data.params }, run, "https://example.test");
                assert.equal(evidence.wallet_output, "Cancelled");
                assert.equal(evidence.request_outcome, "cancelled_by_tester");
                assert.equal(evidence.automatic_verdict, null);
            }
            assert.equal(sent.length, 2);
        });
        test(`${id} ${platform}: guided dispatch preserves the previous ordered transaction payloads byte-for-byte`, async () => {
            const previous = fixture();
            const guided = fixture();
            for (const s of checks[id].steps) {
                const params = { ...s.data.params, ...(platform === "mobile" ? { __wcChainId: "0x89" } : {}) };
                await previous.dispatch(platform, s.ui.content.button.action, previous.wallet, params);
                const run = await runComparisonStep({ platform, step: s, runtime: { ...runtime, provider: guided.wallet }, identity: { name: "Mock extension" }, dispatch: guided.dispatch });
                assert.equal(run.result?.status, "rejected_by_user", JSON.stringify(run));
            }
            assert.equal(guided.sent.length, 2);
            assert.deepEqual(guided.sent, previous.sent);
            const txs = guided.sent.map((request) => request.params[0]);
            assert(txs.every((tx) => tx.from === ACCOUNT));
            if (id === "WSR-VERI-005") {
                assert.equal(txs[0].to, constants.USDC_E);
                assert.equal(txs[1].to, constants.TEST_ERC20_ADDRESS);
                assert.equal(txs[0].data, txs[1].data);
                const decoded = new ethers.utils.Interface(constants.TEST_ERC20_ABI).decodeFunctionData("approve", txs[0].data);
                assert.equal(decoded[0], constants.APPROVE_SPENDER);
                assert.equal(decoded[1].toHexString(), constants.APPROVE_AMOUNT);
                assert(txs.every((tx) => tx.value === "0x0"));
            } else {
                assert.equal(txs[0].to, constants.NONFUNGIBLE_POSITION_MANAGER);
                assert.equal(txs[1].to, constants.SWAP_ROUTER_02);
                assert.equal(txs[0].value, ethers.BigNumber.from(constants.LP_AMOUNT_IN).toHexString());
                assert.equal(txs[1].value, ethers.BigNumber.from(constants.SWAP_AMOUNT_IN).toHexString());
            }
        });
    }
}
