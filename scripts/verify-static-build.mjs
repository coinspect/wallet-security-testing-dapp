import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { socialImageUrl } from './social-preview.mjs';

const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /<div id="root"><\/div>/);
assert.match(html, /Wallet Security Ranking — Testing Tool/);
assert.match(html, /theme-bootstrap/);
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
assert(assets.some((asset) => asset.endsWith('.js')));
assert(assets.some((asset) => asset.endsWith('.css')));
for (const asset of assets) assert(existsSync(`dist${asset}`), `Missing asset: ${asset}`);
for (const asset of ['icon.svg', 'coinspect-logo.svg', 'coinspect-logo-dark.svg', 'social-preview.png']) {
    assert(existsSync(`dist/${asset}`), `Missing asset: ${asset}`);
}
assert(html.includes(`property="og:image" content="${socialImageUrl()}"`));
assert(html.includes(`name="twitter:image" content="${socialImageUrl()}"`));
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(readFileSync('dist/_redirects', 'utf8'), /^\/\*\s+\/index.html\s+200$/m);
assert.equal(readFileSync('dist/_headers', 'utf8'), readFileSync('public/_headers', 'utf8'));
console.log('Verified SPA entry, assets, deep-link fallback and security headers.');
