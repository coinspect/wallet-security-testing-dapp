'use client';

import { ThemeProvider } from '@/app/wizard/context/ThemeContext';
import { WalletRuntimeProvider } from '@/app/wizard/context/WalletRuntimeContext';
import { AppKitProvider } from './AppKitProvider';

/**
 * Application providers persist across route changes. Wallet state lives here once;
 * campaign-specific Sentinel state is mounted inside the wizard layout.
 */
export default function AppProviders({ children }) {
  return (
    <AppKitProvider>
      <WalletRuntimeProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </WalletRuntimeProvider>
    </AppKitProvider>
  );
}
