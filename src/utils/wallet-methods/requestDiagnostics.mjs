// Diagnostics stop at provider.request: invocation is not proof of relay
// delivery, a visible wallet prompt, approval, or broadcast. Never retry here.
const SENSITIVE = /private.?key|seed|mnemonic|secret|signature|session|pairing|symkey/i;

function snapshot(value, depth = 0, seen = new WeakSet()) {
    if (typeof value === "bigint") return String(value);
    if (typeof value === "string") return value.length > 20_000 ? `${value.slice(0, 20_000)}[truncated]` : value;
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object") return String(value);
    if (depth >= 8) return "[truncated]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const fields = value instanceof Error
        ? Object.fromEntries(["name", "message", "code", "data", "cause", "error"].filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))
        : value;
    const result = Array.isArray(fields)
        ? fields.slice(0, 100).map((item) => snapshot(item, depth + 1, seen))
        : Object.fromEntries(Object.entries(fields).slice(0, 100).filter(([key]) => key !== "stack").map(([key, item]) => [
            key, SENSITIVE.test(key) ? "[sensitive value omitted]" : snapshot(item, depth + 1, seen),
        ]));
    seen.delete(value);
    return result;
}

// Shared by evidence adapters too. Keep nested/non-enumerable error details
// JSON-safe without exposing stacks or secret-bearing properties.
export function snapshotError(error) {
    try {
        return snapshot({
            message: String(error?.message ?? error),
            ...Object.fromEntries(["name", "code", "data", "cause", "error", "requestNotSent", "networkPrecondition", "requiredChainId", "chainId"].filter((key) => error?.[key] !== undefined).map((key) => [key, error[key]])),
        });
    } catch { return { message: "Error details could not be serialized" }; }
}

export async function withRequestDiagnostics(provider, execute, payloadVariant) {
    const diagnostics = {
        boundary: "provider.request", transaction_request_invoked: false, calls: [],
        ...(payloadVariant ? { payload_variant: payloadVariant } : {}),
    };
    const request = async (args, stage) => {
        const call = { stage, method: args.method, status: "pending" };
        diagnostics.calls.push(call);
        if (args.method === "eth_sendTransaction") diagnostics.transaction_request_invoked = true;
        try {
            // Preserve both the original argument object and provider binding.
            const result = await provider.request(args);
            call.status = "fulfilled";
            return result;
        } catch (error) {
            if (error?.requestNotSent) {
                call.request_submitted = false;
                if (args.method === 'eth_sendTransaction') diagnostics.transaction_request_invoked = false;
            }
            call.status = "rejected";
            call.error = snapshotError(error);
            throw error;
        }
    };
    try {
        const result = await execute(request);
        return { ...result, request_diagnostics: diagnostics };
    } catch (error) {
        // Handlers can shorten/rebuild errors. The original RPC rejection is
        // already captured above; retain the handler outcome separately.
        const failure = new Error(error?.message ?? String(error));
        if (error?.code != null) failure.code = error.code;
        for (const key of ['requestNotSent', 'networkPrecondition', 'requiredChainId', 'chainId']) {
            if (error?.[key] !== undefined) failure[key] = error[key];
        }
        failure.request_diagnostics = diagnostics;
        throw failure;
    }
}
