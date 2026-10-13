import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import { deferred, flush, sourceLoader } from "./helpers/sourceHarness.mjs";

const account = `0x${"11".repeat(20)}`, hash = `0x${"33".repeat(32)}`;

test("every extension action keeps the dispatch provider when selection changes during account reads", async () => {
    for (const name of ["sendScamTransaction", "sendPoisonTransaction", "sendFamiliarRecipientTransaction", "sendUnknownTransaction", "sendInvalidChecksumTransaction", "sendExplorerLinkTransaction", "clearMethodSignRequest", "ethSignMethod", "differentChainId", "siweSign", "signPermit", "signPermitAndSeaport", "signLongMessage", "signLongMessageAndTypedData", "deployTestErc20", "approveTestErc20"]) {
        const gate = deferred(), calls = [], otherCalls = [];
        const original = { identity: {}, request: async function (args) {
            assert.equal(this, original);
            calls.push(args);
            if (args.method === "eth_accounts") { await gate.promise; return [account]; }
            if (args.method === "eth_chainId") return "0x89";
            if (args.method === "eth_getTransactionReceipt") return { contractAddress: account };
            if (args.method === "eth_sendTransaction") return hash;
            throw { code: 4001, message: "User rejected" };
        } };
        const other = { request: async (args) => { otherCalls.push(args); throw new Error("Wrong wallet"); } };
        let selected = original;
        const load = sourceLoader({
            "@/app/wizard/utils/selectedProvider": { getActiveProvider: () => selected },
            "./wc/methods": {},
        });
        const { handleAction } = load("src/utils/wallet-methods/actionMethods.js");
        const running = handleAction("extension", name, original, { chain: "polygon" }).catch((error) => error);
        await flush(); selected = other; gate.resolve(); await running;
        assert.equal(otherCalls.length, 0, `${name} must never re-resolve the selected wallet`);
        assert(calls.some((call) => !["eth_accounts", "eth_chainId"].includes(call.method)), `${name} must reach its test request`);
        if (name === "sendInvalidChecksumTransaction") {
            assert.equal(calls.find((call) => call.method === "eth_sendTransaction").params[0].to, "0x02970EA171A97EB0d627CB7EC9ABaC308253C716");
        }
    }
});

for (const action of ["simulateSwap", "provideLiquidity"]) {
    test(`${action}: on-chain reads and final transaction remain on the original provider`, async () => {
        const gate = deferred(), sent = [];
        let selected;
        const original = { request: async (args) => {
            if (args.method === "eth_accounts") return [account];
            if (args.method === "eth_chainId") return "0x89";
            sent.push(args); return hash;
        } };
        selected = original;
        const mockEthers = { ...ethers,
            providers: { Web3Provider: class { constructor(provider) { assert.equal(provider.identity, original.identity); } } },
            Contract: class {
                async getPool() { await gate.promise; return account; }
                async slot0() { return { tick: 127 }; }
                callStatic = { quoteExactInputSingle: async () => { await gate.promise; return { amountOut: ethers.BigNumber.from(123456) }; } };
            },
        };
        const { handleAction } = sourceLoader({ ethers: { ethers: mockEthers }, "./wc/methods": {},
            "@/app/wizard/utils/selectedProvider": { getActiveProvider: () => selected },
        })("src/utils/wallet-methods/actionMethods.js");
        const running = handleAction("extension", action, original, { chain: "polygon" });
        await flush(); selected = { request: () => assert.fail("Dispatch moved to another wallet") }; gate.resolve();
        await running;
        assert.equal(sent.length, 1); assert.equal(sent[0].method, "eth_sendTransaction");
        assert.equal(sent[0].params[0].from, account);
    });
}

test("connection permission fallback never moves to another extension", async () => {
    const gate = deferred(), calls = [];
    const provider = { request: async (args) => {
        calls.push(args.method);
        if (args.method === "wallet_revokePermissions") { await gate.promise; return null; }
        if (args.method === "wallet_requestPermissions") throw { code: 4200, message: "Not supported" };
        return [account];
    } };
    const { requestConnection } = sourceLoader({ "@/app/wizard/utils/selectedProvider": { getActiveProvider: () => assert.fail("Re-resolved provider") } })("src/utils/wallet-methods/ext/methods.js");
    const running = requestConnection(provider); await flush(); gate.resolve(); await running;
    assert(calls.includes("eth_requestAccounts"));
});
