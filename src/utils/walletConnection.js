import { getActiveProvider } from '@/app/wizard/utils/selectedProvider';
import { ensurePolygon } from './wallet-methods/chain';

// Broadcast after an in-place connect so the wizard's SHARED account source (and
// any other mount-once eth_accounts reader) re-reads against the now-connected
// provider. This is the reactive replacement for the old window.location.reload()
// in connectToWallet — connecting updates state in place, nothing is dropped.
export const WALLET_ACCOUNTS_EVENT = 'wsr:accounts-changed';

export const connectToWallet = async (setAccountsError) => {
  try {
    // Connect the SELECTED provider (falls back to window.ethereum inside
    // getActiveProvider when nothing is picked), not a bare window.ethereum read.
    let provider = getActiveProvider();
    if (!provider) {
      if (window.web3 && typeof window.web3.currentProvider !== 'undefined') {
        provider = window.web3.currentProvider;
      } else {
        console.log('No Ethereum wallet found');
        setAccountsError('No Ethereum wallet found')
        return;
      }
    }

    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (accounts.length > 0) {
      await ensurePolygon(provider, { isCurrent: () => (getActiveProvider() ?? window.web3?.currentProvider) === provider });
      const userAccount = accounts[0];
      // Update state IN PLACE — never window.location.reload() (that dropped all
      // in-memory wizard state). Broadcast so the shared runtime re-reads the
      // now-connected provider.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(WALLET_ACCOUNTS_EVENT));
      }
      return userAccount;
    } else {
      console.log('No accounts found.');
    }

  } catch (error) {
    console.error('Error connecting to wallet:', error);
    setAccountsError(error?.message || 'Connect on Polygon to continue.');

  }
};
