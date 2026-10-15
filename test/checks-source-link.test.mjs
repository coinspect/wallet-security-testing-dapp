import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sourceLoader } from './helpers/sourceHarness.mjs';

test('parameter views keep the registry without a checks.json repository link', () => {
    const constants = sourceLoader()('src/utils/constants.js');
    assert.equal(constants.CHECKS_SOURCE_URL, undefined);
    assert.equal(constants.CHECKS_SNAPSHOT_URL, undefined);
    assert(constants.testParams.length > 0);
    for (const path of ['src/app/params/page.jsx', 'src/app/wizard/components/ParamsPanel.jsx']) {
        const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /CHECKS_SOURCE_URL|CHECKS_SNAPSHOT_URL|checks\.json snapshot|checks\.json \(main\)/);
    }
    const page = readFileSync(new URL('../src/app/params/page.jsx', import.meta.url), 'utf8');
    assert.match(page, /\['blobSha', prov\.blobSha\]/);
    const panel = readFileSync(new URL('../src/app/wizard/components/ParamsPanel.jsx', import.meta.url), 'utf8');
    assert.match(panel, /to="\/params"/);
    assert.match(panel, /All \{testParams.length\} parameters/);
});
