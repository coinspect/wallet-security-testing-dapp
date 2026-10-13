export function namespacesForChain(namespaces, route) {
    return Object.entries(namespaces ?? {}).filter(([key, ns]) =>
        key === route || (key === 'eip155' && ((ns.chains ?? []).includes(route)
            || (ns.accounts ?? []).some((account) => account.startsWith(`${route}:`)))))
        .map(([, namespace]) => namespace);
}

const methodsOf = (namespaces) => [...new Set(namespaces.flatMap((ns) => ns.methods ?? []))];

export function sessionPermissions(session, route) {
    const proposalRecorded = session?.requiredNamespaces != null || session?.optionalNamespaces != null;
    return {
        chain_id: route,
        requested_methods: proposalRecorded ? methodsOf([
            ...namespacesForChain(session.requiredNamespaces, route),
            ...namespacesForChain(session.optionalNamespaces, route),
        ]) : null,
        approved_methods: methodsOf(namespacesForChain(session?.namespaces, route)),
    };
}
