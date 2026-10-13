// Replaces AppKit's method list, so retain its EVM methods as well as our probes.
export const WALLETCONNECT_METHODS = Object.freeze([
    'eth_accounts', 'eth_requestAccounts', 'eth_sendRawTransaction',
    'eth_sign', 'eth_signTransaction', 'eth_signTypedData',
    'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_sendTransaction',
    'personal_sign', 'wallet_switchEthereumChain', 'wallet_addEthereumChain',
    'wallet_getPermissions', 'wallet_requestPermissions', 'wallet_registerOnboarding',
    'wallet_watchAsset', 'wallet_scanQRCode', 'wallet_getCallsStatus',
    'wallet_showCallsStatus', 'wallet_sendCalls', 'wallet_getCapabilities',
    'wallet_grantPermissions', 'wallet_revokePermissions', 'wallet_getAssets',
    'eth_decrypt', 'eth_getEncryptionPublicKey',
]);
