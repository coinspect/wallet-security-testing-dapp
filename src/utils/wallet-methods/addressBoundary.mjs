export const isAddressShape = (value) =>
    typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim());

export const normalizedAddress = (value) =>
    isAddressShape(value) ? value.trim() : null;

export const resolveTargetAddress = ({ params = {}, catalog, fallback }) => {
    if (params.targetAddress != null && String(params.targetAddress).trim() !== "") {
        const direct = normalizedAddress(params.targetAddress);
        if (!direct) throw new Error("Invalid targetAddress: expected a 20-byte 0x address");
        return direct;
    }

    if (params.target != null && String(params.target).trim() !== "") {
        const key = String(params.target);
        if (!Object.hasOwn(catalog, key)) {
            throw new Error(`Unknown target catalog key: ${key}`);
        }
        const resolved = normalizedAddress(catalog[key]);
        if (!resolved) throw new Error(`Invalid address in target catalog: ${key}`);
        return resolved;
    }

    const safeFallback = normalizedAddress(fallback);
    if (!safeFallback) throw new Error("Invalid fallback target address");
    return safeFallback;
};

export const resolveAccountSource = ({ provided, connected, persisted }) => {
    if (provided != null && String(provided).trim() !== "") {
        const account = normalizedAddress(provided);
        if (!account) throw new Error("Invalid providedAddress: expected a 20-byte 0x address");
        return { account, accountSource: "provided" };
    }

    if (connected != null && String(connected).trim() !== "") {
        const account = normalizedAddress(connected);
        if (!account) throw new Error("Wallet returned an invalid account address");
        return { account, accountSource: "eth_accounts" };
    }

    const account = normalizedAddress(persisted);
    return account
        ? { account, accountSource: "persisted" }
        : { account: null, accountSource: null };
};

export const nonSelfTarget = (requested, connected, alternatives = []) => {
    const target = normalizedAddress(requested);
    const from = normalizedAddress(connected);
    if (!target) throw new Error("Invalid transaction target address");
    if (!from) throw new Error("Wallet returned an invalid account address");
    if (target.toLowerCase() !== from.toLowerCase()) return target;

    const alternate = alternatives
        .map(normalizedAddress)
        .find((candidate) => candidate && candidate.toLowerCase() !== from.toLowerCase());
    if (!alternate) throw new Error("No non-self tester address is available");
    return alternate;
};

