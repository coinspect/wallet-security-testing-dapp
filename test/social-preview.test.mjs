import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { socialImageUrl, socialPreviewPlugin } from '../scripts/social-preview.mjs';

test('social images use the deployment origin', () => {
    assert.equal(socialImageUrl({}), 'https://wsf.tools/social-preview.png');
    assert.equal(socialImageUrl({ CONTEXT: 'production', URL: 'https://wsf.tools', DEPLOY_PRIME_URL: 'https://other.netlify.app' }), 'https://wsf.tools/social-preview.png');
    for (const context of ['deploy-preview', 'branch-deploy']) {
        const env = { CONTEXT: context, URL: 'https://wsf.tools', DEPLOY_PRIME_URL: 'https://preview.netlify.app/' };
        assert.equal(socialImageUrl(env), 'https://preview.netlify.app/social-preview.png');
        const html = socialPreviewPlugin(env).transformIndexHtml(readFileSync('index.html', 'utf8'));
        assert.equal(html.match(/https:\/\/preview.netlify.app\/social-preview.png/g).length, 2);
        assert.ok(!html.includes('https://wsf.tools/social-preview.png'));
    }
    assert.equal(socialImageUrl({ CONTEXT: 'deploy-preview', DEPLOY_URL: 'https://deploy.netlify.app' }), 'https://deploy.netlify.app/social-preview.png');
    assert.throws(() => socialImageUrl({ CONTEXT: 'deploy-preview' }), /Missing/);
    assert.throws(() => socialImageUrl({ URL: 'javascript:alert(1)' }), /Invalid/);
});

test('social preview metadata is available without JavaScript', () => {
    const html = readFileSync('index.html', 'utf8');
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
    const meta = (attribute, key) => head.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]+)"`))?.[1];
    assert.equal(meta('property', 'og:image'), 'https://wsf.tools/social-preview.png');
    assert.equal(meta('name', 'twitter:image'), meta('property', 'og:image'));
    assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
    assert.equal(meta('property', 'og:image:width'), '1200');
    assert.equal(meta('property', 'og:image:height'), '630');
    assert.equal(meta('property', 'og:image:alt'), 'Wallet Testing Tool. We test, you decide. Coinspect logo and a wallet connected to a seismograph.');
    assert.equal(meta('name', 'twitter:image:alt'), meta('property', 'og:image:alt'));
});

test('social preview is a 1200 by 630 PNG under 5 MB', () => {
    const image = readFileSync('public/social-preview.png');
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 630);
    assert.ok(image.length < 5_000_000);
});
