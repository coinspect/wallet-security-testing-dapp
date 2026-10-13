// scripts/refresh-checks-snapshot.mjs
//
// Writes a version-frozen snapshot of the canonical checks.json (from the
// Wallet Security Ranking repo) that the wizard reads to show per-step
// instructions + evidence_requirements.
//
// Why a snapshot (not a runtime fetch): the auto-documentation model wants the
// data FROZEN per dApp version ("this dApp version == checks.json @ SHA X").
// Fetching via the GitHub Contents API pins the blob SHA, so the snapshot is
// traceable and never victim to raw-CDN staleness.
//
// Run:
//   node scripts/refresh-checks-snapshot.mjs
//   CHECKS_REF=release/2026-q2-extension node scripts/refresh-checks-snapshot.mjs
//   GITHUB_TOKEN=ghp_xxx node scripts/refresh-checks-snapshot.mjs   # avoids the 60/hr anon limit
//
// Requires Node 18+ (global fetch).

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

// ---- config ---------------------------------------------------------------
const REPO = "coinspect/wallet-security-ranking";
const SRC_PATH = "config/checks.json";
const OUT_PATH = "src/app/wizard/config/checks-snapshot.json";
const WIZARD_PATH = "src/app/wizard/config/wizard.json";
const REF = process.env.CHECKS_REF || "main"; // branch, tag, or commit SHA
const ALLOW_CANONICAL_DRIFT = process.env.ALLOW_CANONICAL_DRIFT === "true";
// ---------------------------------------------------------------------------

if (!/^[A-Za-z0-9._/-]{1,160}$/.test(REF) || REF.includes("..") || REF.startsWith("/") || REF.endsWith("/")) {
  throw new Error("CHECKS_REF contains unsupported characters or path segments.");
}

const api = `https://api.github.com/repos/${REPO}/contents/${SRC_PATH}?ref=${encodeURIComponent(REF)}`;

const res = await fetch(api, {
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": "wsr-wizard-snapshot",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  },
});

if (!res.ok) {
  const hint =
    res.status === 403
      ? " (rate limited? set GITHUB_TOKEN)"
      : res.status === 404
        ? ` (check REF="${REF}" and path "${SRC_PATH}")`
        : "";
  throw new Error(`GitHub API ${res.status} ${res.statusText} for ${api}${hint}`);
}

const meta = await res.json();
if (Array.isArray(meta) || meta.type !== "file" || !meta.content) {
  throw new Error(`Expected a file at ${SRC_PATH}@${REF}, got something else.`);
}

const raw = Buffer.from(meta.content, "base64").toString("utf8");

if (!/^[0-9a-f]{40}$/.test(String(meta.sha ?? ""))) {
  throw new Error("GitHub returned an invalid blob SHA.");
}
const computedBlobSha = createHash("sha1")
  .update(`blob ${Buffer.byteLength(raw)}\0`)
  .update(raw)
  .digest("hex");
if (computedBlobSha !== meta.sha) {
  throw new Error(`Git blob verification failed: API=${meta.sha}, computed=${computedBlobSha}`);
}

let checks;
try {
  checks = JSON.parse(raw);
} catch (e) {
  throw new Error(`Fetched checks.json is not valid JSON: ${e.message}`);
}

const keys = Object.keys(checks);
if (keys.length === 0) {
  throw new Error("Fetched checks.json parsed to an empty object — aborting.");
}

// Faithful full copy + provenance. The wizard displays only a subset per step,
// but the file keeps everything so the record is complete and auditable.
const snapshot = {
  _provenance: {
    source: `${REPO}/${SRC_PATH}`,
    ref: REF,
    blobSha: meta.sha,
    fetchedAt: new Date().toISOString(),
    note: "Version-frozen copy of checks.json. Do NOT edit by hand — run scripts/refresh-checks-snapshot.mjs.",
  },
  checks,
};

// ---- drift check: warn when canonical text changed upstream ---------------
// The wizard no longer DISPLAYS canonical instructions / evidence_requirements —
// they were re-authored by hand into wizard.json's bulletPoints /
// evidenceChecklist. So a silent upstream edit to either field can leave those
// hand-authored strings stale. Diff the EXISTING snapshot (pre-overwrite)
// against the fresh fetch and flag every changed field for human review. This
// only warns; the new snapshot is still written below.
const DRIFT_FIELDS = ["instructions", "evidence_requirements"];
let prevChecks = null;
try {
  const prev = JSON.parse(await readFile(OUT_PATH, "utf8"));
  prevChecks = prev?.checks ?? null;
} catch {
  // No existing snapshot (first run) or unreadable/invalid — nothing to diff.
  prevChecks = null;
}

if (prevChecks) {
  const drifts = [];
  for (const id of keys) {
    const before = prevChecks[id];
    if (!before) continue; // newly-added check — nothing to compare against.
    for (const field of DRIFT_FIELDS) {
      if ((before[field] ?? null) !== (checks[id][field] ?? null)) {
        drifts.push({ id, field });
      }
    }
  }

  if (drifts.length > 0) {
    console.warn(
      `\n⚠️  Canonical text changed upstream for ${drifts.length} field(s) across ${
        new Set(drifts.map((d) => d.id)).size
      } check(s):`,
    );
    for (const { id, field } of drifts) {
      console.warn(`   • ${id} — ${field} changed`);
    }
    console.warn(
      `\nThe wizard renders hand-authored bulletPoints / evidenceChecklist, NOT`,
    );
    console.warn(
      `this canonical text, so those may now be stale. Review the affected`,
    );
    console.warn(
      `checks in ${WIZARD_PATH} against the new snapshot and update as needed.\n`,
    );
    if (!ALLOW_CANONICAL_DRIFT) {
      throw new Error(
        "Canonical instructions changed. Review/update wizard.json, then rerun with ALLOW_CANONICAL_DRIFT=true.",
      );
    }
  }
}

// ---- validate: every wizard canonicalId still exists in the snapshot ------
// Validate before writing so a failed provenance/canonical check cannot replace
// the last known-good snapshot.
// A miss usually means a check was version-bumped upstream (e.g. .v2 -> .v3)
// and the wizard step's canonicalId needs updating to match.
const baseOf = (id) => String(id).replace(/\.v\d+$/, "");

let wizard;
try {
  wizard = JSON.parse(await readFile(WIZARD_PATH, "utf8"));
} catch (e) {
  console.error(`\n❌ Could not read/parse ${WIZARD_PATH}: ${e.message}`);
  console.error("Snapshot was not written.\n");
  process.exit(1);
}

const wizardChecks = wizard?.wizard?.checks ?? {};
const wizardIds = [
  ...new Set(
    Object.values(wizardChecks).flatMap((check) =>
      (check?.steps ?? [])
        .map((step) => step?.canonicalId)
        .filter(Boolean),
    ),
  ),
];

const snapshotKeys = new Set(keys);
const missing = wizardIds.filter((id) => !snapshotKeys.has(id));

if (missing.length > 0) {
  console.error(
    `\n❌ ${missing.length} wizard canonicalId(s) missing from the snapshot:`,
  );
  for (const id of missing) {
    const base = baseOf(id);
    const candidates = keys.filter((k) => baseOf(k) === base);
    console.error(`   • ${id}`);
    console.error(
      `       available for "${base}": ${candidates.length ? candidates.join(", ") : "(none)"}`,
    );
  }
  console.error(
    `\nA wizard step's canonicalId no longer matches the canonical checks.json`,
  );
  console.error(
    `(likely a version bump upstream). Update the canonicalId in ${WIZARD_PATH}`,
  );
  console.error(`to one of the available keys listed above, then re-run.`);
  console.error(`The snapshot was not written.\n`);
  process.exit(1);
}

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

console.log(
  `Wrote ${OUT_PATH} — ${keys.length} checks, verified blob ${meta.sha.slice(0, 7)} @ ${REF}`,
);

console.log(
  `${wizardIds.length}/${wizardIds.length} wizard canonicalIds present in snapshot`,
);
