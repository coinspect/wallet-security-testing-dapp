import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, useParams } from 'react-router';
import { JSDOM } from 'jsdom';
import { sourceLoader } from './helpers/sourceHarness.mjs';

async function renderApp(t, path, storedPlatform) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://wizard.test' });
    const originals = new Map();
    for (const [key, value] of Object.entries({
        window: dom.window, document: dom.window.document,
        navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    let scrolls = 0;
    dom.window.scrollTo = () => { scrolls++; return Promise.resolve(); };
    if (storedPlatform) dom.window.localStorage.setItem('wizard.platform', storedPlatform);
    const lifecycle = { walletMounts: 0, walletUnmounts: 0, checkMounts: 0, checkUnmounts: 0 };
    let navigate, location, platformContext;
    const Pass = ({ children }) => children;
    function Providers({ children }) {
        useEffect(() => {
            lifecycle.walletMounts++;
            return () => { lifecycle.walletUnmounts++; };
        }, []);
        return children;
    }
    function Check() {
        const params = useParams();
        const campaign = platformContext.usePlatform();
        useEffect(() => {
            lifecycle.checkMounts++;
            return () => { lifecycle.checkUnmounts++; };
        }, []);
        return React.createElement('output', null, `${campaign.platform}:${params.step}`);
    }
    const load = sourceLoader({
        './components/context/AppProviders': Providers,
        './app/params/page': () => React.createElement('h1', null, 'Parameters'),
        './app/wizard/[platform]/[step]/StepPageClient': Check,
        '@/components/context/SentinelProvider': { SentinelProvider: Pass },
        './components/WizardShell': Pass,
        './components/WizardErrorBoundary': Pass,
    }, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator });
    platformContext = load('src/app/wizard/context/PlatformContext.jsx');
    const App = load('src/App.jsx').default;
    const platform = load('src/app/wizard/utils/platform.js');
    function Navigation() {
        navigate = useNavigate();
        location = useLocation();
        return React.createElement(App);
    }
    const root = createRoot(dom.window.document.getElementById('root'));
    t.after(async () => {
        await act(async () => root.unmount());
        dom.window.close();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Navigation))));
    return {
        dom, lifecycle, platform, load,
        get path() { return location.pathname; },
        get text() { return dom.window.document.body.textContent; },
        get scrolls() { return scrolls; },
        async go(to) { await act(async () => navigate(to)); },
    };
}

test('root and wizard landing restore the selected campaign with replacement navigation', async (t) => {
    const ui = await renderApp(t, '/', 'mobile');
    const first = ui.platform.firstCampaignCheckBase('mobile');
    assert.equal(ui.path, `/wizard/mobile/${first}`);
    assert.equal(ui.text, `mobile:${first}`);
    await ui.go('/params/');
    await ui.go(-1);
    assert.equal(ui.path, `/wizard/mobile/${first}`);
});

test('direct campaign links override storage and redirect to the first check', async (t) => {
    const ui = await renderApp(t, '/wizard/extension/', 'mobile');
    const first = ui.platform.firstCampaignCheckBase('extension');
    assert.equal(ui.path, `/wizard/extension/${first}`);
    assert.equal(ui.dom.window.localStorage.getItem('wizard.platform'), 'extension');
});

test('every configured campaign check remains addressable, with or without a trailing slash', async (t) => {
    const ui = await renderApp(t, '/wizard');
    const { campaignChecks } = ui.load('src/app/wizard/utils/campaignChecks.js');
    for (const platform of ['extension', 'mobile']) {
        for (const check of campaignChecks(platform)) {
            const base = ui.platform.baseCheckId(check.id);
            for (const suffix of ['', '/']) {
                await ui.go(`/wizard/${platform}/${base}${suffix}`);
                assert.equal(ui.text, `${platform}:${base}`);
            }
        }
    }
    assert.equal(ui.lifecycle.walletMounts, 1);
});

test('check and campaign navigation remounts checks but retains wallet providers and stored evidence', async (t) => {
    const ui = await renderApp(t, '/wizard/mobile/WSR-PERM-002/');
    const { persistEvidenceRecord, loadCampaignEvidence } = ui.load('src/app/wizard/utils/evidenceStorage.mjs');
    const evidence = { check: 'WSR-PERM-002', wallet_output: 'cancelled_by_tester' };
    persistEvidenceRecord({ platform: 'mobile', checkId: 'WSR-PERM-002', step: '1/1', evidence });
    assert.equal(ui.text, 'mobile:WSR-PERM-002');
    await ui.go('/wizard/mobile/WSR-PERM-009');
    await ui.go('/wizard/extension/WSR-PERM-009/');
    assert.equal(ui.text, 'extension:WSR-PERM-009');
    assert.deepEqual(ui.lifecycle, { walletMounts: 1, walletUnmounts: 0, checkMounts: 3, checkUnmounts: 2 });
    await ui.go('/params/');
    assert.equal(ui.text, 'Parameters');
    await ui.go(-1);
    assert.equal(ui.text, 'extension:WSR-PERM-009');
    assert.equal(ui.lifecycle.walletMounts, 1);
    assert.equal(ui.lifecycle.walletUnmounts, 0);
    assert.deepEqual(loadCampaignEvidence('mobile')[0].evidence, evidence);
    assert(ui.scrolls >= 5);
});

test('invalid campaigns, malformed segments and unknown paths render a recovery link', async (t) => {
    const ui = await renderApp(t, '/wizard/invalid/WSR-PERM-002/');
    assert.match(ui.text, /Page not found/);
    await ui.go('/wizard/%E0%A4%A/');
    assert.match(ui.text, /Page not found/);
    await ui.go('/missing');
    assert.equal(ui.dom.window.document.querySelector('a').getAttribute('href'), '/wizard');
});

test('theme bootstrap honors light mode, defaults to dark, and survives blocked storage', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const script = html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/)[1];
    for (const stored of ['light', 'dark', null, 'blocked']) {
        const classes = new Set();
        runInNewContext(script, {
            localStorage: { getItem() { if (stored === 'blocked') throw new Error('blocked'); return stored; } },
            document: { documentElement: { classList: {
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
                add(name) { classes.add(name); },
            } } },
        });
        assert.equal(classes.has('dark'), stored !== 'light');
    }
});

test('Next and webpack are absent from the locked dependency graph', () => {
    const { packages } = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
    assert.equal(Object.keys(packages).some((name) => /node_modules\/(next|webpack|eslint-config-next)$/.test(name)), false);
});
