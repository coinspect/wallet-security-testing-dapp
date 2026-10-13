import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { authRequestTitle } from "../src/app/wizard/utils/guidedRequests.mjs";
import { AUTH_REQUEST_TIMEOUT_MS } from "../src/utils/wallet-methods/authRunControl.mjs";

const require = createRequire(import.meta.url);
function load(name, overrides = {}) {
    const source = readFileSync(new URL(`../src/app/wizard/components/${name}.jsx`, import.meta.url), "utf8");
    const { code } = require("@swc/core").transformSync(source, {
        filename: `${name}.jsx`, module: { type: "commonjs" },
        jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } },
    });
    const exports = {};
    new Function("require", "exports", code)((id) => overrides[id] ?? require(id), exports);
    return exports.default;
}
const CTA = load("CTAButton");
const Panel = load("AuthRunPanel", {
    "./CTAButton": CTA, "../utils/guidedRequests.mjs": { authRequestTitle },
    "../../../utils/wallet-methods/authRunControl.mjs": { AUTH_REQUEST_TIMEOUT_MS },
});
const base = { pending: true, manual: true, label: "Run requests", onReview() {} };
const progress = { index: 2, total: 7, method: "eth_decrypt" };
const render = (props) => renderToStaticMarkup(React.createElement(Panel, { ...base, ...props }));

test('reconnect is outside More during ready, countdown and completion', () => {
    for (const phase of ['ready', 'countdown', 'complete']) {
        const tree = Panel({ ...base, pending: phase !== 'complete', hasRun: true, onReconnect() {}, progress: { ...progress, phase, lastResult: { outcome: 'stopped_waiting' } } });
        const label = phase === 'complete' ? 'Reconnect and start new run' : 'Reconnect and resume';
        const button = nodes(tree).find((node) => node.props.children === label);
        assert(button);
        assert.equal(button.type, CTA);
    }
});

test('timeouts offer next method and a visible reconnect action', () => {
    for (const manual of [true, false]) {
        for (const outcome of ['no_response', 'stopped_waiting', 'request_expired']) {
            const html = render({ manual, onReconnect() {}, progress: { ...progress, phase: 'result', awaitingNext: true, needsRecovery: false, lastResult: { outcome } } });
            assert.match(html, /Next method/);
            assert.match(html, /Reconnect and resume/);
            assert.match(html, /<details[^>]*><summary[^>]*aria-label="Run options"/);
        }
    }
    assert.match(render({ onReconnect() {}, progress: { ...progress, phase: 'waiting' } }), /Reconnect and resume/);
    assert.match(render({ onReconnect() {}, progress: { ...progress, phase: 'result', needsRecovery: true, lastResult: { outcome: 'session_dropped' } } }), /Reconnect and resume/);
});
function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

test("manual setup is collapsed and disappears once a run starts", () => {
    const idle = render({ pending: false });
    assert.match(idle, /Start manual run/);
    assert.match(idle, /<details[^>]*><summary[^>]*>Advanced controls/);
    assert.doesNotMatch(idle, /<details[^>]*open|Cancel any pending|Next method/);
    const ready = render({ progress: { ...progress, phase: "ready" } });
    assert.match(ready, /Method 3 of 7/);
    assert.match(ready, /eth_decrypt/);
    assert.match(ready, /Run request/);
    assert.match(ready, />Skip</);
    assert.doesNotMatch(ready, /checkbox|Advanced controls|Manual run in progress|Continue| disabled="/);
});

test("quick delay buttons are available only for enabled manual runs and select the next request delay", () => {
    const selected = [], sent = [];
    const props = { ...base, delaySeconds: 10, onDelayChange: (value) => selected.push(value),
        control: { runNext: (value) => sent.push(value) }, progress: { ...progress, phase: "ready" } };
    const tree = nodes(Panel(props));
    const picker = tree.find((node) => node.type === "fieldset");
    const buttons = nodes(picker).filter((node) => node.type === "button");
    assert.deepEqual(buttons.map((node) => node.props.children), ["Off", "5s", "10s", "15s", "30s"]);
    assert.deepEqual(buttons.map((node) => node.props["aria-pressed"]), [false, false, true, false, false]);
    buttons.forEach((node) => node.props.onClick());
    assert.deepEqual(selected, [0, 5, 10, 15, 30]);
    tree.find((node) => node.props.children === "Run request").props.onClick();
    assert.deepEqual(sent, [10000]);
    assert.match(render({ ...props, pending: false }), /Delay before request/);
    for (const override of [{ manual: false }, { onDelayChange: undefined }, { progress: { ...progress, phase: "waiting" } }]) {
        assert.doesNotMatch(render({ ...props, ...override }), /Delay before request/);
    }
});

test("countdown shows the remaining time and cancellation without duplicate send or next controls", () => {
    let cancelled = false;
    const props = { progress: { ...progress, phase: "countdown", remainingSeconds: 5 },
        control: { cancelCountdown: () => { cancelled = true; } } };
    const html = render(props);
    assert.match(html, /Sending in 5s — lock your wallet now/);
    assert.match(html, /Cancel countdown/);
    assert.doesNotMatch(html, /Run request|Next method|Stop waiting|Waiting for wallet|Delay before request/);
    nodes(Panel({ ...base, ...props })).find((node) => node.props.children === "Cancel countdown").props.onClick();
    assert(cancelled);
});

test("each phase shows one method and only its relevant controls", () => {
    const waiting = render({ progress: { ...progress, phase: "waiting" } });
    assert.match(waiting, /Waiting for wallet…/);
    assert.match(waiting, /Stop waiting/);
    assert.doesNotMatch(waiting, /Run request|Next method|>Skip<|disabled/);
    const result = render({ progress: { ...progress, phase: "result", lastResult: { method: "eth_decrypt", outcome: "rejected", code: 4001 } } });
    assert.match(result, /Cancelled by tester/);
    assert.match(result, /Next method/);
    assert.equal((result.match(/eth_decrypt/g) ?? []).length, 1);
    assert.doesNotMatch(result, /Run request|Stop waiting|Cancel any pending/);
    const automatic = render({ manual: false, progress: { ...progress, phase: "waiting" } });
    assert.match(automatic, /Waiting for wallet…/);
    assert.doesNotMatch(automatic, /Run request|Next method|Stop waiting|checkbox/);
});

test("pending-wallet guidance is contextual and completion has a single review action", () => {
    for (const outcome of ["no_response", "stopped_waiting"]) {
        const result = { ...progress, phase: "result", lastResult: { outcome } };
        const html = render({ progress: result });
        assert.match(html, /Cancel any pending prompt there before continuing/);
        assert.match(html, outcome === "no_response" ? /No response within 30 seconds/ : /Stopped waiting/);
        const complete = render({ pending: false, hasRun: true, progress: { ...result, phase: "complete" } });
        assert.match(complete, /Review responses/);
        assert.doesNotMatch(complete, /Next method|Start manual run/);
        assert.match(complete, /New run/);
    }
    const failedSetup = render({ pending: false, hasRun: true, progress: { phase: "complete" } });
    assert.doesNotMatch(failedSetup, /Run complete/);
    assert.match(failedSetup, /Start manual run/);
    const ended = render({ pending: false, hasRun: true, progress: { ...progress, phase: "complete", stopped: true } });
    assert.match(ended, /Run ended/);
});

test("Run, Next and Skip are wired separately and End run stays in a closed menu", () => {
    const calls = [];
    const control = Object.fromEntries(["runNext", "nextMethod", "skipNext", "stopWaitingAndNext", "stop"].map((name) => [name, () => calls.push(name)]));
    for (const [phase, label] of [["ready", "Run request"], ["ready", "Skip"], ["result", "Next method"], ["waiting", "Stop waiting and go to next method"]]) {
        const tree = nodes(Panel({ ...base, control, progress: { ...progress, phase } }));
        tree.find((node) => node.props?.children === label).props.onClick();
    }
    assert.deepEqual(calls, ["runNext", "skipNext", "nextMethod", "stopWaitingAndNext"]);
    const menu = nodes(Panel({ ...base, control, progress: { ...progress, phase: "ready" } })).find((node) => node.props?.children === "End run");
    const menuTree = menu.type(menu.props);
    assert.equal(menuTree.type, "details");
    assert(!menuTree.props.open);
    const details = { open: true };
    nodes(menuTree).find((node) => node.type === "button").props.onClick({ currentTarget: { closest: () => details } });
    assert.equal(details.open, false);
    assert.equal(calls.at(-1), "stop");
});

test("the guided auth stage delegates review navigation instead of duplicating Continue", () => {
    const updates = [];
    let hook = 0;
    const Action = () => null;
    const Guided = load("GuidedRequestCheck", {
        react: { ...React, useState: () => [[1, false, null][hook++], (value) => updates.push(value)], useRef: (value) => ({ current: value }) },
        "./ActionPanel": Action, "./ActionResult": () => null, "./PersistedEvidence": () => null, "./WizardStepHeader": () => null,
        "./RecipientAddress": () => null,
        "./SkipStepButton": () => null,
        "../utils/checkMeta": { checkTitle: () => "Auth" }, "../context/WalletRuntimeContext": { useWalletRuntime: () => ({}) },
        "../utils/platform": { resolveTransport: () => "walletconnect" }, "../utils/providerIdentity": { getProviderIdentity: () => ({}) },
        "../utils/guidedComparison.mjs": { sameGuidedContext: () => true }, "@/utils/constants": { testParams: [] },
    });
    const tree = Guided({ step: { ui: { content: { button: { action: "runAuthBypass" } } } },
        presentation: { stages: [{ title: "Prepare" }, { title: "Run", action: true }, { title: "Review" }] }, platform: "mobile" });
    const stage = nodes(tree).find((node) => node.props?.id === "request-stage-1");
    assert(!nodes(stage).some((node) => node.props?.children === "Continue"));
    const panel = nodes(stage).find((node) => node.type === Action);
    panel.props.onPendingChange(true);
    panel.props.onReview();
    assert.deepEqual(updates, [true, 2]);
});
