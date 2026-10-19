'use client';

import NavBar from '@/components/mainLayout/layoutBar/navBar/NavBar';

/**
 * Shared shell for the two public wizard surfaces: the check flow and /params.
 * The archived testing console had a sidebar and a second layout state machine;
 * neither belongs in the standalone wizard.
 */
export default function WizardShell({ children }) {
    return (
        <div className="min-h-screen overflow-x-hidden bg-stealth-bg text-stealth-fg">
            <NavBar />
            <div
                className="min-h-screen px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[100px] md:px-8 md:pb-6 md:pt-12"
                data-sentinel="content"
            >
                {children}
            </div>
            <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-stealth-border px-4 py-5 text-xs text-stealth-muted">
                <a href="https://www.coinspect.com" className="inline-flex items-center gap-2" aria-label="By Coinspect">
                    <span>By</span>
                    <img src="/coinspect-logo.svg" alt="Coinspect" width={104} height={16} className="h-4 w-auto dark:hidden" />
                    <img src="/coinspect-logo-dark.svg" alt="Coinspect" width={104} height={16} className="hidden h-4 w-auto dark:block" />
                </a>
                <span>© 2026 Coinspect</span>
            </footer>
        </div>
    );
}
