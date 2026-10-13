import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sourceLoader } from "./helpers/sourceHarness.mjs";

const require = createRequire(import.meta.url);
const { createBuildProvenance, sourceFingerprint } = require("../scripts/build-provenance.cjs");
const root = fileURLToPath(new URL("../", import.meta.url));
const snapshotPath = "src/app/wizard/config/checks-snapshot.json";

test("production provenance identifies each build, exact source inputs and canonical snapshot", async () => {
    const first = createBuildProvenance(root), second = createBuildProvenance(root);
    assert.notEqual(first.build_id, second.build_id);
    assert.equal(first.source_sha256, second.source_sha256);
    assert.match(first.source_sha256, /^[a-f0-9]{64}$/);
    assert.match(first.git_commit, /^[a-f0-9]{40,64}$/);
    const snapshot = readFileSync(path.join(root, snapshotPath));
    assert.equal(first.checks_snapshot.blob_sha, JSON.parse(snapshot)._provenance.blobSha);
    assert.equal(first.checks_snapshot.sha256, createHash("sha256").update(snapshot).digest("hex"));
    const { default: configure } = await import("../vite.config.mjs");
    const config = configure({ command: "build" });
    assert.equal(JSON.parse(config.define.__WSR_BUILD_PROVENANCE__).source_sha256, first.source_sha256);
    assert.equal(JSON.parse(configure({ command: "serve" }).define.__WSR_BUILD_PROVENANCE__).mode, "development");
});

test("fingerprints include uncommitted inputs but not environment credentials or build output", (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "wsr-provenance-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(path.join(directory, "src"));
    writeFileSync(path.join(directory, "src/example.js"), "initial");
    const initial = sourceFingerprint(directory);
    writeFileSync(path.join(directory, ".env.local"), "TEST_VALUE=not-a-real-secret");
    mkdirSync(path.join(directory, "dist")); writeFileSync(path.join(directory, "dist/index.html"), "export");
    assert.equal(sourceFingerprint(directory), initial);
    writeFileSync(path.join(directory, "src/example.js"), "changed");
    assert.notEqual(sourceFingerprint(directory), initial);
    for (const file of ["index.html", "vite.config.mjs", "netlify.toml"]) {
        const before = sourceFingerprint(directory);
        writeFileSync(path.join(directory, file), "build input");
        assert.notEqual(sourceFingerprint(directory), before, file);
    }
});

test("development does not claim a fixed source fingerprint across hot reloads", () => {
    const dev = createBuildProvenance(root, { development: true });
    assert.equal(dev.mode, "development");
    assert.equal(dev.source_sha256, null);
    assert.equal(dev.checks_snapshot.sha256, null);
});

test("missing build metadata is explicit, never fabricated as the latest version", () => {
    const { BUILD_PROVENANCE } = sourceLoader({}, { process: { env: {} } })("src/app/wizard/utils/buildProvenance.mjs");
    assert.equal(BUILD_PROVENANCE.mode, "unavailable");
    assert.equal(BUILD_PROVENANCE.build_id, null);
    assert.equal(BUILD_PROVENANCE.git_commit, null);
});

test("new comparison evidence captures build identity and preserves parameters", () => {
    const provenance = createBuildProvenance(root);
    const { comparisonEvidence } = sourceLoader({}, { buildProvenance: provenance })("src/app/wizard/utils/guidedComparison.mjs");
    const params = { method: "eth_sendTransaction", target: "verbatim-target" };
    const evidence = comparisonEvidence({ checkId: "test", parameters: params }, { error: { message: "Invalid checksum" } }, "https://example.test");
    assert.deepEqual(evidence.provenance, provenance);
    assert.deepEqual(evidence.parameters, params);
    assert.equal(evidence.wallet_output, "Invalid checksum");
});

test("session storage never stamps older evidence with a newer build identity", () => {
    const records = new Map();
    const storage = {
        get length() { return records.size; }, key: (i) => [...records.keys()][i],
        getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: (key) => records.delete(key),
    };
    const { persistEvidenceRecord, loadCampaignEvidence } = sourceLoader({}, { window: { sessionStorage: storage, dispatchEvent() {} } })("src/app/wizard/utils/evidenceStorage.mjs");
    const evidence = { check: "old", provenance: { build_id: "original-build", source_sha256: "a".repeat(64) } };
    // CustomEvent may be absent in a Node runtime; storage is written before
    // notification, so the recorded evidence can still be inspected.
    persistEvidenceRecord({ platform: "mobile", checkId: "old", step: "1/1", evidence });
    persistEvidenceRecord({ platform: "mobile", checkId: "legacy", step: "1/1", evidence: { check: "legacy" } });
    const loaded = loadCampaignEvidence("mobile");
    assert.deepEqual(loaded.find((record) => record.check === "old").evidence, evidence);
    assert.equal(loaded.find((record) => record.check === "legacy").evidence.provenance, undefined);
});
