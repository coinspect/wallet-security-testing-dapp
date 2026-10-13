import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { requestChainSwitch } from "../src/utils/wallet-methods/chainSwitchProbe.mjs";
import { comparisonEvidence, comparisonObservation, runComparisonStep } from "../src/app/wizard/utils/guidedComparison.mjs";

const METHOD = "wallet_switchEthereumChain";
const options = { method: METHOD };
const request = (chainId) => ({ method: METHOD, params: [{ chainId }] });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function fixture({ transport = "walletconnect", reply = null, error, chain = "0x89" } = {}) {
    const remote = [], local = [];
    let selected = chain;
    const provider = {
        session: { topic: "original-topic", expiry: Date.now() / 1000 + 3600,
            namespaces: { eip155: { chains: ["eip155:1", "eip155:137"], methods: [METHOD] } } },
        request: async (payload) => {
            local.push(payload);
            if (payload.method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
            if (payload.method === "eth_chainId") return selected;
            assert.equal(transport, "extension", "Mobile must never use the local switch handler");
            remote.push(payload);
            if (error !== undefined) throw error;
            selected = payload.params[0].chainId;
            return reply;
        },
    };
    provider.client = {
        session: { get: (topic) => { assert.equal(topic, provider.session.topic); return provider.session; } },
        request: async (envelope) => { remote.push(envelope); if (error !== undefined) throw error; return reply; },
    };
    return { provider, remote, local, run: (chainId = "0x1", extra = {}) => requestChainSwitch({ provider, chainId,
        chainName: chainId === "0x1" ? "Ethereum Mainnet" : "zkSync Era Mainnet", transport, ...extra }) };
}

test("mobile submits both exact switch payloads to SignClient, including an already approved target", async () => {
    const f = fixture();
    for (const target of ["0x1", "0x144"]) {
        const result = await f.run(target);
        assert.equal(result.status, "switch_response");
        assert.equal(result.response, null);
        assert.equal(result.request_submitted, true);
        assert.equal(result.routing_chain, "eip155:137");
        assert.equal(result.chain_before.chain_id, "0x89");
        assert.deepEqual(result.chain_after, result.chain_before, "No local switch is synthesized after a reply");
        assert.equal(result.chain_after.source, "walletconnect_session_provider");
        assert.deepEqual(f.remote.at(-1), { topic: "original-topic", chainId: "eip155:137", request: request(target) });
        assert.equal(comparisonObservation({ result }, options).title, "Switch request completed");
    }
    assert(f.local.every((payload) => payload.method === "eth_chainId"));
});

test("regression: the installed SDK's local approved-chain shortcut is never used by the probe", async () => {
    const require = createRequire(import.meta.url);
    const map = JSON.parse(read("node_modules/@walletconnect/universal-provider/dist/index.js.map"));
    const source = map.sourcesContent[map.sources.findIndex((path) => path.endsWith("providers/eip155.ts"))];
    const start = source.indexOf("  private async handleSwitchChain(");
    assert(start >= 0);
    const end = source.indexOf("  /**", start);
    const { code } = require("@swc/core").transformSync(`export default class SDKProbe {\n${source.slice(start, end)}\n}`, {
        filename: "SDKProbe.ts", jsc: { parser: { syntax: "typescript" } }, module: { type: "commonjs" },
    });
    const exports = {};
    new Function("exports", code)(exports);
    const f = fixture();
    const sdk = new exports.default();
    const localChanges = [];
    sdk.name = "eip155";
    sdk.namespace = f.provider.session.namespaces.eip155;
    sdk.client = f.provider.client;
    sdk.setDefaultChain = (chain) => localChanges.push(chain);
    const originalRead = f.provider.request;
    f.provider.request = (payload) => payload.method === METHOD
        ? sdk.handleSwitchChain({ topic: f.provider.session.topic, chainId: "eip155:137", request: payload })
        : originalRead(payload);
    await f.provider.request(request("0x1"));
    assert.equal(f.remote.length, 0);
    assert.deepEqual(localChanges, ["1"]);
    localChanges.length = 0;
    await f.run();
    assert.equal(f.remote.length, 1);
    assert.deepEqual(localChanges, []);
});

test("mobile never pairs or falls back to provider RPC when the original connection is unavailable", async () => {
    for (const [alter, reason] of [
        [(p) => { p.session = null; }, "session_unavailable"],
        [(p) => { p.session.expiry = 1; }, "session_unavailable"],
        [(p) => { p.client.session.get = () => { throw new Error("Session deleted"); }; }, "session_unavailable"],
        [(p) => { p.client = null; }, "session_client_unavailable"],
    ]) {
        const f = fixture(); alter(f.provider);
        const result = await f.run();
        assert.equal(result.status, "switch_not_sent");
        assert.equal(result.reason, reason);
        assert.equal(result.request_submitted, false);
        assert.equal(f.remote.length, 0);
        assert.equal(f.local.length, 0);
    }
});

test("namespace methods, chains and accounts do not filter requests or change the Polygon route", async () => {
    for (const namespaces of [
        { "eip155:1": { methods: [METHOD], accounts: [] }, "eip155:137": { methods: [] } },
        { eip155: { methods: [METHOD], accounts: ["eip155:1:0x1111111111111111111111111111111111111111"] } },
        {},
    ]) {
        const f = fixture(); f.provider.session.namespaces = namespaces;
        const result = await f.run("0x144");
        assert.equal(result.reason, undefined);
        assert.equal(result.request_submitted, true);
        assert.equal(result.routing_chain, 'eip155:137');
        assert.deepEqual(result.session_permissions.approved_methods, []);
        assert.deepEqual(f.remote, [{ topic: 'original-topic', chainId: 'eip155:137', request: request('0x144') }]);
    }
});

test("replaced connections prevent stale dispatch but changed method lists do not", async () => {
    for (const replaceSession of [true, false]) {
        const f = fixture();
        f.provider.request = async () => {
            if (replaceSession) f.provider.session = { ...f.provider.session, topic: "another-topic" };
            else f.provider.session.namespaces.eip155.methods = [];
            return "0x89";
        };
        const result = await f.run();
        assert.equal(result.status, replaceSession ? "switch_not_sent" : "switch_response");
        assert.equal(result.reason, replaceSession ? "session_changed" : undefined);
        assert.equal(f.remote.length, replaceSession ? 0 : 1);
    }
});

test("unapproved switch methods reach SignClient and retain its actual error without altering permissions", async () => {
    const error = { code: 5101, message: 'Unauthorized method', data: { method: METHOD } };
    const f = fixture({ error });
    f.provider.session.namespaces.eip155.methods = [];
    const original = structuredClone(f.provider.session);
    for (const target of ['0x1', '0x144']) {
        const result = await f.run(target);
        assert.equal(result.request_submitted, true);
        assert.deepEqual(result.error, error);
        assert.equal(result.code, 5101);
        assert.deepEqual(f.remote.at(-1).request, request(target));
        assert.deepEqual(f.provider.session, original);
    }
    assert.equal(f.remote.length, 2, 'Exactly one attempt per button; no fallback or retry');
});

for (const transport of ["walletconnect", "extension"]) {
    test(`${transport}: an already selected target does not become a successful switch`, async () => {
        const f = fixture({ transport, chain: "0x1" });
        const result = await f.run();
        assert.equal(result.status, "switch_not_sent");
        assert.equal(result.reason, "polygon_required");
        assert.equal(result.request_submitted, false);
        assert.equal(f.remote.length, 0);
        assert.equal(comparisonObservation({ result }, options).inconclusive, true);
    });

    test(`${transport}: raw vendor errors survive classification, copying and evidence export`, async () => {
        for (const [error, title] of [
            [{ code: -1, message: "Not support" }, "Request not supported"],
            [{ code: 4200, message: "Unsupported method" }, "Request not supported"],
            [{ code: -32601, message: "Method not found" }, "Request not supported"],
            [{ code: 4902, message: "Unrecognized chain" }, "Network not configured — 4902"],
            [{ message: "Unrecognized chain" }, "Network not recognized"],
            [{ code: -2, message: "Cancelled" }, "Cancelled by tester"],
            [{ code: 4001, message: "User rejected the request" }, "Cancelled by tester"],
            [{ code: -2, message: "Transport cancelled" }, "Request returned an error"],
            [{ code: -32603, message: "Internal error: User rejected" }, "Request returned an error"],
            [{ code: -32603, message: "Outer error\nSecond line", data: { originalError: { code: 4902, message: "Unknown network\nMore details" } } }, "Network not configured — 4902"],
            [{ code: -32000, message: "Request timed out" }, "Request returned an error"],
        ]) {
            const f = fixture({ transport, error });
            const result = await f.run();
            const evidence = comparisonEvidence({ method: METHOD }, { result }, "https://example.test");
            assert.deepEqual(JSON.parse(JSON.stringify(evidence)).wallet_output.error, error);
            assert.equal(comparisonObservation({ result }, options).title, title);
            assert.equal(evidence.automatic_verdict, null);
            assert.equal(f.remote.length, 1);
            if (title === "Cancelled by tester") assert.equal(evidence.request_outcome, "cancelled_by_tester");
            if (error.code === undefined) assert.equal(result.code, undefined, "Never synthesize a 4902 code from text");
        }
    });
}

test("extension records real provider reads around the exact switch request", async () => {
    const f = fixture({ transport: "extension" });
    const result = await f.run();
    assert.deepEqual(f.local, [{ method: "eth_chainId" }, request("0x1"), { method: "eth_chainId" }]);
    assert.equal(result.chain_before.chain_id, "0x89");
    assert.deepEqual(result.chain_after, { chain_id: "0x1", source: "injected_wallet_provider" });
});

test("native Error instances preserve messages, vendor fields and nested causes", async () => {
    const cause = Object.assign(new Error("Not support\nVendor detail"), { code: 4200, data: { reason: "unsupported" } });
    const error = new Error("Provider failed", { cause });
    const result = await fixture({ error }).run();
    assert.equal(result.status, "switch_not_supported");
    assert.equal(result.code, 4200);
    assert.deepEqual(result.error, { message: "Provider failed", name: "Error", cause: {
        message: "Not support\nVendor detail", name: "Error", code: 4200, data: { reason: "unsupported" },
    } });
});

test("failed or hanging chain reads do not hang setup or hide a completed request", async () => {
    const before = fixture(); before.provider.request = () => new Promise(() => {});
    const notSent = await before.run("0x1", { readTimeoutMs: 5 });
    assert.equal(notSent.reason, "chain_read_failed"); assert.equal(before.remote.length, 0);
    const after = fixture();
    after.provider.request = async () => { if (after.remote.length) throw new Error("Read failed after response"); return "0x89"; };
    const result = await after.run();
    assert.equal(result.status, "switch_response");
    assert.equal(result.chain_after.chain_id, null);
    assert.equal(result.chain_after.error.message, "Read failed after response");
    assert.equal(result.response, null);
});

test("a missing provider is recorded without opening a connection in either campaign", async () => {
    const step = JSON.parse(read("src/app/wizard/config/wizard.json")).wizard.checks["WSR-PERM-009"].steps[0];
    for (const platform of ["mobile", "extension"]) {
        const run = await runComparisonStep({ platform, step, runtime: {}, dispatch: async (_, __, provider) =>
            requestChainSwitch({ provider, chainId: "0x1", chainName: "Ethereum Mainnet", transport: platform === "mobile" ? "walletconnect" : "extension" }) });
        assert.equal(run.needsConnection, undefined);
        assert.equal(run.result.reason, "provider_unavailable");
    }
});
