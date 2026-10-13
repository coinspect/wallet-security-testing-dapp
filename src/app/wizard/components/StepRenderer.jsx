"use client";

import React, { useEffect, useState } from "react";
import { Eye, X, Camera, ChevronRight, Info, CheckCircle2, Check, Copy, ExternalLink } from "lucide-react";
import SourceLabel from "./SourceLabel";
import ImageModal from "./ImageModal";
import { baseCheckId, DEFAULT_PLATFORM } from "../utils/platform";
import { cn } from "@/lib/utils";
import { testParams, resolveParamValue } from "@/utils/constants";
import CTAButton from "./CTAButton";
import { MANUAL_GUIDANCE } from "../utils/manualGuidance.mjs";
import SkipStepButton from "./SkipStepButton";

// Resolve a step's `ui.content.links` (an array of registry KEYS) into openable
// { key, name, url } — sourced from the params registry (usedBy), never hardcoded
// in copy. Bare hosts get an https:// scheme (matching openScamUrl). Unknown keys
// are dropped.
const REGISTRY_BY_KEY = Object.fromEntries(testParams.map((p) => [p.key, p]));
const resolveLinks = (keys) =>
    (Array.isArray(keys) ? keys : [])
        .map((key) => {
            const row = REGISTRY_BY_KEY[key];
            if (!row) return null;
            const raw = String(resolveParamValue(row) ?? "");
            if (!raw) return null;
            const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            let host = raw;
            try {
                host = new URL(url).host;
            } catch {
                /* keep raw */
            }
            // A friendly label for a known dApp (`linkLabel`), else the bare host
            // — for phishing URLs the host is the honest, useful thing to show.
            return { key, name: row.linkLabel ?? host, url };
        })
        .filter(Boolean);

// Resolve `ui.content.copyValues` (an array of registry KEYS) into copyable
// { key, label, value } chips. The copyable sibling of resolveLinks: it does NOT
// URL-parse, so the value is shown VERBATIM (essential for checksum casing — a
// deliberately mis-checksummed address must not be lowercased). Sourced from the
// registry, never hardcoded in copy.
const resolveCopyValues = (keys) =>
    (Array.isArray(keys) ? keys : [])
        .map((key) => {
            const row = REGISTRY_BY_KEY[key];
            if (!row) return null;
            const value = String(resolveParamValue(row) ?? "");
            if (!value) return null;
            return { key, label: row.label ?? key, value };
        })
        .filter(Boolean);

// A compact copyable value — mirrors the copy affordance used in the params
// popover (WizardParamsPanel's CopyBtn): the value in mono, plus a copy button.
const CopyValueChip = ({ label, value }) => {
    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable — the value is still selectable inline */
        }
    };
    return (
        // Label ABOVE the value so the value + Copy own the full row width — a
        // 42-char address then fits on one line at the column width.
        <div className='rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800/40'>
            {label && (
                <span className='block text-[0.625rem] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'>
                    {label}
                </span>
            )}
            <div className={`flex items-center gap-2 ${label ? 'mt-0.5' : ''}`}>
                <code className='min-w-0 flex-1 select-all break-all font-mono text-[0.8125rem] text-gray-700 dark:text-gray-300'>
                    {value}
                </code>
                <button
                    type='button'
                    onClick={onCopy}
                    aria-label={`Copy ${label || value}`}
                    className='inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.75rem] font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'>
                    {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
        </div>
    );
};

// Short objective for the capture badge: the explicit `captureShort`, else the
// capture text truncated at the FIRST comma / em- or en-dash (the leading
// scannable clause), trimmed. The FULL sentence — including the deliberate
// outcome-neutral condition ("showing whether X or Y") — is NEVER dropped: it
// always lives in the badge's title tooltip.
const deriveShort = (full) => {
    const s = String(full ?? "").trim();
    const cut = s.search(/[,—–]/);
    return (cut > 0 ? s.slice(0, cut) : s).trim();
};

// Capture badge label: a muted "Screenshot" word · separator · the short
// objective. The filled camera glyph (inline) or thumbnail (image variant) sits
// to the LEFT in CaptureBlock; the FULL capture sentence always stays in the
// badge's title tooltip. Title Case (not small-caps), muted so the objective
// keeps the stronger ink. Not a button.
const CaptureLabelParts = ({ short }) => (
    <span className="flex min-w-0 items-center gap-1 text-[0.75rem]">
        <span className="shrink-0 font-medium text-gray-500 dark:text-gray-400">
            Screenshot
        </span>
        <span className="shrink-0 text-gray-400 dark:text-gray-600" aria-hidden="true">
            ·
        </span>
        <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-200">
            {short}
        </span>
    </span>
);

// Capture slot — an ATOMIC BADGE, in two forms chosen by whether an example
// image exists:
//   • WITHOUT an image (or on load error): a compact pill — filled camera glyph
//     + "Screenshot" + objective, one line, NO border, NO button / upload
//     affordance.
//   • WITH an image: a bordered block — a 56px example-framing thumbnail that
//     opens the shared ImageModal, plus the same "Screenshot" + objective. On an
//     active row the border/background go quiet so it isn't a box-in-a-box.
// The only click target is ever the thumbnail. The wizard never collects
// screenshots. The full capture sentence is always the title tooltip.
const CaptureBlock = ({ text, captureShort = null, exampleSrc = null, active = false }) => {
    const [err, setErr] = useState(false);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        setErr(false);
    }, [exampleSrc]);
    const hasThumb = !!exampleSrc && !err;
    const short = (captureShort && String(captureShort).trim()) || deriveShort(text);

    if (!hasThumb) {
        return (
            <span
                title={text}
                className="inline-flex max-w-full items-center gap-1.5 rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800/70"
            >
                <Camera
                    className="h-3 w-3 shrink-0 text-gray-500 dark:text-gray-400"
                    fill="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
                <CaptureLabelParts short={short} />
            </span>
        );
    }

    return (
        <div
            className={cn(
                "flex items-center gap-2.5 rounded-md border p-1.5",
                active
                    ? "border-[var(--wsr-accent)]/30 bg-transparent"
                    : "border-gray-200 bg-gray-50/70 dark:border-gray-700 dark:bg-gray-800/30",
            )}
        >
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="Example framing"
                className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-gray-200 transition-opacity hover:opacity-90 dark:border-gray-700"
            >
                {/* Examples are selected dynamically from the static export. */}
                <img
                    src={exampleSrc}
                    alt=""
                    onError={() => setErr(true)}
                    className="h-full w-full object-cover"
                />
            </button>
            <div title={text} className="flex min-w-0 flex-1 items-center gap-1.5">
                <CaptureLabelParts short={short} />
            </div>
            {open && (
                <ImageModal image={exampleSrc} isOpen={open} onClose={() => setOpen(false)} />
            )}
        </div>
    );
};

/**
 * A referenced wizard button (e.g. Connect this dApp) rendered as a distinct
 * inline pill so the eye lands on the action word. Purely visual — the real
 * button lives in the action panel.
 */
const ActionPill = ({ children }) => (
    <span className='inline-flex items-center rounded bg-[var(--wsr-accent)]/10 px-1.5 py-0.5 text-[0.8125rem] font-semibold text-[var(--wsr-accent)]'>
        {children}
    </span>
);

/**
 * Wrap any occurrence of a known wizard-button label in ONE clause of action text
 * with an ActionPill. Labels come from the check's sub-steps; wallet-UI checks have
 * no buttons, so the text is returned untouched.
 */
function renderClause(text, buttonLabels) {
    if (!Array.isArray(buttonLabels) || buttonLabels.length === 0) return text;
    const labels = [...new Set(buttonLabels)].sort((a, b) => b.length - a.length);
    const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(${escaped.join("|")})`, "g");
    const parts = text.split(re);
    return parts.map((part, i) => {
        if (labels.includes(part)) return <ActionPill key={i}>{part}</ActionPill>;
        // Pull punctuation that directly follows a pill tight against it — the
        // pill's right padding otherwise reads as "Connect this dApp ." .
        const hugPill = i > 0 && labels.includes(parts[i - 1]) && /^[.,;:!?)]/.test(part);
        return hugPill ? (
            <span key={i} className="-ml-1">{part}</span>
        ) : (
            <React.Fragment key={i}>{part}</React.Fragment>
        );
    });
}

/**
 * A step's `action` is a STRING (inline prose — today's behaviour) or an ARRAY of
 * short clauses (rendered as bullets so a multi-action step scans faster). Each
 * clause runs through the SAME pill-matching as a string action. The bullets carry
 * no colour/weight of their own — the caller's title <span> (with its dimmed /
 * line-through / expanded states) wraps this list, so those states apply to it.
 */
function renderAction(action, buttonLabels) {
    if (Array.isArray(action)) {
        return (
            <ul className="list-disc space-y-0.5 pl-4">
                {action.map((clause, i) => (
                    <li key={i}>{renderClause(clause, buttonLabels)}</li>
                ))}
            </ul>
        );
    }
    return renderClause(action, buttonLabels);
}

// First sentence of a longer expected-result string — the short line shown on
// the live step, with the full wording kept in Technical details.
const firstSentence = (text) => {
    if (typeof text !== "string" || !text) return null;
    const m = text.match(/^.*?[.!?](?=\s|$)/);
    return m ? m[0] : text;
};

// A hover/keyboard-focus tooltip for the section heading — carries the
// documents-not-judges preamble that used to cost two inline lines per check.
const InfoTip = ({ tip }) => (
    <span
        tabIndex={0}
        role='note'
        className='group relative ml-1.5 inline-flex cursor-help items-center align-middle outline-none focus-visible:ring-1 focus-visible:ring-gray-400 rounded'
    >
        <Info className='h-3.5 w-3.5 text-gray-400 dark:text-gray-500' aria-hidden='true' />
        <span
            role='tooltip'
            className='pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-64 rounded-md border border-[var(--wsr-border)] bg-[var(--wsr-card)] p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-gray-600 shadow-lg group-hover:block group-focus:block dark:text-gray-300'
        >
            {tip}
        </span>
    </span>
);

// Collapsed-by-default reference: the ACTUAL RPC method(s) + (for the live step)
// the full expected-result wording. `rpc` is a single method string, or an array
// of methods in fire order (the auth-bypass batch). Reference, never deleted.
const TechnicalDetails = ({ rpc, fullExpect }) => {
    const [open, setOpen] = useState(false);
    const methods = Array.isArray(rpc) ? rpc : rpc ? [rpc] : [];
    return (
        <div className='mt-1.5'>
            <button
                type='button'
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className='inline-flex items-center gap-1 text-[0.75rem] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            >
                <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
                Technical details
            </button>
            {open && (
                <div className='mt-1 space-y-1 border-l-2 border-gray-200 pl-2 dark:border-gray-700'>
                    {methods.length === 1 && (
                        <p className='font-mono text-[0.75rem] text-gray-500 dark:text-gray-400'>{methods[0]}</p>
                    )}
                    {methods.length > 1 && (
                        <ol className='list-decimal space-y-0.5 pl-4 font-mono text-[0.75rem] text-gray-500 dark:text-gray-400'>
                            {methods.map((m, i) => (
                                <li key={i}>{m}</li>
                            ))}
                        </ol>
                    )}
                    {fullExpect && (
                        <p className='text-[0.8125rem] leading-[1.15rem] text-gray-500 dark:text-gray-400'>
                            {fullExpect}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

function StepRenderer({
    stepConfig,
    onError,
    walletUi = false,
    platform = DEFAULT_PLATFORM,
    buttonLabels = [],
    stepsMeta = [],
    activeStepIndex = 0,
    manualProgress = false,
    manualDone = new Set(),
    onToggleManualDone,
}) {
    const steps = Array.isArray(stepConfig?.ui?.content?.steps) ? stepConfig.ui.content.steps : [];
    const stepCount = steps.length;
    const firstWizardIndex = stepsMeta.findIndex((meta) => meta?.source === "wizard");
    // BASE check id — the folder example-framing images live under
    // (/public/examples/<BASE-CHECK-ID>/), shared across ~Browser/~Mobile.
    const baseId = baseCheckId(stepConfig?.id ?? "");

    // Per-step completion is a tester-local convenience for walletOnly checks
    // (no dApp action to drive an active step). Persisted in localStorage keyed
    // by canonicalId + campaign — NEVER evidence, never an outcome. "Done" is
    // progress, not a verdict.
    const canonicalId = stepConfig?.canonicalId ?? null;
    const guidance = walletUi ? MANUAL_GUIDANCE[canonicalId] : null;
    const storageKey = walletUi && canonicalId ? `wsr-progress:${canonicalId}:${platform}` : null;
    const [done, setDone] = useState(() => new Set());
    const [skipped, setSkipped] = useState(() => new Set());
    const skipStep = (index) => {
        const next = new Set(skipped).add(index);
        setSkipped(next);
        try { if (storageKey) window.localStorage.setItem(`${storageKey}:skipped`, JSON.stringify([...next])); } catch {}
        setExpanded(index + 1 < stepCount ? index + 1 : -1);
    };
    useEffect(() => {
        if (!storageKey || typeof window === "undefined") {
            setDone(new Set());
            setSkipped(new Set());
            return;
        }
        try {
            const raw = window.localStorage.getItem(storageKey);
            const arr = raw ? JSON.parse(raw) : [];
            setDone(new Set(Array.isArray(arr) ? arr : []));
            const skippedSteps = JSON.parse(window.localStorage.getItem(`${storageKey}:skipped`) || '[]');
            setSkipped(new Set(Array.isArray(skippedSteps) ? skippedSteps : []));
        } catch {
            setDone(new Set());
            setSkipped(new Set());
        }
    }, [storageKey]);

    const persist = (set) => {
        if (!storageKey || typeof window === "undefined") return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify([...set].sort((a, b) => a - b)));
        } catch {
            /* storage unavailable — non-fatal */
        }
    };
    const toggleDone = (i) => {
        const remaining = new Set(skipped);
        remaining.delete(i);
        setSkipped(remaining);
        try { if (storageKey) window.localStorage.setItem(`${storageKey}:skipped`, JSON.stringify([...remaining])); } catch {}
        setDone((prev) => {
            const next = new Set(prev);
            next.has(i) ? next.delete(i) : next.add(i);
            persist(next);
            return next;
        });
    };
    const resetDone = () => {
        setDone(new Set());
        setSkipped(new Set());
        if (storageKey && typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(storageKey);
                window.localStorage.removeItem(`${storageKey}:skipped`);
            } catch {
                /* non-fatal */
            }
        }
    };

    // The live step: for walletOnly, the FIRST not-done step (advances as steps
    // are ticked); otherwise the run-driven active step from the page.
    const firstNotDone = (() => {
        for (let i = 0; i < stepCount; i += 1) if (!done.has(i) && !skipped.has(i)) return i;
        return Math.max(0, stepCount - 1);
    })();
    const allDone = walletUi && stepCount > 0 && steps.every((_, i) => done.has(i) || skipped.has(i));
    // When EVERYTHING is done, NO row is active (-1) — the completion line is the
    // only end state. A lingering highlight on the last step read as "still here".
    const liveIndex = walletUi ? (allDone ? -1 : firstNotDone) : activeStepIndex;

    const [expanded, setExpanded] = useState(liveIndex);
    // Progress re-focuses the expanded step (first not-done / run-active). Manual
    // clicks win until the next progress change.
    useEffect(() => {
        setExpanded(liveIndex);
    }, [liveIndex]);

    if (typeof stepConfig.id !== "string") {
        // Steps ids must always be strings!
        return <div className='text-red-500'>Invalid step identifier.</div>;
    }

    const { content } = stepConfig.ui;
    const also = Array.isArray(content.additionalCaptures) ? content.additionalCaptures : [];
    // Registry-sourced clickable links (Task 2/3): a set the tester can each open
    // in a new tab — e.g. THRE-001's trusted dApps, THRE-003's phishing URLs.
    const links = resolveLinks(content.links);
    const linksTitle = typeof content.linksTitle === "string" ? content.linksTitle : "Links";

    // Registry-sourced copyable values (e.g. VERI-001's bad-checksum address the
    // tester types by hand) — rendered as compact copy chips instead of inline in
    // a step's prose.
    const copyValues = resolveCopyValues(content.copyValues);
    const copyValuesTitle =
        typeof content.copyValuesTitle === "string" ? content.copyValuesTitle : "Values";

    const preamble = walletUi
        ? "This check is performed entirely in your wallet. Record your assessment in the checklist."
        : "This tool records the request and the wallet’s response. Record your assessment in the checklist.";

    // Surface hoist: if EVERY step shares one surface (derived from the step
    // data, not per-check config), name it ONCE next to the heading and drop the
    // per-row tags; mixed surfaces keep the per-row tags and hoist nothing.
    const surfaces = steps.map((_, i) => stepsMeta[i]?.source ?? "wallet");
    const uniformSurface =
        surfaces.length > 0 && surfaces.every((s) => s === surfaces[0]) ? surfaces[0] : null;

    // ONE step expanded at a time (default: the active step); the rest collapse
    // to number + action + source, dimmed, but keep their evidence requirement
    // visible so the tester knows what to capture before starting.
    return (
        <div className='font-[var(--default-font)]'>
            {guidance ? <p className="mb-6 text-[var(--wsr-fg-secondary)]">{guidance.objective}</p> : <h2 className='flex items-center border-b border-gray-200 pb-1.5 text-[1.25rem] font-semibold uppercase leading-[1.75rem] tracking-wide text-gray-600 dark:border-gray-700 dark:text-gray-300'>
                {content.bulletPointsTitle}
                <InfoTip tip={preamble} />
                {uniformSurface && (
                    <span className='ml-auto'>
                        <SourceLabel source={uniformSurface} />
                    </span>
                )}
            </h2>}

            {/* Full-width (walletOnly) checks breathe — more air between rows and
                below the heading; the two-column layout stays compact. */}
            {guidance ? <ol className="space-y-3" aria-label="Manual test steps">
                {steps.map((s, index) => <li key={index} aria-current={index === liveIndex ? "step" : undefined}
                    className={`rounded-lg border p-5 ${index === expanded ? "border-blue-400/60 bg-[var(--wsr-card)]" : "border-[var(--wsr-border)]"}`}>
                    <h2 className="flex items-start gap-3 font-semibold">
                        <span className="shrink-0 font-mono text-sm">{String(index + 1).padStart(2, "0")}</span>
                        <button className="text-left" onClick={() => setExpanded(index === expanded ? -1 : index)} aria-expanded={index === expanded}>
                            {guidance.titles[index]}
                        </button>
                        {done.has(index) && <span className="ml-auto text-xs font-normal text-[var(--wsr-fg-secondary)]">Reviewed</span>}
                        {!done.has(index) && skipped.has(index) && <span className="ml-auto text-xs font-normal">Skipped</span>}
                    </h2>
                    {index === expanded && <div className="mt-4 space-y-4 text-sm">
                        <div>{renderAction(s.action, [])}</div>
                        {s.expect && <details>
                            <summary className="cursor-pointer text-xs text-[var(--wsr-fg-secondary)]">What to look for</summary>
                            <p className="mt-2">{s.expect}</p>
                        </details>}
                        <div className="flex flex-wrap items-center gap-3">
                            <CTAButton onClick={() => {
                                if (!done.has(index)) toggleDone(index);
                                setExpanded(index + 1 < steps.length ? index + 1 : -1);
                            }}>{index === steps.length - 1 ? "Finish reviewing steps" : "Continue"}</CTAButton>
                            {done.has(index) && <button className="text-xs underline underline-offset-4" onClick={() => toggleDone(index)}>Mark as not reviewed</button>}
                            <SkipStepButton checkId={canonicalId} platform={platform} stage={index + 1} title={guidance.titles[index]} onSkip={() => skipStep(index)} />
                        </div>
                        {s.capture && <div><CaptureBlock text={s.capture} captureShort={s.captureShort}
                            exampleSrc={s.exampleImage ? `/examples/${baseId}/${s.exampleImage}` : null} active /></div>}
                    </div>}
                </li>)}
            </ol> : <ul className="mt-6 space-y-5">
                {steps.map((s, index) => (
                    <React.Fragment key={index}><StepItem
                        number={index + 1}
                        first={index === 0}
                        step={s}
                        meta={stepsMeta[index]}
                        buttonLabels={buttonLabels}
                        image={content.images?.[index]}
                        baseId={baseId}
                        walletUi={walletUi}
                        expanded={index === expanded}
                        isLive={index === liveIndex}
                        showDone={
                            walletUi ||
                            (
                                manualProgress &&
                                firstWizardIndex > 0 &&
                                index < firstWizardIndex &&
                                stepsMeta[index]?.source !== "wizard"
                            )
                        }
                        showSource={!uniformSurface}
                        done={walletUi ? done.has(index) : manualDone.has(index)}
                        onToggleDone={() => {
                            if (walletUi) toggleDone(index);
                            else onToggleManualDone?.(index);
                        }}
                        onExpand={() => setExpanded(index)}
                    />
                    {index === expanded && <li><SkipStepButton checkId={canonicalId} platform={platform} stage={index + 1} title={`Step ${index + 1}`} onSkip={() => skipStep(index)} /></li>}
                    </React.Fragment>
                ))}
            </ul>}

            {/* walletOnly progress affordances — neutral, tester-local. */}
            {walletUi && (allDone || done.size > 0 || skipped.size > 0) && (
                <div className='mt-8 flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800'>
                    {allDone ? (
                        <p className='flex items-center gap-1.5 text-[0.8125rem] text-gray-500 dark:text-gray-400'>
                            <Check className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
                            {skipped.size ? "Steps finished with omissions." : "Steps reviewed."} Record your observations in the checklist; this is not a pass/fail result.
                        </p>
                    ) : (
                        <span />
                    )}
                    {(done.size > 0 || skipped.size > 0) && (
                        <button
                            type='button'
                            onClick={resetDone}
                            className='shrink-0 text-[0.75rem] font-medium text-gray-400 hover:text-gray-600 hover:underline dark:text-gray-500 dark:hover:text-gray-300'
                        >
                            Reset steps
                        </button>
                    )}
                </div>
            )}

            {links.length > 0 && (
                <div className={"mt-10 max-w-[70ch]"}>
                    <h3 className='text-[0.8125rem] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'>
                        {linksTitle}
                    </h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {links.map((l) => (
                            <li key={l.key}>
                                <a
                                    href={l.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className='inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-[0.8125rem] font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50'
                                    title={l.url}
                                >
                                    <ExternalLink className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
                                    {l.name}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {copyValues.length > 0 && (
                <div className={"mt-8 max-w-[70ch]"}>
                    <h3 className='text-[0.8125rem] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'>
                        {copyValuesTitle}
                    </h3>
                    <ul className="mt-2 space-y-1.5">
                        {copyValues.map((cv) => (
                            <li key={cv.key}>
                                <CopyValueChip label={cv.label} value={cv.value} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {also.length > 0 && (
                <div className={"mt-10 max-w-[70ch]"}>
                    <h3 className='text-[0.8125rem] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'>
                        Also capture
                    </h3>
                    <ul className="mt-3 space-y-3">
                        {also.map((item, i) => {
                            // ALSO CAPTURE items may be a plain string or an object
                            // carrying its own short objective.
                            const text = typeof item === "string" ? item : item?.text;
                            const captureShort = typeof item === "object" ? item?.captureShort : undefined;
                            return (
                                <li key={i}>
                                    <CaptureBlock text={text} captureShort={captureShort} />
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

        </div>
    );
}

const StepItem = ({ number, first = false, step, meta, buttonLabels, image, baseId, walletUi, expanded, isLive, showDone = false, showSource = true, done = false, onToggleDone, onExpand }) => {
    const [showImage, setShowImage] = useState(false);
    const hasImage = typeof image === "string" && image.length > 0;

    // Example-framing thumbnail — generic per check (one set of images for all
    // wallets), lives at /examples/<BASE-CHECK-ID>/<file>. Rendered inside the
    // capture block; the block hides it and falls back to the glyph if it 404s.
    const exampleSrc = step?.exampleImage && baseId ? `/examples/${baseId}/${step.exampleImage}` : null;

    const source = meta?.source ?? "wallet";
    const rpc = meta?.rpc ?? null; // a method string, or an array (auth-bypass batch)
    const hasRpc = Array.isArray(rpc) ? rpc.length > 0 : !!rpc;

    // De-duplication: for the LIVE wizard step, the card carries the executable
    // approve/reject copy, so we don't repeat the FULL expected sentence inline —
    // but the step still shows a SHORT expected line (expectShort, else the first
    // sentence of expect); the full wording lives in Technical details. A short
    // line is not the duplication we removed — the verbatim repeat was.
    const liveWizard = isLive && source === "wizard" && !walletUi;
    const inlineExpect = liveWizard
        ? step.expectShort ?? firstSentence(step.expect)
        : step.expectShort ?? step.expect ?? null;
    // Full expected belongs in Technical details when it isn't shown inline
    // in full (live-wizard suppression, or a short line stands in for it).
    const fullExpectInTech =
        step.expect && step.expect !== inlineExpect ? step.expect : null;
    const hasTech = expanded && (hasRpc || fullExpectInTech);

    return (
        <li
            className={cn(
                "group rounded-md border-l-2",
                isLive
                    // Active step CARD — shares the ONE --wsr-card surface with the
                    // CURRENT ACTION card; the accent border + ~16px padding signal
                    // "active" so both columns read as one system.
                    ? "border-[var(--wsr-accent)] bg-[var(--wsr-card)] px-4 py-2.5 shadow-sm"
                    : "border-transparent pl-2",
            )}
        >
            {/* Two columns: the LEFT (action + expected + Technical details +
                capture) is width-constrained, so every part stops at the SAME
                right edge; the RIGHT holds the source label, kept off by a solid
                gutter. The expanded content no longer runs under the label. */}
            <div className='flex items-start gap-8'>
                <div className='min-w-0 flex-1'>
                    <button
                        type='button'
                        onClick={onExpand}
                        aria-expanded={expanded}
                        className='flex w-full items-start gap-2 py-1.5 text-left'
                    >
                        <span
                            className={`shrink-0 tabular-nums text-[0.9375rem] font-medium leading-6 ${
                                isLive ? "text-[var(--wsr-accent)]" : "text-gray-400 dark:text-gray-500"
                            }`}
                        >
                            {String(number).padStart(2, "0")}
                        </span>
                        <span
                            className={`min-w-0 text-[0.9375rem] leading-6 ${
                                done
                                    ? "text-gray-400 line-through dark:text-gray-500"
                                    : expanded
                                        ? "font-medium text-gray-800 dark:text-gray-200"
                                        : "text-gray-500 dark:text-gray-400"
                            }`}
                        >
                            {renderAction(step.action, buttonLabels)}
                        </span>
                    </button>

                    {expanded && (inlineExpect || hasTech) && (
                        <div className='mt-1 pb-1.5 pl-7'>
                            {inlineExpect && (
                                <p className='text-[0.8125rem] leading-[1.15rem] text-gray-500 dark:text-gray-400'>
                                    {inlineExpect}
                                </p>
                            )}
                            {hasTech && <TechnicalDetails rpc={rpc} fullExpect={fullExpectInTech} />}
                        </div>
                    )}

                    {/* Capture slot — text + integrated example thumbnail, one
                        block. Stays visible on EVERY step (dimmed when collapsed);
                        on the active row the block goes quiet so it doesn't read as
                        a box inside the highlighted box. */}
                    {step.capture && (
                        <div className={`pb-1.5 pl-7 ${expanded ? "" : "opacity-60"}`}>
                            <CaptureBlock
                                text={step.capture}
                                captureShort={step.captureShort}
                                exampleSrc={exampleSrc}
                                active={isLive}
                            />
                        </div>
                    )}
                </div>

                <div className='flex shrink-0 items-center gap-1.5 pt-2'>
                    {showSource && <SourceLabel source={source} />}
                    {showDone && (
                        <button
                            type='button'
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleDone?.();
                            }}
                            aria-pressed={done}
                            aria-label={done ? "Mark step as not done" : "Mark step as done"}
                            title={done ? "Done" : "Mark as done"}
                            className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium transition-colors",
                                done
                                    ? "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                    : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300",
                            )}
                        >
                            {/* Text on the LEFT so the circle stays right-anchored and
                                aligned across rows. At rest the label shows only on
                                the first row (and on any done row); hovering/focusing
                                a row reveals it there too. */}
                            <span
                                className={cn(
                                    "whitespace-nowrap",
                                    done || first
                                        ? ""
                                        : "hidden group-hover:inline group-focus-within:inline",
                                )}
                            >
                                {done ? "Done" : "Mark as done"}
                            </span>
                            {done ? (
                                // Done: solid check circle.
                                <CheckCircle2 className='h-4 w-4 shrink-0' aria-hidden='true' />
                            ) : (
                                // Pending/actionable: dashed circle outline (neutral).
                                <span
                                    className='h-4 w-4 shrink-0 rounded-full border border-dashed border-current'
                                    aria-hidden='true'
                                />
                            )}
                        </button>
                    )}
                    {hasImage && (
                        <>
                            <button
                                onClick={() => setShowImage(true)}
                                className='inline-flex rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                                title='See image'
                            >
                                <Eye className='h-4 w-4' />
                            </button>
                            <ImagePreview
                                imagePath={`/photos/${image}`}
                                isOpen={showImage}
                                onClose={() => setShowImage(false)}
                            />
                        </>
                    )}
                </div>
            </div>
        </li>
    );
};

const Modal = ({ isOpen, onClose, children }) => {
    if (!isOpen) return null;

    return (
        <div
            className='fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm'
            onClick={onClose}>
            <div
                className='bg-white dark:bg-dark-base rounded-lg shadow-lg relative max-w-xl w-auto font-[var(--default-font)] ring-1 ring-black/5 dark:ring-white/10 transition-colors'
                onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className='absolute -top-2 -right-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400
                   hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded-full shadow-md z-10
                   transition-colors hover:scale-110 active:scale-95'>
                    <X className='w-4 h-4' />
                </button>
                <div className='p-1'>{children}</div>
            </div>
        </div>
    );
};

const ImagePreview = ({ imagePath, isOpen, onClose }) => {
    if (!imagePath) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <div className='relative w-auto'>
                {/* Preview paths are selected dynamically from wizard data. */}
                <img
                    src={imagePath}
                    alt='Step preview'
                    className='max-h-[80vh] w-auto object-contain rounded-lg dark:brightness-90'
                />
            </div>
        </Modal>
    );
};

export default StepRenderer;
