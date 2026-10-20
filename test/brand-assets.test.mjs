import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const read = (path) => readFileSync(path, 'utf8');
const config = createRequire(import.meta.url)('../tailwind.config.js');

test('brand fonts are bundled and every declared face is available', () => {
    const css = read('src/app/globals.css');
    const fonts = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)];
    assert.equal(fonts.length, 6);
    for (const [, path] of fonts) assert.ok(existsSync(`public${path}`), path);
    assert.match(css, /--font-inter: 'WSR Inter'/);
    assert.match(css, /--font-jetbrains: 'WSR Mono'/);
    assert.doesNotMatch(read('src/main.jsx'), /@fontsource/);
});

test('navbar and footer keep WSR primary and Coinspect secondary in both themes', () => {
    const navbar = read('src/components/mainLayout/layoutBar/navBar/NavBar.jsx');
    assert.match(navbar, /\/brand\/wsr-wordmark-horizontal.svg/);
    assert.match(navbar, /whitespace-nowrap[^>]*>Testing Tool/);
    assert.doesNotMatch(navbar, /src="\/coinspect/);
    const logo = read('public/brand/wsr-wordmark.svg').toLowerCase();
    for (const color of ['#85f2e7', '#f25ebf']) assert.ok(logo.includes(color));
    const shell = read('src/app/wizard/components/WizardShell.jsx');
    assert.match(shell, /<footer/);
    assert.match(shell, /By Coinspect/);
    assert.match(shell, /© 2026 Coinspect/);
    assert.match(shell, /coinspect-logo-dark.svg/);
    assert.match(shell, /dark:hidden/);
});

test('WSR action colors retain readable text contrast', () => {
    const colors = config.theme.extend.colors;
    assert.equal(colors.primary.dark, '#85F2E7');
    assert.equal(colors.stealth.accent, '#36C497');
    assert.equal(colors.stealth.danger, '#FA4A89');
    const luminance = (hex) => {
        const channels = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
            .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    assert.ok(contrast(colors.primary.light, '#FFFFFF') >= 4.5);
    assert.ok(contrast(colors.primary.dark, '#18181B') >= 4.5);
});
