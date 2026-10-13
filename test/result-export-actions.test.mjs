import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { transformSync } = require("@swc/core");
const readComponent = (name) => readFileSync(new URL(`../src/app/wizard/components/${name}.jsx`, import.meta.url), "utf8");
const { code } = transformSync(readComponent("ResultExportActions"), {
    filename: "ResultExportActions.jsx",
    jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
});
const exports = {};
new Function("require", "exports", code)(require, exports);
const ResultExportActions = exports.default;

test("result footer exposes both exports and excludes controls and feedback from image capture", () => {
    const called = [];
    const props = { onCopyEvidence: () => called.push("json"), onCopyImage: () => called.push("image"), status: "Evidence copied" };
    const tree = ResultExportActions(props);
    assert.equal(tree.props["data-capture-skip"], true);
    const buttons = tree.props.children[0].props.children;
    buttons[0].props.onClick();
    buttons[1].props.onClick();
    assert.deepEqual(called, ["json", "image"]);
    const html = renderToStaticMarkup(createElement(ResultExportActions, props));
    assert.match(html, /Copy evidence \(JSON\)/);
    assert.match(html, /Copy result as image/);
    assert.match(html, /role="status"[^>]*>Evidence copied/);
    assert.doesNotMatch(html, /pass\/fail/);
});

test("image export is disabled while rendering and absent before a connection result exists", () => {
    const pending = renderToStaticMarkup(createElement(ResultExportActions, { onCopyEvidence() {}, onCopyImage() {}, imagePending: true }));
    assert.match(pending, /disabled=""/);
    assert.match(pending, /Rendering…/);
    const setup = renderToStaticMarkup(createElement(ResultExportActions, { onCopyEvidence() {} }));
    assert.equal((setup.match(/<button/g) ?? []).length, 1);
    assert.match(setup, /Copy evidence \(JSON\)/);
    assert.doesNotMatch(setup, /Copy result as image|role="status"/);
});

test("guided checks place exports in the result card without duplicating controls in technical details", () => {
    for (const name of ["GuidedComparisonCheck", "ConnectedDappCheck", "GuidedRequestResult"]) {
        assert.doesNotMatch(readComponent(name), /Recorded observations? · no automatic pass\/fail/);
    }
    for (const [name, ref] of [["GuidedComparisonCheck", "summary"], ["ConnectedDappCheck", "resultPanel"]]) {
        const source = readComponent(name);
        const result = source.indexOf(`<div ref={${ref}}`);
        const details = source.indexOf("Evidence and technical details", result);
        assert(result >= 0 && details > result);
        assert.match(source.slice(result, details), /<ResultExportActions onCopyEvidence=\{copyEvidence\} onCopyImage=\{copyImage\} status=\{copyStatus\} \/>/);
        assert.doesNotMatch(source.slice(details), /onCopyImage/);
    }
    assert.match(readComponent("ConnectedDappCheck"), /!observed && <ResultExportActions onCopyEvidence=\{copyEvidence\} status=\{copyStatus\}/);
    const action = readComponent("ActionResult");
    assert.match(action, /showHeader && !guided/);
    assert.match(action, /\{body\}[\s\S]*guided && hasEvidence[\s\S]*<ResultExportActions[\s\S]*onCopyEvidence=\{\(\) => copy\(evidenceText, 'value'\)\}/);
});
