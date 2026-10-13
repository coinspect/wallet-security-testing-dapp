"use client";

import React from "react";
import ActionResult from "./ActionResult";
import PersistedEvidence from "./PersistedEvidence";
import { DEFAULT_PLATFORM } from "../utils/platform";

/**
 * Right-column RESULT + EVIDENCE. Flat — no surrounding card. Shows a quiet
 * placeholder before the wallet responds; otherwise renders <ActionResult>
 * (which owns the flattened result line + collapsible evidence JSON).
 */
const EvidencePanel = ({ error, success, step, onRetry, placeholder, extraRuntime, targetAddress, platform = DEFAULT_PLATFORM }) => {
    const hasOutcome = success != null || error != null;

    if (!hasOutcome) {
        return (
            <div className="space-y-2">
                <PersistedEvidence checkId={step?.canonicalId ?? step?.id} platform={platform} />
                <p className="text-[0.8125rem] text-gray-500 dark:text-gray-400">
                    {placeholder || "No new evidence in this view. Run the action to create another record."}
                </p>
            </div>
        );
    }

    return (
        <ActionResult
            error={error}
            success={success}
            step={step}
            onRetry={onRetry}
            extraRuntime={extraRuntime}
            targetAddress={targetAddress}
        />
    );
};

export default EvidencePanel;
