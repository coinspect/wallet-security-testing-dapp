import { normalizeChainId } from "../chainId.mjs";
import { assertPolygon, POLYGON_CHAIN_ID } from '../polygonPolicy.mjs';
import { sessionPermissions } from './sessionPermissions.mjs';

const unavailable = (reason, message) => Object.assign(new Error(message), {
    authTransportReason: reason, requestNotSent: true,
});

// Privileged auth probes must never fall through UniversalProvider to HTTP RPC.
// Pin one session/chain for this attempt; declared permissions are evidence,
// never a dApp-side filter. SignClient must receive every selected method.
export function createAuthSessionRequest(provider, chainId, account, connectionAttempt = 1) {
    const universal = provider?.client ? provider : provider?.signer;
    const client = universal?.client;
    const initial = provider?.session ?? universal?.session;
    const topic = initial?.topic;
    const hex = normalizeChainId(chainId);
    const route = hex ? `eip155:${parseInt(hex, 16)}` : null;
    const metadata = initial?.peer?.metadata;
    const request = async (args) => {
        if (!topic || !client?.request || !client?.session?.get) throw unavailable("session_unavailable", "No active WalletConnect session");
        if ((provider.session ?? universal.session)?.topic !== topic) throw unavailable("session_changed", "WalletConnect session changed");
        let session;
        try { session = client.session.get(topic); }
        catch { throw unavailable("session_unavailable", "WalletConnect session ended"); }
        if (!session || session.topic !== topic || (session.expiry && session.expiry * 1000 <= Date.now())) {
            throw unavailable("session_unavailable", "WalletConnect session expired or ended");
        }
        const permissions = sessionPermissions(session, route);
        request.authContext = { ...request.authContext, session_permissions: permissions };
        if (hex !== POLYGON_CHAIN_ID) throw unavailable('polygon_required', 'Reconnect on Polygon before resuming.');
        try { await assertPolygon(provider); }
        catch (error) { throw Object.assign(error, { authTransportReason: 'polygon_required' }); }
        if ((provider.session ?? universal.session)?.topic !== topic) throw unavailable('session_changed', 'WalletConnect session changed');
        return client.request({ topic, chainId: route, request: args });
    };
    request.authContext = {
        connection_attempt: connectionAttempt,
        from: account,
        chain_id: hex,
        provider: { name: metadata?.name ?? "WalletConnect wallet", url: metadata?.url ?? null },
        request_boundary: "walletconnect_sign_client",
        session_permissions: sessionPermissions(initial, route),
    };
    return request;
}
