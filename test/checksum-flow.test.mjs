import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as comparison from "../src/app/wizard/utils/guidedComparison.mjs";
import * as checksum from "../src/app/wizard/utils/checksumComparison.mjs";
import * as simpleTransaction from "../src/utils/wallet-methods/simpleTransaction.mjs";
import * as chainId from "../src/utils/wallet-methods/chainId.mjs";
import * as chainVerification from "../src/utils/wallet-methods/chainSwitchVerification.mjs";
import * as authRecovery from '../src/app/wizard/utils/authRecovery.mjs';
import * as responseDetails from '../src/app/wizard/utils/responseDetails.mjs';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const checks = JSON.parse(read("src/app/wizard/config/wizard.json")).wizard.checks;
const sent = "0x02970EA171A97EB0d627CB7EC9ABaC308253C716";
const account = `0x${"11".repeat(20)}`;
function load(name, overrides = {}, browser = {}) {
    const { code } = require("@swc/core").transformSync(read(`src/app/wizard/components/${name}.jsx`), {
        filename: `${name}.jsx`, module: { type: "commonjs" },
        jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } },
    });
    const exports = {};
    new Function("require", "exports", "window", "navigator", code)(
        (id) => overrides[id] ?? require(id), exports,
        { location: { origin: "https://example.test" } }, browser,
    );
    return exports;
}
const review = load("ChecksumReview", { "../utils/checksumComparison.mjs": checksum });
const CTA = load("CTAButton").default;
function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

// Exercise the real component's event handlers and re-renders with fake wallet
// responses. No connection, signature or transaction is sent by these tests.
function mount(platform, id = "WSR-VERI-001") {
    const states = [], refs = [], saved = [], copied = [], dispatched = [];
    let stateIndex = 0, refIndex = 0;
    const runtime = {
        address: account, chainId: "0x89",
        provider: {
            request: async () => [account],
            session: { topic: "test-session", peer: { metadata: { name: "Test wallet" } } },
        },
    };
    const check = checks[id];
    const presentation = comparison.GUIDED_COMPARISONS[check.canonicalId];
    const originalCheck = JSON.stringify(check);
    const Guided = load("GuidedComparisonCheck", {
        "@/utils/wallet-methods/chainSwitchVerification.mjs": chainVerification,
        "../utils/responseDetails.mjs": responseDetails,
        react: {
            ...React,
            useState(initial) {
                const index = stateIndex++;
                if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
                return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
            },
            useRef(initial) {
                const index = refIndex++;
                return refs[index] ??= { current: initial };
            },
            useEffect() {},
        },
        "./CTAButton": CTA,
        "./SkipStepButton": () => null,
        "./ChecksumReview": review,
        "./ResultExportActions": () => null,
        "./RuntimeIdentity": () => null,
        "./ApprovalTokenIdentity": () => null,
        "./ChainGate": () => null,
        "./PersistedEvidence": () => null,
        "./WizardStepHeader": () => null,
        "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
        "../utils/checkMeta": { checkTitle: () => "Checksum" },
        "../utils/resolveCheckParams": { resolveCheckParams: () => ({
            target: sent, method: "eth_sendTransaction", checkId: check.canonicalId,
            stepNumber: 1, totalSteps: 1, dappVersion: "0.2.0",
            parameters: { target: sent, chain: "0x89", method: "eth_sendTransaction", value: "0x0" },
        }) },
        "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Test wallet" }) },
        "../utils/evidenceStorage.mjs": { persistEvidenceRecord: (entry) => saved.push(entry) },
        "../utils/panelToImage": {},
        "../utils/guidedComparison.mjs": comparison,
        '../utils/authRecovery.mjs': authRecovery,
        "../utils/approvalToken": { approvalTokenForStep: () => null },
        "@/utils/wallet-methods/actionMethods": { handleAction: async (...args) => {
            dispatched.push(args);
            throw { code: -32602, message: "Invalid checksum" };
        } },
        "@/utils/wallet-methods/addressBoundary.mjs": {},
        "@/utils/wallet-methods/simpleTransaction.mjs": simpleTransaction,
        "@/utils/wallet-methods/chainId.mjs": chainId,
        "@/utils/constants": {},
    }, { clipboard: { writeText: async (text) => copied.push(text) } }).default;
    const render = () => {
        stateIndex = 0; refIndex = 0;
        return Guided({ check, presentation, platform });
    };
    const click = async (label) => {
        const control = nodes(render()).find((node) => node.props?.children === label && node.props.onClick);
        assert(control, `Missing control: ${label}`);
        await control.props.onClick();
    };
    const facts = () => nodes(render()).find((node) => node.type === review.ChecksumFacts);
    const html = () => renderToStaticMarkup(render());
    const assertUnchanged = () => assert.equal(JSON.stringify(check), originalCheck);
    return { render, click, facts, html, assertUnchanged, saved, copied, dispatched, presentation };
}

for (const platform of ["mobile", "extension"]) {
    test(`checksum ${platform}: explicitly skipping an absent address advances without rewriting the wallet error`, async () => {
        const ui = mount(platform);
        await ui.click("Send Invalid Checksum Transaction");
        await ui.click("Continue as inconclusive");
        assert.equal(ui.facts().props.noAddressShown, false, "An error alone must not imply no recipient was displayed");
        assert.match(ui.html(), /Paste the wallet&#x27;s recipient address to compare/);
        await ui.click("No address shown — continue");
        const active = nodes(ui.render()).find((node) => node.props?.["aria-current"] === "step");
        assert.match(renderToStaticMarkup(active), /Test manual entry in your wallet/);
        assert.match(renderToStaticMarkup(active), /Do not send this second transaction/);
        assert.match(renderToStaticMarkup(active), new RegExp(sent));
        assert(!nodes(active).some((node) => node.type === review.ChecksumInput));
        const summary = nodes(ui.render()).find((node) => node.props?.["aria-live"] === "polite");
        const summaryHtml = renderToStaticMarkup(summary);
        assert.match(summaryHtml, /No recipient address shown/);
        assert.match(summaryHtml, /Reported by tester · address comparison skipped/);
        assert.match(summaryHtml, /Request returned an error/);
        assert.doesNotMatch(summaryHtml, /Paste the wallet|No address pasted yet|fix the checksum|passed|blocked/i);
        // The same summary is the result-image capture target.
        assert(summary.props.ref);
        const exportActions = nodes(summary).find((node) => node.props?.onCopyEvidence);
        await exportActions.props.onCopyEvidence();
        assert.deepEqual(JSON.parse(ui.copied[0]), [ui.saved[0].evidence]);
        assert.equal(ui.saved[0].evidence.wallet_output, "Invalid checksum");
        assert.equal(ui.saved[0].evidence.code, -32602);
        assert.equal(ui.saved[0].evidence.automatic_verdict, null);
        assert.equal(ui.saved[0].evidence.parameters.target, sent);
        assert.equal(ui.dispatched.length, 1, "Skipping must not send another wallet request");
        ui.assertUnchanged();
    });

    test(`checksum ${platform}: editing and rerunning clear a previous no-address observation`, async () => {
        const ui = mount(platform);
        await ui.click("Send Invalid Checksum Transaction");
        await ui.click("Continue as inconclusive");
        await ui.click("No address shown — continue");
        await ui.click("Compare the displayed address");
        const input = nodes(ui.render()).find((node) => node.type === review.ChecksumInput);
        input.props.onChange(sent);
        assert.equal(ui.facts().props.noAddressShown, false);
        assert.match(ui.html(), /Same address — letter case unchanged/);
        await ui.click("Test manual entry in your wallet");
        assert.match(ui.html(), /Same address — letter case unchanged/);
        await ui.click("Compare the displayed address");
        await ui.click("No address shown — continue");
        assert.equal(ui.facts().props.input, "", "Skipping clears an earlier pasted address");
        await ui.click("Review the dApp request");
        await ui.click("Run this request again");
        assert.equal(ui.facts().props.noAddressShown, false);
        assert.equal(ui.facts().props.input, "");
        assert.equal(ui.dispatched.length, 2);
        assert.deepEqual(ui.dispatched[0][3], {
            target: "checksumProbeBadChecksum", chain: "polygon",
            ...(platform === "mobile" ? { __wcChainId: "0x89" } : {}),
        });
        assert.deepEqual(ui.dispatched[1][3], ui.dispatched[0][3]);
        ui.assertUnchanged();
    });
}

test("the no-address branch is limited to checksum, not other guided checks", () => {
    for (const id of Object.keys(checks).filter((id) => id !== "WSR-VERI-001" && comparison.GUIDED_COMPARISONS[checks[id].canonicalId])) {
        assert.doesNotMatch(mount("mobile", id).html(), /No address shown|No recipient address shown|address comparison skipped/);
    }
});
