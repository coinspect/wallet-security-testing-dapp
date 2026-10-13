"use client";

import { useState } from "react";
import { persistEvidenceRecord } from "../utils/evidenceStorage.mjs";
import { BUILD_PROVENANCE } from "../utils/buildProvenance.mjs";

export default function SkipStepButton({ checkId, platform, stage, title, onSkip, disabled = false }) {
    const [skipped, setSkipped] = useState(false);
    return <div className="text-sm">
        <button type="button" disabled={disabled} className="min-h-11 underline underline-offset-4 disabled:opacity-50" onClick={() => {
            persistEvidenceRecord({ platform, checkId, step: `skipped:${stage}`, evidence: {
                check: checkId, step: `skipped:${stage}`, stage_title: title,
                provenance: BUILD_PROVENANCE, runtime: { platform },
                request_outcome: "skipped_by_tester", wallet_output: null, automatic_verdict: null,
                recorded_at: new Date().toISOString(),
            } });
            setSkipped(true); onSkip?.();
        }}>Skip step</button>
        {skipped && <p className="text-xs">Step skipped by tester. Existing responses are preserved.</p>}
    </div>;
}
