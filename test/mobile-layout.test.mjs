import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MANUAL_GUIDANCE } from "../src/app/wizard/utils/manualGuidance.mjs";
import * as guidedRequests from "../src/app/wizard/utils/guidedRequests.mjs";
import * as responseDetails from "../src/app/wizard/utils/responseDetails.mjs";

const require = createRequire(import.meta.url);
const { transformSync } = require("@swc/core");
const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const componentPath = (name) => `app/wizard/components/${name}.jsx`;
function load(name, overrides = {}) {
    const { code } = transformSync(source(componentPath(name)), {
        filename: `${name}.jsx`,
        jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } },
        module: { type: "commonjs" },
    });
    const exports = {};
    new Function("require", "exports", code)((id) => Object.hasOwn(overrides, id) ? overrides[id] : require(id), exports);
    return exports.default;
}
function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

test("manual checks keep Continue in a separate row above the screenshot reminder in both campaigns", () => {
    const Renderer = load("StepRenderer", {
        "./SourceLabel": () => null,
        "./SkipStepButton": () => null,
        "./ImageModal": () => null,
        "../utils/platform": { baseCheckId: (id) => id.split("~")[0], DEFAULT_PLATFORM: "extension" },
        "@/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
        "@/utils/constants": { testParams: [], resolveParamValue: () => null },
        "./CTAButton": load("CTAButton"),
        "../utils/manualGuidance.mjs": { MANUAL_GUIDANCE },
    });
    for (const [platform, variant] of [["mobile", "Mobile"], ["extension", "Browser"]]) {
        const stepConfig = {
            id: `WSR-PHYS-002~${variant}`,
            canonicalId: `WSR-PHYS-002~${variant}.v1`,
            ui: { content: { steps: [
                { action: "Review the wallet screen.", capture: "Keep the wallet screenshot." },
                { action: "Review the next screen." },
            ] } },
        };
        const html = renderToStaticMarkup(React.createElement(Renderer, { stepConfig, walletUi: true, platform }));
        assert.match(html, /<div class="flex flex-wrap items-center gap-3"><button[^>]*>Continue<\/button><\/div><div><span title="Keep the wallet screenshot\."/);
        assert.match(html, /min-h-11 w-full/);
        assert.match(html, /md:w-auto/);
    }
});

test("compact navigator preserves campaign and ordered check routes, with disabled boundaries", () => {
    const calls = [];
    const checks = ["WSR-PERM-001", "WSR-PERM-002", "WSR-PERM-009"].map((id) => ({ id, title: id }));
    const Progress = load("ProgressBar", {
        react: { ...React, useState: () => [null, () => {}] },
        "react-router": { useNavigate: () => (url) => calls.push(url) },
        "../context/ThemeContext": { useTheme: () => ({ isDarkMode: true }) },
        "../utils/platform": { baseCheckId: (id) => id, DEFAULT_PLATFORM: "extension" },
        "../utils/campaignChecks": { campaignChecks: () => checks },
        "./CheckIndexPanel": () => null,
        "./EvidenceExportButton": () => null,
    });
    for (const platform of ["extension", "mobile"]) {
        const tree = nodes(Progress({ currentStep: checks[1].id, platform }));
        const counter = tree.find((node) => node.props?.["aria-live"] === "polite");
        assert.equal(counter.props["aria-label"], "Check 2 of 3");
        for (const [label, expected] of [["Previous check", checks[0]], ["Next check", checks[2]]]) {
            const button = tree.find((node) => node.props?.["aria-label"] === label);
            assert.equal(button.props.disabled, false);
            button.props.onClick();
            assert.equal(calls.at(-1), `/wizard/${platform}/${expected.id}`);
        }
        assert(nodes(Progress({ currentStep: checks[0].id, platform })).find((node) => node.props?.["aria-label"] === "Previous check").props.disabled);
        assert(nodes(Progress({ currentStep: checks[2].id, platform })).find((node) => node.props?.["aria-label"] === "Next check").props.disabled);
        assert(nodes(Progress({ currentStep: "missing", platform })).filter((node) => ["Next check", "Previous check"].includes(node.props?.["aria-label"])).every((button) => button.props.disabled));
    }
});

test("responsive tools close on Escape/outside touch and restore trigger focus only on Escape", () => {
    const listeners = new Map(), updates = [];
    let focused = 0;
    const inside = {};
    const oldDocument = globalThis.document;
    globalThis.document = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key) => listeners.delete(key) };
    let cleanup;
    let ref = 0;
    try {
        const Tools = load("ResponsiveTools", { react: {
            ...React, useState: () => [true, (value) => updates.push(value)], useId: () => "tools-test",
            useRef: () => ({ current: ref++ === 0 ? { contains: (target) => target === inside } : { focus: () => focused++ } }),
            useEffect: (effect) => { cleanup = effect(); },
        } });
        const tree = Tools({ label: "Tools", accessibleLabel: "Session actions", children: (close) => React.createElement("button", { onClick: close }, "Export") });
        assert.equal(tree.props.children[0].props["aria-controls"], tree.props.children[1].props.id);
        listeners.get("pointerdown")({ target: inside });
        assert.equal(updates.length, 0);
        listeners.get("pointerdown")({ target: {} });
        assert.deepEqual(updates, [false]);
        listeners.get("keydown")({ key: "Escape" });
        assert.equal(focused, 1);
        tree.props.children[1].props.children.props.onClick();
        assert.deepEqual(updates, [false, false, false]);
        cleanup();
        assert.equal(listeners.size, 0);
    } finally { globalThis.document = oldDocument; }
});

test("responsive presentation never auto-selects a campaign or changes a request", () => {
    for (const path of [componentPath("ResponsiveTools"), componentPath("ProgressBar"),
        "components/mainLayout/layoutBar/navBar/NavBar.jsx", "components/mainLayout/layoutBar/controls/NavControls.jsx"]) {
        assert.doesNotMatch(source(path), /matchMedia|userAgent|handleAction|provider\.request/);
    }
    const shell = source(componentPath("WizardShell"));
    assert.match(shell, /pt-\[100px\].*md:pt-12/);
    assert.match(shell, /safe-area-inset-bottom/);
    assert.match(source(componentPath("ProgressBar")), /hidden h-7.*lg:block/);
    assert.doesNotMatch(source("components/mainLayout/layoutBar/navBar/NavStatusStrip.jsx"), /relative hidden md:inline-flex/);
});

test("mobile account copy uses the full address and exported images retain the full identity", async () => {
    const address = "0x462A0d4fE4C2b10aadFBD4628f697d09a76Cd954";
    const runtime = Object.freeze({ provider: Object.freeze({ name: "Test wallet" }), from: address });
    const copied = [], statuses = [];
    const Identity = load("RuntimeIdentity", { react: { ...React, useState: () => ["", (value) => statuses.push(value)] } });
    const tree = Identity({ runtime });
    const all = nodes(tree);
    assert.equal(all.find((node) => node.props?.["data-capture-only"]).props.children, `Test wallet · Wallet address: ${address}`);
    const button = all.find((node) => node.type === "button");
    assert.equal(button.props.title, address);
    const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => copied.push(value) } } });
    try { await button.props.onClick(); }
    finally { if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator; }
    assert.deepEqual(copied, [address]);
    assert.deepEqual(statuses, ["Account copied"]);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /0x462A…d954/);
    assert(html.includes(address));
    assert.match(source("app/wizard/utils/panelToImage.js"), /\[data-capture-only\][\s\S]*node.style.display = 'block'/);
});

test("method results keep cancellation compact without technical payload details", () => {
    const Result = load("GuidedRequestResult", {
        "../utils/responseDetails.mjs": responseDetails,
        "../utils/guidedRequests.mjs": guidedRequests,
        "./RuntimeIdentity": () => null,
    });
    const success = Object.freeze([Object.freeze({ method: "eth_decrypt", elapsed_ms: 1, outcome: "cancelled_by_tester", payload_note: "Placeholder ciphertext — not evidence about the auth gate." })]);
    const html = renderToStaticMarkup(React.createElement(Result, { action: "runAuthBypass", success, platform: "extension", checkId: "WSR-PERM-010~Browser.v1" }));
    assert.match(html, /eth_decrypt/);
    assert.match(html, /Cancelled by tester/);
    assert.doesNotMatch(html, /Placeholder ciphertext/);
    assert.doesNotMatch(html, /<details[^>]*\sopen/);
    assert.doesNotMatch(html, /elapsed_ms/);
});

test("clearing a session requires explicit confirmation even from the compact toolbar", () => {
    const calls = [];
    let confirm = false;
    const previous = globalThis.window;
    globalThis.window = { confirm: () => confirm };
    try {
        const Export = load("EvidenceExportButton", {
            react: { ...React, useState: () => [1, () => {}], useEffect: () => {} },
            "react-router": { useNavigate: () => (url) => calls.push(url) },
            "./ResponsiveTools": () => null,
            "../utils/evidenceStorage.mjs": { clearStoredWizardData: () => calls.push("clear"), downloadCampaignEvidence: () => calls.push("export") },
        });
        const contents = Export({ platform: "mobile" }).props.children.props.children(() => calls.push("close"));
        const buttons = nodes(contents).filter((node) => node.type === "button");
        buttons[1].props.onClick();
        assert.deepEqual(calls, []);
        confirm = true;
        buttons[1].props.onClick();
        assert.deepEqual(calls, ["close", "clear", "/wizard"]);
    } finally { globalThis.window = previous; }
});
