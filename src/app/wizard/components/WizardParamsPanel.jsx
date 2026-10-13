'use client';

import React, { useState } from 'react';
import { Link } from "react-router";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { resolveCheckParams, isParamUsedByStep } from '../utils/resolveCheckParams';
import { actionToString } from '../utils/actionText';
import { testParams, PARAM_GROUPS, PARAM_GROUP_NOTES, resolveParamValue } from '@/utils/constants';

// A payload entry's `full` may be an object (EIP-712) or a long string.
const fullText = (full) =>
    typeof full === 'string' ? full : JSON.stringify(full, null, 2);
const shortHash = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/**
 * Read-only params inspector for the wizard. Two stacked sections:
 *
 *   a. CURRENT CHECK — run-context rows from `resolveCheckParams`
 *      (check, step, action, method, chain, dapp_version). Same source
 *      as ActionResult's evidence, so display and auto-doc never drift.
 *
 *   b. GLOBAL TEST PARAMS — every `constants.testParams` entry, GROUPED by
 *      `group` with the rows used by THIS check pulled to the top of each
 *      group. Payload rows show a summary + short hash with a reveal toggle
 *      for the full value. All data reads from the registry — nothing here is
 *      duplicated. A discreet link opens the full /params document.
 *
 * Every row has an icon-only copy button (1.5 s check feedback). The
 * copiedKey state is prefixed per section to keep the feedback local.
 */
const WizardParamsPanel = ({ stepConfig, walletUi = false }) => {
    const [copiedKey, setCopiedKey] = useState(null);

    const copy = async (text, key) => {
        try {
            await navigator.clipboard.writeText(String(text));
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 1500);
        } catch {
            /* clipboard unavailable — silent */
        }
    };

    const r = resolveCheckParams(stepConfig);
    // A check with no declared chain runs on whatever the wallet is on — show
    // a single clean label, not the "(current chain) · (current)" placeholders.
    const chainValue = r.chainKey ? `${r.chainName} · ${r.chainId}` : 'current chain';

    // Wallet-UI checks may still declare params (e.g. PHYS-002's suggested
    // credentials). Show those when present; otherwise fall back to the
    // "no dApp parameters" message.
    const walletUiMatched = walletUi
        ? testParams.filter((row) => isParamUsedByStep(row, stepConfig))
        : [];

    // Wallet-UI checks have no dApp action, so action/method/chain rows would
    // just read "(no action)" / "current chain" — omit them.
    const checkRows = walletUi
        ? [
            { name: 'check',        key: 'check',   value: r.checkId },
            { name: 'step',         key: 'step',    value: `${r.stepNumber}/${r.totalSteps}` },
            { name: 'dapp version', key: 'version', value: r.dappVersion },
        ]
        : [
            { name: 'check',        key: 'check',   value: r.checkId },
            { name: 'step',         key: 'step',    value: `${r.stepNumber}/${r.totalSteps}` },
            { name: 'action',       key: 'action',  value: actionToString(r.action) },
            { name: 'method',       key: 'method',  value: r.method },
            { name: 'chain',        key: 'chain',   value: chainValue },
            { name: 'dapp version', key: 'version', value: r.dappVersion },
        ];

    return (
        <section
            data-testid="wizard-params"
            className="flex flex-col gap-3"
        >
            {/* ────── SECTION A — CURRENT CHECK ────── */}
            <div className="rounded-md border border-stealth-border bg-stealth-surface p-3">
                <header className="mb-2 flex items-baseline justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-normal text-stealth-dim">
                        Current Check
                    </span>
                    <span className="font-mono text-[10px] text-stealth-dim">
                        {checkRows.length} rows · read-only
                    </span>
                </header>
                <div className='flex flex-col gap-1.5'>
                    {checkRows.map((row) => (
                        <div
                            key={row.key}
                            data-testid={`wizard-params-check-${row.key}`}
                            className='grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-2'
                        >
                            <label className='font-mono text-[10px] uppercase tracking-normal text-stealth-muted'>
                                {row.name}
                            </label>
                            <span className='font-mono text-[11px] text-stealth-fg break-all'>
                                {row.value}
                            </span>
                            <CopyBtn
                                onClick={() => copy(row.value, `check-${row.key}`)}
                                copied={copiedKey === `check-${row.key}`}
                                label={`Copy ${row.name}`}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* ────── SECTION B — GLOBAL TEST PARAMS (registry, grouped) ────── */}
            <div className="rounded-md border border-stealth-border bg-stealth-surface p-3">
                <header className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-normal text-stealth-dim">
                        Global Test Params
                    </span>
                    <div className="flex items-baseline gap-3">
                        <Link
                            to="/params"
                            target="_blank"
                            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-normal text-stealth-action hover:underline"
                        >
                            Full params page
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                        <span className="font-mono text-[10px] text-stealth-dim">
                            {walletUi
                                ? (walletUiMatched.length ? `${walletUiMatched.length} entries` : 'not applicable')
                                : `${testParams.length} entries`}
                        </span>
                    </div>
                </header>
                {walletUi && walletUiMatched.length === 0 ? (
                    <p className='font-mono text-[11px] leading-relaxed text-stealth-muted'>
                        Performed entirely in the wallet UI — no dApp parameters.
                    </p>
                ) : (
                <div className='flex flex-col gap-2.5'>
                    {PARAM_GROUPS.map((group) => {
                        // Wallet-UI checks show only their matched entries; dApp
                        // checks show the whole registry (used-first per group).
                        const source = walletUi ? walletUiMatched : testParams;
                        const rows = source.filter((row) => row.group === group);
                        if (rows.length === 0) return null;
                        const ordered = [
                            ...rows.filter((row) => isParamUsedByStep(row, stepConfig)),
                            ...rows.filter((row) => !isParamUsedByStep(row, stepConfig)),
                        ];
                        return (
                            <div key={group} className='flex flex-col gap-0.5'>
                                <div className='font-mono text-[9px] uppercase tracking-wider text-stealth-dim'>
                                    {group}
                                </div>
                                {PARAM_GROUP_NOTES[group] && (
                                    <div className='font-mono text-[9px] leading-relaxed text-stealth-muted'>
                                        {PARAM_GROUP_NOTES[group]}
                                    </div>
                                )}
                                {ordered.map((row) => (
                                    <ParamRow
                                        key={row.key}
                                        row={row}
                                        isUsed={isParamUsedByStep(row, stepConfig)}
                                        copy={copy}
                                        copiedKey={copiedKey}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
                )}
            </div>
        </section>
    );
};

const ParamRow = ({ row, isUsed, copy, copiedKey }) => {
    const [open, setOpen] = useState(false);
    const hasFull = row.full != null;
    return (
        <div
            data-testid={`wizard-params-global-${row.key}`}
            data-used={isUsed ? 'true' : 'false'}
            className={
                isUsed
                    ? 'rounded border border-stealth-action/40 bg-stealth-action/5 px-2 py-0.5'
                    : 'px-2 py-0.5'
            }
        >
            <div className='grid grid-cols-[190px_minmax(0,1fr)_auto_auto] items-start gap-2'>
                <label className='pt-px font-mono text-[10px] uppercase tracking-normal text-stealth-muted'>
                    {row.key}
                </label>
                <span className='font-mono text-[11px] text-stealth-fg break-all'>
                    {String(resolveParamValue(row))}
                    {row.note && <span className='text-stealth-muted'> · {row.note}</span>}
                    {(row.templateHash || row.hash) && (
                        <span className='text-stealth-dim'> · template keccak256 {shortHash(row.templateHash ?? row.hash)}</span>
                    )}
                    {hasFull && (
                        <button
                            type='button'
                            onClick={() => setOpen((o) => !o)}
                            aria-expanded={open}
                            className='ml-2 inline-flex items-center gap-0.5 align-middle text-[10px] uppercase tracking-wider text-stealth-action hover:underline'
                        >
                            {open ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
                            {open ? 'Hide' : 'Reveal'}
                        </button>
                    )}
                </span>
                {isUsed ? (
                    <span className='shrink-0 rounded border border-stealth-action/50 bg-stealth-action/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-stealth-action'>
                        used by this check
                    </span>
                ) : (
                    <span aria-hidden='true' />
                )}
                <CopyBtn
                    onClick={() => copy(row.templateHash ?? row.hash ?? resolveParamValue(row), `global-${row.key}`)}
                    copied={copiedKey === `global-${row.key}`}
                    label={`Copy ${row.key}`}
                />
            </div>
            {open && hasFull && (
                <div className='mt-1 flex items-start gap-2'>
                    <pre className='min-w-0 flex-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-stealth-bg/60 p-2 font-mono text-[10px] leading-4 text-stealth-fg'>
                        {fullText(row.full)}
                    </pre>
                    <CopyBtn
                        onClick={() => copy(fullText(row.full), `full-${row.key}`)}
                        copied={copiedKey === `full-${row.key}`}
                        label={`Copy full ${row.key}`}
                    />
                </div>
            )}
        </div>
    );
};

const CopyBtn = ({ onClick, copied, label }) => (
    <button
        type='button'
        onClick={onClick}
        aria-label={label}
        className='inline-flex items-center justify-center rounded p-1 text-stealth-muted hover:bg-stealth-elevated hover:text-stealth-fg transition-colors'
    >
        {copied
            ? <Check className='w-3 h-3 text-stealth-accent' aria-hidden='true' />
            : <Copy className='w-3 h-3' aria-hidden='true' />
        }
    </button>
);

export default WizardParamsPanel;
