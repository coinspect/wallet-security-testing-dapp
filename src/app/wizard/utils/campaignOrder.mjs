// Stable family partition for the progress navigator. Wallet-only checks use
// the celeste visual language and stay together before dApp-driven checks.
export const walletChecksFirst = (checks) =>
    [...checks].sort((a, b) => Number(b.walletOnly) - Number(a.walletOnly));
