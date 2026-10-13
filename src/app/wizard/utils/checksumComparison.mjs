import { hasValidEip55Checksum } from "./eip55.mjs";

function invalidInputReason(value) {
    if (/\.\.\.|…/.test(value)) return "truncated";
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return "hash";
    if (/^[0-9a-fA-F]{40}$/.test(value)) return "missing-prefix";
    if (!value.startsWith("0x")) return "prefix";
    if (/[^0-9a-fA-F]/.test(value.slice(2))) return "characters";
    return "length";
}

// Facts about tester-entered text only. Never used to build/normalize a request
// and deliberately kept separate from automatically recorded wallet evidence.
export function compareChecksumDisplay(sent, input) {
    const displayed = typeof input === "string" ? input.trim() : "";
    if (!displayed) return { state: "empty" };
    if (!/^0x[0-9a-fA-F]{40}$/.test(displayed)) {
        return { state: "invalid", displayed, reason: invalidInputReason(displayed) };
    }
    const matchesSent = displayed.toLowerCase() === sent.toLowerCase();
    return {
        state: "compared",
        displayed,
        validChecksum: hasValidEip55Checksum(displayed),
        matchesSent,
        casingDiffers: matchesSent ? displayed !== sent : null,
    };
}

// Plain-language interpretation of the comparison, not a wallet pass/fail.
export function checksumComparisonSummary(facts) {
    if (facts.state === "empty") return {
        title: "Paste the wallet's recipient address to compare",
        detail: "Use step 2. The full address needs 0x followed by 40 hex characters (42 characters total).",
    };
    if (facts.state === "invalid") {
        const details = {
            truncated: "The pasted text contains an ellipsis (… or ...). Open the full recipient address in the wallet; a shortened address cannot be compared.",
            hash: "The pasted value has 64 hex characters after 0x, the length of a transaction hash. A recipient address has 40. Copy the recipient, not the transaction hash.",
            "missing-prefix": "The pasted text has 40 hex characters but no 0x prefix. Check the full recipient address in the wallet and paste it exactly as displayed.",
            prefix: "The pasted text does not start with 0x. Paste only the full recipient address, without a label, URL or quotation marks.",
            characters: "The pasted text contains characters other than 0–9 and A–F after 0x, such as spaces or invisible characters. Check the paste; do not change the letters' case.",
            length: `The pasted text has ${facts.displayed.length - 2} hex characters after 0x; an address needs exactly 40 (42 characters including 0x). Check that you copied the full recipient.`,
        };
        return { title: "Address not compared yet", detail: details[facts.reason] };
    }
    if (!facts.matchesSent) return {
        title: "Different address — not just different letter case",
        detail: "The pasted address is not the recipient from step 1, even ignoring uppercase and lowercase. Check that you copied the recipient, not your account or another address.",
    };
    if (!facts.casingDiffers) return {
        title: "Same address — letter case unchanged",
        detail: "Your pasted address exactly matches the dApp request, including its deliberately invalid checksum. This alone does not tell us whether the wallet warned.",
    };
    if (facts.validChecksum) return {
        title: "Same address — the wallet changed the letter case to fix the checksum",
    };
    const body = facts.displayed.slice(2);
    const uniformCase = body === body.toLowerCase() || body === body.toUpperCase();
    return {
        title: "Same address — letter case changed",
        detail: uniformCase
            ? "The pasted address uses only lowercase or only uppercase letters, so it does not show a mixed-case checksum. The recipient is the same."
            : "The pasted address uses different uppercase/lowercase letters, but its EIP-55 checksum is still invalid. The recipient is the same.",
    };
}

// Make paste artifacts visible without silently removing/replacing them for
// validation. Valid addresses pass through byte-for-byte, including letter case.
export function visibleChecksumInput(value) {
    return [...value].map((character) => {
        const point = character.codePointAt(0);
        if (/\s|\p{Cc}|\p{Cf}/u.test(character)) return `[U+${point.toString(16).toUpperCase().padStart(4, "0")}]`;
        return character;
    }).join("");
}
