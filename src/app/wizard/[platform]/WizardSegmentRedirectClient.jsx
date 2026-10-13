"use client";

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import LoadingState from "../components/LoadingState";
import { isPlatform, firstCampaignCheckBase } from "../utils/platform";

/**
 * A bare /wizard/<platform> URL redirects to that campaign's first check.
 * The redirect runs client-side because static exports have no request-time
 * redirect runtime.
 */
export default function WizardSegmentRedirect() {
    const navigate = useNavigate();
    const { platform: seg } = useParams();

    useEffect(() => {
        const raw = decodeURIComponent(String(seg ?? ""));
        if (!isPlatform(raw)) return;
        const first = firstCampaignCheckBase(raw);
        if (first) navigate(`/wizard/${raw}/${first}`, { replace: true });
    }, [seg, navigate]);

    return <LoadingState />;
}
