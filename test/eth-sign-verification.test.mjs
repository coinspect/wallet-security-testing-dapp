import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import { inspectEthSignSignature } from "../src/utils/wallet-methods/ethSignVerification.mjs";

test("eth_sign diagnostics distinguish raw and both prefixed formats without retaining signatures", async () => {
    const signer = ethers.Wallet.createRandom();
    const hash = ethers.utils.id("Offline verification fixture");
    for (const [format, signature] of [
        ["raw_eth_sign", ethers.utils.joinSignature(signer._signingKey().signDigest(hash))],
        ["personal_sign_bytes", await signer.signMessage(ethers.utils.arrayify(hash))],
        ["personal_sign_text", await signer.signMessage(hash)],
    ]) {
        const output = inspectEthSignSignature(signer.address, hash, signature);
        const details = output.eth_sign_verification;
        assert.equal(details.requested_method, "eth_sign");
        assert.equal(details.message_hash, hash);
        assert.equal(details.matched_format, format);
        assert.equal(details.attempts.filter((attempt) => attempt.matches_signing_account).length, 1);
        assert.equal(JSON.stringify(output).includes(signature), false);
        const mismatch = inspectEthSignSignature(ethers.Wallet.createRandom().address, hash, signature);
        assert.equal(mismatch.eth_sign_verification.status, "inconclusive");
        assert.equal(mismatch.eth_sign_verification.matched_format, null);
        assert.match(mismatch.result, /Inconclusive/);
    }
});

test("unrecoverable signatures remain inconclusive with diagnostic failures", () => {
    const result = inspectEthSignSignature(ethers.Wallet.createRandom().address, ethers.utils.id("fixture"), "0x1234");
    assert.equal(result.eth_sign_verification.status, "inconclusive");
    assert.ok(result.eth_sign_verification.attempts.every((attempt) => attempt.recovered_address === null && attempt.error));
});
