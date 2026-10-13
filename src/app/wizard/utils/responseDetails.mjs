export function responseErrorMessages(row, fallback) {
    const source = row.late_settlement?.response_outcome ? row.late_settlement : row;
    const messages = [];
    const seen = new Set();
    const add = (message) => {
        if (typeof message === "string" && message.trim() && !messages.includes(message)) messages.push(message);
    };
    const visit = (value) => {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        add(value.cause?.message);
        for (const nested of Object.values(value)) visit(nested);
    };
    add(source.rpc_error?.message);
    visit(source.rpc_error);
    visit(source.cause && { cause: source.cause });
    if (!messages.length) add(fallback);
    return messages;
}

export function formatResponseDetails(value) {
    return JSON.stringify(value, (key, entry) => {
        if ((key === "requested_methods" || key === "approved_methods") && Array.isArray(entry)) {
            return `${entry.length} ${entry.length === 1 ? "method" : "methods"} (see full evidence JSON)`;
        }
        return entry;
    }, 2);
}
