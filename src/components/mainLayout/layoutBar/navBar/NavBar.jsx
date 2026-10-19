'use client';
import ConnectMetaMaskButton from '../WalletConnectButton/WalletConnectButton';
import WalletSelector from '../WalletSelector/WalletSelector';
import NavControls from '../controls/NavControls';
import NavStatusStrip from './NavStatusStrip';
import { usePlatform } from '@/app/wizard/context/PlatformContext';

function BrandMark() {
    return (
        <div aria-label="Wallet Security Ranking — Testing Tool" className="flex shrink-0 flex-col items-start gap-2">
            <img
                src="/brand/wsr-wordmark-horizontal.svg"
                alt="Wallet Security Ranking"
                width={1320}
                height={80}
                className="hidden h-auto w-[190px] dark:block sm:w-[260px] xl:w-[300px]"
            />
            <img src="/brand/wsr-wordmark-horizontal-light.svg" alt="Wallet Security Ranking" width={1320} height={80} className="h-auto w-[190px] dark:hidden sm:w-[260px] xl:w-[300px]" />
            <span className="whitespace-nowrap text-sm font-medium leading-none text-stealth-muted">Testing Tool</span>
        </div>
    );
}

/** Compact navigation used only by the standalone wizard and /params. */
export default function NavBar() {
    const platformCtx = usePlatform();
    const walletConnect = platformCtx?.platform === 'mobile';
    const platformReady = platformCtx ? platformCtx.ready : true;

    return (
        <nav aria-label="Wallet and campaign" className="fixed top-0 z-[1150] h-[132px] w-full border-b border-stealth-border bg-stealth-bg font-sans shadow-sm xl:h-20 xl:shadow-none">
            <div className="flex h-full flex-col px-4 text-stealth-fg xl:flex-row xl:items-center xl:gap-4 xl:px-6">
                <div className="flex h-20 shrink-0 items-center justify-between gap-2 xl:contents">
                    <BrandMark />
                    <div className="flex min-w-0 items-center justify-end gap-1 xl:order-3 xl:gap-2">
                        {platformReady && !walletConnect && <WalletSelector />}
                        <ConnectMetaMaskButton wconnect={walletConnect} ready={platformReady} />
                    </div>
                </div>
                <div className="-mx-4 flex min-h-0 flex-1 items-center justify-between gap-2 border-t border-stealth-border/60 bg-stealth-panel/60 px-4 xl:contents">
                    <div className="min-w-0 xl:order-1 xl:ml-auto">
                        <NavStatusStrip />
                    </div>
                    <div className="shrink-0 xl:order-2">
                        <NavControls />
                    </div>
                </div>
            </div>
        </nav>
    );
}
