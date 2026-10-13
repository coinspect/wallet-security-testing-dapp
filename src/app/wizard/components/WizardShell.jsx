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
        </div>
    );
}
