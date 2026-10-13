export function safeDecodeRouteSegment(value) {
    if (typeof value !== "string") return null;
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

export function cloneReadonly(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);

    const clone = Array.isArray(value) ? [] : {};
    seen.set(value, clone);
    for (const [key, child] of Object.entries(value)) {
        clone[key] = cloneReadonly(child, seen);
    }
    return Object.freeze(clone);
}

export function summarizeImages(images) {
    if (!Array.isArray(images)) return [];
    return images.map((image) => ({
        annotation: typeof image?.annotation === "string" ? image.annotation.slice(0, 500) : "",
        bytes: typeof image?.data === "string" ? image.data.length : 0,
    }));
}

export function sanitizeWizardEventData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data ?? {};
    if (!("images" in data)) return { ...data };
    return { ...data, images: summarizeImages(data.images) };
}
