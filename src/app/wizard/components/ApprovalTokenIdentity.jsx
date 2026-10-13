export default function ApprovalTokenIdentity({ token }) {
    if (!token) return null;
    return <dl className="space-y-1 py-1 text-xs text-[var(--wsr-fg-secondary)]" aria-label="Approval token">
        <div className="flex items-baseline gap-2">
            <dt className="shrink-0">Token</dt>
            <dd className="min-w-0 break-words font-medium">{token.name}</dd>
        </div>
        <div className="flex items-baseline gap-2">
            <dt className="shrink-0">Contract</dt>
            <dd className="min-w-0"><code className="select-all break-all">{token.address}</code></dd>
        </div>
    </dl>;
}
