const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, args) => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
};

// Fingerprint build inputs, including uncommitted files, but never environment
// files, local caches or credentials. Only the digest goes into the client.
function sourceFingerprint(root) {
    const files = [];
    const walk = (directory) => {
        if (!existsSync(path.join(root, directory))) return;
        for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const relative = `${directory}/${entry.name}`;
            if (entry.isDirectory()) walk(relative);
            else if (entry.isFile()) files.push(relative);
            else throw new Error(`Unsupported build input: ${relative}`);
        }
    };
    for (const directory of ['src', 'public', 'contracts', 'scripts']) walk(directory);
    for (const file of ['package.json', 'package-lock.json', 'index.html', 'vite.config.mjs', 'tailwind.config.js', 'postcss.config.js', 'jsconfig.json', 'netlify.toml']) {
        if (existsSync(path.join(root, file))) files.push(file);
    }
    const digest = createHash('sha256');
    for (const file of files.sort()) {
        digest.update(file).update('\0').update(sha256(readFileSync(path.join(root, file)))).update('\0');
    }
    return digest.digest('hex');
}

function createBuildProvenance(root, { development = false } = {}) {
    const snapshot = readFileSync(path.join(root, 'src/app/wizard/config/checks-snapshot.json'));
    const provenance = JSON.parse(snapshot)._provenance;
    const commit = git(root, ['rev-parse', 'HEAD']) ?? process.env.COMMIT_REF;
    const status = git(root, ['status', '--porcelain', '--untracked-files=normal']);
    return {
        build_id: randomUUID(),
        mode: development ? 'development' : 'production',
        git_commit: /^[a-f0-9]{40,64}$/i.test(commit ?? '') ? commit : null,
        git_dirty: status === null ? null : status.length > 0,
        // HMR changes source after startup. Do not label that moving target as
        // the fingerprint of an immutable production build.
        source_sha256: development ? null : sourceFingerprint(root),
        checks_snapshot: {
            source: provenance.source,
            ref: provenance.ref,
            blob_sha: provenance.blobSha,
            sha256: development ? null : sha256(snapshot),
        },
    };
}

module.exports = { createBuildProvenance, sourceFingerprint };
