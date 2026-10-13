'use client';

import { useNavigate } from 'react-router';
import { PlatformProvider } from './context/PlatformContext';
import { SentinelProvider } from '@/components/context/SentinelProvider';
import WizardErrorBoundary from './components/WizardErrorBoundary';
import WizardShell from './components/WizardShell';

export default function WizardLayout({ children }) {
    const navigate = useNavigate();
    return (
        <PlatformProvider>
            <SentinelProvider>
                <WizardShell>
                    <WizardErrorBoundary onReset={() => navigate('/wizard')}>
                        <div className="transition-colors duration-200">
                            <main className="mx-auto flex max-w-7xl flex-col pb-6 md:px-4 lg:px-6">
                                {children}
                            </main>
                        </div>
                    </WizardErrorBoundary>
                </WizardShell>
            </SentinelProvider>
        </PlatformProvider>
    );
}
