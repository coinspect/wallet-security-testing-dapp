import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceLoader } from "./helpers/sourceHarness.mjs";
import { comparisonEvidence, comparisonObservation, runComparisonStep } from "../src/app/wizard/utils/guidedComparison.mjs";
import { sanitizeEvidenceForStorage } from "../src/app/wizard/utils/evidenceStorage.mjs";
import { withRequestDiagnostics } from "../src/utils/wallet-methods/requestDiagnostics.mjs";

const { handleAction } = sourceLoader()("src/utils/wallet-methods/actionMethods.js");
const check = JSON.parse(readFileSync(new URL("../src/app/wizard/config/wizard.json", import.meta.url))).wizard.checks["WSR-THRE-002"];
const account = `0x${"11".repeat(20)}`, hash = `0x${"ab".repeat(32)}`;
const targets = ["0x873050043AF661fe9d5633369B10139eb7b4Da54", "0x592340957eBC9e4Afb0E9Af221d06fDDDF789de9", "0x8730aeb8FE951cfa6e17f82341ECD95C921FDa54"];

async function run({ index = 0, reply, platform = "mobile" } = {}) {
    const calls = [];
    const provider = {
        session: { peer: { metadata: { name: "Mock Trust" } } },
        async request(args) {
            assert.equal(this, provider, "Keep the original provider binding");
            calls.push(structuredClone(args));
            if (reply) {
                const response = reply(args, calls);
                if (response !== undefined) return response;
            }
            if (args.method === "eth_chainId") return "0x89";
            if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [account];
            if (args.method === "eth_sendTransaction") return hash;
            return null;
        },
    };
    const step = check.steps[index];
    const before = JSON.stringify(step);
    const result = await runComparisonStep({ platform, step, runtime: { provider, address: account, chainId: "0x89" }, dispatch: handleAction });
    assert.equal(JSON.stringify(step), before, "Do not modify the configured test");
    const parameters = { target: targets[index], chain: "0x89", method: "eth_sendTransaction", value: "0x0" };
    const evidence = comparisonEvidence({ checkId: check.canonicalId, stepNumber: index + 1, totalSteps: 3, parameters, method: "eth_sendTransaction" }, result, "https://example.test");
    assert.equal(evidence.parameters, parameters);
    assert.equal(evidence.automatic_verdict, null);
    return { result, evidence, calls };
}

for (const [stage, method, position] of [
    ["chain_read", "eth_chainId", 1],
    ["accounts_read", "eth_requestAccounts", 2],
    ["transaction_request", "eth_sendTransaction", 5],
]) test(`THRE-002 records the original failure at ${stage}`, async () => {
    const error = new Error("The data couldn’t be read because it is missing.\nOriginal second line");
    Object.defineProperty(error, "code", { value: -32603 });
    error.data = { originalError: Object.assign(new Error("Missing field"), { code: 4865 }), vendor: { amount: 0n } };
    Object.freeze(error);
    const { evidence, result, calls } = await run({ reply: (args, all) => { if (all.length === position) throw error; } });
    assert.equal(calls.length, position, "No extra calls or retries");
    assert.equal(evidence.failed_method, method);
    assert.equal(evidence.failed_stage, stage);
    assert.equal(evidence.code, -32603);
    assert.equal(evidence.rpc_error.message, error.message);
    assert.equal(evidence.rpc_error.data.originalError.message, "Missing field");
    assert.equal(evidence.rpc_error.data.originalError.code, 4865);
    assert.equal(evidence.rpc_error.data.vendor.amount, "0");
    assert.equal(evidence.rpc_error.stack, undefined);
    assert.equal(evidence.request_diagnostics.boundary, "provider.request");
    assert.equal(evidence.request_diagnostics.transaction_request_invoked, position === 5);
    assert.equal(evidence.request_diagnostics.calls.at(-1).status, "rejected");
    assert.equal(comparisonObservation(result).inconclusive, true);
    if (position < 5) assert.match(comparisonObservation(result).title, /test request not sent/);
    else assert.equal(evidence.wallet_output, error.message);
    const stored = sanitizeEvidenceForStorage(JSON.parse(JSON.stringify(evidence)));
    assert.equal(stored.rpc_error.message, error.message);
    assert.equal(stored.request_diagnostics.calls.at(-1).error.message, error.message);
    assert.equal(sanitizeEvidenceForStorage(evidence).request_diagnostics.calls.at(-1).error.message, error.message);
});

for (const [stage, method] of [
    ["chain_switch", "wallet_switchEthereumChain"],
    ["chain_add", "wallet_addEthereumChain"],
    ["chain_switch_after_add", "wallet_switchEthereumChain"],
]) test(`THRE-002 traces ${stage} failure without attempting the transaction`, async () => {
    const error = { code: -32000, message: "Preparation failed", data: { reason: stage } };
    const { evidence, calls } = await run({ reply: (args, all) => {
        if (args.method === "eth_chainId") return "0x1";
        const switches = all.filter((call) => call.method === "wallet_switchEthereumChain").length;
        if (args.method === "wallet_switchEthereumChain" && switches === 1) {
            if (stage === "chain_switch") throw error;
            throw { code: 4902, message: "Unknown chain" };
        }
        if (args.method === "wallet_addEthereumChain" && stage === "chain_add") throw error;
        if (args.method === "wallet_switchEthereumChain" && switches === 2) throw error;
    } });
    assert.equal(evidence.failed_method, method);
    assert.equal(evidence.failed_stage, stage);
    assert.equal(evidence.code, error.code);
    assert.deepEqual(evidence.rpc_error.data, error.data);
    assert.equal(evidence.request_diagnostics.transaction_request_invoked, false);
    assert(!calls.some((call) => call.method === "eth_sendTransaction"));
});

test("a recovered chain read remains in the trace but is not reported as a failed transaction", async () => {
    const { evidence, calls } = await run({ reply: (args, all) => { if (all.length === 3) throw { code: 4200, message: "Read unsupported" }; } });
    assert.equal(calls.length, 5);
    assert.equal(evidence.wallet_output, hash);
    assert.equal(evidence.failed_method, undefined);
    assert.equal(evidence.rpc_error, undefined);
    assert.equal(evidence.request_diagnostics.calls[2].stage, "transaction_chain_read");
    assert.equal(evidence.request_diagnostics.calls[2].error.code, 4200);
    assert.equal(evidence.request_diagnostics.calls[3].status, "fulfilled");
    assert.equal(evidence.request_diagnostics.transaction_request_invoked, true);
});

test("empty accounts are a local preparation failure, not a fabricated RPC rejection", async () => {
    const { evidence, result, calls } = await run({ reply: (args) => args.method === "eth_requestAccounts" ? [] : undefined });
    assert.equal(calls.length, 2);
    assert.equal(evidence.wallet_output, "No accounts connected");
    assert.equal(evidence.failed_method, undefined);
    assert.equal(evidence.request_diagnostics.transaction_request_invoked, false);
    assert.match(comparisonObservation(result).title, /test request not sent/);
});

test("account rejection is preparation failure, while transaction cancellation remains tester cancellation", async () => {
    for (const method of ["eth_requestAccounts", "eth_sendTransaction"]) {
        const error = { code: 4001, message: "User rejected", data: { reason: "cancel" } };
        const { evidence, result } = await run({ index: 1, reply: (args) => { if (args.method === method) throw error; } });
        assert.equal(evidence.failed_method, method);
        assert.equal(evidence.code, 4001);
        assert.deepEqual(evidence.rpc_error, error);
        assert.equal(evidence.request_outcome, method === "eth_sendTransaction" ? "cancelled_by_tester" : undefined);
        assert.equal(comparisonObservation(result).inconclusive, method !== "eth_sendTransaction");
    }
});

for (const index of [0, 1, 2]) test(`THRE-002 step ${index + 1} keeps the exact payload and call order`, async () => {
    const { evidence, calls } = await run({ index });
    assert.deepEqual(calls, [
        { method: "eth_chainId" }, { method: "eth_requestAccounts" }, { method: "eth_chainId" },
        { method: "eth_chainId" },
        { method: "eth_sendTransaction", params: [{ from: account, to: targets[index], value: "0x0", data: "0x" }] },
    ]);
    assert.equal(evidence.wallet_output, hash);
    assert.equal(evidence.failed_method, undefined);
    assert.equal(evidence.request_diagnostics.calls.length, 4);
    assert(evidence.request_diagnostics.calls.every((call) => call.status === "fulfilled"));
});

test("extension requests keep the previous payload and have no WC diagnostic metadata", async () => {
    const { evidence, calls } = await run({ platform: "extension" });
    assert.equal(evidence.request_diagnostics, undefined);
    assert.equal(calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
    assert.equal(calls.at(-1).params[0].to, targets[0]);
    assert.equal(calls.at(-1).params[0].value, "0x0");
});

test("diagnostics forward argument identity, retain frozen/circular errors, and omit sensitive fields", async () => {
    const error = { code: -1, message: "Failure", data: { secret: "do not export", value: 1n } };
    error.data.originalError = error;
    Object.freeze(error);
    const args = Object.freeze({ method: "eth_sendTransaction", params: [] });
    const provider = { request(received) { assert.equal(this, provider); assert.equal(received, args); throw error; } };
    await assert.rejects(withRequestDiagnostics(provider, (request) => request(args, "transaction_request")), (thrown) => {
        const recorded = thrown.request_diagnostics.calls[0].error;
        assert.equal(recorded.data.value, "1");
        assert.equal(recorded.data.secret, "[sensitive value omitted]");
        assert.doesNotThrow(() => JSON.stringify(recorded));
        assert.match(JSON.stringify(recorded), /\[circular\]/);
        assert.equal(error.data.secret, "do not export");
        return true;
    });
});
