export default function ResultExportActions({ onCopyEvidence, onCopyImage, imagePending = false, status }) {
    const linkStyle = "min-h-11 rounded-md border border-[var(--wsr-border)] px-3 py-2 text-sm text-[var(--wsr-fg-secondary)] disabled:opacity-50 md:min-h-0 md:rounded-none md:border-0 md:p-0 md:underline md:underline-offset-4";
    return <div data-capture-skip className="space-y-2">
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 md:flex md:flex-wrap md:gap-4">
            <button type="button" className={linkStyle} onClick={onCopyEvidence}>Copy evidence (JSON)</button>
            {onCopyImage && <button type="button" className={linkStyle} onClick={onCopyImage} disabled={imagePending}>
                {imagePending ? "Rendering…" : "Copy result as image"}
            </button>}
        </div>
        {status && <p role="status" className="text-xs">{status}</p>}
    </div>;
}
