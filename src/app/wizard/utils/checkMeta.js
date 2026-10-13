import checksSnapshot from "@/app/wizard/config/checks-snapshot.json";

/**
 * The check's display TITLE, DERIVED from the vendored checks.json snapshot
 * (`checks[canonicalId].name`) rather than hardcoded in wizard.json — so an
 * upstream rename reaches the wizard with the next snapshot refresh instead of
 * silently drifting.
 *
 * The platform variant is NOT appended — the navbar campaign selector already
 * makes the campaign obvious, so a "· Browser"/"· Mobile" suffix on the title
 * is just noise. The suffix still lives where it's part of the real identity:
 * the versioned canonical id (header id line, navigator tooltip) and the
 * evidence `check` field.
 *
 * Fallback chain (belt-and-braces): the authored wizard.json title (now
 * removed, so this term is normally undefined) → the canonical id → the slug
 * → a generic label, so the header can never render blank. The refresh guard
 * (scripts/refresh-checks-snapshot.mjs) already fails if a wizard canonicalId
 * is missing from the snapshot, so the primary path effectively always wins.
 *
 * @param {object} step a wizard sub-step ({ canonicalId, id, metadata })
 */
export const checkTitle = (step) => {
    const canonical = checksSnapshot.checks?.[step?.canonicalId];
    return (
        canonical?.name ??
        step?.metadata?.title ??
        step?.canonicalId ??
        step?.id ??
        "Check"
    );
};
