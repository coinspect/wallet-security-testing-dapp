import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUIDED_REQUESTS, authRequestTitle, authResultSummary, requestCancelled, signingRequestRows } from "../src/app/wizard/utils/guidedRequests.mjs";
import { GUIDED_COMPARISONS } from "../src/app/wizard/utils/guidedComparison.mjs";
import { MANUAL_GUIDANCE } from "../src/app/wizard/utils/manualGuidance.mjs";
import { gatesOnAccount, requiresDisconnected } from "../src/app/wizard/utils/walletState.js";
import { isReadFailure, isReconnectSignal, planWcConnect, WC_CONNECT_RECONNECT_NOTE } from "../src/app/wizard/utils/wcSession.mjs";
import { createAuthRunControl, readAuthPreflight } from "../src/utils/wallet-methods/authRunControl.mjs";
import { createStepRun } from "../src/utils/wallet-methods/stepRun.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const checks = JSON.parse(read("src/app/wizard/config/wizard.json")).wizard.checks;
const ADDRESS = `0x${"12".repeat(20)}`;

test("every configured check has exactly one guided presentation, including the 13 remaining variants", () => {
    assert.equal(Object.keys(GUIDED_REQUESTS).length, 13);
    for (const check of Object.values(checks)) {
        const choices = [GUIDED_REQUESTS[check.canonicalId], GUIDED_COMPARISONS[check.canonicalId], MANUAL_GUIDANCE[check.canonicalId], check.presentation === "connection-management"].filter(Boolean);
        assert.equal(choices.length, 1, check.canonicalId);
        const guided = GUIDED_REQUESTS[check.canonicalId];
        if (!guided) continue;
        assert.equal(check.steps.length, 1);
        assert.equal(guided.stages.filter((stage) => stage.action).length, 1);
        assert(guided.objective && guided.safety && guided.button);
        // Guidance never gets to declare wire values or change execution.
        assert.doesNotMatch(JSON.stringify(guided), /"(?:params|methods|chainId|transport|walletState)":/);
    }
});

test("signing summaries normalize cancellations across the actual legacy result shapes without rewriting results", () => {
    for (const [action, legs] of [
        ["clearMethodSignRequest", [["personalSign", "Personal Sign"], ["typedData", "Typed Data (Seaport)"], ["permit", "Typed Data (Permit)"]]],
        ["signPermitAndSeaport", [["permit", "Permit (EIP-712)"], ["seaport", "Seaport order (EIP-712)"]]],
        ["signLongMessageAndTypedData", [["personalSign", "Long Message (personal_sign)"], ["typedData", "Typed Data (eth_signTypedData_v4)"]]],
    ]) {
        const mobile = Object.fromEntries(legs.map(([key]) => [key, { error: "Cancelled" }]));
        const before = JSON.stringify(mobile);
        const extension = `🔐 Signing Test Results:\n\n${legs.map(([, label]) => `❌ ${label}: Cancelled`).join("\n\n")}`;
        assert.deepEqual(signingRequestRows(action, extension), signingRequestRows(action, mobile));
        assert(signingRequestRows(action, mobile).every((row) => row.title === "Cancelled by tester"));
        assert.equal(JSON.stringify(mobile), before);
        const mixed = { [legs[0][0]]: { result: "0xsignature" }, [legs[1][0]]: { error: "Transport cancelled" } };
        assert.deepEqual(signingRequestRows(action, mixed).slice(0, 2).map((row) => row.title), ["Signature returned", "Request returned an error"]);
    }
});

test("auth summaries keep cancellations, empty replies, session loss, unsupported methods and timeouts distinct", () => {
    for (const [row, title] of [
        [{ outcome: "error: Cancelled", code: -2 }, "Cancelled by tester"],
        [{ outcome: "rejected", code: 4001 }, "Cancelled by tester"],
        [{ outcome: "cancelled_by_tester", code: -32000 }, "Cancelled by tester"],
        [{ outcome: "error: User canceled", code: -32000 }, "Cancelled by tester"],
        [{ outcome: "request_expired" }, "Request expired"],
        [{ outcome: "rejected" }, "Request rejected"],
        [{ outcome: "error (internal): User rejected", code: -32603 }, "Request returned an error"],
        [{ outcome: "error: Not support", code: -1 }, "Request returned an error"],
        [{ outcome: "error: Transport cancelled", code: -2 }, "Request returned an error"],
        [{ outcome: "session_dropped" }, "Session lost"],
        [{ outcome: "empty" }, "Empty response"],
        [{ outcome: "declined" }, "Request declined"],
        [{ outcome: "no_response", late_settlement: "pending" }, "No response within timeout"],
        [{ outcome: "no_response", late_settlement: { outcome: "resolved_after_timeout", data_returned: "raw" } }, "No response within timeout"],
        [{ outcome: "skipped_by_tester", request_submitted: false }, "Skipped by tester — not sent"],
        [{ outcome: "stopped_waiting" }, "Tester stopped waiting — wallet request not cancelled"],
        [{ outcome: "not_attempted" }, "Not sent — run stopped"],
        [{ outcome: "resolved", data_returned: "raw", elapsed_ms: 0 }, "Data returned"],
    ]) {
        const frozen = JSON.stringify(row);
        assert.equal(authRequestTitle(row), title);
        assert.equal(JSON.stringify(row), frozen);
    }
    assert.equal(requestCancelled({ code: -2 }), false);
    assert.equal(requestCancelled({ message: "Connection cancelled" }), false);
});

test("SDK expiry counts as no wallet response, not a cancellation or recorded answer", () => {
    assert.equal(authResultSummary([
        { outcome: 'request_expired', request_submitted: true },
        { outcome: 'method_not_approved', request_submitted: false },
        { outcome: 'cancelled_by_tester', request_submitted: true },
    ]), '1 response recorded · 1 without a response · 1 not sent');
});

// Execute the production ActionPanel run closure without React/DOM. This
// verifies that the new presentation still uses its original transport/gates.
function panelFixture(step, platform, overrides = {}) {
    const calls = [], notices = [], outcomes = [], lifecycle = [];
    const provider = { identity: Symbol('selected-provider'), request: async (request) => { calls.push(request); return [ADDRESS]; } };
    const transport = platform === "mobile" ? step.transport === "injected" ? "injected" : "walletconnect" : "extension";
    const bindings = {
        mounted: { current: true }, recoveryRef: { current: null }, runDone: { current: null }, lastAuthResult: { current: null }, authOrigin: { current: null },
        latestRuntime: { current: { provider, address: ADDRESS, chainId: "0x89" } }, authConnection: () => ({}),
        pendingRef: { current: false }, action: step.ui.content.button.action, blocked: false, gateBlocked: false, mustDisconnect: false,
        authControl: { current: null }, manualAuth: false, setAuthProgress: () => {}, createAuthRunControl, readAuthPreflight,
        stepControl: { current: null }, manualRequests: false, setRequestProgress() {}, createStepRun,
        setGuardMessage: (message) => notices.push(message), transport, platform, runParams: { ...(step.data.params ?? {}) },
        wcSession: { walletProvider: provider, chainId: "0x89", open: () => lifecycle.push("pair") },
        onRunStart: () => lifecycle.push("start"), onRunFinish: () => lifecycle.push("finish"), setIsPending: () => {},
        onPendingChange: () => {},
        onResult: (value) => outcomes.push(value), onError: (error) => outcomes.push({ error }),
        planWcConnect, isReconnectSignal, isReadFailure, WC_CONNECT_RECONNECT_NOTE,
        actionProvider: provider, window: {}, walletState: step.walletState, gatesOnAccount,
        INJECTED_NO_PROVIDER_NOTE: "Open the wallet browser",
        handleAction: async (...args) => { calls.push({ dispatch: args }); return "recorded"; },
        ...overrides,
    };
    const source = read("src/app/wizard/components/ActionPanel.jsx");
    const body = source.slice(source.indexOf("const run = async (resume) =>"), source.indexOf("    const stopAndContinue"));
    const run = new Function(...Object.keys(bindings), `${body}\nreturn run;`)(...Object.values(bindings));
    return { run, calls, notices, outcomes, lifecycle, provider };
}

for (const [key, check] of Object.entries(checks).filter(([, check]) => GUIDED_REQUESTS[check.canonicalId])) {
    for (const platform of key.includes("~Browser") ? ["extension"] : key.includes("~Mobile") ? ["mobile"] : ["extension", "mobile"]) {
        test(`${key} ${platform}: guided action preserves params, transport and account preconditions`, async () => {
            const step = check.steps[0];
            const fixture = panelFixture(step, platform);
            await fixture.run();
            const sent = fixture.calls.find((call) => call.dispatch)?.dispatch;
            assert(sent);
            const navigation = step.ui.content.button.action === "openScamUrl";
            const wc = !navigation && platform === "mobile" && step.transport !== "injected";
            assert.equal(sent[0], step.transport === "injected" ? "extension" : platform);
            assert.equal(sent[1], step.ui.content.button.action);
            if (navigation) assert.equal(sent[2], null);
            else assert.equal(sent[2].identity, fixture.provider.identity);
            assert.deepEqual(sent[3], { ...(step.data.params ?? {}), ...(wc ? { __wcChainId: "0x89" } : {}) });
            if (sent[1] === "runAuthBypass") assert.equal(sent[4].manual, false);
            assert.deepEqual(fixture.calls.filter((call) => call.method), !navigation && !wc && gatesOnAccount(step.walletState) ? [{ method: "eth_accounts" }] : []);
            assert.deepEqual(fixture.lifecycle, ["start", "finish"]);
            assert.deepEqual(fixture.outcomes, ["recorded"]);
        });
    }
}

test("locked/disconnected checks retain the no-switch constraint and explicit address override", async () => {
    for (const key of ["WSR-PERM-002~Browser", "WSR-PERM-002~Mobile", "WSR-PERM-008~Browser"]) {
        assert.equal(checks[key].requiredChain, undefined);
        assert.equal(checks[key].steps[0].data.params.chain, undefined);
    }
    const step = checks["WSR-PERM-008~Browser"].steps[0];
    assert.equal(requiresDisconnected(step.walletState), true);
    const runParams = { ...step.data.params, providedAddress: ADDRESS };
    const fixture = panelFixture(step, "extension", { runParams });
    await fixture.run();
    assert.deepEqual(fixture.calls[0].dispatch[3], runParams);
    for (const guard of ["mustDisconnect", "blocked", "gateBlocked"]) {
        const blocked = panelFixture(step, "extension", { [guard]: true });
        await blocked.run(); assert.equal(blocked.calls.length, 0);
    }
});

test("WC pairing, reconnect and read failure do not become completed requests or leave pending UI", async () => {
    const step = checks["WSR-PERM-002~Mobile"].steps[0];
    const missing = panelFixture(step, "mobile", { wcSession: { open() {} } });
    await missing.run(); assert.deepEqual(missing.outcomes, []); assert.deepEqual(missing.lifecycle, []);
    for (const result of [{ status: "reconnect_required" }, { status: "read_failed", note: "No reply" }]) {
        const fixture = panelFixture(step, "mobile", { handleAction: async () => result });
        await fixture.run();
        assert.deepEqual(fixture.outcomes, []);
        assert.equal(fixture.lifecycle.at(-1), "finish");
        assert(fixture.notices.at(-1));
    }
});

test("manual execution is passed separately from the frozen RPC parameters", async () => {
    const step = checks["WSR-PERM-007~Mobile"].steps[0];
    const f = panelFixture(step, "mobile", { manualAuth: true });
    await f.run();
    const sent = f.calls.find((c) => c.dispatch).dispatch;
    assert.equal(sent[4].manual, true);
    assert.deepEqual(sent[3], { ...step.data.params, __wcChainId: "0x89" });
    assert(!JSON.stringify(sent[3]).includes("manual"));
});

test("account preflight is included in the double-click guard", async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    let reads = 0;
    const f = panelFixture(checks["WSR-PERM-010~Browser"].steps[0], "extension", {
        actionProvider: { request: () => { reads++; return pending; } },
    });
    const first = f.run();
    await f.run();
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 1);
    resolve([ADDRESS]); await first;
    assert.equal(f.calls.filter((c) => c.dispatch).length, 1);
});
