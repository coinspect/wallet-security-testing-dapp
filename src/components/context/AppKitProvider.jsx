'use client'

import { createAppKit } from '@reown/appkit/react'
import { Ethers5Adapter } from '@reown/appkit-adapter-ethers5'
import { polygon } from '@reown/appkit/networks'
import { useEffect, useState } from 'react'
import { WALLETCONNECT_METHODS } from '@/utils/wallet-methods/wc/requestedMethods.mjs'

const projectId = 'da57addf3995953ad952c96230792051'

// Keep the test URL unchanged: some checks assess how wallets surface its
// relationship with the actual origin. The icon is public even for local runs.
const metadata = {
    name: 'Wallet Testing',
    description: 'Wallet Testing Website',
    url: 'https://mywebsite.com',
    icons: ['https://www.coinspect.com/icon-512.png'],
}

let wcNetworkDown = false
const wcDownListeners = new Set()

function markWalletConnectDown(reason) {
    if (!wcNetworkDown) {
        wcNetworkDown = true
        wcDownListeners.forEach((listener) => {
            try {
                listener()
            } catch {
                // A status listener must not make initialization fail.
            }
        })
    }
    console.warn('[AppKit] WalletConnect initialization failed:', reason)
}

// Optional AppKit product and telemetry surfaces are not needed by the wizard.
try {
    createAppKit({
        adapters: [new Ethers5Adapter()],
        networks: [polygon],
        defaultNetwork: polygon,
        allowUnsupportedChain: false,
        universalProviderConfigOverride: {
            methods: { eip155: [...WALLETCONNECT_METHODS] },
        },
        metadata,
        projectId,
        enableCoinbase: false,
        features: {
            analytics: false,
            email: false,
            socials: false,
            onramp: false,
            swaps: false,
        },
    })
} catch (error) {
    markWalletConnectDown(error?.message || String(error))
}

export function AppKitProvider({ children }) {
    const [down, setDown] = useState(false)

    useEffect(() => {
        if (wcNetworkDown) setDown(true)
        const onDown = () => setDown(true)
        wcDownListeners.add(onDown)
        return () => wcDownListeners.delete(onDown)
    }, [])

    return (
        <>
            {down && (
                <div
                    role="status"
                    className="w-full border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-[0.8125rem] font-medium text-amber-700 dark:text-amber-300"
                >
                    WalletConnect couldn&apos;t initialize — check your connection and retry.
                </div>
            )}
            {children}
        </>
    )
}
