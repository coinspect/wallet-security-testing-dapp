import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceLoader, reactHarness, nodes, deferred } from "./helpers/sourceHarness.mjs";

const address = "0xcd75f32FB6f10857F97DdDdf22102716E9335554";
const nextAddress = `0x${"Ab".repeat(20)}`;

function recipientFixture(clipboard) {
    const hooks = reactHarness();
    const Component = sourceLoader({ react: hooks.react }, { navigator: { clipboard } })("src/app/wizard/components/RecipientAddress.jsx").default;
    const render = (value = address) => hooks.render(Component, { address: value, label: "Selected recipient" });
    const button = (value) => nodes(render(value)).find((node) => node.type === "button");
    return { render, button, hooks };
}

test("copy uses the full recipient verbatim and confirms only after clipboard success", async () => {
    const copied = [], gate = deferred();
    const ui = recipientFixture({ writeText: (value) => { copied.push(value); return gate.promise; } });
    const copying = ui.button().props.onClick();
    assert.deepEqual(copied, [address]);
    assert.doesNotMatch(renderToStaticMarkup(ui.render()), /Copied/);
    gate.resolve();
    await copying;
    const html = renderToStaticMarkup(ui.render());
    assert.match(html, /Copied/);
    assert.match(html, new RegExp(address));
    assert.doesNotMatch(renderToStaticMarkup(ui.render(nextAddress)), /Copied/);
    ui.hooks.unmount();
});

test("a delayed clipboard result cannot claim a different recipient was copied", async () => {
    const gate = deferred();
    const ui = recipientFixture({ writeText: () => gate.promise });
    const copying = ui.button().props.onClick();
    ui.render(nextAddress);
    gate.resolve();
    await copying;
    assert.doesNotMatch(renderToStaticMarkup(ui.render(nextAddress)), /Copied/);
    ui.hooks.unmount();
});

for (const clipboard of [undefined, { writeText: async () => { throw new Error("Permission denied"); } }]) {
    test(`clipboard ${clipboard ? "denied" : "unavailable"}: keep the full address selectable and explain manual copying`, async () => {
        const ui = recipientFixture(clipboard);
        await ui.button().props.onClick();
        const html = renderToStaticMarkup(ui.render());
        assert.match(html, /Could not copy/);
        assert.match(html, /select-all/);
        assert.match(html, new RegExp(address));
        assert.doesNotMatch(html, /Copied/);
        ui.hooks.unmount();
    });
}

test("missing recipient cannot be copied", async () => {
    const ui = recipientFixture({ writeText: () => assert.fail("No address to copy") });
    assert.equal(ui.button("").props.disabled, true);
    await ui.button("").props.onClick();
    ui.hooks.unmount();
});

for (const platform of ["mobile", "extension"]) {
    test(`${platform}: manual entry copies the request's captured recipient, not a later selection`, async () => {
        const hooks = reactHarness(), Action = () => null, Recipient = () => null;
        const load = sourceLoader({
            react: hooks.react,
            "../context/WalletRuntimeContext": { useWalletRuntime: () => ({ provider: null, address: null, chainId: "0x89" }) },
            "../utils/providerIdentity": { getProviderIdentity: () => ({ name: "Mock wallet" }) },
            "./ActionPanel": Action, "./ActionResult": () => null,
            "./PersistedEvidence": () => null, "./WizardStepHeader": () => null,
            "./RecipientAddress": Recipient,
        });
        const check = load("src/app/wizard/config/wizard.json").wizard.checks["WSR-THRE-005"];
        const presentation = load("src/app/wizard/utils/guidedRequests.mjs").GUIDED_REQUESTS[check.canonicalId];
        const Component = load("src/app/wizard/components/GuidedRequestCheck.jsx").default;
        const props = { step: check.steps[0], presentation, platform, targetAddress: address };
        const render = () => hooks.render(Component, props);
        const action = () => nodes(render()).find((node) => node.type === Action).props;
        assert.deepEqual(nodes(render()).filter((node) => node.type === Recipient).map((node) => node.props.address), [address, address]);
        action().onRunStart();
        props.targetAddress = nextAddress;
        action().onResult({ status: "rejected_by_user" });
        const recipients = nodes(render()).filter((node) => node.type === Recipient);
        assert.equal(recipients[0].props.address, nextAddress);
        assert.equal(recipients[1].props.address, address);
        assert.equal(recipients[1].props.label, "Recipient used in the dApp request");
        const copied = [], ui = recipientFixture({ writeText: async (value) => copied.push(value) });
        await ui.button(recipients[1].props.address).props.onClick();
        assert.deepEqual(copied, [address]);
        assert.match(presentation.stages[2].instruction, /Copy.*paste/);
        assert.match(presentation.stages[2].instruction, /then cancel/);
        ui.hooks.unmount(); hooks.unmount();
    });
}
