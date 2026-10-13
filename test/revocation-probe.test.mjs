import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRevocationProbe } from "../src/app/wizard/utils/revocationProbe.mjs";
import { snapshotError } from "../src/utils/wallet-methods/requestDiagnostics.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
class Provider extends EventEmitter {
    accounts = [ACCOUNT];
    permissions = [{ parentCapability: "eth_accounts" }];
    chainId = "0x89";
    calls = [];
    fail = null;
    request({ method }) {
        this.calls.push(method);
        if (this.fail?.method === method) return Promise.reject(this.fail.error);
        if (method === "eth_accounts") return Promise.resolve([...this.accounts]);
        if (method === "eth_chainId") return Promise.resolve(this.chainId);
        if (method === "wallet_getPermissions") return Promise.resolve(this.permissions);
        throw new Error(`Unexpected interactive request: ${method}`);
    }
}
const setup = async (transport = "injected", methods = []) => {
    const provider = new Provider();
    provider.remote = [];
    if (transport === "walletconnect") {
        provider.session = { topic: "original-session", namespaces: { eip155: { methods } } };
        provider.client = { request: async (envelope) => {
            provider.remote.push(envelope);
            if (provider.fail?.method === envelope.request.method) throw provider.fail.error;
            return provider.permissions;
        } };
    }
    const run = createRevocationProbe({ provider, transport, timeoutMs: 20 });
    await run.captureBaseline();
    provider.calls = [];
    return { provider, run };
};

test("revocation reads the original injected wallet and distinguishes removed from retained access", async () => {
    const { provider, run } = await setup();
    assert.equal((await run.check(provider)).observation, "accounts_reported");
    provider.accounts = [];
    assert.equal((await run.check(provider)).observation, "permission_remains");
    provider.permissions = [];
    const result = await run.check(provider);
    assert.equal(result.observation, "access_removed");
    assert.deepEqual(result.baseline.accounts, [ACCOUNT]);
    assert.equal(result.automatic_verdict, null);
    assert(provider.calls.every((method) => ["eth_accounts", "eth_chainId", "wallet_getPermissions"].includes(method)));
    run.dispose();
});

test("mobile captures its own provider baseline and cached accounts are not a successful wallet request", async () => {
    globalThis.window = { ethereum: { request() { throw new Error("Injected wallet must not be read"); } } };
    try {
        const { provider, run } = await setup("walletconnect");
        const result = await run.check(provider);
        assert.deepEqual(result.baseline.accounts, [ACCOUNT]);
        assert.equal(result.baseline.account_source, "walletconnect_session");
        assert.equal(result.observation, "cached_accounts");
        assert.equal(result.wallet_output[1].outcome, "resolved");
        assert.equal(result.wallet_output[1].request_boundary, "walletconnect_sign_client");
        assert.equal(result.wallet_output[1].request_submitted, true);
        assert.deepEqual(provider.remote, [{ topic: 'original-session', chainId: 'eip155:137', request: { method: 'wallet_getPermissions' } }]);
        assert(!provider.calls.includes("wallet_getPermissions"));
        run.dispose();
    } finally { delete globalThis.window; }
});

test("original WC session deletion is recorded without reconnection or synthetic empty RPC responses", async () => {
    const { provider, run } = await setup("walletconnect");
    provider.session = undefined;
    provider.emit("session_delete", { topic: "original-session" });
    const result = await run.check(null);
    assert.equal(result.observation, "session_ended");
    assert.equal(result.session_events[0].original_session, true);
    assert(result.wallet_output.every((row) => row.outcome === "not_sent_session_ended" && row.data_returned === null));
    assert.deepEqual(provider.calls, []);
    run.dispose();
    assert.equal(provider.listenerCount("session_delete"), 0);
    assert.equal(provider.listenerCount("disconnect"), 0);
});

test("a missing session, unrelated deletion, or network disconnect never proves revocation", async () => {
    const { provider, run } = await setup("walletconnect");
    provider.emit("session_delete", { topic: "another-session" });
    provider.emit("disconnect", { code: 4900 });
    provider.session = undefined;
    assert.equal((await run.check(null)).observation, "session_unavailable");
    assert.deepEqual(provider.calls, []);
    run.dispose();
});

test("re-pairing with the same provider object or selecting another wallet invalidates the comparison", async () => {
    const { provider, run } = await setup("walletconnect");
    provider.emit("session_delete", { topic: "original-session" });
    provider.session.topic = "new-session";
    assert.equal((await run.check(provider)).observation, "connection_changed");
    assert.equal((await run.check(new Provider())).observation, "connection_changed");
    assert.deepEqual(provider.calls, []);
    run.dispose();
});

test("changing networks prevents a misleading empty-account result", async () => {
    const { provider, run } = await setup();
    provider.chainId = "0x1";
    provider.accounts = [];
    assert.equal((await run.check(provider)).observation, "network_changed");
    assert.deepEqual(provider.calls, ["eth_chainId"]);
    run.dispose();
});

test("timeouts, unsupported methods and unstable account reads remain inconclusive", async () => {
    const { provider, run } = await setup();
    provider.accounts = [];
    provider.fail = { method: "wallet_getPermissions", error: { code: -32601, message: "Unsupported" } };
    assert.equal((await run.check(provider)).observation, "accounts_empty");
    provider.fail = null;
    const original = provider.request.bind(provider);
    let reads = 0;
    provider.request = (args) => args.method === "eth_accounts" ? Promise.resolve(++reads % 2 ? [ACCOUNT] : [OTHER]) : original(args);
    assert.equal((await run.check(provider)).observation, "inconclusive");
    provider.request = (args) => args.method === "eth_accounts" ? new Promise(() => {}) : original(args);
    assert.equal((await run.check(provider)).observation, "inconclusive");
    run.dispose();
});

test("a failed or empty baseline cannot be used as evidence of revoked access", async () => {
    const provider = new Provider();
    provider.accounts = [];
    const run = createRevocationProbe({ provider, transport: "injected" });
    await assert.rejects(run.captureBaseline(), /initial connection/);
    await assert.rejects(run.check(provider), /Establish the initial connection/);
    run.dispose();
});

test("WC permission replies are retained without going through the session or HTTP fallback", async () => {
    const { provider, run } = await setup("walletconnect", ["wallet_getPermissions"]);
    const result = await run.check(provider);
    assert(!provider.calls.includes("wallet_getPermissions"));
    assert.equal(provider.remote.length, 1);
    assert.deepEqual(result.wallet_output[1].data_returned, provider.permissions);
    assert.equal(result.automatic_verdict, null);
    run.dispose();
});

test("unapproved WC permissions retain the real transport error instead of being skipped", async () => {
    const { provider, run } = await setup('walletconnect');
    const error = { code: 5101, message: 'Unauthorized method', data: { source: 'SignClient' } };
    provider.fail = { method: 'wallet_getPermissions', error };
    const result = await run.check(provider);
    assert.equal(provider.remote.length, 1);
    assert.equal(result.wallet_output[1].request_submitted, true);
    assert.deepEqual(result.wallet_output[1].rpc_error, error);
    assert.equal(result.automatic_verdict, null);
    run.dispose();
});

test("wallet replacement during the probe cannot produce an access-removed result", async () => {
    const { provider, run } = await setup();
    provider.accounts = []; provider.permissions = [];
    let current = provider;
    const original = provider.request.bind(provider);
    provider.request = (args) => {
        if (args.method === "wallet_getPermissions") current = new Provider();
        return original(args);
    };
    assert.equal((await run.check(() => current)).observation, "connection_changed");
    run.dispose();
});

test("account changes and malformed permissions do not produce a verified removal", async () => {
    const { provider, run } = await setup();
    provider.accounts = [OTHER];
    assert.equal((await run.check(provider)).observation, "accounts_changed");
    provider.accounts = [];
    provider.permissions = [null];
    assert.equal((await run.check(provider)).observation, "accounts_empty");
    run.dispose();
});

test("session deletion during a probe is retained without dispatching through a new session", async () => {
    const { provider, run } = await setup("walletconnect", ["wallet_getPermissions"]);
    const original = provider.request.bind(provider);
    provider.request = (args) => {
        if (args.method === "eth_accounts") {
            provider.session = undefined;
            provider.emit("session_delete", { topic: "original-session" });
        }
        return original(args);
    };
    const result = await run.check(provider);
    assert.equal(result.observation, "session_ended");
    assert(!provider.calls.includes("wallet_getPermissions"));
    run.dispose();
});

// Execute the actual WC signing handler with a mock transport. The rest of the
// module depends on Next aliases and browser-only adapters, so load this export
// independently instead of importing the application into Node's test runner.
const wcSource = readFileSync(new URL("../src/utils/wallet-methods/wc/methods.js", import.meta.url), "utf8");
const handlerSource = wcSource.slice(wcSource.indexOf("export const sendPersonalSignWC ="), wcSource.indexOf("/**", wcSource.indexOf("export const sendPersonalSignWC =")));
const messagesSource = readFileSync(new URL("../src/utils/signMessages.js", import.meta.url), "utf8");
const messages = await import(`data:text/javascript;base64,${Buffer.from(messagesSource).toString("base64")}`);

test("Mobile SIWE sends opensea.io in the actual personal_sign payload and evidence", async () => {
    const { ethers } = await import("ethers");
    let sent;
    const mockEthers = { ...ethers, providers: { Web3Provider: class { constructor(provider) { return provider; } } } };
    const handler = new Function("ethers", "retrieveAddress", "verifyWalletSignature", "PERSONAL_SIGN_MESSAGE", "buildSiweMismatchMessage", "siweMessageRuntime", "snapshotError",
        `${handlerSource.replace("export const", "const")}\nreturn sendPersonalSignWC;`)(
        mockEthers, async () => ACCOUNT, async () => ({ valid: true }), "ordinary message", messages.buildSiweMismatchMessage, messages.siweMessageRuntime, snapshotError,
    );
    const provider = { send: async (method, params) => { sent = { method, params }; return "test-signature"; } };
    const result = await handler(provider, true);
    const decoded = ethers.utils.toUtf8String(sent.params[0]);
    assert.equal(sent.method, "personal_sign");
    assert.equal(sent.params[1], ACCOUNT);
    assert(decoded.startsWith(`https://opensea.io wants you to sign in with your Ethereum account:\n${ACCOUNT}`));
    assert(decoded.includes("URI: https://opensea.io\n"));
    assert.match(decoded, /Chain ID: 137\nNonce: [a-zA-Z0-9]{8,}\nIssued At:/);
    assert(!decoded.includes("wallet-testing-dapp.com"));
    assert.equal(result.runtime.siwe_message, decoded);
    assert.equal(result.runtime.siwe_domain, "opensea.io");
    await handler(provider, false);
    assert.equal(ethers.utils.toUtf8String(sent.params[0]), "ordinary message");
});
