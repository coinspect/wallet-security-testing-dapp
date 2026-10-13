'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Copy, Image as ImageIcon, Info } from 'lucide-react';
import { resolveCheckParams } from '../utils/resolveCheckParams';
import { panelToPngBlob } from '../utils/panelToImage';
import { useWalletRuntime } from '../context/WalletRuntimeContext';
import { usePlatform } from '../context/PlatformContext';
import { DEFAULT_PLATFORM, resolveTransport } from '../utils/platform';
import { getProviderIdentity } from '../utils/providerIdentity';
import { persistEvidenceRecord } from '../utils/evidenceStorage.mjs';
import { BUILD_PROVENANCE } from '../utils/buildProvenance.mjs';
import { AUTH_BYPASS_LATE_EVENT } from '@/utils/wallet-methods/authBypassBatch';
import GuidedRequestResult from './GuidedRequestResult';
import ResultExportActions from './ResultExportActions';

/**
 * Inline result renderer for a wizard step's action outcome. NEUTRAL and
 * informational — the wizard DOCUMENTS, it does not judge (no pass/fail, no
 * success-green). Renders as ONE bordered container (no box-in-box):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ [part tabs]                      Copy value  │  ← header row
 *   ├─────────────────────────────────────────────┤
 *   │ ⓘ  <result line>                             │
 *   │ Show evidence                                │  ← toggle
 *   │ <pre>{ …JSON… }</pre> (borderless, on expand) │
 *   └─────────────────────────────────────────────┘
 *
 * `tabs` (optional JSX) fills the header's left side for multi-part checks.
 * Evidence JSON shape:
 *   { check, step, dapp_version, parameters, wallet_output, [failed_method] }
 */
const isTxHash = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
const shortHash = (h) => `${h.slice(0, 10)}…${h.slice(-8)}`;
// A runAuthBypass result — an array of { method, outcome, data_returned,
// elapsed_ms } records. Shape-checked so a requestConnection permissions/accounts
// array (the connect checks + PERM-004 part 1) is NOT mistaken for one.
const isAuthBypassResult = (v) =>
    Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && 'elapsed_ms' in r);

// ── Per-row facts for the auth-bypass OUTCOME cell ───────────────────────────
// All THREE facts are DERIVED at render time from fields the batch already
// records (outcome, code, elapsed_ms, payload_note) — nothing is persisted or
// inferred beyond what those fields support. The wizard states facts; the reviewer
// draws the conclusion (no "bypass"/pass/fail wording, no verdict colour).
const AUTO_INTERACTION_MS = 100;

// A short token that keeps the raw outcome legible on the data line.
const OUTCOME_TOKEN = {
    resolved: 'resolved',
    declined: 'declined',
    empty: 'empty',
    rejected: 'rejected',
    no_response: 'no response',
    unstable: 'unstable',
    session_dropped: 'session dropped',
};
const outcomeToken = (outcome) => {
    if (typeof outcome !== 'string') return null;
    if (outcome.startsWith('error')) return outcome.split(':')[0].trim(); // "error" | "error (internal)"
    return OUTCOME_TOKEN[outcome] ?? outcome;
};

// FACT 2 — could a person have acted? Derived ONLY from elapsed. Under 100 ms is
// too fast for any human interaction (the same threshold that flags auto-rejects);
// at/above it a person MAY have acted, which the wizard cannot confirm (it can't
// see the wallet's UI) — so it says "may", never asserting a confirmation happened.
const interactionFact = (r) =>
    typeof r.elapsed_ms !== 'number'
        ? 'Response time not recorded'
        : r.elapsed_ms < AUTO_INTERACTION_MS
            ? 'Too fast for a person to act'
            : 'Slow enough a person may have acted';

// Codes that fail BEFORE the wallet's authorization decision: the request never
// got to the point where the wallet chooses to serve or prompt.
const GATE_NOT_REACHED_CODES = {
    '4200': 'the method is unsupported',
    '-32601': 'the method was not found',
    '-32602': 'the request was rejected on its parameters',
    '-32600': 'the request was rejected on its format',
};
// FACT 3 — did the request reach the wallet's authorization decision? Returns
// { state: 'yes' | 'no' | 'unknown', why }. A payload- or method-level rejection
// (placeholder, unsupported, schema) never reached it; a served/refused answer or
// a definitive auth code (4100 unauthorized) did; anything else is genuinely
// unknown (no answer, dropped session, internal error).
const authorizationFact = (r) => {
    if (r.payload_note) return { state: 'no', why: null }; // payload_note explains why
    const key = r.code == null ? null : String(r.code);
    if (key && GATE_NOT_REACHED_CODES[key]) return { state: 'no', why: GATE_NOT_REACHED_CODES[key] };
    if (
        r.outcome === 'resolved' || r.outcome === 'declined' ||
        r.outcome === 'empty' || r.outcome === 'rejected' || r.outcome === 'cancelled_by_tester' || r.code === 4100
    ) {
        return { state: 'yes', why: null };
    }
    return { state: 'unknown', why: null };
};
const AUTH_LINE = {
    yes: 'Reached the wallet’s authorization decision',
    no: 'Did not reach the wallet’s authorization decision',
    unknown: 'Whether it reached the wallet’s authorization decision is unknown',
};

// A column header carrying its own explanation — shown on hover AND keyboard
// focus (the trigger is focusable), so the results table needs no paragraph.
const HeaderTip = ({ id, label, tip, align = 'left' }) => (
    <span
        tabIndex={0}
        aria-describedby={id}
        className='group relative inline-flex cursor-help items-center gap-1 outline-none focus-visible:underline'
    >
        {label}
        <Info className='h-3 w-3 opacity-60' aria-hidden='true' />
        <span
            id={id}
            role='tooltip'
            className={`pointer-events-none absolute top-full z-20 mt-1 hidden w-56 rounded-md border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-gray-600 shadow-lg group-hover:block group-focus:block dark:text-gray-300 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
            {tip}
        </span>
    </span>
);


const ActionResult = ({ error, errorDetails, success, step, onRetry, tabs, extraRuntime, targetAddress, guided = false, contextChanged = false }) => {
    const [copiedKey, setCopiedKey] = useState(null);
    const [showEvidence, setShowEvidence] = useState(false);
    // "Copy as image" state: idle | working | copied | downloaded | error.
    const [imgState, setImgState] = useState('idle');
    const panelRef = useRef(null);
    // Auth-bypass rows: which are expanded to their full-text detail row. The
    // table cells truncate to one line; the row toggles the untruncated view.
    const [openRows, setOpenRows] = useState(() => new Set());
    const [, setLateSettlementVersion] = useState(0);
    const toggleRow = (i) =>
        setOpenRows((prev) => {
            const next = new Set(prev);
            next.has(i) ? next.delete(i) : next.add(i);
            return next;
        });
    // The `from` of every request — a RUNTIME fact no dApp version can freeze,
    // so it belongs in this run's evidence. Read from the same eth_accounts[0]
    // the handlers send with.
    // Active campaign/transport used for THIS run (extension | mobile).
    const platform = usePlatform()?.platform ?? DEFAULT_PLATFORM;
    const transport = resolveTransport(platform, step);
    const { address: account } = useWalletRuntime(transport);

    useEffect(() => {
        if (!isAuthBypassResult(success) || typeof window === 'undefined') return undefined;
        const refresh = () => setLateSettlementVersion((version) => version + 1);
        window.addEventListener(AUTH_BYPASS_LATE_EVENT, refresh);
        return () => window.removeEventListener(AUTH_BYPASS_LATE_EVENT, refresh);
    }, [success]);

    const copy = async (text, key) => {
        try {
            await navigator.clipboard.writeText(String(text));
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 2000);
        } catch {
            /* clipboard unavailable — silent */
        }
    };

    // Capture the evidence panel to a PNG. Prefer the clipboard; if the image
    // clipboard write is unavailable or denied, fall back to a download — never
    // silently do nothing. Reports state so the header can show a neutral note.
    const copyAsImage = async () => {
        setImgState('working');
        let blob;
        try {
            blob = await panelToPngBlob(panelRef.current, { scale: 2 });
            if (!blob) throw new Error('empty');
        } catch {
            setImgState('error'); // this browser couldn't rasterize the panel
            return;
        }
        if (navigator.clipboard?.write && typeof window.ClipboardItem === 'function') {
            try {
                await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
                setImgState('copied');
                setTimeout(() => setImgState('idle'), 2500);
                return;
            } catch {
                /* clipboard image write unavailable/denied — download instead */
            }
        }
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `wsr-evidence-${resolved.checkId ?? 'panel'}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setImgState('downloaded');
        } catch {
            setImgState('error');
        }
    };

    const resolved = resolveCheckParams(step, { targetAddress });

    const errorMessage = error
        ? String(error)
        : success && success.status === 'error'
            ? success.message || `Error at ${success.at}`
            : null;

    const outcome = errorMessage
        ? 'error'
        : !success
            ? null
            : isAuthBypassResult(success)
                ? 'auth-bypass'
                : typeof success === 'string'
                ? isTxHash(success) ? 'sent' : 'generic-success'
                : success.at === 'chain_switch' &&
                  (success.status === 'switched' || success.status === 'switch_cancelled' || success.status === 'chain_not_added')
                    ? 'chain-switch'
                : success.status === 'rejected_by_user'
                    ? success.at === 'chain_switch' ? 'chain-rejected' : 'send-rejected'
                    : 'contractAddress' in success
                        ? 'deployed'
                        : success.hash
                            ? 'sent'
                            : 'generic-success';

    // Normalised tx hash whether the handler returned a bare string (send
    // checks) or a { hash, runtime } envelope (swap / LP).
    const txHash = typeof success === 'string'
        ? success
        : (success && typeof success === 'object' ? success.hash : undefined);
    // Extension signing actions return the signature directly; WalletConnect
    // returns it in a `{ result, runtime }` envelope. Render both the same way
    // so the visible evidence matches across platforms.
    const genericResult = typeof success === 'string'
        ? success
        : (success && typeof success === 'object' && typeof success.result === 'string'
            ? success.result
            : null);

    // RUNTIME provenance, kept in its own key so hardcoded (`parameters`, frozen
    // by dApp version) vs per-run values stay visually obvious in the JSON.
    // `from` on every run; handler-supplied runtime (deploy address/hash, swap
    // quote, LP pool/ticks/deadline) merged in when present.
    const handlerRuntime =
        success && typeof success === 'object' && success.runtime ? success.runtime : null;
    // The ACTUAL dApp origin this run executed on — a per-run fact. THRE-006's
    // whole subject is the origin the wallet shows, and PERM-001's SIWE check
    // compares the message domain against the real origin, so the hardcoded
    // registry value (the production URL) must not stand in for it in evidence.
    const dappOrigin = typeof window !== 'undefined' ? window.location.origin : null;
    // Which injected wallet actually served this run — pinned so a two-extension
    // setup can't attribute the result to the wrong wallet.
    const provider = getProviderIdentity();
    const runtime = {
        platform,
        ...(provider ? { provider } : {}),
        ...(dappOrigin ? { dapp_origin: dappOrigin } : {}),
        ...(account ? { from: account } : {}),
        // Per-run extras from the page (e.g. THRE-005's picked unknown_candidate).
        ...(extraRuntime ?? {}),
        ...(handlerRuntime ?? {}),
    };
    const hasRuntime = Object.keys(runtime).length > 0;

    const baseEvidence = {
        check: resolved.checkId,
        step: `${resolved.stepNumber}/${resolved.totalSteps}`,
        dapp_version: resolved.dappVersion,
        provenance: BUILD_PROVENANCE,
        parameters: resolved.parameters,
        ...(contextChanged ? { context_changed_during_request: true } : {}),
    };

    const buildEvidence = () => {
        // Additive: append `runtime` to whatever the outcome already records.
        const withRuntime = (obj) => (hasRuntime ? { ...obj, runtime } : obj);
        if (success?.request_outcome === 'stopped_waiting' || success?.request_outcome === 'skipped_by_tester') {
            return withRuntime({ ...baseEvidence, ...success });
        }
        if (outcome === 'sent') return withRuntime({ ...baseEvidence, wallet_output: txHash });
        if (outcome === 'deployed') {
            return withRuntime({
                ...baseEvidence,
                wallet_output: success.hash,
                deployed_address: success.contractAddress ?? '(pending receipt)',
            });
        }
        if (outcome === 'send-rejected') return withRuntime({ ...baseEvidence, wallet_output: 'rejected_by_user' });
        // Chain-switch action (PERM-009): record the wallet's answer plainly —
        // switched / cancelled / chain_not_added (4902) are all observations, not
        // errors. Additive: status + optional code + the target chain.
        if (outcome === 'chain-switch') {
            return withRuntime({
                ...baseEvidence,
                wallet_output: success.status,
                ...(success.code != null ? { code: success.code } : {}),
                target_chain: `${success.chainName ?? ''} · ${success.chainId ?? ''}`.trim(),
                method: 'wallet_switchEthereumChain',
            });
        }
        // Auth-bypass batch: wallet_output is the per-method results array.
        if (outcome === 'auth-bypass') return withRuntime({ ...baseEvidence, wallet_output: success });
        // Include runtime identity in signature and navigation evidence.
        if (outcome === 'generic-success') {
            // requestConnection returns { result, runtime: { connect_method } } —
            // the path it actually ran rides in `runtime` (merged above), and the
            // real return value is `result`. Unwrap so wallet_output stays the
            // permissions/accounts array, not the envelope.
            const walletOutput =
                success && typeof success === 'object' && !Array.isArray(success) && 'result' in success
                    ? success.result
                    : success;
            return withRuntime({ ...baseEvidence, wallet_output: walletOutput });
        }
        if (outcome === 'error') {
            const at = success?.at;
            const failed_method = at === 'chain_switch'
                ? 'wallet_switchEthereumChain'
                : at === 'chain_read'
                    ? 'eth_chainId'
                    : resolved.method;
            return withRuntime({
                ...baseEvidence, wallet_output: errorDetails?.message ?? errorMessage, failed_method,
                ...(errorDetails ? { error_details: errorDetails } : {}),
                ...(errorDetails?.code != null ? { code: errorDetails.code } : {}),
            });
        }
        return null;
    };

    const evidence = buildEvidence();
    const evidenceText = evidence ? JSON.stringify(evidence, null, 2) : '';

    useEffect(() => {
        if (!evidence) return;
        persistEvidenceRecord({
            platform,
            checkId: resolved.checkId,
            step: `${resolved.stepNumber}/${resolved.totalSteps}`,
            evidence,
        });
    }, [evidence, evidenceText, platform, resolved.checkId, resolved.stepNumber, resolved.totalSteps]);

    if (!outcome) return null;
    const copyValue = guided ? null : outcome === 'deployed'
        ? (success.contractAddress ?? resolved.salient)
        : outcome === 'auth-bypass'
            ? null // no single salient value — the whole results array is the finding
            : resolved.salient;
    const clipboardPayload = copyValue != null ? String(copyValue) : evidenceText;
    const hasEvidence = !!evidence;
    const showHeader = Boolean(tabs) || hasEvidence;

    // Label the copy button by what the salient value actually IS (it copies
    // the salient parameter value, not the JSON).
    const cv = String(copyValue ?? '');
    const copyLabel = !cv
        ? 'Copy evidence (JSON)'
        : /^0x[0-9a-fA-F]{40}$/.test(cv)
            ? 'Copy address'
            : /^https?:\/\//i.test(cv) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(cv)
                ? 'Copy URL'
                : 'Copy target value';

    // Recorded-outcome heading — DEMOTED (smaller, muted, smaller glyph) so a
    // completed benign result reads as history, lighter than the pending action
    // above it. Still fully legible in the captured PNG; not collapsed. Error /
    // chain states keep their own attention treatment (they may need a retry).
    const infoLine = (text) => (
        <p className='flex items-start gap-2 text-[0.875rem] font-medium leading-5 text-gray-600 dark:text-gray-400'>
            <Info className='mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500' />
            {text}
        </p>
    );
    // `tag` names the value (same small uppercase treatment as the verifier's
    // "We sent" field, so labelled values read as siblings). The Copy button's
    // title spells out what it copies, so it is never confused with the header's
    // salient-value copy.
    const copyLine = (value, label, k, tag = null) => (
        <div className='flex items-center gap-2 font-mono text-[0.8125rem] text-gray-800 dark:text-gray-200'>
            {tag && (
                <span className='shrink-0 font-sans text-[0.625rem] font-medium uppercase tracking-wide text-[var(--wsr-fg-muted)]'>
                    {tag}
                </span>
            )}
            <span title={value} className='truncate'>{label}</span>
            <button
                type='button'
                onClick={() => copy(value, k)}
                title={tag ? `Copy the ${tag.toLowerCase()}` : undefined}
                className='inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'>
                {copiedKey === k ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
                {copiedKey === k ? 'Copied' : 'Copy'}
            </button>
        </div>
    );

    let body;
    if (guided || success?.request_outcome) {
        body = <GuidedRequestResult action={step.ui.content.button.action} success={success} error={errorMessage} runtime={runtime} checkId={resolved.checkId} platform={platform}
            targetAddress={resolved.method === 'eth_sendTransaction' && /^0x[0-9a-fA-F]{40}$/.test(resolved.target ?? '') ? resolved.target : undefined} />;
    } else if (outcome === 'sent') {
        body = <>{infoLine('Transaction sent to the wallet and confirmed.')}{copyLine(txHash, shortHash(txHash), 'hash', 'Transaction hash')}</>;
    } else if (outcome === 'deployed') {
        body = (
            <>
                {infoLine(success.contractAddress ? 'Test token deployed.' : 'Deploy sent — awaiting receipt…')}
                {success.contractAddress && copyLine(success.contractAddress, success.contractAddress, 'addr', 'Contract address')}
            </>
        );
    } else if (outcome === 'send-rejected') {
        body = infoLine('Wallet showed its confirmation UI — user declined to proceed.');
    } else if (outcome === 'auth-bypass') {
        // One row per RPC. Factual only — no pass/fail, no green/red. "Data
        // returned" is emphasised when non-null (the leak); a sub-100ms
        // "resolved" means no human interaction happened. Cells truncate to one
        // line (title = hover fallback); clicking a row reveals the full,
        // wrapped, selectable text below it — so nothing widens the table.
        //
        // The ONLY outcome where the wallet served the request is "resolved"
        // (the classifier files declined/empty ahead of it, so resolved ⇔ real
        // data came back). Every other outcome — declined / empty / rejected /
        // no_response / session_dropped / unstable / error — returned nothing.
        // The count + the per-row "Returned data / Returned no data" line make
        // that legible from the screenshot alone, without the tooltip legend.
        const totalRequests = success.length;
        const returnedData = success.filter((r) => r.outcome === 'resolved').length;
        // "resolved" is the ONLY outcome that returned data, so when none resolved
        // the Data column is all "—" — pure noise. Drop it entirely (the summary
        // line already states "0 of N returned data") and give its width to
        // Method/Outcome, where a wrapped error message needs the room. When a row
        // DID return data, keep the column and show that value prominently.
        const anyData = returnedData > 0;
        // Columns: METHOD · OUTCOME · [DATA RETURNED]. Code and Elapsed are gone —
        // both are distilled into the OUTCOME cell's fact lines (timing → "a person
        // could/could not act"; code → the authorization line) and their raw values
        // live in the expanded detail + the evidence JSON.
        const colCount = anyData ? 3 : 2;
        // table-fixed widths live on the header cells; dynamic → inline style,
        // since Tailwind can't JIT arbitrary runtime class values.
        const colW = anyData
            ? { method: '24%', outcome: '54%', data: '22%' }
            : { method: '24%', outcome: '76%' };
        body = (
            // table-fixed with explicit column widths so the columns always FIT —
            // no overflow-x wrapper, so no horizontal scrollbar.
            <div>
                <p className='mb-2 text-[0.8125rem] font-medium text-gray-700 dark:text-gray-300'>
                    {returnedData} of {totalRequests} requests returned data
                    <span className='ml-1 font-normal text-gray-500 dark:text-gray-400'>
                        · {totalRequests - returnedData} returned no data
                    </span>
                </p>
                <table className='w-full table-fixed border-collapse text-left text-[0.8125rem]'>
                    <thead>
                        <tr className='border-b border-gray-200 text-[0.6875rem] uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400'>
                            <th style={{ width: colW.method }} className='py-1 pr-2 font-medium'>Method</th>
                            <th style={{ width: colW.outcome }} className='py-1 pr-2 font-medium'>
                                <HeaderTip
                                    id='authtip-outcome'
                                    label='Outcome'
                                    tip='Three facts per row: whether data came back, whether the timing left room for a person to act, and whether the request reached the wallet’s authorization.'
                                />
                            </th>
                            {anyData && (
                                <th style={{ width: colW.data }} className='py-1 pr-2 font-medium'>
                                    <HeaderTip
                                        id='authtip-data'
                                        label='Data returned'
                                        tip='The value the wallet returned — anything shown here is the finding.'
                                    />
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {success.map((r, i) => {
                            const dataStr = r.data_returned == null
                                ? null
                                : typeof r.data_returned === 'object'
                                    ? JSON.stringify(r.data_returned)
                                    : String(r.data_returned);
                            // An "error"/"error (internal)" outcome carries a full
                            // message that must survive the screenshot — so it wraps
                            // instead of truncating (a mid-word cut misleads the AI
                            // reviewer). Short outcomes stay one truncated line.
                            const isError = typeof r.outcome === 'string' && r.outcome.startsWith('error');
                            // Three derived facts for the OUTCOME cell (all from
                            // fields already recorded — see the helpers above).
                            const token = outcomeToken(r.outcome);
                            const interaction = interactionFact(r);
                            const gate = authorizationFact(r);
                            const gateLine = gate.why ? `${AUTH_LINE[gate.state]} — ${gate.why}` : AUTH_LINE[gate.state];
                            // The wallet's own message, minus the "error:" / "error
                            // (internal):" prefix (that marker already shows as the
                            // line-1 token), for the authorization line on error rows.
                            const errorMsg = isError ? r.outcome.replace(/^error(?:\s*\([^)]*\))?:\s*/, '') : null;
                            const isOpen = openRows.has(i);
                            return (
                                <React.Fragment key={i}>
                                    <tr
                                        onClick={() => toggleRow(i)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                toggleRow(i);
                                            }
                                        }}
                                        role='button'
                                        tabIndex={0}
                                        aria-expanded={isOpen}
                                        className='cursor-pointer border-b border-gray-100 align-top hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40'>
                                        <td className='py-1.5 pr-2 font-mono text-gray-800 dark:text-gray-200'>
                                            <div className='flex items-center gap-1'>
                                                <ChevronRight
                                                    className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                                                    aria-hidden='true'
                                                />
                                                <span className='truncate' title={r.method}>{r.method}</span>
                                            </div>
                                        </td>
                                        <td className='py-1.5 pr-2 font-mono text-gray-600 dark:text-gray-400'>
                                            {/* THREE derived facts, top to bottom:
                                                (1) whether data came back (+ the raw outcome token),
                                                (2) whether a person could have acted (from elapsed),
                                                (3) whether the request reached the wallet's authorization
                                                    decision — a payload/unsupported failure never did.
                                                Factual only; the reviewer draws the conclusion. */}
                                            <div className='font-medium text-gray-800 dark:text-gray-200'>
                                                {r.outcome === 'resolved' ? 'Returned data' : 'Returned no data'}
                                                {token && (
                                                    <span className='font-normal text-gray-500 dark:text-gray-400'> · {token}</span>
                                                )}
                                            </div>
                                            <div className='mt-0.5 text-[0.6875rem] leading-4 text-gray-500 dark:text-gray-400'>
                                                {interaction}
                                            </div>
                                            {/* Authorization line wraps (never truncates) — for an error
                                                row it also carries the wallet's own message AND the numeric
                                                code, so -32602 / -32600 / 4200 stay fully legible in the
                                                captured PNG now that the Code column is gone. */}
                                            <div className='mt-0.5 whitespace-normal text-[0.6875rem] leading-4 text-gray-500 [overflow-wrap:anywhere] dark:text-gray-400'>
                                                {gateLine}
                                                {isError && errorMsg && (
                                                    <span className='text-gray-700 dark:text-gray-300' title={r.outcome}>. The wallet said: {errorMsg}{r.code != null && ` (code ${r.code})`}</span>
                                                )}
                                            </div>
                                            {/* Payload-limited row (eth_decrypt): the ciphertext is a
                                                non-decryptable placeholder, so this caveat stays visible
                                                — a decode/decrypt error here is NOT an auth-gate result. */}
                                            {r.payload_note && (
                                                <div className='mt-1 flex items-start gap-1 text-[0.6875rem] leading-4 text-[var(--wsr-fg-muted)] [overflow-wrap:anywhere]'>
                                                    <Info className='mt-px h-3 w-3 shrink-0' aria-hidden='true' />
                                                    <span>{r.payload_note}</span>
                                                </div>
                                            )}
                                        </td>
                                        {anyData && (
                                            <td className='py-1.5 pr-2 font-mono'>
                                                {/* Data belongs only to a "resolved" row — the sole
                                                    outcome that actually returned something. It wraps
                                                    (not truncates) so a leaked value is fully legible
                                                    in the captured image. */}
                                                {r.outcome === 'resolved' && dataStr != null
                                                    ? <div className='whitespace-normal font-semibold text-gray-900 [overflow-wrap:anywhere] dark:text-gray-50'>{dataStr}</div>
                                                    : <span className='text-gray-400 dark:text-gray-600'>—</span>}
                                            </td>
                                        )}
                                    </tr>
                                    {isOpen && (
                                        <tr className='border-b border-gray-100 dark:border-gray-800'>
                                            <td colSpan={colCount} className='px-1 pb-2'>
                                                <div className='select-text space-y-1 rounded-md bg-gray-50 p-2 font-mono text-[0.75rem] leading-5 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300'>
                                                    {/* ONLY what the row does not already show: the raw
                                                        error message, the numeric code, the raw elapsed ms,
                                                        and the payload note. Method / outcome / data are on
                                                        the row itself, so they are not repeated here. */}
                                                    {isError && (
                                                        <div>
                                                            <span className='text-gray-500 dark:text-gray-400'>message: </span>
                                                            <span className='[overflow-wrap:anywhere]'>{r.outcome}</span>
                                                        </div>
                                                    )}
                                                    {r.code != null && (
                                                        <div>
                                                            <span className='text-gray-500 dark:text-gray-400'>code: </span>{r.code}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <span className='text-gray-500 dark:text-gray-400'>elapsed: </span>{r.elapsed_ms} ms
                                                    </div>
                                                    {r.payload_note && (
                                                        <div>
                                                            <span className='text-gray-500 dark:text-gray-400'>note: </span>
                                                            <span className='[overflow-wrap:anywhere]'>{r.payload_note}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    } else if (outcome === 'chain-switch') {
        // Neutral — every branch is a legitimate observation, not a failure. Uses
        // the shared note tokens (no verdict colour, no pass/fail).
        const chainLabel = success.chainName || 'the target chain';
        const line =
            success.status === 'chain_not_added'
                ? `Wallet returned 4902 (unrecognized chain) for ${chainLabel} — it declined to switch to a network it doesn't have configured.`
                : success.status === 'switch_cancelled'
                    ? `Chain-switch request to ${chainLabel} was cancelled — the wallet showed a confirmation you could decline.`
                    : `Wallet switched to ${chainLabel}.`;
        body = (
            <div className='space-y-1.5'>
                <p className='flex items-start gap-2 text-lg font-medium leading-7 text-[var(--wsr-note-fg)]'>
                    <Info className='mt-0.5 h-5 w-5 shrink-0 text-[var(--wsr-note-fg)]' />
                    {line}
                </p>
                <p className='text-[0.8125rem] text-[var(--wsr-note-fg)]/90'>
                    Recorded as an observation{success.code != null ? ` (code ${success.code})` : ''}.
                </p>
            </div>
        );
    } else if (outcome === 'chain-rejected') {
        body = (
            <div className='space-y-1.5'>
                <p className='flex items-start gap-2 text-lg font-medium leading-7 text-[var(--wsr-note-fg)]'>
                    <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-[var(--wsr-note-fg)]' />
                    Chain switch to {resolved.chainName} was declined.
                </p>
                <p className='text-[0.8125rem] text-[var(--wsr-note-fg)]/90'>
                    The transaction was never sent, so the check was not exercised. Switch and retry.
                </p>
                <button
                    type='button'
                    onClick={onRetry}
                    className='inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium border-[var(--wsr-note-border)] text-[var(--wsr-note-fg)] hover:bg-[var(--wsr-note-bg)]'>
                    Try again
                </button>
            </div>
        );
    } else if (outcome === 'error') {
        body = (
            <>
                <p className='flex items-start gap-2 text-lg font-medium leading-7 text-red-700 dark:text-red-300'>
                    <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400' />
                    <span className='flex-1'>{errorMessage.split('\n')[0]}</span>
                </p>
                {(errorMessage.includes('\n') || errorMessage.length > 120) && (
                    <details>
                        <summary className='cursor-pointer text-xs text-red-700/80 dark:text-red-300/80'>Full message</summary>
                        <pre className='mt-1 whitespace-pre-wrap break-words font-mono text-[0.75rem] text-red-800 dark:text-red-200'>{errorMessage}</pre>
                    </details>
                )}
            </>
        );
    } else {
        body = (
            <>
                {infoLine('Action completed.')}
                {genericResult && (
                    <pre className='max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[0.8125rem] leading-5 text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300'>
                        {genericResult}
                    </pre>
                )}
            </>
        );
    }

    return (
        <>
        <div ref={panelRef} className='w-full rounded-lg border border-[var(--wsr-border)] bg-[var(--wsr-card)]'>
            {showHeader && !guided && (
                <div className='flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-700'>
                    <div className='min-w-0 flex-1'>{tabs}</div>
                    <button
                        type='button'
                        onClick={copyAsImage}
                        disabled={imgState === 'working'}
                        title='Capture this evidence panel as a PNG — the wizard panel only, not the wallet dialog'
                        data-capture-skip
                        className='inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[0.8125rem] font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60 dark:text-gray-200 dark:hover:bg-gray-700'>
                        {imgState === 'copied' || imgState === 'downloaded'
                            ? <Check className='h-4 w-4' />
                            : <ImageIcon className='h-4 w-4' />}
                        {imgState === 'working' ? 'Rendering…'
                            : imgState === 'copied' ? 'Image copied'
                                : imgState === 'downloaded' ? 'Downloaded'
                                    : 'Copy as image'}
                    </button>
                    {hasEvidence && (
                        <button
                            type='button'
                            title={`Copies the salient value: ${cv}`}
                            onClick={() => copy(clipboardPayload, 'value')}
                            data-capture-skip
                            className='inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[0.8125rem] font-medium text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-700'>
                            {copiedKey === 'value' ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                            {copiedKey === 'value' ? 'Copied' : copyLabel}
                        </button>
                    )}
                </div>
            )}
            <div className={guided ? 'space-y-3 p-4 text-sm md:space-y-1.5 md:px-3 md:py-2' : 'space-y-1.5 px-3 py-2 text-sm'}>
                {guided && tabs && <div>{tabs}</div>}
                {contextChanged && <p role='status'>Wallet or network changed during this run. Keep this result separate and repeat the setup before retrying.</p>}
                {body}
                {guided && hasEvidence && <div className='md:px-2 md:pb-2'>
                    <ResultExportActions
                        onCopyEvidence={() => copy(evidenceText, 'value')}
                        onCopyImage={copyAsImage}
                        imagePending={imgState === 'working'}
                        status={copiedKey === 'value' ? 'Evidence copied' : imgState === 'copied' ? 'Image copied' : null}
                    />
                </div>}
                {hasEvidence && (
                    <div className='border-t border-[var(--wsr-border)] pt-3'>
                        <button
                            type='button'
                            onClick={() => setShowEvidence((o) => !o)}
                            className='min-h-11 text-left text-[0.8125rem] font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 md:min-h-0'>
                            {showEvidence ? 'Hide raw evidence (JSON)' : 'Show raw evidence (JSON)'}
                        </button>
                        {showEvidence && (
                            <pre className='mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[0.8125rem] leading-5 text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300'>
                                {evidenceText}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
        {(imgState === 'downloaded' || imgState === 'error') && (
            <p className='mt-1 px-1 text-[0.75rem] leading-4 text-[var(--wsr-fg-muted)]'>
                {imgState === 'downloaded'
                    ? 'Clipboard image not available here — the panel was saved as a PNG download instead.'
                    : "Couldn't create the image in this browser — use a Chromium or Firefox browser, or Copy evidence (JSON)."}
            </p>
        )}
        </>
    );
};

export default ActionResult;
