"use client";

import { useEffect } from "react";
import { useNavigate } from "react-router";
import LoadingState from "./components/LoadingState";
import {
    DEFAULT_PLATFORM,
    firstCampaignCheckBase,
    isPlatform,
} from "./utils/platform";

const STORAGE_KEY = "wizard.platform";

export default function WizardHomePage() {
    const navigate = useNavigate();

    useEffect(() => {
        let platform = DEFAULT_PLATFORM;
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (isPlatform(stored)) platform = stored;
        } catch {
            /* storage unavailable — keep the default */
        }

        const first = firstCampaignCheckBase(platform);
        if (first) navigate(`/wizard/${platform}/${first}`, { replace: true });
    }, [navigate]);

    return <LoadingState />;
}
