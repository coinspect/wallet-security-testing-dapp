import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceLoader, reactHarness, nodes } from "./helpers/sourceHarness.mjs";

const recipient = `0x${"Ab".repeat(20)}`, other = `0x${"Cd".repeat(20)}`;
const account = `0x${"12".repeat(20)}`, hash = `0x${"56".repeat(32)}`;

for (const platform of ["mobile", "extension"]) for (const outcome of ["cancelled", "hash", "error"]) {
    test(`${platform}/${outcome}: Unknown evidence and image show the captured recipient, wallet address and only a real tx hash`, async () => {
        const guided = reactHarness(), result = reactHarness(), saved = [], copied = [];
        const Action = () => null, Result = () => null;
        const runtime = { provider: { session: { topic: "first", peer: { metadata: { name: "Mock wallet" } } } }, address: account, chainId: "0x89" };
        const shared = {
            "../context/WalletRuntimeContext": { useWalletRuntime: () => runtime },
            "../context/PlatformContext": { usePlatform: () => ({ platform }) },
            "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Mock wallet" }) },
            "./WizardStepHeader": () => null, "./PersistedEvidence": () => null,
            "../utils/panelToImage": {},
        };
        const browser = { window: { location: { origin: "http://localhost:3000" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
            navigator: { clipboard: { writeText: async (text) => copied.push(text) } } };
        const load = sourceLoader({ ...shared, react: guided.react, "./ActionPanel": Action, "./ActionResult": Result }, browser);
        const step = load("src/app/wizard/config/wizard.json").wizard.checks["WSR-THRE-005"].steps[0];
        const presentation = load("src/app/wizard/utils/guidedRequests.mjs").GUIDED_REQUESTS[step.canonicalId];
        const Guided = load("src/app/wizard/components/GuidedRequestCheck.jsx").default;
        const props = { step, presentation, platform, targetAddress: recipient };
        const render = () => guided.render(Guided, props);
        const action = () => nodes(render()).find((n) => n.type === Action).props;
        action().onRunStart();
        props.targetAddress = other;
        runtime.address = other;
        if (outcome === "error") action().onError("A test error", { message: "A test error", code: -32603 });
        else action().onResult(outcome === "hash" ? hash : { status: "rejected_by_user" });
        const resultProps = nodes(render()).find((n) => n.type === Result).props;
        assert.equal(resultProps.targetAddress, recipient);
        const ActualResult = sourceLoader({ ...shared, react: result.react,
            "../utils/evidenceStorage.mjs": { persistEvidenceRecord: (record) => saved.push(record) },
        }, browser)("src/app/wizard/components/ActionResult.jsx").default;
        const tree = result.render(ActualResult, resultProps);
        const html = renderToStaticMarkup(tree);
        assert.match(html, /Recipient address:/);
        assert.match(html, /Wallet address:/);
        assert(html.includes(recipient));
        assert(html.includes(account));
        assert(!html.includes(other), "Do not relabel the finished run with the latest selection/account");
        if (outcome === "hash") { assert.match(html, /Tx hash:/); assert(html.includes(hash)); }
        else assert.doesNotMatch(html, /Tx hash:/);
        await nodes(tree).find((node) => node.props?.onCopyEvidence).props.onCopyEvidence();
        const evidence = JSON.parse(copied[0]);
        assert.equal(evidence.parameters.target, recipient);
        assert.equal(evidence.runtime.from, account);
        assert.equal(saved[0].evidence.parameters.target, recipient);
        if (outcome === "hash") assert.equal(evidence.wallet_output, hash);
        guided.unmount(); result.unmount();
    });
}
