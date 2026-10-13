// Use a separate, read-only facade: a frozen provider cannot be the proxy target
// when request (or another protected method) needs a different function value.
export function providerRequestAdapter(provider, request, overrides = {}) {
    const bound = new WeakMap();
    const read = (key) => {
        if (key === 'request') return request;
        if (Object.hasOwn(overrides, key)) return overrides[key];
        const value = Reflect.get(provider, key, provider);
        if (typeof value !== 'function') return value;
        if (!bound.has(value)) bound.set(value, value.bind(provider));
        return bound.get(value);
    };
    return new Proxy(Object.create(null), {
        get: (_, key) => read(key),
        has: (_, key) => key === 'request' || Reflect.has(provider, key),
        ownKeys: () => [...new Set([...Reflect.ownKeys(provider), 'request'])],
        getOwnPropertyDescriptor(_, key) {
            const descriptor = Reflect.getOwnPropertyDescriptor(provider, key);
            if (!descriptor && key !== 'request') return undefined;
            return { configurable: true, enumerable: descriptor?.enumerable ?? true, get: () => read(key) };
        },
        set: () => false,
        defineProperty: () => false,
        deleteProperty: () => false,
        preventExtensions: () => false,
        setPrototypeOf: () => false,
    });
}
