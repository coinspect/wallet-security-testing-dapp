import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
    ".git",
    ".next",
    "build",
    "dist",
    "coverage",
    "node_modules",
    "out",
]);
const forbiddenCredentialFiles = new Set([".npmrc", ".pypirc"]);
const rules = [
    ["private-key PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ["private key assignment", /\bprivate[_-]?key\s*[:=]\s*["'](?:0x)?[0-9a-fA-F]{64}["']/i],
    ["mnemonic assignment", /\b(?:mnemonic|seed[_-]?phrase)\s*[:=]\s*["'][^"'\r\n]{20,}["']/i],
    ["credentialed Infura URL", /https?:\/\/[^\s"']*infura\.io\/v3\/[A-Za-z0-9_-]{8,}/i],
    ["credentialed Alchemy URL", /https?:\/\/[^\s"']*alchemy\.com\/v2\/[A-Za-z0-9_-]{8,}/i],
];

const findings = [];

async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute);

        if (entry.isDirectory()) {
            await walk(absolute);
            continue;
        }

        if (forbiddenCredentialFiles.has(entry.name)) {
            findings.push([relative, "credential file"]);
            continue;
        }
        if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
            findings.push([relative, "environment file"]);
            continue;
        }

        const metadata = await stat(absolute);
        if (metadata.size > 5 * 1024 * 1024) continue;
        const content = await readFile(absolute);
        if (content.includes(0)) continue;
        const text = content.toString("utf8");
        for (const [name, pattern] of rules) {
            if (pattern.test(text)) findings.push([relative, name]);
        }
    }
}

await walk(root);

if (findings.length > 0) {
    console.error("Potential secrets detected (values intentionally omitted):");
    for (const [file, rule] of findings) console.error(`- ${file}: ${rule}`);
    process.exit(1);
}

console.log("No forbidden credential files or known secret patterns detected.");
