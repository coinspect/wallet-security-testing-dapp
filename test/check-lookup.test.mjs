import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ethers } from "ethers";
import {
    baseCheckId,
    canonicalCheckBase,
    checkBaseFromPath,
    paramsForCheck,
} from "../src/app/wizard/utils/checkLookup.mjs";
import { cloneReadonly } from "../src/security/clientBoundary.mjs";
import { buildAuthBypassTypedDataV4 } from "../src/utils/wallet-methods/authBypassPayloads.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("src/app/wizard/config/wizard.json"));
const checks = cloneReadonly(config.wizard.checks);
const bases = [...new Set(Object.keys(checks).map(baseCheckId))];

// Load the actual platform logic with Node-compatible imports; its production
// JSON import is otherwise resolved by the bundler, not by the Node test runner.
const platformSource = read("src/app/wizard/utils/platform.js")
    .replace('import wizardConfig from "../config/wizard";', `const wizardConfig = ${JSON.stringify(config)};`)
    .replace('"./checkLookup.mjs"', JSON.stringify(new URL("../src/app/wizard/utils/checkLookup.mjs", import.meta.url).href));
const platform = await import(`data:text/javascript;base64,${Buffer.from(platformSource).toString("base64")}`);

const variants = (id) => [id, id.toLowerCase(), id.replace("WSR", "wSr")];

const loadPermitEntry = () => {
    // Execute the actual registry row and its template without loading unrelated
    // browser/bundler-only imports from constants.js. Do not mock usedBy.
    const source = read("src/utils/constants.js");
    const template = source.match(/export const PERMIT_EIP712 = \{[\s\S]*?\n\};/)?.[0];
    const hash = source.match(/const hashOf = [\s\S]*?;/)?.[0];
    const row = source.split("\n").find((line) => line.includes('key: "permit_eip712"'));
    assert(template && hash && row, "Permit registry entry must be available");
    return cloneReadonly(new Function("ethers",
        `${template.replace(/^export /, "")}\n${hash}\nreturn (${row.trim().replace(/,$/, "")});`,
    )(ethers));
};

test("VERI-006 exposes the actual Permit template, including verifyingContract, in both campaigns", () => {
    const entry = loadPermitEntry();
    const before = JSON.stringify(entry);
    assert(entry.usedBy.includes("signPermit"));
    assert(entry.usedBy.includes("signPermitAndSeaport"));
    for (const campaign of platform.PLATFORMS) {
        for (const base of ["WSR-VERI-006", "WSR-VERI-004"]) {
            for (const id of variants(base)) {
                const selected = paramsForCheck(checkBaseFromPath(`/wizard/${campaign}/${id}/`, checks), checks, [entry]);
                assert.equal(selected.length, 1, `${campaign}/${id}`);
                assert.equal(selected[0], entry);
                assert.equal(selected[0].full.domain.verifyingContract, "0xC08f20F90193C1124C83d0237374e91f910ea64e");
            }
        }
    }
    assert.deepEqual(paramsForCheck("WSR-VERI-007", checks, [entry]), []);
    assert.equal(JSON.stringify(entry), before);
});

test("the shared Permit claims USD Coin with a fixed non-USDC address while the real token constant stays unchanged", () => {
    const entry = loadPermitEntry();
    assert.deepEqual(entry.full.domain, {
        name: "USD Coin (PoS)", version: "1", chainId: 137,
        verifyingContract: "0xC08f20F90193C1124C83d0237374e91f910ea64e",
    });
    assert.equal(ethers.utils.getAddress(entry.full.domain.verifyingContract), entry.full.domain.verifyingContract);
    assert.equal(entry.templateHash, ethers.utils.id(JSON.stringify(entry.full)));
    assert.match(read("src/utils/constants.js"), /export const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";/);
});

test("Mobile, Extension and auth-bypass send the same deliberately mismatched Permit domain", async () => {
    const permit = loadPermitEntry().full;
    const before = JSON.stringify(permit);
    const account = "0x1111111111111111111111111111111111111111";
    const expected = { ...permit, message: { ...permit.message, owner: account } };
    for (const transport of ["ext", "wc"]) {
        const calls = [];
        const provider = { request: async (request) => {
            calls.push(request);
            return request.method === "eth_requestAccounts" ? [account] : "0xsignature";
        } };
        const name = transport === "ext" ? "signPermit" : "signPermitWC";
        const source = read(`src/utils/wallet-methods/${transport}/methods.js`);
        const handler = source.match(new RegExp(`export const ${name} = [\\s\\S]*?\\n};`))?.[0];
        assert(handler, `${transport} Permit handler must be available`);
        const bindings = {
            PERMIT_EIP712: permit, getActiveProvider: () => provider,
            readChainHexWC: async () => "0x89", isUserRejectionErrWC: () => false,
        };
        const sign = new Function(...Object.keys(bindings), `${handler.replace(/^export /, "")}\nreturn ${name};`)(...Object.values(bindings));
        await (transport === "ext" ? sign(account, provider) : sign(provider, "0x89"));
        const request = calls.find((call) => call.method === "eth_signTypedData_v4");
        assert.equal(request.params[0], account);
        assert.deepEqual(JSON.parse(request.params[1]), expected);
    }
    for (const chainId of [1, 137]) {
        const request = buildAuthBypassTypedDataV4({ permit, account, chainId });
        assert.equal(request.method, "eth_signTypedData_v4");
        assert.deepEqual(JSON.parse(request.params[1]), { ...expected, domain: { ...permit.domain, chainId } });
    }
    assert.match(read("src/utils/wallet-methods/authBypassBatch.js"), /permit: PERMIT_EIP712/);
    assert.equal(JSON.stringify(permit), before);
});

test("all registered route IDs resolve to the same canonical check in either campaign regardless of case", () => {
    for (const base of bases) {
        for (const id of variants(base)) {
            assert.equal(canonicalCheckBase(id, checks), base);
            for (const campaign of platform.PLATFORMS) {
                const resolved = platform.checkBaseFromPath(`/wizard/${campaign}/${id}/`);
                assert.equal(resolved, base);
                assert.equal(platform.resolveCheckKey(resolved, campaign), platform.resolveCheckKey(base, campaign));
            }
        }
    }
});

test("direct loading, lowercase refresh and returning through the stepper preserve parameter selection", () => {
    // Entries for every real check/action cover both direct IDs and action links.
    const registry = cloneReadonly(Object.entries(checks).flatMap(([key, check]) => [
        { key, value: `Unchanged ${key}`, usedBy: [`${key}.v1`] },
        ...(check.steps ?? []).filter((step) => step.ui?.content?.button?.action).map((step) => ({
            key: step.ui.content.button.action,
            full: { method: step.ui.content.button.action, message: "Case MUST stay unchanged" },
            usedBy: [step.ui.content.button.action],
        })),
    ]));
    const before = JSON.stringify({ checks, registry });
    for (const base of bases) {
        const expected = paramsForCheck(base, checks, registry);
        assert(expected.length > 0, base);
        for (const campaign of platform.PLATFORMS) {
            for (const id of [base, base.toLowerCase(), bases[0], base]) {
                const result = paramsForCheck(checkBaseFromPath(`/wizard/${campaign}/${id}/`, checks), checks, registry);
                const reference = id === bases[0] ? paramsForCheck(bases[0], checks, registry) : expected;
                assert.deepEqual(result, reference);
                result.forEach((entry, index) => assert.equal(entry, reference[index]));
            }
        }
    }
    assert.equal(JSON.stringify({ checks, registry }), before);
});

test("parameter lookup preserves variant unions, environment entries, full payloads and case-sensitive actions", () => {
    const fixtureChecks = cloneReadonly({
        "WSR-TEST-001~Browser": { steps: [{ ui: { content: { button: { action: "signMessage" } } } }] },
        "WSR-TEST-001~Mobile": { steps: [{ ui: { content: { button: { action: "mobileAction" } } } }] },
    });
    const registry = cloneReadonly([
        { key: "address", value: "0xAbCdEf", scope: "environment", usedBy: ["WSR-TEST-001~Mobile.v1"] },
        { key: "message", full: { message: "opensea.io wants you to sign in", address: "0xAbCdEf" }, usedBy: ["signMessage"] },
        { key: "mobile", value: "Keep Case", usedBy: ["mobileAction"] },
        { key: "wrong-action-case", usedBy: ["signmessage"] },
        { key: "unused", usedBy: [] },
        { key: "missing" },
    ]);
    const before = JSON.stringify(registry);
    const result = paramsForCheck("wsr-test-001", fixtureChecks, registry);
    assert.deepEqual(result, registry.slice(0, 3));
    result.forEach((entry, index) => assert.equal(entry, registry[index]));
    assert.equal(result[1].full, registry[1].full);
    assert.equal(JSON.stringify(registry), before);
});

test("malformed, unknown and non-check routes are harmless empty lookups", () => {
    for (const pathname of [
        null, "", "/params", "/wizard/", "/wizard/mobile/", "/wizard/invalid/WSR-VERI-006/",
        "/wizard/mobile/%E0%A4%A/", "/wizard/mobile/WSR-NOT-999/",
        "/wizard/mobile/WSR-VERI-006/extra", "/wizard/mobile/WSR-VERI-006%2F/",
        "/wizard/mobile/WSR-VERI-006~Mobile/", "/wizard/mobile/WSR-VERI-006.v1/",
        "/wizard/mobile/__proto__/", "/wizard/mobile/constructor/",
    ]) {
        assert.equal(checkBaseFromPath(pathname, checks), null, pathname);
        assert.deepEqual(paramsForCheck(checkBaseFromPath(pathname, checks), checks, []), []);
    }
    assert.equal(canonicalCheckBase(["WSR-VERI-006"], checks), null);
    assert.equal(canonicalCheckBase("0xAbCdEf", checks), null);
});

test("encoded IDs, query strings and trailing slashes retain the canonical check", () => {
    for (const pathname of [
        "/wizard/mobile/wsr-veri-006", "/wizard/mobile/%77sr-veri-006/",
        "/wizard/extension/wsr-veri-006/?test=1#params", "/wizard/mobile/WSR-VERI-006?test=1",
    ]) assert.equal(checkBaseFromPath(pathname, checks), "WSR-VERI-006");
});

test("switching campaigns after lowercase refresh keeps the same check whenever available", () => {
    for (const base of bases) {
        for (const next of platform.PLATFORMS) {
            const current = platform.checkBaseFromPath(`/wizard/${next === "mobile" ? "extension" : "mobile"}/${base.toLowerCase()}/`);
            const target = current && platform.resolveCheckKey(current, next) ? current : platform.firstCampaignCheckBase(next);
            assert.equal(target, platform.resolveCheckKey(base, next) ? base : platform.firstCampaignCheckBase(next));
        }
    }
});

test("params, campaign switching and the check page consume canonical route IDs", () => {
    const panel = read("src/app/wizard/components/ParamsPanel.jsx");
    assert.match(panel, /const baseId = checkBaseFromPath\(pathname\)/);
    assert.match(panel, /paramsForCheck\(baseId, wizardConfig\.wizard\.checks, testParams\)/);
    assert.match(read("src/app/wizard/context/PlatformContext.jsx"), /const base = checkBaseFromPath\(pathname\)/);
    assert.match(read("src/app/wizard/[platform]/[step]/StepPageClient.jsx"), /const step = canonicalCheckBase\(routeStep\) \?\? routeStep/);
});
