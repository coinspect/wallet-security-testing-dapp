const installedRoots = new WeakSet();

export const SENTINEL_VERSION = '3.0.0';

export function markSentinelRoot(root) {
    if (!root || (typeof root !== 'object' && typeof root !== 'function')) return false;
    installedRoots.add(root);
    return true;
}

export function isAuthenticSentinelRoot(root) {
    return Boolean(
        root &&
        installedRoots.has(root) &&
        root.version === SENTINEL_VERSION &&
        root.actions &&
        Object.isFrozen(root.actions),
    );
}
