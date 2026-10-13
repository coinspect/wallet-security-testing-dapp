import { normalizeChainId } from "../../../utils/wallet-methods/chainId.mjs";
import { walletConnectProbeProvider } from "../../../utils/wallet-methods/wc/probeProvider.mjs";
import { snapshotError } from "../../../utils/wallet-methods/requestDiagnostics.mjs";
import { waitForWalletReply, REQUEST_WAIT_STOPPED } from "../../../utils/wallet-methods/requestWait.mjs";

const METHODS = ["eth_accounts", "wallet_getPermissions"];
const validAccounts = (value) => Array.isArray(value) && value.every(
    (account) => typeof account === "string" && /^0x[0-9a-fA-F]{40}$/.test(account),
);
const sessionOf = (provider) => provider?.session ?? provider?.signer?.session;
const sameAccounts = (a, b) => JSON.stringify(a.map((v) => v.toLowerCase()).sort()) ===
    JSON.stringify(b.map((v) => v.toLowerCase()).sort());

export const REVOCATION_MESSAGES = {
    session_ended: ["Original session ended", "WalletConnect reported that the original session was deleted. No new connection was opened. Keep the wallet screenshots with this observation."],
    access_removed: ["Account access removed", "The original provider returned no accounts and no account permission. Keep the wallet screenshots with this observation."],
    accounts_reported: ["Accounts still reported", "The original provider still returned accounts after the reported revocation."],
    cached_accounts: ["WalletConnect still lists accounts", "These accounts come from session data. They do not prove that the wallet accepted a new request. Review the permission response in the evidence."],
    permission_remains: ["Account permission still reported", "The provider still reports an eth_accounts permission after the reported revocation."],
    accounts_empty: ["No accounts returned", "An empty account list alone does not prove revocation. Review the permission response and session events in the evidence."],
    connection_changed: ["Connection changed — restart the check", "The selected wallet or WalletConnect session changed. This run cannot be compared with the original connection."],
    accounts_changed: ["Accounts changed — restart the check", "The provider returned accounts outside the initial connection. This run cannot establish whether the original access was revoked."],
    network_changed: ["Network changed — restart the check", "The network differs from the initial connection. This run cannot establish whether access was revoked."],
    session_unavailable: ["Could not verify the original session", "The original connection is unavailable, but its deletion was not observed. This is inconclusive."],
    inconclusive: ["Could not verify access", "The provider did not return a stable, valid account response. Errors and timeouts do not demonstrate revocation."],
};

// A run owns the ORIGINAL provider. The probe never opens AppKit, requests
// accounts, changes chains, or sends signing/transaction requests.
export function createRevocationProbe({ provider, transport, identity = null, timeoutMs = 5000 }) {
    const requestProvider = transport === "walletconnect" ? walletConnectProbeProvider(provider) : provider;
    let baseline = null;
    let deleted = null;
    let topic = null;
    let disposed = false;
    const events = [];
    const listeners = [];
    const observations = [];

    const read = async (method, signal) => {
        if (signal?.aborted || disposed) throw REQUEST_WAIT_STOPPED;
        const started = Date.now();
        const requestBoundary = transport === "walletconnect"
            ? method === "wallet_getPermissions" ? "walletconnect_sign_client" : "walletconnect_session_provider"
            : "injected_provider";
        let submitted = false;
        let timer;
        const row = { method, outcome: 'pending', data_returned: null, request_boundary: requestBoundary, request_submitted: false };
        observations.push(row);
        try {
            const value = await waitForWalletReply(() => Promise.race([
                Promise.resolve().then(() => {
                    if (signal?.aborted || disposed) throw REQUEST_WAIT_STOPPED;
                    if (baseline && transport === "walletconnect" && sessionOf(provider)?.topic !== topic) {
                        throw new Error("The original WalletConnect session is no longer available.");
                    }
                    submitted = true;
                    row.request_submitted = true;
                    return requestProvider.request({ method });
                }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(Object.assign(new Error("No response"), { timedOut: true })), timeoutMs);
                }),
            ]), signal);
            return Object.assign(row, { outcome: "resolved", data_returned: value, elapsed_ms: Date.now() - started,
                request_submitted: submitted });
        } catch (error) {
            if (error === REQUEST_WAIT_STOPPED) { row.outcome = 'stopped_waiting'; throw error; }
            return Object.assign(row, {
                method, outcome: error?.timedOut ? "no_response" : "error",
                data_returned: null, message: String(error?.message ?? error),
                ...(error?.code != null ? { code: error.code } : {}),
                rpc_error: snapshotError(error), request_boundary: requestBoundary,
                request_submitted: submitted && !error?.requestNotSent,
                elapsed_ms: Date.now() - started,
            });
        } finally {
            clearTimeout(timer);
        }
    };

    const listen = (name, handler) => {
        if (!provider?.on) return;
        provider.on(name, handler);
        listeners.push([name, handler]);
    };
    listen("session_delete", (payload) => {
        if (!baseline || !topic || payload?.topic !== topic) return;
        deleted = { event: "session_delete", observed_at: new Date().toISOString(), original_session: true };
        events.push(deleted);
    });
    listen("disconnect", (error) => {
        if (!baseline) return;
        // A transport disconnect alone is not proof of revoked access.
        events.push({ event: "disconnect", code: error?.code ?? null, observed_at: new Date().toISOString() });
    });

    return {
        snapshot: () => ({ wallet_output: structuredClone(observations), session_events: structuredClone(events) }),
        async captureBaseline({ signal } = {}) {
            if (disposed || !provider?.request) throw new Error("Connect the test wallet first.");
            const [accounts, chain] = await Promise.all([read("eth_accounts", signal), read("eth_chainId", signal)]);
            if (signal?.aborted || disposed) throw REQUEST_WAIT_STOPPED;
            const chainId = chain.outcome === "resolved" ? normalizeChainId(chain.data_returned) : null;
            if (accounts.outcome !== "resolved" || !validAccounts(accounts.data_returned) || !accounts.data_returned.length || !chainId) {
                throw new Error("The initial connection could not be confirmed. Connect this dApp and try again.");
            }
            topic = sessionOf(provider)?.topic ?? null;
            if (transport === "walletconnect" && !topic) throw new Error("No active WalletConnect session. Connect this dApp first.");
            baseline = {
                accounts: [...accounts.data_returned], chain_id: chainId, transport,
                provider: identity, recorded_at: new Date().toISOString(),
                account_source: transport === "walletconnect" ? "walletconnect_session" : "eth_accounts",
            };
            return baseline;
        },
        async check(currentProvider, { signal } = {}) {
            if (disposed || !baseline) throw new Error("Establish the initial connection before checking revocation.");
            const liveProvider = () => typeof currentProvider === "function" ? currentProvider() : currentProvider;
            const connectionChanged = () => (liveProvider() && liveProvider() !== provider) ||
                (transport === "walletconnect" && sessionOf(provider)?.topic && sessionOf(provider).topic !== topic);
            const result = (observation, rows = []) => ({
                observation, baseline, wallet_output: rows, session_events: [...events],
                methods: METHODS, automatic_verdict: null,
            });
            const session = sessionOf(provider);
            // Detect re-pairing even when the SDK reuses the same provider object.
            if (connectionChanged()) {
                return result("connection_changed");
            }
            if (transport === "walletconnect" && deleted) {
                return result("session_ended", METHODS.map((method) => ({ method, outcome: "not_sent_session_ended", data_returned: null })));
            }
            if (!liveProvider() || (transport === "walletconnect" && !session)) return result("session_unavailable");
            const chain = await read("eth_chainId", signal);
            if (chain.outcome !== "resolved") return result("inconclusive", [chain]);
            if (normalizeChainId(chain.data_returned) !== baseline.chain_id) return result("network_changed", [chain]);
            const first = await read("eth_accounts", signal);
            const second = await read("eth_accounts", signal);
            const accounts = { ...second, samples: [first, second], source: baseline.account_source };
            const permissions = await read("wallet_getPermissions", signal);
            const rows = [accounts, permissions];
            if (connectionChanged()) return result("connection_changed", rows);
            if (transport === "walletconnect" && deleted) return result("session_ended", rows);
            if (!liveProvider()) return result("session_unavailable", rows);
            if (first.outcome !== "resolved" || second.outcome !== "resolved" ||
                !validAccounts(first.data_returned) || !validAccounts(second.data_returned) ||
                !sameAccounts(first.data_returned, second.data_returned)) return result("inconclusive", rows);
            if (accounts.data_returned.some((account) => !baseline.accounts.some((original) => original.toLowerCase() === account.toLowerCase()))) return result("accounts_changed", rows);
            if (transport === "walletconnect" && accounts.data_returned.length) return result("cached_accounts", rows);
            if (accounts.data_returned.length) return result("accounts_reported", rows);
            if (permissions.outcome !== "resolved" || !Array.isArray(permissions.data_returned) ||
                !permissions.data_returned.every((p) => p && typeof p.parentCapability === "string")) return result("accounts_empty", rows);
            if (permissions.data_returned.some((p) => p?.parentCapability === "eth_accounts")) return result("permission_remains", rows);
            return result(transport === "walletconnect" ? "accounts_empty" : "access_removed", rows);
        },
        dispose() {
            disposed = true;
            for (const [name, handler] of listeners) {
                if (provider.removeListener) provider.removeListener(name, handler);
                else provider.off?.(name, handler);
            }
        },
    };
}
