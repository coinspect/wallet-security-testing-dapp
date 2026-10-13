"use client";

import { useEffect, useState } from "react";
import { Copy, Database } from "lucide-react";
import {
    EVIDENCE_UPDATED_EVENT,
    loadCheckEvidence,
} from "../utils/evidenceStorage.mjs";

const PersistedEvidence = ({ checkId, platform }) => {
    const [records, setRecords] = useState([]);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const refresh = () => setRecords(loadCheckEvidence(checkId, platform));
        refresh();
        window.addEventListener(EVIDENCE_UPDATED_EVENT, refresh);
        return () => window.removeEventListener(EVIDENCE_UPDATED_EVENT, refresh);
    }, [checkId, platform]);

    if (records.length === 0) return null;
    const text = JSON.stringify(records.map((record) => record.evidence), null, 2);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access is optional; campaign export remains available.
        }
    };

    return (
        <details className="rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[0.8125rem] text-gray-600 dark:text-gray-300">
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                Recovered session evidence · {records.length} record{records.length === 1 ? "" : "s"}
            </summary>
            <div className="border-t border-[var(--wsr-border)] px-3 py-2">
                <button
                    type="button"
                    onClick={copy}
                    className="mb-2 inline-flex items-center gap-1 text-[0.75rem] font-medium text-gray-600 hover:underline dark:text-gray-300"
                >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    {copied ? "Copied" : "Copy recovered evidence"}
                </button>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.75rem] text-gray-700 dark:text-gray-300">
                    {text}
                </pre>
            </div>
        </details>
    );
};

export default PersistedEvidence;

