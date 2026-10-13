'use client';
import ConnectMetaMaskButton from '../WalletConnectButton/WalletConnectButton';
import WalletSelector from '../WalletSelector/WalletSelector';
import NavControls from '../controls/NavControls';
import NavStatusStrip from './NavStatusStrip';
import { usePlatform } from '@/app/wizard/context/PlatformContext';

function BrandMark() {
    return (
        <div aria-label="Coinspect" className="flex min-w-0 items-center gap-1">
            <img
                src="/coinspect-logo.svg"
                alt="Coinspect"
                width={1000}
                height={154}

                className="h-4 w-auto shrink-0 dark:hidden md:h-5"
            />
            <img
                src="/coinspect-logo-dark.svg"
                alt="Coinspect"
                width={1000}
                height={154}

                className="hidden h-4 w-auto shrink-0 dark:block md:h-5"
            />
        </div>
    );
}

/** Compact navigation used only by the standalone wizard and /params. */
export default function NavBar() {
    const platformCtx = usePlatform();
    const walletConnect = platformCtx?.platform === 'mobile';
    const platformReady = platformCtx ? platformCtx.ready : true;

    return (
        <nav aria-label="Wallet and campaign" className="fixed top-0 z-[1150] h-[100px] w-full border-b border-stealth-border bg-stealth-bg font-sans shadow-sm md:h-12 md:shadow-none">
            <div className="flex h-full flex-col px-4 text-stealth-fg md:flex-row md:items-center md:gap-2 md:px-2">
                <div className="flex h-12 shrink-0 items-center justify-between gap-2 md:contents">
                    <BrandMark />
                    <div className="flex min-w-0 items-center justify-end gap-1 md:order-3 md:gap-2">
                        {platformReady && !walletConnect && <WalletSelector />}
                        <ConnectMetaMaskButton wconnect={walletConnect} ready={platformReady} />
                    </div>
                </div>
                <div className="-mx-4 flex min-h-0 flex-1 items-center justify-between gap-2 border-t border-stealth-border/60 bg-stealth-panel/60 px-4 md:contents">
                    <div className="min-w-0 md:order-1 md:ml-auto">
                        <NavStatusStrip />
                    </div>
                    <div className="shrink-0 md:order-2">
                        <NavControls />
                    </div>
                </div>
            </div>
        </nav>
    );
}
