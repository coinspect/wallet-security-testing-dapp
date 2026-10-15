import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('social preview metadata is available without JavaScript', () => {
    const html = readFileSync('index.html', 'utf8');
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
    const meta = (attribute, key) => head.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]+)"`))?.[1];
    assert.equal(meta('property', 'og:image'), 'https://wsf.tools/social-preview.png');
    assert.equal(meta('name', 'twitter:image'), meta('property', 'og:image'));
    assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
    assert.equal(meta('property', 'og:image:width'), '1200');
    assert.equal(meta('property', 'og:image:height'), '630');
    assert.ok(meta('property', 'og:image:alt'));
    assert.ok(meta('name', 'twitter:image:alt'));
});

test('social preview is a 1200 by 630 PNG under 5 MB', () => {
    const image = readFileSync('public/social-preview.png');
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 630);
    assert.ok(image.length < 5_000_000);
});
