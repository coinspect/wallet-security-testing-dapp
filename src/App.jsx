import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useParams, useLocation, Link } from 'react-router';
import AppProviders from './components/context/AppProviders';
import WizardLayout from './app/wizard/layout';
import WizardHomePage from './app/wizard/page';
import WizardSegmentRedirect from './app/wizard/[platform]/WizardSegmentRedirectClient';
import StepPage from './app/wizard/[platform]/[step]/StepPageClient';
import ParamsPage from './app/params/page';
import { canonicalCheckBase, isPlatform } from './app/wizard/utils/platform';

function NotFound() {
    return <div className="p-8"><h1>Page not found</h1><Link to="/wizard">Open wizard</Link></div>;
}

function CampaignRoute() {
    const { platform } = useParams();
    return isPlatform(platform) ? <Outlet /> : <NotFound />;
}

function CheckRoute() {
    const { platform, step } = useParams();
    const knownStep = canonicalCheckBase(step);
    return knownStep ? <StepPage key={`${platform}:${knownStep}`} /> : <NotFound />;
}

export default function App() {
    const { pathname } = useLocation();
    useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
    return (
        <AppProviders>
            <main className="min-h-screen overflow-x-hidden bg-stealth-bg">
                <Routes>
                    <Route path="/" element={<Navigate to="/wizard" replace />} />
                    <Route path="/params" element={<ParamsPage />} />
                    <Route path="/wizard" element={<WizardLayout><Outlet /></WizardLayout>}>
                        <Route index element={<WizardHomePage />} />
                        <Route path=":platform" element={<CampaignRoute />}>
                            <Route index element={<WizardSegmentRedirect />} />
                            <Route path=":step" element={<CheckRoute />} />
                        </Route>
                    </Route>
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </main>
        </AppProviders>
    );
}
