import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, overrides = {}) {
    const { code } = require("@swc/core").transformSync(read(path), {
        filename: path, module: { type: "commonjs" },
        jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } },
    });
    const exports = {};
    new Function("require", "exports", code)((id) => overrides[id] ?? require(id), exports);
    return exports;
}
// Read the actual address constants without the rest of the application's SDKs.
const source = read("src/utils/constants.js");
const constants = Object.fromEntries(["TEST_ERC20_ADDRESS", "USDC_E"].map((key) => [key, JSON.parse(source.match(new RegExp(`export const ${key} = ([^;]+);`))[1])]));
const { approvalTokenForStep } = load("src/app/wizard/utils/approvalToken.js", { "@/utils/constants": constants });
const Identity = load("src/app/wizard/components/ApprovalTokenIdentity.jsx").default;
const check = JSON.parse(read("src/app/wizard/config/wizard.json")).wizard.checks["WSR-VERI-005"];

test("approval identities use the actual configured contracts without changing request parameters", () => {
    const before = JSON.stringify(check);
    assert.deepEqual(check.steps.map(approvalTokenForStep), [
        { name: "USDC.e", address: constants.USDC_E },
        { name: "WSR Test Token (WSRT)", address: constants.TEST_ERC20_ADDRESS },
    ]);
    assert.equal(JSON.stringify(check), before);
    const contractSource = read("contracts/WSRTestToken.sol");
    assert.match(contractSource, /name = "WSR Test Token"/);
    assert.match(contractSource, /symbol = "WSRT"/);
});

test("custom contracts cannot be mislabeled USDC and useTestToken keeps the handler's precedence", () => {
    const custom = `0x${"12".repeat(20)}`;
    const step = (params) => ({ ui: check.steps[0].ui, data: { params: Object.freeze(params) } });
    assert.deepEqual(approvalTokenForStep(step({ tokenAddress: custom })), { name: "Custom token", address: custom });
    assert.deepEqual(approvalTokenForStep(step({ useTestToken: true, tokenAddress: custom })), { name: "WSR Test Token (WSRT)", address: constants.TEST_ERC20_ADDRESS });
    assert.equal(approvalTokenForStep(step({ tokenAddress: constants.USDC_E.toLowerCase() })).name, "USDC.e");
    assert.equal(approvalTokenForStep(step({ tokenAddress: 42 })), null);
    assert.equal(approvalTokenForStep({ ui: { content: { button: { action: "simulateSwap" } } } }), null);
});

test("result and image content include each full contract, with token and contract clearly labelled", () => {
    for (const step of check.steps) {
        const token = approvalTokenForStep(step);
        const html = renderToStaticMarkup(React.createElement(Identity, { token }));
        assert(html.includes(token.name));
        assert(html.includes(token.address));
        assert.match(html, /<dt[^>]*>Token<\/dt>/);
        assert.match(html, /<dt[^>]*>Contract<\/dt>/);
        assert.match(html, /break-all/);
        assert.doesNotMatch(html, /data-capture-skip|truncate|\.\.\.|…/);
    }
    assert.equal(renderToStaticMarkup(React.createElement(Identity)), "");
});

test("the comparison snapshots token identity at dispatch and places it inside the exported summary", () => {
    const source = read("src/app/wizard/components/GuidedComparisonCheck.jsx");
    assert(source.indexOf("const approvalToken = approvalTokenForStep") < source.indexOf("await runComparisonStep"));
    assert.match(source, /\{ \.\.\.outcome, evidence, approvalToken(?:,| \})/);
    const summary = source.slice(source.indexOf("<div ref={summary}"), source.indexOf("<details className=\"rounded-lg"));
    assert.match(summary, /<ApprovalTokenIdentity token=\{runs\[index\]\?\.approvalToken\} \/>/);
    // UI metadata never enters the RPC's params or rewrites the raw evidence.
    assert.match(source, /comparisonEvidence\(evidenceParams, outcome, window.location.origin\)/);
});
