import { useLocation } from 'react-router';
import { usePlatform } from '../context/PlatformContext';
import { checkBaseFromPath, resolveCheckKey, resolveTransport, DEFAULT_PLATFORM } from '../utils/platform';
import wizardConfig from '../config/wizard';

export function transportForRoute(pathname, fallbackPlatform = DEFAULT_PLATFORM) {
    const platform = /^\/wizard\/(mobile|extension)(?:\/|$)/.exec(pathname)?.[1] ?? fallbackPlatform;
    const base = checkBaseFromPath(pathname);
    const key = base ? resolveCheckKey(base, platform) : null;
    const step = key ? wizardConfig.wizard.checks[key]?.steps?.[0] : null;
    return resolveTransport(platform, step);
}

export function useActiveTransport() {
    const { pathname } = useLocation();
    const platform = usePlatform()?.platform ?? DEFAULT_PLATFORM;
    return transportForRoute(pathname, platform);
}
