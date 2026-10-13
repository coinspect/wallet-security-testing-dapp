import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createAuthSessionRequest } from "../src/utils/wallet-methods/wc/authSession.mjs";
import { authConnection, authRecoveryGuard, authResumePlan, disconnectForRecovery } from "../src/app/wizard/utils/authRecovery.mjs";
import { createAuthRunControl } from "../src/utils/wallet-methods/authRunControl.mjs";
import { sourceLoader, reactHarness, nodes, deferred, flush } from "./helpers/sourceHarness.mjs";

const account = `0x${"11".repeat(20)}`;
const methods = ["wallet_addEthereumChain", "wallet_watchAsset", "eth_decrypt", "eth_getEncryptionPublicKey", "eth_signTypedData_v4", "personal_sign", "eth_sendTransaction"];

test('the visible late status distinguishes SDK expiry from a wallet cancellation', () => {
    const Component = sourceLoader()('src/app/wizard/components/GuidedRequestResult.jsx').default;
    const row = { method: methods[0], outcome: 'stopped_waiting', elapsed_ms: 5000,
        late_settlement: { outcome: 'rejected_after_stop', response_outcome: 'request_expired' } };
    const render = () => renderToStaticMarkup(Component({ action: 'runAuthBypass', success: [row], checkId: 'WSR-PERM-002~Mobile.v1', platform: 'mobile' }));
    assert.match(render(), /Original request expired without a wallet response/);
    assert.match(render(), /0 responses recorded · 1 without a response/);
    row.late_settlement.response_outcome = 'cancelled_by_tester';
    assert.match(render(), /Late response: Cancelled by tester/);
    assert.equal(row.outcome, 'stopped_waiting');
});

function wallet(topic = "first", approved = methods, reply = async () => { throw { code: 4001, message: "User rejected" }; }) {
    const calls = [], reads = [];
    const provider = {
        session: { topic, expiry: Date.now() / 1000 + 3600, peer: { metadata: { name: "Mock Trust", url: "https://wallet.test" } },
            namespaces: { eip155: { accounts: [`eip155:137:${account}`], methods: approved, events: [] } } },
        request: async (args) => {
            reads.push(args);
            if (args.method === "eth_accounts") return [account];
            if (args.method === "eth_chainId") return "0x89";
            assert.fail("A privileged method must not use UniversalProvider / HTTP fallback");
        },
    };
    provider.client = {
        session: { get: (key) => { assert.equal(key, topic); return provider.session; } },
        request(args) { assert.equal(this, provider.client); calls.push(structuredClone(args)); return reply(args); },
    };
    return { provider, calls, reads };
}

test("auth transport sends all payloads verbatim, including unapproved methods, without HTTP fallback", async () => {
    const f = wallet("first", ["personal_sign"], async () => null);
    const request = createAuthSessionRequest(f.provider, 137, account);
    const args = { method: "personal_sign", params: ["0xab", account] };
    assert.equal(await request(args), null);
    assert.deepEqual(f.calls, [{ topic: "first", chainId: "eip155:137", request: args }]);
    for (const method of ["eth_decrypt", "eth_getEncryptionPublicKey", "wallet_watchAsset"]) {
        assert.equal(await request({ method, params: [] }), null);
    }
    assert.equal(f.calls.length, 4);
    assert.deepEqual(f.reads, Array.from({ length: 4 }, () => ({ method: 'eth_chainId' })));
});

test("session approval is evidence only, while a replacement connection cannot receive an old request", async () => {
    const f = wallet();
    f.provider.session.namespaces = {
        "eip155:1": { accounts: [`eip155:1:${account}`], methods: ["eth_decrypt"] },
        "eip155:137": { accounts: [`eip155:137:${account}`], methods: ["personal_sign"] },
    };
    const request = createAuthSessionRequest(f.provider, "0x89", account);
    await assert.rejects(request({ method: "eth_decrypt", params: [] }), (e) => e.code === 4001);
    assert.deepEqual(request.authContext.session_permissions.approved_methods, ['personal_sign']);
    f.provider.session.namespaces["eip155:137"].methods = [];
    await assert.rejects(request({ method: "personal_sign", params: [] }), (e) => e.code === 4001);
    assert.deepEqual(request.authContext.session_permissions.approved_methods, []);
    f.provider.session = { ...f.provider.session, topic: "replacement" };
    await assert.rejects(request({ method: "personal_sign", params: [] }), (e) => e.authTransportReason === "session_changed");
    assert.equal(f.calls.length, 2);
});

test("missing and expired connections cannot receive new requests", async () => {
    for (const [change, reason] of [
        [(p) => { p.client = null; }, "session_unavailable"],
        [(p) => { p.session.expiry = 1; }, "session_unavailable"],
    ]) {
        const f = wallet(); change(f.provider);
        await assert.rejects(createAuthSessionRequest(f.provider, "0x89", account)({ method: "personal_sign" }), (e) => e.requestNotSent && e.authTransportReason === reason);
        assert.equal(f.calls.length, 0);
    }
});

test("namespace chain and account lists do not filter auth requests", async () => {
    for (const namespaces of [{}, { eip155: { accounts: [`eip155:1:0x${'22'.repeat(20)}`], methods: [] } }]) {
        const f = wallet(); f.provider.session.namespaces = namespaces;
        const args = { method: 'personal_sign', params: ['0xab', account] };
        await assert.rejects(createAuthSessionRequest(f.provider, 137, account)(args), (e) => e.code === 4001);
        assert.deepEqual(f.calls, [{ topic: 'first', chainId: 'eip155:137', request: args }]);
    }
});

test("recovery guards require a new session for the same account, wallet and network", () => {
    const runtime = { provider: wallet().provider, address: account, chainId: "0x89" };
    const original = authConnection(runtime);
    assert.match(authRecoveryGuard(original, runtime), /Disconnect/);
    assert.match(authRecoveryGuard(original, {}), /Reconnect/);
    const fresh = { ...runtime, provider: wallet("second").provider };
    assert.equal(authRecoveryGuard(original, fresh), null);
    assert.match(authRecoveryGuard(original, { ...fresh, address: `0x${"22".repeat(20)}` }), /same account/);
    assert.match(authRecoveryGuard(original, { ...fresh, chainId: "0x1" }), /Polygon/);
    fresh.provider.session.peer.metadata.name = "Other wallet";
    assert.match(authRecoveryGuard(original, fresh), /same wallet/);
});

test("resume plans preserve earlier row references and reject overwriting attempted methods", () => {
    const first = { method: methods[0], outcome: "stopped_waiting", request_submitted: true };
    const rows = [first, { method: methods[1], outcome: "not_attempted", request_submitted: false }];
    Object.defineProperty(rows, "runtime", { value: { connection_attempts: 2 } });
    const plan = authResumePlan(rows, 1);
    assert.equal(plan.previousResults[0], first);
    assert.equal(plan.connectionAttempt, 3);
    rows[1].request_submitted = true;
    assert.throws(() => authResumePlan(rows, 1), /already attempted/);
});

test("disconnect timeout ends the local wait without inventing a successful reconnection", async () => {
    const pending = deferred();
    await assert.rejects(disconnectForRecovery(() => pending.promise, 5), /did not finish/);
    pending.reject(new Error("Late disconnect error"));
    await flush();
});

function fixture({ locked = false, disconnectError = false } = {}) {
    const hooks = reactHarness(), results = [], lifecycle = [], late = deferred();
    const first = wallet("first", methods, () => late.promise);
    const runtime = { provider: first.provider, address: account, chainId: "0x89", status: "connected",
        get walletProvider() { return this.provider; },
        disconnect: async () => { lifecycle.push("disconnect"); if (disconnectError) throw new Error("Could not disconnect"); runtime.provider = null; runtime.address = null; },
        open: async () => { lifecycle.push("open"); },
    };
    const browser = { window: { location: { origin: "http://localhost:3000" }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} } };
    const load = sourceLoader({ react: hooks.react,
        "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
        "./SourceLabel": () => null, "./ChainGate": () => null,
    }, browser);
    const config = load("src/app/wizard/config/wizard.json").wizard.checks[locked ? "WSR-PERM-002~Mobile" : "WSR-PERM-007~Mobile"];
    const Component = load("src/app/wizard/components/ActionPanel.jsx").default;
    const props = { step: config.steps[0], platform: "mobile", walletConnectSession: runtime,
        onRunStart: (detail) => lifecycle.push(detail.resume ? "resume" : "start"), onRunFinish() {},
        onResult: (r) => { results.push(r); props.hasRun = true; lifecycle.push("saved"); },
        onError: (error) => assert.fail(error), onReview: () => lifecycle.push("review"),
    };
    const render = () => hooks.render(Component, props);
    const panel = () => nodes(render()).find((node) => node.props?.onManualChange)?.props;
    const button = (label) => nodes(render()).find((node) => node.props?.onClick && node.props.children === label);
    const connect = (provider = wallet("second", methods.filter((m) => !["eth_decrypt", "eth_getEncryptionPublicKey"].includes(m)))) => {
        runtime.provider = provider.provider; runtime.address = account; render(); return provider;
    };
    return { hooks, results, lifecycle, late, first, runtime, load, config, render, panel, button, connect };
}

test("stop waiting advances the method inside the same instruction without reviewing or reconnecting", async (t) => {
    const ui = fixture();
    t.after(() => ui.hooks.unmount());
    const Panel = ui.load("src/app/wizard/components/AuthRunPanel.jsx").default;
    ui.panel().onManualChange(true);
    const running = ui.panel().onRun(); await flush();
    ui.panel().control.runNext(); await flush();
    assert.equal(ui.first.calls.length, 1);
    assert.equal(ui.button("Stop waiting and continue"), undefined);
    assert(ui.button("Stop run and go to next instruction"));
    const button = nodes(Panel(ui.panel())).find((node) => node.props.children === "Stop waiting and go to next method");
    button.props.onClick();
    button.props.onClick();
    await flush();
    assert.equal(ui.panel().progress.index, 1);
    assert.equal(ui.panel().progress.phase, "ready");
    assert.match(ui.panel().progress.notice, /Previous request may still be pending/);
    assert.equal(ui.first.calls.length, 1);
    assert.deepEqual(ui.lifecycle, ["start"]);
    assert.equal(ui.runtime.provider, ui.first.provider);
    ui.panel().control.runNext(); await flush();
    assert.equal(ui.first.calls.length, 2);
    ui.late.resolve("reply"); await flush();
    ui.panel().control.stop(); await running;
    assert.equal(ui.results.at(-1)[0].outcome, "stopped_waiting");
    assert.equal(ui.results.at(-1)[0].late_settlement.data_returned, "reply");
    assert.equal(ui.results.at(-1)[1].outcome, "resolved");
    assert(!ui.lifecycle.includes("review"));
    assert(!ui.lifecycle.includes("disconnect"));
});

test("next instruction ends all remaining methods and calls review only after saving", async (t) => {
    const ui = fixture();
    t.after(() => ui.hooks.unmount());
    ui.panel().onManualChange(true);
    const running = ui.panel().onRun(); await flush();
    ui.panel().control.runNext(); await flush();
    await ui.button("Stop run and go to next instruction").props.onClick();
    await running;
    assert.equal(ui.first.calls.length, 1);
    assert.equal(ui.results.at(-1)[0].outcome, "stopped_waiting");
    assert(ui.results.at(-1).slice(1).every((row) => row.outcome === "not_attempted" && row.request_submitted === false));
    assert.deepEqual(ui.lifecycle, ["start", "saved", "review"]);
    ui.late.resolve(null); await flush();
});

for (const phase of ['ready', 'countdown']) test(`reconnect from ${phase} resumes the unsent method`, async (t) => {
    const ui = fixture();
    t.after(() => ui.hooks.unmount());
    ui.panel().onManualChange(true);
    const running = ui.panel().onRun(); await flush();
    if (phase === 'countdown') ui.panel().control.runNext(30000);
    await ui.panel().onReconnect(); await running;
    const next = ui.connect();
    const resumed = ui.button('Resume with next method').props.onClick(); await flush();
    assert.equal(ui.panel().progress.index, 0);
    assert.equal(next.calls.length, 0);
    ui.panel().control.runNext(); await flush();
    assert.equal(next.calls.length, 1);
    ui.panel().control.stop(); await resumed;
});

test('a finished run reconnects and starts from method zero only after explicit confirmation', async (t) => {
    const ui = fixture();
    t.after(() => ui.hooks.unmount());
    ui.panel().onManualChange(true);
    const running = ui.panel().onRun(); await flush();
    ui.panel().control.stop(); await running;
    const original = JSON.stringify(ui.results[0]);
    await ui.panel().onReconnect();
    const next = ui.connect();
    assert.equal(next.calls.length, 0);
    const restarted = ui.button('Start new run').props.onClick(); await flush();
    assert.equal(ui.panel().progress.index, 0);
    assert.equal(next.calls.length, 0);
    ui.panel().control.runNext(); await flush();
    ui.panel().control.stop(); await restarted;
    assert.equal(JSON.stringify(ui.results[0]), original);
    assert.equal(next.calls.length, 1);
});

test("quick delays are scoped to Mobile wallet unlock and persist between its manual methods", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const other = fixture();
    assert.equal(other.panel().onDelayChange, undefined);
    other.hooks.unmount();
    const ui = fixture({ locked: true });
    t.after(() => ui.hooks.unmount());
    const Panel = ui.load("src/app/wizard/components/AuthRunPanel.jsx").default;
    const click = (label) => nodes(Panel(ui.panel())).find((node) => node.props.children === label).props.onClick();
    ui.panel().onManualChange(true);
    assert.equal(ui.panel().delaySeconds, 0);
    click("10s");
    const running = ui.panel().onRun(); await flush();
    assert.equal(ui.first.calls.length, 0);
    click("Run request");
    assert.equal(ui.panel().progress.phase, "countdown");
    assert.equal(ui.panel().delaySeconds, 10);
    assert.equal(ui.button("Cancel countdown and continue"), undefined);
    t.mock.timers.tick(10000); await flush();
    assert.equal(ui.first.calls.length, 1);
    ui.late.reject({ code: 4001, message: "User rejected" }); await flush();
    click("Next method"); await flush();
    assert.equal(ui.panel().progress.phase, "ready");
    assert.equal(ui.panel().delaySeconds, 10);
    click("5s"); click("Run request");
    t.mock.timers.tick(5000); await flush();
    assert.equal(ui.first.calls.length, 2);
    ui.panel().control.stop(); await running;
    const rows = ui.results.at(-1);
    assert.deepEqual(rows.slice(0, 2).map((row) => row.request_delay.selected_ms), [10000, 5000]);
    const Result = ui.load("src/app/wizard/components/GuidedRequestResult.jsx").default;
    const html = renderToStaticMarkup(Result({ action: "runAuthBypass", success: rows, platform: "mobile", checkId: ui.config.canonicalId }));
    assert.match(html, /Delay before request: 10s/);
    assert.match(html, /Delay before request: 5s/);
});

for (const change of ["account", "provider", "topic", "disconnect", "unmount", "continue"]) test(`${change} during the Mobile unlock countdown leaves no pending send`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const ui = fixture({ locked: true });
    t.after(() => ui.hooks.unmount());
    ui.panel().onManualChange(true);
    const running = ui.panel().onRun(); await flush();
    ui.panel().control.runNext(10000);
    if (change === "account") ui.runtime.address = `0x${"22".repeat(20)}`;
    if (change === "provider") ui.runtime.provider = wallet("second").provider;
    if (change === "topic") ui.runtime.provider.session.topic = "replacement";
    if (change === "disconnect") { ui.runtime.provider = null; ui.runtime.address = null; }
    if (change === "unmount") ui.hooks.unmount();
    else if (change === "continue") ui.panel().control.stop();
    else ui.render();
    t.mock.timers.tick(60000); await running; await flush();
    assert.equal(ui.first.calls.length, 0);
    assert(ui.results.every((rows) => rows.every((row) => !row.request_submitted && row.outcome === "not_attempted")));
    if (!["unmount", "continue"].includes(change)) assert.match(ui.panel().progress.notice, /Connection changed/);
});

test("real manual UI reconnects, resumes at the next method and retains all prior observations and late replies", async () => {
    const ui = fixture(), frozen = JSON.stringify(ui.config);
    ui.panel().onManualChange(true);
    const initial = ui.panel().onRun();
    await flush();
    ui.panel().control.runNext(); await flush();
    assert.equal(ui.first.calls.length, 1);
    const recovering = ui.panel().onReconnect();
    await recovering; await initial;
    assert.deepEqual(ui.lifecycle, ["start", "saved", "disconnect", "open"]);
    const original = ui.results[0][0];
    assert.equal(original.outcome, "stopped_waiting");
    assert(ui.results[0].slice(1).every((r) => r.outcome === "not_attempted"));
    assert.match(renderToStaticMarkup(ui.render()), /Continue with the next method/);
    const second = ui.connect();
    const continued = ui.button("Resume with next method").props.onClick();
    await flush();
    assert.equal(ui.panel().progress.index, 1);
    assert.equal(second.calls.length, 0, "Reconnect never sends a privileged request automatically");
    for (let index = 1; index < methods.length; index++) {
        assert.equal(ui.panel().progress.index, index);
        ui.panel().control.runNext(); await flush();
        if (index < methods.length - 1) { ui.panel().control.nextMethod(); await flush(); }
    }
    await continued;
    const resumed = ui.results.at(-1);
    assert.equal(resumed.length, 7);
    assert.equal(resumed[0], original);
    assert.equal(resumed[0].runtime.connection_attempt, 1);
    assert(resumed.slice(1).every((r) => r.runtime.connection_attempt === 2));
    assert.equal(resumed[2].outcome, "cancelled_by_tester");
    assert.equal(resumed[2].request_submitted, true);
    assert.equal(resumed[3].request_submitted, true);
    assert.equal(resumed.runtime.connection_attempts, 2);
    assert.deepEqual(second.calls.map((c) => c.request.method), methods.slice(1));
    const { authBypassParams } = ui.load("src/utils/wallet-methods/authBypassBatch.js");
    for (const call of [...ui.first.calls, ...second.calls]) assert.deepEqual(call.request.params,
        authBypassParams(call.request.method, account, 137, ui.config.steps[0].data.params.addChain));
    ui.late.resolve(null); await flush();
    assert.equal(resumed[0].outcome, "stopped_waiting");
    assert.equal(resumed[0].late_settlement.outcome, "resolved_after_stop");
    assert.equal(resumed[1].outcome, "cancelled_by_tester");
    assert.equal(JSON.stringify(ui.config), frozen);
    ui.hooks.unmount();
});

test("automatic timeouts pause until Next without requiring a new connection", async () => {
    const load = sourceLoader({}, { window: { dispatchEvent() {} } });
    const { runAuthBypassBatch } = load("src/utils/wallet-methods/authBypassBatch.js");
    const states = [], calls = [], control = createAuthRunControl({ recoverable: true, onChange: (s) => states.push(s) });
    const pending = runAuthBypassBatch({ methods, account, chainId: 137, control, timeoutMs: 5, request: (args) => { calls.push(args); return new Promise(() => {}); } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(states.at(-1).needsRecovery, false);
    assert.equal(calls.length, 1);
    control.nextMethod(); await flush();
    assert.equal(calls.length, 2);
    control.stop();
    const result = await pending;
    assert.equal(result[0].outcome, "no_response");
    assert.equal(result[1].request_submitted, true);
    assert(result.slice(2).every((row) => row.request_submitted === false));
});

test("failed disconnect keeps history and requires manual recovery; locked checks restore their precondition", async () => {
    const ui = fixture({ locked: true, disconnectError: true });
    const running = ui.panel().onRun(); await flush();
    await ui.panel().onReconnect(); await running;
    assert.equal(ui.results[0][0].outcome, "stopped_waiting");
    assert(!ui.lifecycle.includes("open"));
    assert(ui.button("Connect wallet").props.disabled);
    assert.match(renderToStaticMarkup(ui.render()), /Disconnect this dApp manually/);
    const fresh = ui.connect();
    assert(ui.button("Wallet locked — resume"));
    assert.equal(fresh.calls.length, 0);
    ui.hooks.unmount();
});

test("unmount during reconnect never opens a modal or starts another request", async () => {
    const ui = fixture(), gate = deferred();
    ui.runtime.disconnect = () => gate.promise;
    const running = ui.panel().onRun(); await flush();
    const recovery = ui.panel().onReconnect(); await flush();
    ui.hooks.unmount(); gate.resolve();
    await recovery; await running;
    assert(!ui.lifecycle.includes("open"));
    assert.equal(ui.first.calls.length, 1);
});

test("failed resume preflight retains history and permits retry without resending earlier methods", async () => {
    const ui = fixture();
    const initial = ui.panel().onRun(); await flush();
    await ui.panel().onReconnect(); await initial;
    const saved = ui.results[0];
    const second = ui.connect();
    const read = second.provider.request;
    second.provider.request = async () => { throw new Error("Temporary connection read failure"); };
    await ui.button("Resume with next method").props.onClick();
    assert.equal(ui.results.at(-1), saved);
    assert.equal(second.calls.length, 0);
    assert.match(renderToStaticMarkup(ui.render()), /Temporary connection read failure/);
    second.provider.request = read;
    const retry = ui.button("Resume with next method").props.onClick(); await flush();
    assert.equal(ui.panel().progress.index, 1);
    ui.panel().control.stop(); await retry;
    assert.equal(ui.results.at(-1)[0], saved[0]);
    ui.hooks.unmount();
});
