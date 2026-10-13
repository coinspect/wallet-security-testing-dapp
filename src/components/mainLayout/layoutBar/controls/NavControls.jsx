'use client';

import { useTheme } from '../../../../app/wizard/context/ThemeContext';
import { usePlatform } from '../../../../app/wizard/context/PlatformContext';
import React from 'react';
import { Sun, Moon, ChevronDown, Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import PlatformModeSelector from './PlatformModeSelector';
import ResponsiveTools from '@/app/wizard/components/ResponsiveTools';

/** Desktop utility controls; mobile keeps the active campaign on the trigger. */
const NavControls = () => {
  const { isDarkMode, toggleTheme } = useTheme();
  const platformCtx = usePlatform();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const chipBase = cn(
    'flex min-h-11 items-center justify-center gap-2 rounded-md px-3 md:h-7 md:min-h-0 md:w-7 md:px-0',
    'bg-stealth-elevated/70 hover:bg-stealth-elevated',
    'border border-stealth-border/50 hover:border-stealth-border',
    'transition-all duration-150 ease-out'
  );

  return (
    <ResponsiveTools accessibleLabel="Campaign and appearance" label={<>
      {platformCtx?.platform === 'mobile' ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
      {platformCtx?.platform === 'mobile' ? 'Mobile' : 'Extension'}
      <ChevronDown className="h-3 w-3" />
    </>}>
      {(close) => <>
      <button
        type="button"
        onClick={() => { toggleTheme(); close(); }}
        data-testid="theme-toggle"
        data-mode={isDarkMode ? 'dark' : 'light'}
        className={chipBase}
        aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {/* `key` re-mounts the icon on every toggle so the `animate-pop`
            keyframe fires, giving the swap a subtle zoom-fade. */}
        {isDarkMode ? (
          <Sun
            key="sun"
            className="h-3.5 w-3.5 text-stealth-muted hover:text-stealth-fg animate-pop"
          />
        ) : (
          <Moon
            key="moon"
            className="h-3.5 w-3.5 text-stealth-muted hover:text-stealth-fg animate-pop"
          />
        )}
        <span className="text-sm md:hidden">{isDarkMode ? 'Light theme' : 'Dark theme'}</span>
      </button>

      {platformCtx && (
        <PlatformModeSelector
          platform={platformCtx.platform}
          setPlatform={(value) => { platformCtx.setPlatform(value); close(); }}
        />
      )}
      </>}
    </ResponsiveTools>
  );
};

export default NavControls;
