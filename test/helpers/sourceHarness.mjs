import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));

// Load real application modules with narrowly scoped browser/transport doubles.
export function sourceLoader(overrides = {}, browser = {}) {
    const cache = new Map();
    const load = (file) => {
        const resolved = path.resolve(root, file);
        const filename = [resolved, ...[".js", ".jsx", ".mjs", ".json"].map((ext) => resolved + ext)].find(existsSync);
        if (!filename) throw new Error(`Missing test module: ${file}`);
        if (cache.has(filename)) return cache.get(filename);
        if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
        const exports = {};
        cache.set(filename, exports);
        const { code } = require("@swc/core").transformSync(readFileSync(filename, "utf8"), {
            filename, module: { type: "commonjs" },
            jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } },
        });
        const importModule = (id) => {
            if (Object.hasOwn(overrides, id)) return overrides[id];
            if (id.startsWith("@/")) return load(`src/${id.slice(2)}`);
            if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id));
            return require(id);
        };
        new Function("require", "exports", "window", "document", "navigator", "process", "__WSR_BUILD_PROVENANCE__", code)(importModule, exports, browser.window, browser.document, browser.navigator, browser.process ?? process, browser.buildProvenance);
        return exports;
    };
    return load;
}

export function reactHarness() {
    let cursor = 0;
    const hooks = [], effects = [];
    const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const memo = (fn, deps) => {
        const i = cursor++;
        if (!hooks[i] || !equal(hooks[i].deps, deps)) hooks[i] = { value: fn(), deps };
        return hooks[i].value;
    };
    return {
        react: {
            ...React,
            useState(initial) {
                const i = cursor++;
                if (!hooks[i]) hooks[i] = { value: typeof initial === "function" ? initial() : initial };
                return [hooks[i].value, (value) => { hooks[i].value = typeof value === "function" ? value(hooks[i].value) : value; }];
            },
            useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
            useMemo: memo,
            useCallback: (fn, deps) => memo(() => fn, deps),
            useEffect(fn, deps) {
                const i = cursor++;
                if (!hooks[i] || !equal(hooks[i].deps, deps)) {
                    const previous = hooks[i];
                    hooks[i] = { deps };
                    effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
                }
            },
        },
        render(Component, props) {
            cursor = 0;
            const result = Component(props);
            effects.splice(0).forEach((effect) => effect());
            return result;
        },
        unmount() { hooks.forEach((hook) => hook.cleanup?.()); },
    };
}

export const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
export const flush = () => new Promise((resolve) => setImmediate(resolve));
export function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
