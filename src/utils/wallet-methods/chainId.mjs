export const normalizeChainId = (value) => {
    try {
        const numeric = typeof value === "number" ? BigInt(value) : BigInt(String(value));
        return numeric >= 0n ? `0x${numeric.toString(16)}` : null;
    } catch {
        return null;
    }
};
