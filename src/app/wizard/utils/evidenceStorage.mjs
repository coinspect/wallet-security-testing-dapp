export const EVIDENCE_PREFIX = "wsr-evidence:";
export const EVIDENCE_UPDATED_EVENT = "wsr:evidence-updated";

const MAX_STRING_LENGTH = 20_000;
const MAX_DEPTH = 8;
const SIGNATURE_HEX = /^0x[0-9a-fA-F]{128,132}$/;
const SECRET_KEY = /(?:^|_)(?:signature|signed_payload|private_key|seed|mnemonic|secret|screenshot|image_data)(?:$|_)/i;

const sanitizeString = (value) => {
    if (value.startsWith("data:image/")) return "[screenshot omitted]";
    if (SIGNATURE_HEX.test(value)) return "[signature omitted]";
    return value.slice(0, MAX_STRING_LENGTH);
};

export const sanitizeEvidenceForStorage = (value, depth = 0, seen = new WeakSet()) => {
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return sanitizeString(value);
    if (typeof value !== "object" || depth >= MAX_DEPTH) return "[omitted]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.slice(0, 200).map((item) => sanitizeEvidenceForStorage(item, depth + 1, seen));
    }

    const safe = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
        safe[key] = SECRET_KEY.test(key)
            ? "[sensitive value omitted]"
            : sanitizeEvidenceForStorage(item, depth + 1, seen);
    }
    return safe;
};

const storageKey = ({ platform, checkId, step }) =>
    `${EVIDENCE_PREFIX}${encodeURIComponent(platform)}:${encodeURIComponent(checkId)}:${encodeURIComponent(step)}`;

const session = () =>
    typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;

export const archiveCheckEvidence = (platform, checkId) => {
    const target = session();
    if (!target) return;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    for (const key of keys) {
        if (!key?.startsWith(EVIDENCE_PREFIX)) continue;
        const record = JSON.parse(target.getItem(key));
        if (record?.platform !== platform || record?.check !== checkId || record.step.startsWith('previous:')) continue;
        let suffix = 0;
        const base = `previous:${Date.now()}:${record.step}`;
        let step = base;
        while (target.getItem(storageKey({ platform, checkId, step }))) step = `${base}:${++suffix}`;
        target.setItem(storageKey({ platform, checkId, step }), JSON.stringify({ ...record, step }));
    }
};

export const persistEvidenceRecord = ({ platform, checkId, step, evidence }) => {
    const target = session();
    if (!target || !platform || !checkId || !step || !evidence) return false;
    if (evidence.request_outcome === 'skipped_by_tester' && !step.startsWith('skipped:')) step = `skipped:${step}`;
    try {
        const record = {
            platform,
            check: checkId,
            step,
            recorded_at: new Date().toISOString(),
            evidence: sanitizeEvidenceForStorage(evidence),
        };
        target.setItem(storageKey({ platform, checkId, step }), JSON.stringify(record));
        // Older records used `check` where the key builder expected `checkId`.
        // Keep that legacy evidence unless this run replaces the SAME check.
        const legacyKey = storageKey({ platform, step });
        try {
            const legacy = JSON.parse(target.getItem(legacyKey));
            if (legacy?.check === checkId && legacy.platform === platform && legacy.step === step) {
                target.removeItem(legacyKey);
            }
        } catch { /* malformed legacy data must not prevent a new record */ }
        window.dispatchEvent(new CustomEvent(EVIDENCE_UPDATED_EVENT));
        return true;
    } catch {
        return false;
    }
};

const recordsMatching = (predicate) => {
    const target = session();
    if (!target) return [];
    const records = [];
    for (let i = 0; i < target.length; i += 1) {
        const key = target.key(i);
        if (!key?.startsWith(EVIDENCE_PREFIX)) continue;
        try {
            const record = JSON.parse(target.getItem(key));
            if (record && predicate(record)) records.push(record);
        } catch {
            // A corrupt record is ignored rather than breaking the wizard.
        }
    }
    return records.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
};

export const loadCheckEvidence = (checkId, platform) =>
    recordsMatching((record) => record.check === checkId && record.platform === platform);

export const loadCampaignEvidence = (platform) =>
    recordsMatching((record) => record.platform === platform);

const shouldClearWizardKey = (key) =>
    key === "wizard_state" ||
    key?.startsWith("wizard.") ||
    key?.startsWith("wsr-progress:") ||
    key?.startsWith(EVIDENCE_PREFIX);

export const clearWizardStorage = (target) => {
    if (!target) return 0;
    let removed = 0;
    for (let index = target.length - 1; index >= 0; index -= 1) {
        const key = target.key(index);
        if (!shouldClearWizardKey(key)) continue;
        target.removeItem(key);
        removed += 1;
    }
    return removed;
};

export const clearStoredWizardData = () => {
    if (typeof window === "undefined") return 0;
    let removed = 0;
    for (const target of [window.localStorage, window.sessionStorage]) {
        try {
            removed += clearWizardStorage(target);
        } catch {
            // Storage can be disabled independently; clear whichever is usable.
        }
    }
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent(EVIDENCE_UPDATED_EVENT));
    }
    return removed;
};

export const downloadCampaignEvidence = (platform) => {
    const records = loadCampaignEvidence(platform);
    if (typeof document === "undefined" || records.length === 0) return 0;
    const payload = {
        exported_at: new Date().toISOString(),
        platform,
        records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallet-security-evidence-${platform}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return records.length;
};
