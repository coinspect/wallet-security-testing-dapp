import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceLoader, reactHarness, nodes, deferred, flush } from "./helpers/sourceHarness.mjs";

const account = `0x${"11".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const target = "0x873050043AF661fe9d5633369B10139eb7b4Da54";
const variant = "omitted_data";
const originalButton = "Try original format (no data)";

function fixture({ mode = "development", platform = "mobile", reply, id = "WSR-THRE-002" } = {}) {
    const hooks = reactHarness(), calls = [], saved = [], copied = [];
    const runtime = {
        address: account, chainId: "0x89",
        provider: {
            session: { topic: "test", peer: { metadata: { name: "Mock Trust" } } },
            async request(args) {
                calls.push(structuredClone(args));
                if (args.method === "eth_chainId") return "0x89";
                if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [account];
                if (args.method === "eth_sendTransaction") {
                    if (reply) return reply(args);
                    throw { code: 4001, message: "User rejected" };
                }
                throw new Error(`Unexpected method: ${args.method}`);
            },
        },
    };
    const load = sourceLoader({
        react: hooks.react,
        "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
        "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Mock extension" }) },
        "../utils/evidenceStorage.mjs": { persistEvidenceRecord: (record) => saved.push(record) },
        "../utils/panelToImage": {},
        "./RuntimeIdentity": () => null,
        "./PersistedEvidence": () => null,
        "./ChainGate": () => null,
        "./WizardStepHeader": () => null,
    }, {
        process: { env: { NODE_ENV: mode } },
        window: { location: { origin: "http://localhost:3000" } },
        navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    });
    const check = load("src/app/wizard/config/wizard.json").wizard.checks[id];
    const comparison = load("src/app/wizard/utils/guidedComparison.mjs");
    const Component = load("src/app/wizard/components/GuidedComparisonCheck.jsx").default;
    const render = () => hooks.render(Component, { check, platform, presentation: comparison.GUIDED_COMPARISONS[check.canonicalId] });
    const button = (label) => nodes(render()).find((node) => node.props?.onClick && node.props.children === label);
    const click = async (label) => {
        const node = button(label);
        assert(node, `Missing control: ${label}`);
        assert(!node.props.disabled, `Disabled control: ${label}`);
        await node.props.onClick();
    };
    return { calls, saved, copied, load, check, comparison, runtime, render, button, click };
}

for (const platform of ["mobile", "extension"]) test(`${platform}: original-format probe changes only data and does not overwrite normal evidence`, async () => {
    const ui = fixture({ platform, mode: "production" });
    const configBefore = JSON.stringify(ui.check);
    await ui.click("Send setup transaction");
    const baseline = structuredClone(ui.saved[0]);
    await ui.click(originalButton);
    const requests = ui.calls.filter((call) => call.method === "eth_sendTransaction");
    assert.deepEqual(requests[0], { method: "eth_sendTransaction", params: [{ from: account, to: target, value: "0x0", data: "0x" }] });
    assert.deepEqual(requests[1], { method: "eth_sendTransaction", params: [{ from: account, to: target, value: "0x0" }] });
    assert.equal(ui.calls.length, 10, "One additional Polygon verification per run; no transaction retries");
    assert.equal(ui.saved.length, 1, "Diagnostic must not enter campaign evidence");
    assert.deepEqual(ui.saved[0], baseline);
    await ui.click("Copy diagnostic JSON");
    const [evidence] = JSON.parse(ui.copied[0]);
    assert.equal(evidence.diagnostic_variant, variant);
    assert.equal(evidence.parameters.data, undefined);
    assert.equal(evidence.parameters.target, target);
    assert.equal(evidence.parameters.value, "0x0");
    if (platform === "mobile") {
        assert.equal(evidence.request_diagnostics.payload_variant, variant);
        assert.equal(evidence.request_diagnostics.transaction_request_invoked, true);
        assert.equal(evidence.rpc_error.code, 4001);
    }
    assert.equal(evidence.request_outcome, "cancelled_by_tester");
    assert.equal(evidence.automatic_verdict, null);
    assert.equal(evidence.history_precondition, undefined);
    assert.match(renderToStaticMarkup(ui.render()), /Separate probe · data omitted/);
    assert.equal(JSON.stringify(ui.check), configBefore);
    await ui.click("Run this request again");
    assert.equal(ui.calls.at(-1).params[0].data, "0x", "Diagnostic selection must not leak into normal reruns");
    assert.equal(ui.saved[1].evidence.parameters.data, "0x");
    assert.equal(ui.saved[1].evidence.diagnostic_variant, undefined);
});

test("diagnostic error details survive unchanged and omitted data is explicit in evidence", async () => {
    const ui = fixture({ reply: () => { throw { code: -32603, message: "The data couldn’t be read because it is missing." }; } });
    await ui.click(originalButton);
    await ui.click("Copy diagnostic JSON");
    const [evidence] = JSON.parse(ui.copied[0]);
    assert.equal(evidence.failed_method, "eth_sendTransaction");
    assert.equal(evidence.parameters.data, undefined);
    assert.equal(evidence.diagnostic_variant, "omitted_data");
    assert.equal(evidence.code, -32603);
    assert.equal(ui.saved.length, 0);
    assert(ui.button("Send setup transaction"), "Normal setup has not been executed");
});

test("extension preflight failure stays in diagnostic export without changing normal evidence", async () => {
    const ui = fixture({ platform: "extension" });
    await ui.click("Send setup transaction");
    const baseline = structuredClone(ui.saved[0]);
    const requestsBefore = ui.calls.length;
    const request = ui.runtime.provider.request;
    ui.runtime.provider.request = async (args) => {
        ui.calls.push(structuredClone(args));
        assert.equal(args.method, "eth_accounts", "No transaction after failed preflight");
        throw { code: -32603, message: "Account read failed\nOriginal detail", data: { reason: "unavailable" } };
    };
    await ui.click(originalButton);
    await ui.click("Copy diagnostic JSON");
    const [evidence] = JSON.parse(ui.copied[0]);
    assert.deepEqual(ui.calls.slice(requestsBefore), [{ method: "eth_accounts" }]);
    assert.equal(evidence.diagnostic_variant, variant);
    assert.equal(evidence.parameters.data, undefined);
    assert.equal(evidence.failed_method, "eth_accounts");
    assert.equal(evidence.wallet_output, "Account read failed\nOriginal detail");
    assert.deepEqual(evidence.error_details.data, { reason: "unavailable" });
    assert.deepEqual(ui.saved, [baseline]);
    assert.match(renderToStaticMarkup(ui.render()), /test request not sent/);
    ui.runtime.provider.request = request;
    await ui.click("Run this request again");
    assert.equal(ui.calls.at(-1).params[0].data, "0x");
    assert.equal(ui.saved[1].evidence.diagnostic_variant, undefined);
});

test("even a diagnostic hash must not be used as the setup-history transaction", async () => {
    const ui = fixture({ reply: () => hash });
    await ui.click(originalButton);
    assert.equal(ui.saved.length, 0);
    assert.equal(ui.button("I confirmed it in wallet history"), undefined);
    assert(ui.button("Send setup transaction"));
    const active = nodes(ui.render()).find((node) => node.props?.["aria-current"] === "step");
    assert.match(renderToStaticMarkup(active), /Prepare the familiar recipient/);
});

test("original format is only offered for simple sends, never approvals or chain switching", () => {
    for (const options of [{ id: "WSR-VERI-005" }, { id: "WSR-PERM-009" }]) {
        const ui = fixture(options);
        assert.equal(ui.button(originalButton), undefined);
        assert.doesNotMatch(renderToStaticMarkup(ui.render()), /Advanced controls/);
    }
});

test("dispatch rejects diagnostic variants for calldata-bearing requests", async () => {
    for (const options of [{ id: "WSR-VERI-005" }, { id: "WSR-VERI-003" }]) {
        const ui = fixture(options);
        let dispatched = false;
        const result = await ui.comparison.runComparisonStep({
            platform: options.platform ?? "mobile", step: ui.check.steps[0], runtime: ui.runtime,
            diagnosticVariant: variant, dispatch: async () => { dispatched = true; },
        });
        assert.equal(dispatched, false);
        assert.match(result.error.message, /only available/);
        assert(!ui.calls.some((call) => call.method === "eth_sendTransaction"));
    }
});

test("the diagnostic and normal run share the in-flight guard", async () => {
    const gate = deferred();
    const ui = fixture({ reply: () => gate.promise });
    const start = ui.button(originalButton).props.onClick;
    const running = start();
    await flush();
    assert.equal(ui.button(originalButton).props.disabled, true);
    assert.equal(ui.button("Waiting for wallet…").props.disabled, true);
    await start();
    assert.equal(ui.calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
    gate.reject({ code: 4001, message: "User rejected" });
    await running;
    assert(!ui.button(originalButton).props.disabled);
});
