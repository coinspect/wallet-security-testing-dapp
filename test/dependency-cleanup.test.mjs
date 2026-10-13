import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { sourceLoader } from './helpers/sourceHarness.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const require = createRequire(import.meta.url);
// Execute the real class helper with its installed dependencies, not a cn mock.
const classSource = read('src/lib/utils.js').replace(/from '(clsx|tailwind-merge)'/g,
    (_, name) => `from '${pathToFileURL(require.resolve(name)).href}'`);
const { cn } = await import(moduleUrl(classSource));

test('Tailwind 3 uses the supported tailwind-merge 2 line in the manifest and lockfile', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.match(pkg.devDependencies.tailwindcss, /^\^3\./);
    assert.match(pkg.dependencies['tailwind-merge'], /^\^2\.6\./);
    assert.match(lock.packages['node_modules/tailwindcss'].version, /^3\./);
    assert.match(lock.packages['node_modules/tailwind-merge'].version, /^2\.6\./);
    assert.equal(lock.packages[''].dependencies['tailwind-merge'], pkg.dependencies['tailwind-merge']);
});

test('cn keeps conditional classes and resolves Tailwind 3 spacing and shadow conflicts', () => {
    assert.equal(cn('px-2 py-1', false, ['p-3'], { 'font-medium': true, hidden: false }), 'p-3 font-medium');
    assert.equal(cn('shadow-sm rounded-sm', 'shadow rounded'), 'shadow rounded');
    assert.equal(cn('ring ring-blue-500', 'ring-2'), 'ring-blue-500 ring-2');
});

test('cn preserves independent mobile, desktop and dark-mode styles', () => {
    assert.equal(
        cn('h-11 w-full md:h-7 md:w-auto text-sm dark:text-gray-400', 'h-12 md:h-10 text-[0.8125rem] dark:text-gray-300'),
        'w-full md:w-auto h-12 md:h-10 text-[0.8125rem] dark:text-gray-300',
    );
    assert.equal(cn('text-sm text-stealth-muted', 'text-[11px] text-stealth-fg'), 'text-[11px] text-stealth-fg');
    assert.equal(cn('border border-stealth-border/50', 'border-stealth-border'), 'border border-stealth-border');
});

// Only replace provider selection. The connection module and its event are real;
// no wallet, RPC endpoint or browser connection is used by these tests.
let selected, connectToWallet, WALLET_ACCOUNTS_EVENT;
const select = (provider) => { selected = provider; };
const ACCOUNT = '0x1111111111111111111111111111111111111111';

function setup(t, provider, legacyProvider) {
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const events = [], errors = [];
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        web3: legacyProvider ? { currentProvider: legacyProvider } : undefined,
        dispatchEvent: (event) => { events.push(event.type); },
    } });
    select(provider);
    ({ connectToWallet, WALLET_ACCOUNTS_EVENT } = sourceLoader({
        '@/app/wizard/utils/selectedProvider': { getActiveProvider: () => selected },
    }, { window: globalThis.window })('src/utils/walletConnection.js'));
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    t.after(() => {
        select(undefined);
        if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
        else delete globalThis.window;
    });
    return { events, errors, setError: (error) => errors.push(error) };
}

test('connection cleanup preserves the selected provider, exact RPC and account event', async (t) => {
    const requests = [];
    const provider = { request: async (request) => { requests.push(request); return request.method === 'eth_chainId' ? '0x89' : [ACCOUNT]; } };
    const state = setup(t, provider, { request: () => assert.fail('must not switch providers') });
    assert.equal(await connectToWallet(state.setError), ACCOUNT);
    assert.deepEqual(requests, [{ method: 'eth_requestAccounts' }, { method: 'eth_chainId' }, { method: 'eth_chainId' }]);
    assert.equal(WALLET_ACCOUNTS_EVENT, 'wsr:accounts-changed');
    assert.deepEqual(state.events, [WALLET_ACCOUNTS_EVENT]);
    assert.deepEqual(state.errors, []);
});

test('connection cleanup preserves the legacy injected-provider fallback', async (t) => {
    const requests = [];
    const state = setup(t, null, { request: async (request) => { requests.push(request); return request.method === 'eth_chainId' ? '0x89' : [ACCOUNT]; } });
    assert.equal(await connectToWallet(state.setError), ACCOUNT);
    assert.deepEqual(requests, [{ method: 'eth_requestAccounts' }, { method: 'eth_chainId' }, { method: 'eth_chainId' }]);
    assert.deepEqual(state.events, [WALLET_ACCOUNTS_EVENT]);
});

test('missing providers and empty accounts never emit a connected event', async (t) => {
    const state = setup(t, null);
    assert.equal(await connectToWallet(state.setError), undefined);
    assert.deepEqual(state.errors, ['No Ethereum wallet found']);
    select({ request: async () => [] });
    assert.equal(await connectToWallet(state.setError), undefined);
    assert.deepEqual(state.events, []);
});

test('a rejected connection retains the existing error callback and does not emit an account event', async (t) => {
    const state = setup(t, { request: async () => { throw { code: 4001, message: 'User rejected' }; } });
    assert.equal(await connectToWallet(state.setError), undefined);
    assert.deepEqual(state.errors, ['User rejected']);
    assert.deepEqual(state.events, []);
});
