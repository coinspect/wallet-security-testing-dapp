// Embedded at build time. Never re-label evidence from an older build
// when loading it from session storage or exporting a mixed-build campaign.
const metadata = typeof __WSR_BUILD_PROVENANCE__ === 'undefined' ? null : __WSR_BUILD_PROVENANCE__;
export const BUILD_PROVENANCE = Object.freeze(metadata ?? {
    build_id: null,
    mode: 'unavailable',
    git_commit: null,
    git_dirty: null,
    source_sha256: null,
    checks_snapshot: null,
});
