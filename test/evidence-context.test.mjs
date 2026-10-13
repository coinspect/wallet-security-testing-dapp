import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { nodes, reactHarness, sourceLoader } from "./helpers/sourceHarness.mjs";

test('restarting a check archives its evidence without replacing unrelated records', () => {
    const store = new Map();
    const sessionStorage = { get length() { return store.size; }, key: (i) => [...store.keys()][i], getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    const { archiveCheckEvidence } = sourceLoader({}, { window: { sessionStorage } })('src/app/wizard/utils/evidenceStorage.mjs');
    const original = { platform: 'mobile', check: 'auth', step: '1/1', evidence: { wallet_output: [{ outcome: 'no_response' }] } };
    sessionStorage.setItem('wsr-evidence:mobile:auth:1%2F1', JSON.stringify(original));
    sessionStorage.setItem('wsr-evidence:other', JSON.stringify({ ...original, check: 'other' }));
    archiveCheckEvidence('mobile', 'auth');
    const records = [...store.values()].map(JSON.parse);
    assert.equal(records.length, 3);
    assert.deepEqual(records.find((record) => record.step.startsWith('previous:')).evidence, original.evidence);
    assert.deepEqual(JSON.parse(store.get('wsr-evidence:mobile:auth:1%2F1')), original);
    archiveCheckEvidence('mobile', 'auth');
    assert.equal(store.size, 4);
});

for (const platform of ["extension", "mobile"]) {
    for (const changed of [false, true]) {
        test(`${platform}: context change=${changed} is consistent in the result image, copied JSON and stored evidence`, async () => {
            const provider = { session: { topic: "original", peer: { metadata: { name: "Original wallet" } } } };
            let runtime = { provider, address: `0x${"11".repeat(20)}`, chainId: "0x89" };
            const first = runtime;
            const guided = reactHarness(), result = reactHarness(), saved = [], copied = [];
            const Action = () => null, Result = () => null;
            const shared = {
                "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
                "../context/PlatformContext": { usePlatform: () => ({ platform }) },
                "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Original wallet" }) },
                "../utils/checkMeta": { checkTitle: () => "Auth" },
            };
            const load = sourceLoader({ ...shared, react: guided.react, "./ActionPanel": Action, "./ActionResult": Result,
                "./PersistedEvidence": () => null, "./WizardStepHeader": () => null,
            });
            const step = load("src/app/wizard/config/wizard.json").wizard.checks[platform === "mobile" ? "WSR-PERM-007~Mobile" : "WSR-PERM-010~Browser"].steps[0];
            const Guided = load("src/app/wizard/components/GuidedRequestCheck.jsx").default;
            const props = { step, platform, presentation: { stages: [{ title: "Run", action: true }, { title: "Review" }] } };
            const render = () => guided.render(Guided, props);
            nodes(render()).find((node) => node.type === Action).props.onRunStart();
            if (changed) runtime = { provider: {}, address: `0x${"22".repeat(20)}`, chainId: "0x1" };
            const output = [{ method: "personal_sign", outcome: "rejected", code: 4001, elapsed_ms: 500 }];
            nodes(render()).find((node) => node.type === Action).props.onResult(output);
            const resultProps = nodes(render()).find((node) => node.type === Result).props;
            assert.equal(resultProps.contextChanged, changed);
            assert.equal(resultProps.extraRuntime.from, first.address);
            const ActualResult = sourceLoader({ ...shared, react: result.react,
                "../utils/evidenceStorage.mjs": { persistEvidenceRecord: (record) => saved.push(record) },
                "../utils/panelToImage": {},
            }, { window: { location: { origin: "https://example.test" }, addEventListener() {}, removeEventListener() {} },
                navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
            })("src/app/wizard/components/ActionResult.jsx").default;
            const tree = result.render(ActualResult, resultProps);
            const panel = nodes(tree).find((node) => node.props?.ref);
            const html = renderToStaticMarkup(panel);
            assert.equal(html.includes("Wallet or network changed during this run"), changed);
            assert.equal(saved[0].evidence.context_changed_during_request, changed ? true : undefined);
            assert.deepEqual(saved[0].evidence.wallet_output, output);
            assert.equal(saved[0].evidence.runtime.from, first.address);
            assert.equal(saved[0].evidence.runtime.chain_id, first.chainId);
            await nodes(tree).find((node) => node.props?.onCopyEvidence).props.onCopyEvidence();
            assert.deepEqual(JSON.parse(copied[0]), saved[0].evidence);
            guided.unmount(); result.unmount();
        });
    }
}
