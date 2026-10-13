import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { requestChainSwitch } from "../src/utils/wallet-methods/chainSwitchProbe.mjs";
import { REQUEST_WAIT_STOPPED, waitForWalletReply } from "../src/utils/wallet-methods/requestWait.mjs";
import { sourceLoader, reactHarness, nodes, deferred, flush } from "./helpers/sourceHarness.mjs";

const method = "wallet_switchEthereumChain";
const account = `0x${"11".repeat(20)}`;
const stopLabel = "Stop waiting and continue";
const payload = (chainId) => ({ method, params: [{ chainId }] });

function wallet(platform) {
    const calls = [], sent = [], replies = [];
    const send = (request) => {
        sent.push(structuredClone(request));
        const reply = deferred(); replies.push(reply);
        return reply.promise;
    };
    const provider = {
        session: { topic: "original", expiry: Date.now() / 1000 + 3600,
            peer: { metadata: { name: "Mock wallet" } },
            namespaces: { eip155: { chains: ["eip155:137", "eip155:1"], methods: [method] } } },
        request(args) {
            assert.equal(this, provider, "Keep the provider binding");
            calls.push(structuredClone(args));
            if (args.method === "eth_accounts") return Promise.resolve([account]);
            if (args.method === "eth_chainId") return Promise.resolve("0x89");
            assert.equal(platform, "extension", "WC switching must bypass the SDK's local shortcut");
            assert.equal(args.method, method);
            return send(args);
        },
    };
    provider.client = {
        session: { get: () => provider.session },
        request(args) { assert.equal(this, provider.client); return send(args); },
    };
    return { provider, calls, sent, replies,
        run: (signal) => requestChainSwitch({ provider, chainId: "0x1", chainName: "Ethereum Mainnet",
            transport: platform === "mobile" ? "walletconnect" : "extension", signal }) };
}

test("stopping before dispatch, including the dispatch microtask, sends nothing", async () => {
    for (const before of [true, false]) {
        const control = new AbortController();
        if (before) control.abort();
        let sent = false;
        const waiting = waitForWalletReply(() => { sent = true; }, control.signal);
        control.abort();
        await assert.rejects(waiting, (error) => error === REQUEST_WAIT_STOPPED);
        await flush();
        assert.equal(sent, false);
    }
});

for (const platform of ["mobile", "extension"]) {
    test(`${platform}: stop a hanging switch without retry, invented cancellation or late mutations`, async () => {
        for (const reject of [true, false]) {
            const f = wallet(platform), control = new AbortController();
            const pending = f.run(control.signal);
            await flush();
            assert.equal(f.sent.length, 1);
            control.abort();
            const result = await pending;
            assert.equal(result.status, "switch_stopped_waiting");
            assert.equal(result.request_submitted, true);
            assert.deepEqual(result.wait_stopped, { source: "tester", stage: "switch_request" });
            assert.equal(result.error, undefined);
            assert.equal(result.response, undefined);
            assert.equal(result.chain_after, undefined);
            assert.deepEqual(f.sent[0], platform === "mobile"
                ? { topic: "original", chainId: "eip155:137", request: payload("0x1") } : payload("0x1"));
            const snapshot = structuredClone(result), calls = structuredClone(f.calls);
            if (reject) f.replies[0].reject({ code: 4001, message: "Late cancellation" });
            else f.replies[0].resolve(null);
            await flush();
            assert.deepEqual(result, snapshot);
            assert.deepEqual(f.calls, calls);
            assert.equal(f.sent.length, 1);
        }
    });

    test(`${platform}: stopping a pending chain read prevents any subsequent switch`, async () => {
        const f = wallet(platform), read = deferred(), control = new AbortController();
        f.provider.request = () => read.promise;
        const waiting = f.run(control.signal);
        await flush();
        control.abort();
        const result = await waiting;
        assert.equal(result.request_submitted, false);
        assert.equal(result.wait_stopped.stage, "chain_before");
        read.resolve("0x89");
        await flush();
        assert.equal(f.sent.length, 0);
    });
}

test("stopping the post-switch chain read retains the wallet's actual response or rejection", async () => {
    for (const reject of [true, false]) {
        const f = wallet("extension"), control = new AbortController(), after = deferred();
        const original = f.provider.request;
        f.provider.request = function (args) {
            if (args.method === "eth_chainId" && f.sent.length) return after.promise;
            return original.call(this, args);
        };
        const waiting = f.run(control.signal);
        await flush();
        if (reject) f.replies[0].reject({ code: 4001, message: "User rejected" });
        else f.replies[0].resolve(null);
        await flush();
        control.abort();
        const result = await waiting;
        assert.equal(result.status, reject ? "switch_cancelled" : "switch_response");
        assert.equal(result.wait_stopped.stage, "chain_after");
        assert.equal(result.error?.code, reject ? 4001 : undefined);
        if (!reject) assert.equal(result.response, null);
        after.resolve("0x1");
        await flush();
        assert.equal(result.chain_after, undefined);
    }
});

function uiFixture(platform = "mobile", id = "WSR-PERM-009") {
    const hooks = reactHarness(), f = wallet(platform), saved = [];
    const runtime = { provider: f.provider, address: account, chainId: "0x89" };
    const load = sourceLoader({
        react: hooks.react,
        "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
        "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Mock extension" }) },
        "../utils/evidenceStorage.mjs": { persistEvidenceRecord: (record) => saved.push(structuredClone(record)) },
        "../utils/panelToImage": {},
        "./RuntimeIdentity": () => null,
        "./PersistedEvidence": () => null,
        "./ChainGate": () => null,
        "./WizardStepHeader": () => null,
    }, { window: { location: { origin: "http://localhost:3000" } } });
    const check = load("src/app/wizard/config/wizard.json").wizard.checks[id];
    const comparison = load("src/app/wizard/utils/guidedComparison.mjs");
    const Component = load("src/app/wizard/components/GuidedComparisonCheck.jsx").default;
    const render = () => hooks.render(Component, { check, platform, presentation: comparison.GUIDED_COMPARISONS[check.canonicalId] });
    const button = (label) => nodes(render()).find((node) => node.props?.onClick && node.props.children === label);
    const click = (label) => {
        const node = button(label);
        assert(node, `Missing control: ${label}`);
        assert(!node.props.disabled, `Disabled control: ${label}`);
        return node.props.onClick();
    };
    const phase = () => nodes(render()).filter((node) => node.type === "li").findIndex((node) => node.props["aria-current"] === "step");
    return { ...f, hooks, check, saved, render, button, click, phase };
}

for (const platform of ["mobile", "extension"]) test(`${platform}: the continue button records a neutral stop, advances once and isolates late replies`, async () => {
    const ui = uiFixture(platform), config = JSON.stringify(ui.check);
    assert.equal(ui.button(stopLabel), undefined);
    const first = ui.click("Switch to Ethereum Mainnet");
    await flush();
    assert.equal(ui.phase(), 0);
    assert.equal(ui.button("Waiting for wallet…").props.disabled, true);
    const stop = ui.button(stopLabel);
    stop.props.onClick(); stop.props.onClick();
    await first;
    assert.equal(ui.phase(), 1);
    assert.equal(ui.sent.length, 1, "Never dispatch the next step automatically");
    const evidence = ui.saved[0].evidence;
    assert.equal(evidence.request_outcome, "stopped_waiting");
    assert.equal(evidence.automatic_verdict, null);
    assert.equal(evidence.failed_method, undefined);
    assert.equal(evidence.wallet_output.error, undefined);
    assert.deepEqual(evidence.wallet_output.request, payload("0x1"));
    assert.match(renderToStaticMarkup(ui.render()), /Stopped waiting by tester/);
    const second = ui.click("Switch to zkSync Era");
    await flush();
    assert.equal(ui.sent.length, 2);
    assert.deepEqual(platform === "mobile" ? ui.sent[1].request : ui.sent[1], payload("0x144"));
    ui.replies[0].reject({ code: 4001, message: "Late cancellation" });
    await flush();
    assert.equal(ui.saved.length, 1);
    assert.deepEqual(ui.saved[0].evidence, evidence);
    assert.equal(ui.phase(), 1);
    assert.equal(ui.button("Waiting for wallet…").props.disabled, true);
    ui.click(stopLabel);
    await second;
    assert.equal(ui.phase(), 2);
    assert.equal(ui.saved.length, 2);
    ui.replies[1].resolve(null);
    await flush();
    assert.equal(ui.saved.length, 2);
    assert.equal(JSON.stringify(ui.check), config, "Do not edit the checks or their params");
});

test("extension: stop during account preflight advances without sending a switch", async () => {
    const ui = uiFixture("extension"), accounts = deferred();
    ui.provider.request = (args) => { assert.equal(args.method, "eth_accounts"); return accounts.promise; };
    const waiting = ui.click("Switch to Ethereum Mainnet");
    await flush();
    ui.click(stopLabel);
    await waiting;
    assert.equal(ui.phase(), 1);
    assert.deepEqual(ui.saved[0].evidence.wait_stopped, { source: "tester", stage: "accounts_read", request_submitted: false });
    assert.equal(ui.saved[0].evidence.wallet_output, null);
    accounts.resolve([account]);
    await flush();
    assert.equal(ui.sent.length, 0);
});

test("unmount ends the local wait without recording a tester action or sending later requests", async () => {
    const ui = uiFixture("extension"), accounts = deferred();
    ui.provider.request = () => accounts.promise;
    const waiting = ui.click("Switch to Ethereum Mainnet");
    await flush();
    ui.hooks.unmount();
    await waiting;
    accounts.resolve([account]);
    await flush();
    assert.equal(ui.saved.length, 0);
    assert.equal(ui.sent.length, 0);
});

test("normal wallet cancellation keeps its original outcome and needs no manual stop", async () => {
    const ui = uiFixture();
    const waiting = ui.click("Switch to Ethereum Mainnet");
    await flush();
    ui.replies[0].reject({ code: 4001, message: "User rejected" });
    await waiting;
    assert.equal(ui.saved[0].evidence.request_outcome, "cancelled_by_tester");
    assert.equal(ui.button(stopLabel), undefined);
    assert.equal(ui.phase(), 0);
    ui.click("Continue to the second request");
    assert.equal(ui.phase(), 1);
});

test("transaction checks also allow stopping a pending wait without sending another request", async () => {
    const ui = uiFixture("mobile", "WSR-VERI-005"), pending = deferred();
    ui.provider.request = () => pending.promise;
    const waiting = ui.click("Review USDC.e approval");
    await flush();
    assert(ui.button("Waiting for wallet…"));
    assert(ui.button(stopLabel));
    await ui.click(stopLabel);
    await waiting;
    assert.equal(ui.saved[0].evidence.request_outcome, 'stopped_waiting');
    pending.reject({ code: 4001, message: "User rejected" });
    await flush();
});
