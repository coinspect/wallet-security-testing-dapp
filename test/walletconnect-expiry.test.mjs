import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const format of ['commonjs', 'module']) test(`SignClient utils (${format}) expires without a second unhandled rejection`, () => {
    // Separate process: a global unhandledRejection handler would conceal the
    // SDK bug. Exercise the installed implementation with a short expiry.
    const script = `
        const { createRequire } = require('node:module');
        const sdkRequire = createRequire(require.resolve('@walletconnect/sign-client'));
        (async () => {
            const entry = sdkRequire.resolve('@walletconnect/utils');
            const utils = ${format === 'module'
                ? "await import(require('node:url').pathToFileURL(entry.replace(/index\\.cjs$/, 'index.js')).href)"
                : "sdkRequire('@walletconnect/utils')"};
            const delayed = utils.createDelayedPromise(0.01, 'Request expired. Please try again.');
            let handled = false;
            delayed.done().catch(error => {
                require('node:assert/strict').equal(error.message, 'Request expired. Please try again.');
                handled = true;
            });
            await new Promise(resolve => setTimeout(resolve, 40));
            require('node:assert/strict').equal(handled, true);
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script], {
        cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr.split('\n').filter((line) => line.length < 1000).join('\n'));
});
