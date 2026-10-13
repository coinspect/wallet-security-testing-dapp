import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createAuthRunControl, readAuthPreflight, waitForAuthRequest } from "../src/utils/wallet-methods/authRunControl.mjs";
import * as payloads from "../src/utils/wallet-methods/authBypassPayloads.js";
import * as errors from "../src/utils/wallet-methods/walletErrors.mjs";
import { createAuthSessionRequest } from "../src/utils/wallet-methods/wc/authSession.mjs";
import { snapshotError } from '../src/utils/wallet-methods/requestDiagnostics.mjs';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL("../src/utils/wallet-methods/authBypassBatch.js", import.meta.url), "utf8");
const { code } = require("@swc/core").transformSync(src, { filename: "authBypassBatch.js", jsc: { parser: { syntax: "ecmascript" } }, module: { type: "commonjs" } });
const exports = {};
const constants = {
    LONG_SIGN_MESSAGE: "Auth fixture", TEST_ERC20_ADDRESS: `0x${"12".repeat(20)}`,
    PERMIT_EIP712: { types: {}, domain: { name: "USD Coin", chainId: 137 }, primaryType: "Permit", message: { owner: "runtime", spender: `0x${"34".repeat(20)}` } },
    resolveAddChain: () => ({ chainId: "0x28c58", chainName: "Taiko Mainnet", rpcUrls: ["https://rpc.mainnet.taiko.xyz"] }),
    chains: { polygon: { chainId: "0x89" } },
};
new Function("require", "exports", code)((id) => ({
    "@/utils/constants": constants,
    "@/utils/wallet-methods/authBypassPayloads": payloads,
    "@/utils/wallet-methods/walletErrors.mjs": errors,
    "./authRunControl.mjs": { AUTH_REQUEST_TIMEOUT_MS: 30000, readAuthPreflight, waitForAuthRequest },
    './requestDiagnostics.mjs': { snapshotError },
})[id] ?? require(id), exports);
const { runAuthBypassBatch, authBypassParams, resolveAuthBypassChainId } = exports;
const methods = Object.freeze(["wallet_addEthereumChain", "wallet_watchAsset", "eth_decrypt", "eth_getEncryptionPublicKey", "eth_signTypedData_v4", "personal_sign", "eth_sendTransaction"]);
const account = `0x${"56".repeat(20)}`;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('auth evidence normalizes explicit cancellation and preserves raw provider error details', async () => {
    for (const [error, expected] of [
        [{ code: 4001, message: 'User rejected' }, 'cancelled_by_tester'],
        [{ code: -32000, message: 'User canceled\nOriginal provider detail', data: { reason: 'cancel' } }, 'cancelled_by_tester'],
        [{ code: -32603, message: 'User canceled' }, 'error (internal): User canceled'],
        [{ code: -32601, message: 'Method not available' }, 'error: Method not available'],
        [{ code: -32000, message: 'Transport cancelled' }, 'error: Transport cancelled'],
        [{ code: 'EXPIRED', message: 'Request expired. Please try again.' }, 'request_expired'],
    ]) {
        const original = structuredClone(error);
        const rows = await runAuthBypassBatch({ methods: ['personal_sign'], account, chainId: 137,
            request: async () => { throw error; } });
        assert.equal(rows[0].outcome, expected);
        assert.equal(rows[0].request_submitted, true);
        assert.deepEqual(rows[0].rpc_error, original);
        assert.deepEqual(error, original);
    }
});

test('late cancellation or expiry stays attached to the stopped request with its original error', async () => {
    for (const [error, responseOutcome] of [
        [{ code: -32000, message: 'User canceled' }, 'cancelled_by_tester'],
        [{ code: 'EXPIRED', message: 'Request expired. Please try again.' }, 'request_expired'],
    ]) {
        const pending = deferred();
        const f = fixture({ manual: false, list: ['wallet_addEthereumChain', 'personal_sign'], request: () => pending.promise });
        await flush();
        f.control.stop();
        const rows = await f.result;
        pending.reject(error); await flush();
        assert.equal(rows[0].outcome, 'stopped_waiting');
        assert.equal(rows[0].late_settlement.outcome, 'rejected_after_stop');
        assert.equal(rows[0].late_settlement.response_outcome, responseOutcome);
        assert.deepEqual(rows[0].late_settlement.rpc_error, error);
        assert.equal(rows[1].request_submitted, false);
        assert.equal(f.calls.length, 1);
    }
});

test('an SDK expiry pauses a recoverable run without automatically sending the next method', async () => {
    const control = createAuthRunControl({ recoverable: true });
    let sent = 0;
    const running = runAuthBypassBatch({ methods: ['wallet_addEthereumChain', 'personal_sign'], account, chainId: 137, control,
        request: async () => { sent++; throw new Error('Request expired. Please try again.'); } });
    await flush();
    assert.equal(control.getState().lastResult.outcome, 'request_expired');
    assert.equal(control.getState().needsRecovery, false);
    assert.equal(sent, 1);
    control.nextMethod(); await flush();
    assert.equal(sent, 2);
    const rows = await running;
    assert.equal(rows[1].outcome, 'request_expired');
});

for (const stopEarly of [false, true]) {
    test(`mobile manual run continues on the same connection after ${stopEarly ? 'stop waiting' : 'timeout'}`, async () => {
        const first = deferred();
        const calls = [];
        const control = createAuthRunControl({ manual: true, recoverable: true });
        const running = runAuthBypassBatch({ methods: ['wallet_addEthereumChain', 'personal_sign'], account, chainId: 137, control, timeoutMs: 10,
            request: (args) => { calls.push(args); return calls.length === 1 ? first.promise : Promise.resolve('second response'); } });
        await flush(); control.runNext(); await flush();
        if (stopEarly) control.stopWaiting();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(control.getState().needsRecovery, false);
        assert.equal(calls.length, 1);
        control.nextMethod(); await flush();
        assert.equal(control.getState().phase, 'ready');
        assert.equal(calls.length, 1);
        control.runNext();
        const rows = await running;
        assert.equal(calls.length, 2);
        assert.equal(rows[0].outcome, stopEarly ? 'stopped_waiting' : 'no_response');
        assert.equal(rows[1].data_returned, 'second response');
        first.resolve('late first response'); await flush();
        assert.equal(rows[0].late_settlement.data_returned, 'late first response');
        assert.equal(rows[1].data_returned, 'second response');
    });
}

test('a reported session loss still requires recovery', async () => {
    const control = createAuthRunControl({ manual: true, recoverable: true });
    const waiting = control.endRequest({ outcome: 'session_dropped' }, { index: 0, total: 2 });
    assert.equal(control.getState().needsRecovery, true);
    control.nextMethod();
    assert.equal(control.getState().phase, 'result');
    control.stop();
    await waiting;
});

function fixture({ manual = true, request = async () => null, list = methods, timeoutMs = 1000, isConnectionCurrent } = {}) {
    const states = [], calls = [];
    const control = createAuthRunControl({ manual, isConnectionCurrent, onChange: (state) => states.push(state) });
    const result = runAuthBypassBatch({ control, methods: list, account, chainId: 137, timeoutMs,
        request: (args) => { calls.push(args); return request(args); } });
    return { control, result, calls, states };
}

for (const seconds of [5, 10, 15, 30]) test(`a ${seconds}s countdown sends only the selected manual method with unchanged payloads`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const f = fixture({ list: ["personal_sign", "eth_decrypt"] });
    t.after(() => f.control.dispose());
    f.control.runNext(seconds * 1000);
    assert.equal(f.states.at(-1).phase, "countdown");
    assert.equal(f.states.at(-1).remainingSeconds, seconds);
    f.control.runNext(); f.control.nextMethod(); f.control.skipNext();
    t.mock.timers.tick(seconds * 1000 - 1); await flush();
    assert.equal(f.calls.length, 0);
    assert.equal(f.states.at(-1).remainingSeconds, 1);
    t.mock.timers.tick(1); await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.states.at(-1).phase, "result");
    assert.deepEqual(f.calls[0], { method: "personal_sign", params: authBypassParams("personal_sign", account, 137) });
    assert.deepEqual(f.states.at(-1).lastResult.request_delay, { selected_ms: seconds * 1000, elapsed_ms: seconds * 1000 });
    f.control.nextMethod(); await flush();
    t.mock.timers.tick(60000); await flush();
    assert.equal(f.calls.length, 1);
    f.control.runNext();
    const rows = await f.result;
    assert.equal(rows[1].request_delay, undefined, "Off must not inherit the previous countdown");
    assert.equal(f.calls.length, 2);
});

test("cancelling a countdown returns to the same method and allows a different delay", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const f = fixture({ list: ["personal_sign"] });
    t.after(() => f.control.dispose());
    f.control.runNext(30000);
    t.mock.timers.tick(2000);
    f.control.cancelCountdown();
    t.mock.timers.tick(60000); await flush();
    assert.equal(f.calls.length, 0);
    assert.equal(f.states.at(-1).phase, "ready");
    assert.match(f.states.at(-1).notice, /request not sent/);
    f.control.runNext(5000);
    t.mock.timers.tick(5000);
    const rows = await f.result;
    assert.equal(f.calls.length, 1);
    assert.deepEqual(rows[0].request_delay, { selected_ms: 5000, elapsed_ms: 5000 });
});

for (const action of ["stop", "dispose"]) test(`${action} clears a countdown without sending or fabricating a wallet reply`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const f = fixture();
    f.control.runNext(15000);
    f.control[action]();
    const rows = await f.result;
    t.mock.timers.tick(60000); await flush();
    assert.equal(f.calls.length, 0);
    assert(rows.every((row) => row.outcome === "not_attempted" && !row.request_submitted && !row.request_delay));
});

test("a connection change during a countdown cancels the run before dispatch", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    let current = true;
    const f = fixture({ isConnectionCurrent: () => current });
    f.control.runNext(10000);
    current = false;
    t.mock.timers.tick(1000);
    const rows = await f.result;
    assert.equal(f.calls.length, 0);
    assert.match(f.states.at(-1).notice, /Connection changed/);
    assert(rows.every((row) => row.outcome === "not_attempted"));
});

test("the response timeout starts after the countdown and delayed timers still send once", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const f = fixture({ list: ["personal_sign"], timeoutMs: 30000, request: () => new Promise(() => {}) });
    t.after(() => f.control.dispose());
    f.control.runNext(10000);
    t.mock.timers.tick(12000); await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.states.at(-1).phase, "waiting");
    t.mock.timers.tick(29999); await flush();
    assert.equal(f.states.at(-1).phase, "waiting");
    t.mock.timers.tick(1);
    const rows = await f.result;
    assert.equal(rows[0].outcome, "no_response");
    assert.deepEqual(rows[0].request_delay, { selected_ms: 10000, elapsed_ms: 12000 });
    assert.equal(f.calls.length, 1);
});

test("manual mode dispatches exactly one unchanged RPC per click; skip never dispatches", async () => {
    const f = fixture();
    assert.equal(f.calls.length, 0);
    assert.equal(f.states.at(-1).phase, "ready");
    for (let index = 0; index < methods.length; index++) {
        assert.equal(f.states.at(-1).index, index);
        if (index === 2) f.control.skipNext();
        else { f.control.runNext(); f.control.runNext(); }
        await flush();
        assert.equal(f.calls.length, index + 1 - (index >= 2 ? 1 : 0));
        if (index < methods.length - 1) {
            assert.equal(f.states.at(-1).phase, "result");
            assert.equal(f.states.at(-1).method, methods[index]);
            f.control.nextMethod();
            await flush();
        }
    }
    const rows = await f.result;
    assert.deepEqual(f.calls, methods.filter((m) => m !== "eth_decrypt").map((method) => ({ method, params: authBypassParams(method, account, 137) })));
    assert.equal(rows[2].outcome, "skipped_by_tester");
    assert.equal(rows[2].request_submitted, false);
    assert.equal(rows.runtime.execution_mode, "manual");
    assert.deepEqual(rows.map((r) => r.method), methods);
    assert(!JSON.stringify(rows).includes("runNext"));
});

test("automatic mode still attempts every method after errors and timeouts", async () => {
    const f = fixture({ manual: false, timeoutMs: 5, request: ({ method }) => {
        if (method === "eth_decrypt") return new Promise(() => {});
        if (method === "eth_getEncryptionPublicKey") throw { code: -32601, message: "Not supported" };
        return Promise.resolve("raw wallet reply");
    } });
    const rows = await f.result;
    assert.deepEqual(f.calls.map((r) => r.method), methods);
    assert.equal(rows[2].outcome, "no_response");
    assert.equal(rows[3].code, -32601);
    assert.equal(rows[6].data_returned, "raw wallet reply");
    assert.equal(rows.runtime.execution_mode, "automatic");
});

test("manual timeout pauses before the next RPC and preserves late replies on the original row", async () => {
    const late = deferred();
    const f = fixture({ timeoutMs: 5, list: ["eth_decrypt", "personal_sign"], request: ({ method }) => method === "eth_decrypt" ? late.promise : Promise.resolve("second") });
    f.control.runNext();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(f.states.at(-1).phase, "result");
    assert.equal(f.states.at(-1).method, "eth_decrypt");
    assert.equal(f.calls.length, 1);
    assert.equal(f.states.at(-1).lastResult.outcome, "no_response");
    f.control.nextMethod(); await flush();
    assert.equal(f.calls.length, 1);
    f.control.runNext();
    const rows = await f.result;
    late.resolve("late raw response");
    await flush();
    assert.equal(rows[0].outcome, "no_response");
    assert.equal(rows[0].late_settlement.data_returned, "late raw response");
    assert.equal(rows[1].data_returned, "second");
});

test("stopping the wait is not labelled wallet rejection and never advances automatically", async () => {
    const late = deferred();
    const f = fixture({ list: ["eth_decrypt", "personal_sign"], request: () => late.promise });
    f.control.runNext(); await flush();
    f.control.stopWaiting(); await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.states.at(-1).lastResult.outcome, "stopped_waiting");
    f.control.nextMethod(); await flush();
    f.control.skipNext();
    const rows = await f.result;
    late.reject({ code: 4001, message: "User rejected" }); await flush();
    assert.equal(rows[0].late_settlement.outcome, "rejected_after_stop");
    assert.equal(rows[0].late_settlement.code, 4001);
    assert.equal(rows[1].request_submitted, false);
});

test("stop/unmount releases a paused run without sending its remaining requests", async () => {
    for (const action of ["stop", "dispose"]) {
        const f = fixture();
        f.control[action]();
        const rows = await f.result;
        assert.equal(f.calls.length, 0);
        assert(rows.every((r) => r.outcome === "not_attempted" && r.request_submitted === false));
        f.control.runNext(); await flush();
        assert.equal(f.calls.length, 0);
    }
});

test("stopping an in-flight automatic run sends no later requests", async () => {
    const f = fixture({ manual: false, request: () => new Promise(() => {}) });
    await flush(); f.control.stop();
    const rows = await f.result;
    assert.equal(f.calls.length, 1);
    assert.equal(rows[0].outcome, "stopped_waiting");
    assert(rows.slice(1).every((r) => r.outcome === "not_attempted"));
});

test("manual eth_accounts timeout and skip obey the same controls without hidden polls", async () => {
    const f = fixture({ timeoutMs: 5, list: ["eth_accounts", "personal_sign"], request: () => new Promise(() => {}) });
    f.control.runNext();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(f.calls, [{ method: "eth_accounts" }]);
    f.control.nextMethod(); await flush();
    f.control.skipNext();
    const rows = await f.result;
    assert.equal(rows[0].outcome, "no_response");
    assert.equal(rows[1].outcome, "skipped_by_tester");
});

test("result review and method selection are separate gates; duplicate or stale clicks cannot send", async () => {
    const f = fixture({ list: ["personal_sign", "eth_decrypt"] });
    f.control.nextMethod(); await flush();
    assert.equal(f.calls.length, 0);
    f.control.runNext(); await flush();
    assert.equal(f.states.at(-1).phase, "result");
    f.control.runNext(); f.control.skipNext(); await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.states.at(-1).method, "personal_sign");
    f.control.nextMethod(); f.control.nextMethod(); await flush();
    assert.equal(f.states.at(-1).phase, "ready");
    assert.equal(f.states.at(-1).lastResult, null);
    assert.equal(f.calls.length, 1);
    f.control.skipNext();
    const rows = await f.result;
    assert.equal(rows[1].outcome, "skipped_by_tester");
    assert.equal(f.states.at(-1).phase, "complete");
});

test("ending a run from its result preserves the visible method and drains remaining rows as unsent", async () => {
    const f = fixture();
    f.control.runNext(); await flush();
    const displayed = f.states.at(-1).lastResult;
    f.control.stop();
    const rows = await f.result;
    assert.equal(f.states.at(-1).lastResult, displayed);
    assert.equal(f.states.at(-1).method, methods[0]);
    assert.equal(f.states.at(-1).stopped, true);
    assert.equal(f.calls.length, 1);
    assert(rows.slice(1).every((r) => r.outcome === "not_attempted"));
});

test("setup reads are bounded and cannot continue using fallback values after a stop", async () => {
    await assert.rejects(readAuthPreflight(() => new Promise(() => {}), { method: "eth_accounts" }, undefined, 5), (e) => e.authSetupStopped && e.message.includes("eth_accounts"));
    const control = createAuthRunControl();
    const result = resolveAuthBypassChainId(() => new Promise(() => {}), "polygon", control);
    control.stop();
    await assert.rejects(result, (e) => e.authSetupStopped);
    // A normal explicit refusal retains the existing declared-chain fallback.
    assert.equal(await resolveAuthBypassChainId(() => Promise.reject({ code: 4100 }), "polygon"), 137);
});

test("an already stopped or synchronously throwing request cannot leak a timer or fabricated late reply", async () => {
    const abort = new AbortController(); abort.abort();
    let sent = 0, late = 0;
    await assert.rejects(waitForAuthRequest(() => { sent++; }, {}, 5, abort.signal, () => late++));
    await flush(); assert.equal(sent, 0); assert.equal(late, 0);
    await assert.rejects(waitForAuthRequest(() => { throw new Error("sync failure"); }, {}, 5), /sync failure/);
});

test("a stop at the dispatch boundary records not sent, not a pending wallet request", async () => {
    let control, sent = 0;
    control = createAuthRunControl({ onChange: (s) => { if (s.phase === "waiting") control.stop(); } });
    const rows = await runAuthBypassBatch({ control, methods: ["personal_sign"], account, chainId: 137, request: () => { sent++; return Promise.resolve(null); } });
    assert.equal(sent, 0);
    assert.equal(rows[0].outcome, "not_attempted");
    assert.equal(rows[0].late_settlement, undefined);
});

test("both real transport wrappers preserve the manual controller and exact request payload", async () => {
    const read = (name) => readFileSync(new URL(`../src/utils/wallet-methods/${name}/methods.js`, import.meta.url), "utf8");
    const extSource = read("ext").split("export const runAuthBypass = ")[1];
    const wcSource = read("wc").split("export const runAuthBypassWC = ")[1];
    for (const transport of ["extension", "walletconnect"]) {
        const calls = [], control = createAuthRunControl({ manual: true });
        const provider = { request: async (args) => { calls.push(args); return args.method === "eth_chainId" ? "0x89" : "signature"; } };
        provider.session = { topic: "test", namespaces: { eip155: { accounts: [`eip155:137:${account}`], methods: ["personal_sign"] } } };
        provider.client = { session: { get: () => provider.session }, request: async (envelope) => { calls.push(envelope.request); return "signature"; } };
        const ext = new Function("runAuthBypassBatch", "resolveSharedAuthBypassChainId", "getActiveProvider", `return ${extSource}`)(runAuthBypassBatch, resolveAuthBypassChainId, () => provider);
        const wc = new Function("runAuthBypassBatch", "readAuthPreflight", "readChainHexWC", "createAuthSessionRequest", `return ${wcSource}`)(runAuthBypassBatch, readAuthPreflight, (p) => p.request({ method: "eth_chainId" }), createAuthSessionRequest);
        const promise = transport === "extension"
            ? ext(["personal_sign"], account, "polygon", "connected", undefined, control, provider)
            : wc(["personal_sign"], account, "polygon", provider, "0x89", "connected", undefined, control);
        await flush();
        assert.deepEqual(calls, [{ method: "eth_chainId" }]);
        control.runNext();
        const rows = await promise;
        assert.deepEqual(calls.filter((c) => c.method !== 'eth_chainId'), [{ method: "personal_sign", params: authBypassParams("personal_sign", account, 137) }]);
        assert.equal(rows.runtime.execution_mode, "manual");
        assert.equal(rows[0].data_returned, "signature");
    }
});
