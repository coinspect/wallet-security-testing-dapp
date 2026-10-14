import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceLoader } from './helpers/sourceHarness.mjs';
import { GUIDED_REQUESTS } from '../src/app/wizard/utils/guidedRequests.mjs';

test('unknown dApp is added to both checks without replacing existing URLs', () => {
    const load = sourceLoader();
    const config = load('src/app/wizard/config/wizard.json').wizard.checks;
    const { testParams } = load('src/utils/constants.js');
    assert.deepEqual(config['WSR-THRE-001'].steps[0].ui.content.links, ['verified_dapp_url', 'aave_dapp_url', 'curve_dapp_url', 'unknown_dapp_url']);
    assert.deepEqual(config['WSR-THRE-006'].steps[0].ui.content.links, ['polygon_staking_dapp_url', 'polygon_portal_dapp_url', 'olympusdao_dapp_url', 'unknown_dapp_url']);
    const unknown = testParams.find((row) => row.key === 'unknown_dapp_url');
    assert.equal(unknown.value, 'https://this-is-unkown-dappeppy-sorbet-7eca61.netlify.app/');
    assert.equal(unknown.linkLabel, 'Open unknown dApp');
    const stages = GUIDED_REQUESTS['WSR-THRE-001.v1'].stages;
    assert.equal(stages.filter((stage) => stage.action).length, 1);
    assert.deepEqual(stages[1].linkKeys, ['unknown_dapp_url']);
    assert(!stages[1].action);
    assert(!stages[2].linkKeys.includes('unknown_dapp_url'));
    const source = readFileSync(new URL('../src/app/wizard/components/GuidedRequestCheck.jsx', import.meta.url), 'utf8');
    assert.match(source, /stage\.linkKeys\.includes\(link\.key\)/);
    assert.match(source, /rel="noopener noreferrer"/);
});
