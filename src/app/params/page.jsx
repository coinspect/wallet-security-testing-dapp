'use client';

import React from 'react';
import WizardShell from '@/app/wizard/components/WizardShell';
import { testParams, PARAM_GROUPS, PARAM_GROUP_NOTES } from '@/utils/constants';
import { isParamUsedByStep } from '@/app/wizard/utils/resolveCheckParams';
import wizardConfig from '@/app/wizard/config/wizard';
import checksSnapshot from '@/app/wizard/config/checks-snapshot.json';
import pkg from '../../../package.json';

// A single page listing all data used by all checks, so a
// ranking release can say "this data == dApp vX.Y.Z" at a glance. Reads
// EXCLUSIVELY from the testParams registry (values) + the wizard config (which
// checks reference each entry) + the snapshot provenance. Zero duplicated data.

const fullText = (full) =>
    typeof full === 'string' ? full : JSON.stringify(full, null, 2);

// Reverse map: registry entry → the check ids that reference it, via the SAME
// matcher the panel uses (action OR check id). Computed, never stored.
const checksUsingEntry = (entry) => {
    const ids = [];
    for (const [checkId, check] of Object.entries(wizardConfig.wizard.checks ?? {})) {
        const used = (check.steps ?? []).some((step) => isParamUsedByStep(entry, step));
        if (used) ids.push(checkId);
    }
    return ids;
};

const ParamsPage = () => {
    const prov = checksSnapshot._provenance ?? {};
    const checkCount = Object.keys(wizardConfig.wizard.checks ?? {}).length;

    const provRows = [
        ['checks.json', prov.source],
        ['ref', prov.ref],
        ['blobSha', prov.blobSha],
        ['fetchedAt', prov.fetchedAt],
    ];

    return (
        <WizardShell>
            <div className='wizard-surface mx-auto w-full max-w-5xl py-6 font-[var(--default-font)] text-stealth-fg md:px-4 md:py-8'>
                {/* ── Header: version + snapshot provenance ── */}
                <header className='border-b border-stealth-border pb-4'>
                    <div className='flex flex-wrap items-baseline justify-between gap-2 md:gap-4'>
                        <h1 className='text-[1.75rem] font-semibold leading-tight'>
                            dApp Parameter Set
                        </h1>
                        <span className='font-mono text-[1.5rem] font-semibold text-stealth-action'>
                            v{pkg.version}
                        </span>
                    </div>
                    <p className='mt-1 max-w-[80ch] text-[0.8125rem] text-stealth-muted'>
                        Every hardcoded parameter used across all {checkCount} wizard checks, in one
                        place — the artifact to attach to a ranking release. Generated live from the
                        <span className='font-mono'> testParams </span> registry.
                    </p>
                    <dl className='mt-3 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-[0.75rem] sm:grid-cols-2'>
                        {provRows.map(([label, value]) => (
                            <div key={label} className='min-w-0'>
                                <dt className='inline text-stealth-dim'>{label}: </dt>
                                <dd className='inline break-all text-stealth-muted'>
                                    {value ?? '—'}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </header>

                {/* ── Groups ── */}
                {PARAM_GROUPS.map((group) => {
                    const rows = testParams.filter((row) => row.group === group);
                    if (rows.length === 0) return null;
                    return (
                        <section key={group} className='mt-6'>
                            <h2 className='font-mono text-[0.8125rem] font-semibold uppercase tracking-wide text-stealth-dim'>
                                {group}
                                <span className='ml-2 font-normal text-stealth-muted'>· {rows.length}</span>
                            </h2>
                            {PARAM_GROUP_NOTES[group] && (
                                <p className='mt-0.5 text-[0.75rem] text-stealth-muted'>
                                    {PARAM_GROUP_NOTES[group]}
                                </p>
                            )}
                            <div className='mt-2 divide-y divide-stealth-border/60 border-y border-stealth-border/60'>
                                {rows.map((row) => {
                                    const checks = checksUsingEntry(row);
                                    return (
                                        <div
                                            key={row.key}
                                            data-testid={`params-page-${row.key}`}
                                            className='grid grid-cols-1 gap-x-4 gap-y-1 py-2 sm:grid-cols-[220px_minmax(0,1fr)]'
                                        >
                                            <div>
                                                <div className='text-[0.8125rem] font-medium text-stealth-fg'>
                                                    {row.label}
                                                </div>
                                                <div className='font-mono text-[0.6875rem] uppercase tracking-normal text-stealth-muted'>
                                                    {row.key}
                                                </div>
                                            </div>
                                            <div className='min-w-0'>
                                                <div className='font-mono text-[0.8125rem] break-all text-stealth-fg'>
                                                    {String(row.value)}
                                                    {row.note && (
                                                        <span className='text-stealth-muted'> · {row.note}</span>
                                                    )}
                                                </div>
                                                {(row.templateHash || row.hash) && (
                                                    <div className='font-mono text-[0.6875rem] break-all text-stealth-dim'>
                                                        template keccak256 {row.templateHash ?? row.hash}
                                                    </div>
                                                )}
                                                {row.full != null && (
                                                    <details className='mt-1'>
                                                        <summary className='cursor-pointer font-mono text-[0.6875rem] uppercase tracking-wider text-stealth-action'>
                                                            full payload
                                                        </summary>
                                                        <pre className='mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-stealth-bg/60 p-2 font-mono text-[0.6875rem] leading-4 text-stealth-fg'>
                                                            {fullText(row.full)}
                                                        </pre>
                                                    </details>
                                                )}
                                                <div className='mt-1 flex flex-wrap items-center gap-1'>
                                                    <span className='font-mono text-[0.625rem] uppercase tracking-wider text-stealth-dim'>
                                                        used by
                                                    </span>
                                                    {checks.length ? (
                                                        checks.map((c) => (
                                                            <span
                                                                key={c}
                                                                className='rounded border border-stealth-border px-1.5 py-0.5 font-mono text-[0.625rem] text-stealth-muted'
                                                            >
                                                                {c}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className='font-mono text-[0.625rem] text-stealth-dim'>
                                                            (no check)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}

                <footer className='mt-8 border-t border-stealth-border pt-3 font-mono text-[0.6875rem] text-stealth-dim'>
                    {testParams.length} parameters · dApp v{pkg.version} · checks.json {prov.ref}@{String(prov.blobSha).slice(0, 7)}
                </footer>
            </div>
        </WizardShell>
    );
};

export default ParamsPage;
