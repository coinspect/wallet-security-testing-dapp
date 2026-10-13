import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceLoader, reactHarness, nodes } from "./helpers/sourceHarness.mjs";
import { sanitizeEvidenceForStorage } from "../src/app/wizard/utils/evidenceStorage.mjs";

const load = sourceLoader();
const { handleAction } = load("src/utils/wallet-methods/actionMethods.js");
const { runComparisonStep, comparisonEvidence, comparisonObservation } = load("src/app/wizard/utils/guidedComparison.mjs");
const { resolveCheckParams } = load("src/app/wizard/utils/resolveCheckParams.js");
const checks = load("src/app/wizard/config/wizard.json").wizard.checks;
const account = `0x${"11".repeat(20)}`;
const origin = "https://example.test";

function rpcError() {
    const error = new Error("Provider rejected the request\nOriginal second line");
    Object.defineProperty(error, "code", { value: -32603 });
    error.data = { originalError: Object.assign(new Error("Missing field"), { code: 4865 }), amount: 0n, privateKey: "test-only-sensitive-value" };
    error.data.self = error.data;
    return Object.freeze(error);
}

function wallet(error, failAt = "eth_sendTransaction") {
    const calls = [];
    const provider = { async request(args) {
        assert.equal(this, provider);
        calls.push(structuredClone(args));
        if (args.method === failAt) throw error;
        if (args.method === "eth_accounts") return [account];
        if (args.method === "eth_chainId") return "0x89";
        throw new Error(`Unexpected method: ${args.method}`);
    } };
    return { provider, calls, runtime: { provider, address: account, chainId: "0x89", status: "connected" } };
}

for (const id of ["WSR-THRE-002", "WSR-VERI-001", "WSR-VERI-002"]) {
    test(`${id}: extension errors retain full details for both data formats`, async () => {
        for (const diagnosticVariant of [undefined, "omitted_data"]) {
            const error = rpcError(), { calls, runtime } = wallet(error);
            const step = checks[id].steps[0];
            const before = JSON.stringify(step);
            const run = await runComparisonStep({ platform: "extension", step, runtime, dispatch: handleAction, diagnosticVariant });
            const evidence = comparisonEvidence(resolveCheckParams(step), run, origin);
            assert.equal(evidence.wallet_output, error.message);
            assert.equal(evidence.code, -32603);
            assert.equal(evidence.error_details.data.originalError.message, "Missing field");
            assert.equal(evidence.error_details.data.originalError.code, 4865);
            assert.equal(evidence.error_details.data.amount, "0");
            assert.equal(evidence.error_details.data.privateKey, "[sensitive value omitted]");
            assert.equal(evidence.error_details.data.self, "[circular]");
            assert.equal(evidence.error_details.stack, undefined);
            assert.equal(evidence.parameters.data, diagnosticVariant ? undefined : "0x");
            assert.equal(evidence.diagnostic_variant, diagnosticVariant);
            assert.equal(evidence.failed_method, "eth_sendTransaction");
            assert.equal(evidence.automatic_verdict, null);
            assert.equal(comparisonObservation(run).title, "Request returned an error");
            assert.equal(calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
            assert.equal(calls.at(-1).params[0].data, diagnosticVariant ? undefined : "0x");
            assert.equal(JSON.stringify(step), before);
            assert.equal(sanitizeEvidenceForStorage(evidence).error_details.data.originalError.code, 4865);
            assert.equal(error.data.privateKey, "test-only-sensitive-value", "Do not mutate the original error");
        }
    });
}

test("extension sender forwards the original frozen rejection without truncation", async () => {
    const error = rpcError(), { provider } = wallet(error);
    const { sendTransactionWithFallback } = load("src/utils/wallet-methods/ext/methods.js");
    await assert.rejects(sendTransactionWithFallback(account, provider), (thrown) => thrown === error);
});

test("preflight failures retain the chosen format and never submit a transaction", async () => {
    for (const diagnosticVariant of [undefined, "omitted_data"]) {
        const error = rpcError(), { calls, runtime } = wallet(error, "eth_accounts");
        const step = checks["WSR-THRE-002"].steps[0];
        const run = await runComparisonStep({ platform: "extension", step, runtime, diagnosticVariant, dispatch: () => assert.fail("No dispatch after failed preflight") });
        const evidence = comparisonEvidence(resolveCheckParams(step), run, origin);
        assert.equal(run.preflightFailed, true);
        assert.equal(evidence.diagnostic_variant, diagnosticVariant);
        assert.equal(evidence.parameters.data, diagnosticVariant ? undefined : "0x");
        assert.equal(evidence.failed_method, "eth_accounts");
        assert.equal(evidence.wallet_output, error.message);
        assert.equal(evidence.error_details.code, -32603);
        assert.equal(evidence.request_outcome, undefined);
        assert.match(comparisonObservation(run).title, /test request not sent/);
        assert.deepEqual(calls, [{ method: "eth_accounts" }]);
    }
});

test("invalid diagnostic variants are rejected before preflight; missing connection retains a valid variant", async () => {
    for (const [id, diagnosticVariant] of [["WSR-THRE-002", "unknown"], ["WSR-VERI-005", "omitted_data"]]) {
        const { runtime, calls } = wallet(rpcError());
        const run = await runComparisonStep({ platform: "extension", step: checks[id].steps[0], runtime, diagnosticVariant, dispatch: () => assert.fail("Invalid probe dispatched") });
        assert.match(run.error.message, /only available/);
        assert.equal(run.diagnosticVariant, undefined);
        assert.equal(calls.length, 0);
    }
    const run = await runComparisonStep({ platform: "extension", step: checks["WSR-THRE-002"].steps[0], runtime: {}, diagnosticVariant: "omitted_data" });
    assert.deepEqual(run, { needsConnection: true, diagnosticVariant: "omitted_data" });
});

test("preserving multiline cancellation details does not turn tester cancellation into an error", async () => {
    for (const error of [{ code: 4001, message: "User rejected" }, { code: -32000, message: "User canceled\nOriginal provider detail" }]) {
        const { calls, runtime } = wallet(error);
        const step = checks["WSR-THRE-002"].steps[1];
        const run = await runComparisonStep({ platform: "extension", step, runtime, dispatch: handleAction });
        assert.equal(comparisonObservation(run).title, "Cancelled by tester");
        assert.equal(comparisonEvidence(resolveCheckParams(step), run, origin).request_outcome, "cancelled_by_tester");
        assert.equal(calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
    }
});

test("unknown-recipient flow keeps a short display message and full copied/stored error evidence", async () => {
    const error = rpcError(), { runtime, calls } = wallet(error);
    const guided = reactHarness(), action = reactHarness(), result = reactHarness();
    const copied = [], saved = [];
    const Action = () => null, Result = () => null;
    const shared = {
        "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
        "../context/PlatformContext": { usePlatform: () => ({ platform: "extension" }) },
        "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Mock extension" }) },
        "../utils/disconnectDapp": {},
        "./PersistedEvidence": () => null, "./WizardStepHeader": () => null,
    };
    const browser = { window: { location: { origin }, addEventListener() {}, removeEventListener() {} },
        navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    };
    const Guided = sourceLoader({ ...shared, react: guided.react, "./ActionPanel": Action, "./ActionResult": Result }, browser)("src/app/wizard/components/GuidedRequestCheck.jsx").default;
    const ActualAction = sourceLoader({ ...shared, react: action.react }, browser)("src/app/wizard/components/ActionPanel.jsx").default;
    const ActualResult = sourceLoader({ ...shared, react: result.react,
        "../utils/evidenceStorage.mjs": { persistEvidenceRecord: (record) => saved.push(record) }, "../utils/panelToImage": {},
    }, browser)("src/app/wizard/components/ActionResult.jsx").default;
    const props = { step: checks["WSR-THRE-005"].steps[0], platform: "extension",
        presentation: { button: "Run fixture", stages: [{ title: "Run", action: true }] },
    };
    const tree = guided.render(Guided, props);
    const actionProps = nodes(tree).find((node) => node.type === Action).props;
    const actionTree = action.render(ActualAction, actionProps);
    await nodes(actionTree).find((node) => node.props?.onClick && node.props.children === "Run fixture").props.onClick();
    const resultProps = nodes(guided.render(Guided, props)).find((node) => node.type === Result).props;
    assert.equal(resultProps.error, "Provider rejected the request");
    assert.equal(resultProps.errorDetails.message, error.message);
    const resultTree = result.render(ActualResult, resultProps);
    const panel = nodes(resultTree).find((node) => node.props?.ref);
    assert.doesNotMatch(renderToStaticMarkup(panel), /Original second line/);
    await nodes(resultTree).find((node) => node.props?.onCopyEvidence).props.onCopyEvidence();
    const evidence = JSON.parse(copied[0]);
    assert.equal(evidence.wallet_output, error.message);
    assert.equal(evidence.error_details.data.originalError.code, 4865);
    assert.equal(evidence.code, -32603);
    assert.equal(evidence.error_details.data.privateKey, "[sensitive value omitted]");
    assert.deepEqual(saved[0].evidence, evidence);
    assert.equal(calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
    guided.unmount(); action.unmount(); result.unmount();
});
