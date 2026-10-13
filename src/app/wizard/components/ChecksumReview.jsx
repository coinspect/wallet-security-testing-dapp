"use client";

import { compareChecksumDisplay, checksumComparisonSummary, visibleChecksumInput } from "../utils/checksumComparison.mjs";

export function ChecksumAddress({ address, onCopy }) {
    return <div className="space-y-2 rounded-md border border-[var(--wsr-border)] p-3">
        <p className="text-xs text-[var(--wsr-fg-secondary)]">Bad-checksum address — preserve every letter&apos;s case</p>
        <code className="block select-all break-all text-sm" data-testid="checksum-target">{address}</code>
        <button className="text-xs underline underline-offset-4" onClick={() => onCopy(address)}>Copy address</button>
    </div>;
}

export function ChecksumInput({ value, onChange }) {
    return <div className="space-y-2">
        <label className="block space-y-2">
            <span className="text-sm">Address as the wallet displayed it</span>
            <input type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
                value={value} onChange={(event) => onChange(event.target.value)}
                placeholder="0x… paste the complete address"
                className="w-full rounded-md border border-[var(--wsr-border)] bg-transparent px-3 py-2 font-mono text-sm" />
        </label>
        <p className="text-xs text-[var(--wsr-fg-secondary)]">Copy the recipient, not your account or the transaction hash. Keep its exact letter case. If only a shortened address is available, leave this blank and keep the screenshot.</p>
    </div>;
}

const HighlightedAddress = ({ value, other }) => [...value].map((letter, index) =>
    letter !== other[index]
        ? <mark key={index} className="rounded-sm bg-[var(--wsr-accent-tint)] text-[var(--wsr-accent)]">{letter}</mark>
        : letter);

export function ChecksumFacts({ sent, input, noAddressShown = false }) {
    if (noAddressShown) return <div className="space-y-2 border-b border-[var(--wsr-border)] pb-4 text-sm" data-testid="checksum-comparison">
        <h3 className="font-semibold">No recipient address shown</h3>
        <p className="text-xs text-[var(--wsr-fg-secondary)]">Reported by tester · address comparison skipped</p>
    </div>;
    const facts = compareChecksumDisplay(sent, input);
    const summary = checksumComparisonSummary(facts);
    return <div className="space-y-3 border-b border-[var(--wsr-border)] pb-4 text-sm" data-testid="checksum-comparison">
        <h3 className="font-semibold">{summary.title}</h3>
        {summary.detail && <p>{summary.detail}</p>}
        <div className="space-y-3 rounded-md border border-[var(--wsr-border)] p-3">
            <div className="space-y-1">
                <p className="text-xs text-[var(--wsr-fg-secondary)]">Recipient in the dApp request · step 1</p>
                <code className="block select-all break-all text-xs" data-testid="checksum-request-address">{facts.casingDiffers
                    ? <HighlightedAddress value={sent} other={facts.displayed} /> : sent}</code>
            </div>
            <div className="space-y-1">
                <p className="text-xs text-[var(--wsr-fg-secondary)]">Wallet display · what you pasted</p>
                <code className="block select-all break-all text-xs" data-testid="checksum-pasted-address">{facts.state === "empty"
                    ? "No address pasted yet"
                    : facts.casingDiffers ? <HighlightedAddress value={facts.displayed} other={sent} /> : visibleChecksumInput(facts.displayed)}</code>
            </div>
        </div>
    </div>;
}
