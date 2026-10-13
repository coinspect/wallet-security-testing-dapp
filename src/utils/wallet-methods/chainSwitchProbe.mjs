import { normalizeChainId } from "./chainId.mjs";
import { REQUEST_WAIT_STOPPED, waitForWalletReply } from "./requestWait.mjs";
import { POLYGON_CHAIN_ID } from './polygonPolicy.mjs';
import { sessionPermissions } from './wc/sessionPermissions.mjs';

const METHOD = "wallet_switchEthereumChain";

// Keep RPC fields, including nested vendor errors, without Error's JSON {} trap.
function errorSnapshot(value, seen = new WeakSet()) {
    if (typeof value === "bigint") return String(value);
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const fields = value instanceof Error
        ? Object.fromEntries([...new Set([...Object.getOwnPropertyNames(value), "name", "message"])].map((key) => [key, value[key]]))
        : value;
    const entries = Object.entries(fields).filter(([key]) => key !== "stack");
    const result = Array.isArray(value) ? entries.map(([, item]) => errorSnapshot(item, seen))
        : Object.fromEntries(entries.map(([key, item]) => [key, errorSnapshot(item, seen)]));
    seen.delete(value);
    return result;
}

function errorDetails(error, seen = new Set()) {
    const own = { code: error?.code, message: String(error?.message ?? error) };
    if (seen.has(error)) return own;
    seen.add(error);
    const nested = error?.data?.originalError ?? error?.error ?? error?.cause;
    if (!nested || typeof nested !== "object") return own;
    const inner = errorDetails(nested, seen);
    return { code: inner.code ?? own.code, message: inner.message };
}

function errorStatus(error) {
    const { code, message } = errorDetails(error);
    const numericCode = Number(code);
    const cancellationCode = code == null || [4001, 5000, -2].includes(numericCode);
    if (numericCode === 4001 || (cancellationCode && (/user (denied|rejected|disapproved)/i.test(message)
        || /^(?:returned error:\s*)?(?:cancelled|canceled|user cancelled|user canceled|cancelled by user|canceled by user)[.!]?$/i.test(message.trim())))) return "switch_cancelled";
    if (numericCode === 4902 || /unrecognized chain|not (been )?added|add .*chain first/i.test(message)) return "chain_not_added";
    if ([4200, -32601].includes(numericCode)
        || /^(?:returned error:\s*)?(?:not support|not supported|unsupported)[.!]?$/i.test(message.trim())
        || /(?:method|wallet_switchEthereumChain).*(?:not supported|unsupported|not available|disabled|does not exist)/i.test(message)) return "switch_not_supported";
    return "switch_error";
}

async function readChain(provider, source, timeoutMs) {
    let timer;
    try {
        const response = await Promise.race([
            Promise.resolve().then(() => provider.request({ method: "eth_chainId" })),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Chain read timed out")), timeoutMs); }),
        ]);
        const chainId = normalizeChainId(response);
        if (!chainId || chainId === "0x0") throw new Error("Invalid chain ID returned by provider");
        return { chain_id: chainId, source };
    } catch (error) {
        return { chain_id: null, source, error: errorSnapshot(error) };
    } finally { clearTimeout(timer); }
}

// PERM-009 only. Never use UniversalProvider.request for the switch: it can
// change an approved chain locally without ever contacting the wallet.
export async function requestChainSwitch({ provider, chainId, chainName, transport, readTimeoutMs = 2000, signal }) {
    const mobile = transport === "walletconnect";
    const request = { method: METHOD, params: [{ chainId }] };
    const result = {
        at: "chain_switch", chainId, chainName, request,
        request_path: mobile ? "walletconnect_sign_client" : "injected_provider",
        request_submitted: false,
    };
    const notSent = (reason) => ({ ...result, status: "switch_not_sent", reason });
    const stopped = (stage) => ({ ...result, status: result.status ?? "switch_stopped_waiting", wait_stopped: { source: "tester", stage } });
    if (signal?.aborted) return stopped("preparation");
    if (!provider?.request) return notSent("provider_unavailable");
    let send;
    let session;
    let client;
    if (mobile) {
        const universal = provider.client ? provider : provider.signer;
        client = universal?.client;
        session = provider.session ?? universal?.session;
        if (!session?.topic) return notSent("session_unavailable");
        if (!client?.request || !client?.session?.get) return notSent("session_client_unavailable");
        try { session = client.session.get(session.topic); }
        catch (error) { return { ...notSent("session_unavailable"), error: errorSnapshot(error) }; }
        if (!session?.topic || (session.expiry && session.expiry * 1000 <= Date.now())) return notSent("session_unavailable");
    }
    const source = mobile ? "walletconnect_session_provider" : "injected_wallet_provider";
    try {
        result.chain_before = await waitForWalletReply(() => readChain(provider, source, readTimeoutMs), signal);
    } catch (error) {
        if (error === REQUEST_WAIT_STOPPED) return stopped("chain_before");
        throw error;
    }
    if (!result.chain_before.chain_id) return notSent("chain_read_failed");
    if (result.chain_before.chain_id !== POLYGON_CHAIN_ID) return notSent("polygon_required");
    if (result.chain_before.chain_id === normalizeChainId(chainId)) return { ...result, status: "switch_already_selected" };
    if (mobile) {
        const live = provider.session ?? provider.signer?.session;
        if (live?.topic !== session.topic) return notSent("session_changed");
        // Keep the same live connection after the asynchronous chain read.
        try { session = client.session.get(session.topic); }
        catch (error) { return { ...notSent("session_unavailable"), error: errorSnapshot(error) }; }
        if (!session?.topic || (session.expiry && session.expiry * 1000 <= Date.now())) return notSent("session_unavailable");
        const currentRoute = `eip155:${BigInt(result.chain_before.chain_id)}`;
        result.routing_chain = currentRoute;
        result.session_permissions = sessionPermissions(session, currentRoute);
        send = () => client.request({ topic: session.topic, chainId: result.routing_chain, request });
    } else send = () => provider.request(request);
    try {
        // Submitted to the transport, not proof of wallet receipt or a prompt.
        result.response = await waitForWalletReply(() => {
            result.request_submitted = true;
            return send();
        }, signal);
        result.status = "switch_response";
    } catch (error) {
        if (error === REQUEST_WAIT_STOPPED) return stopped("switch_request");
        result.status = errorStatus(error);
        result.error = errorSnapshot(error);
        const { code } = errorDetails(error);
        if (code != null) result.code = code;
    }
    try {
        result.chain_after = await waitForWalletReply(() => readChain(provider, source, readTimeoutMs), signal);
    } catch (error) {
        if (error === REQUEST_WAIT_STOPPED) return stopped("chain_after");
        throw error;
    }
    return result;
}
