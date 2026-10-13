"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Download, Trash2, MoreHorizontal } from "lucide-react";
import ResponsiveTools from "./ResponsiveTools";
import {
    clearStoredWizardData,
    downloadCampaignEvidence,
    EVIDENCE_UPDATED_EVENT,
    loadCampaignEvidence,
} from "../utils/evidenceStorage.mjs";

const EvidenceExportButton = ({ platform }) => {
    const [count, setCount] = useState(0);
    const navigate = useNavigate();

    useEffect(() => {
        const refresh = () => setCount(loadCampaignEvidence(platform).length);
        refresh();
        window.addEventListener(EVIDENCE_UPDATED_EVENT, refresh);
        return () => window.removeEventListener(EVIDENCE_UPDATED_EVENT, refresh);
    }, [platform]);

    return (
        <div className="ml-auto">
            <ResponsiveTools accessibleLabel="Session actions" label={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}>
                {(close) => <>
            <button
                type="button"
                disabled={count === 0}
                onClick={() => { downloadCampaignEvidence(platform); close(); }}
                title="Download all evidence recorded in this browser tab"
                className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 md:min-h-0 md:gap-1 md:px-2 md:py-1 md:text-[0.75rem]"
            >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export evidence{count > 0 ? ` (${count})` : ""}
            </button>
            <button
                type="button"
                onClick={() => {
                    if (!window.confirm("Clear saved account, campaign progress and evidence from this browser? Export your evidence first if you want to keep it.")) return;
                    close();
                    clearStoredWizardData();
                    navigate("/wizard", { replace: true });
                }}
                title="Clear saved address, campaign progress, and evidence from this browser"
                className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded px-3 py-2 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-700 dark:text-gray-400 dark:hover:bg-red-950/40 dark:hover:text-red-300 md:min-h-0 md:gap-1 md:px-2 md:py-1 md:text-[0.75rem]"
            >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Clear session
            </button>
                </>}
            </ResponsiveTools>
        </div>
    );
};

export default EvidenceExportButton;
