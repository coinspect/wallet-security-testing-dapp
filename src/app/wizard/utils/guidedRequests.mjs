import { isUserCancellation } from "../../../utils/wallet-methods/walletErrors.mjs";

// Presentation only: dispatch, payloads, method order and transport stay in the
// existing ActionPanel, wizard.json and wallet handlers.
const rejectRequests = "Use a dedicated test wallet. Capture each wallet screen, then cancel every request. Do not sign or approve transactions.";
const authStages = (setup, review) => [
    { title: "Prepare your wallet", instruction: setup, preparation: true },
    { title: "Run the requests", instruction: "Watch whether each request asks for permission or returns without asking. Cancel every prompt.", action: true },
    { title: "Review the responses", instruction: review },
];
const authReview = "Keep the wallet screenshots alongside the responses below. Returned data needs review; an unsupported method or a timeout does not establish whether the wallet requested confirmation.";

export const GUIDED_REQUESTS = {
    "WSR-THRE-001.v1": {
        objective: "Compare how your wallet identifies this testing dApp, an unknown dApp and a known dApp.",
        safety: "Capture each connection dialog, then cancel. Do not grant access.",
        button: "Request connection",
        stages: [
            { title: "Check this dApp", instruction: "Look for an unknown or unverified label on the connection request. Capture the screen, then cancel.", action: true },
            { title: "Check the unknown dApp", instruction: "Open the site and request a connection there. Capture the domain and any trust label, then cancel.", links: true, linkKeys: ['unknown_dapp_url'] },
            { title: "Compare a known dApp", instruction: "Open one of these dApps and request a connection there. Capture any verified or trusted badge, then cancel.", links: true, linkKeys: ['verified_dapp_url', 'aave_dapp_url', 'curve_dapp_url'] },
            { title: "Compare the screens", instruction: "Record the trust labels shown for each dApp. Keep the screenshots." },
        ],
    },
    "WSR-THRE-003.v1": {
        objective: "Check which phishing sites your wallet or browser warns about or blocks.",
        safety: "These are phishing test URLs. Do not enter information, connect a wallet or interact with the sites. Close each tab after capturing the response.",
        button: "Open first phishing URL",
        stages: [
            { title: "Check the first site", instruction: "Open the first URL. Capture any warning, block or lack of warning, then close the tab.", action: true },
            { title: "Check the remaining sites", instruction: "Work through the full team-curated list one URL at a time. Record the response for each URL; a site being unavailable is not a phishing warning.", links: true },
            { title: "Review your observations", instruction: "Keep the screenshots with their URLs. Distinguish a wallet warning, a browser warning and a site that opened without a warning." },
        ],
    },
    "WSR-THRE-004.v1": {
        objective: "Check whether the connection dialog explains what this dApp can access.",
        safety: "Capture the connection dialog, then cancel. You do not need to grant access.",
        button: "Request connection",
        stages: [
            { title: "Review the connection dialog", instruction: "Look for disclosure of access to your balance, activity and approvals. Capture the dialog before cancelling.", action: true },
            { title: "Review the disclosure", instruction: "Record which permissions the wallet explained and which were missing. Keep the screenshot; the connection response alone does not show the disclosure." },
        ],
    },
    "WSR-THRE-005.v1": {
        objective: "Check whether your wallet flags a first-time recipient, from a dApp request and from manual entry.",
        safety: "Use a dedicated test wallet on Polygon. Cancel both tests. Do not approve or send either transaction.",
        button: "Send unknown-address request",
        stages: [
            { title: "Choose an unused recipient", instruction: "Choose a candidate you have not sent to from this wallet. Keep the same recipient for both tests.", preparation: true },
            { title: "Review the dApp request", instruction: "Look for an unknown-address or first-time-recipient warning. Capture the wallet screen, then cancel.", action: true, target: true },
            { title: "Test manual entry", instruction: "Copy the recipient below and paste it into the wallet's own send screen. Capture any first-time-recipient warning, then cancel.", target: true },
        ],
    },
    "WSR-VERI-006.v1": {
        objective: "Check whether all signing details are readable, without truncation or hidden fields.",
        safety: rejectRequests,
        button: "Review the three signing requests",
        stages: [
            { title: "Review each request in order", instruction: "One click starts this sequence. Capture and cancel each request to reach the next.", action: true, checklist: [
                "personal_sign: check that the entire large message is readable.",
                "Seaport EIP-712: scroll through every field, including verifyingContract. A raw contract address or a resolved name both count as displayed.",
                "Permit EIP-712: check all fields and verifyingContract in the same way.",
            ] },
            { title: "Compare the three screens", instruction: "Record any truncated or hidden details for each request. Keep all three screenshots." },
        ],
    },
    "WSR-VERI-004.v1": {
        objective: "Compare how your wallet parses a flat permit and a nested Seaport order.",
        safety: rejectRequests,
        button: "Review permit and Seaport requests",
        stages: [
            { title: "Review both typed-data requests", instruction: "One click starts both requests. Capture and cancel each in order.", action: true, checklist: [
                "Permit: look for labelled token, spender and amount fields instead of raw JSON.",
                "Seaport: look for structured offer/consideration items and bytes32 fields instead of raw JSON.",
            ] },
            { title: "Compare the two renderings", instruction: "Record the permit and the Seaport order separately: the wallet may parse one but not the other. Keep both screenshots." },
        ],
    },
    "WSR-VERI-007.v1": {
        objective: "Check whether the wallet requires scrolling through a message before enabling signing.",
        safety: rejectRequests,
        button: "Review both long requests",
        stages: [
            { title: "Check the sign button before and after scrolling", instruction: "For each request, capture whether Sign is enabled before scrolling and after reaching the bottom. Do not sign; cancel to continue.", action: true, checklist: [
                "First: the long personal_sign message (informational).",
                "Second: the large EIP-712 request — this is the request evaluated by this check.",
            ] },
            { title: "Review the scroll requirement", instruction: "Keep the before-and-after screenshots. Record whether EIP-712 signing was disabled until the full message had been reviewed." },
        ],
    },
    "WSR-PERM-002~Browser.v1": {
        objective: "Check whether a locked wallet serves requests without being unlocked.", safety: rejectRequests, button: "Run requests while locked",
        stages: authStages("Connect this dApp and switch to Polygon first. Then lock the wallet without disconnecting this dApp. Keep it locked while running the requests.", authReview),
    },
    "WSR-PERM-002~Mobile.v1": {
        objective: "Check whether a locked mobile wallet serves requests over its existing WalletConnect session.", safety: rejectRequests, button: "Run requests while locked",
        stages: authStages("Pair this dApp using Connect Wallet and switch to Polygon first. Then lock the wallet app or phone, keeping the pairing. If you reconnect to recover the test, lock the wallet again before resuming.", "If locking dropped the pairing, record the session loss and repeat the setup before retrying. It is not evidence of an authorization bypass. Otherwise, review returned data alongside your wallet screenshots."),
    },
    "WSR-PERM-008~Browser.v1": {
        objective: "Check whether the wallet serves requests before this dApp has permission to connect.", safety: rejectRequests, button: "Run requests while disconnected",
        stages: authStages("Switch the wallet to Polygon, then revoke this dApp's connection in the wallet. Confirm the address below without reconnecting the dApp.", authReview),
    },
    "WSR-PERM-010~Browser.v1": {
        objective: "Check whether requests require your confirmation while the wallet is connected and unlocked.", safety: rejectRequests, button: "Run confirmation requests",
        stages: authStages("Connect using the header and unlock your wallet. Keep it connected and unlocked for this test.", authReview),
    },
    "WSR-PERM-007~Mobile.v1": {
        objective: "Check whether WalletConnect requests require confirmation in the mobile wallet.", safety: rejectRequests, button: "Run WalletConnect requests",
        stages: authStages("Pair your mobile wallet using Connect Wallet. Keep the wallet app unlocked and ready to review the prompts.", authReview),
    },
    "WSR-PERM-010~Mobile.v1": {
        objective: "Check whether requests from the wallet's built-in browser require your confirmation.", safety: rejectRequests, button: "Run embedded-browser requests",
        stages: authStages("Open this page inside your wallet app's built-in browser. Stay in Mobile and use Connect Wallet above to connect the embedded wallet, then unlock it. This check does not use WalletConnect. If your wallet has no built-in browser, skip this check.", authReview),
    },
};

export function requestCancelled(error) {
    return isUserCancellation(error);
}

const SIGNING_LEGS = {
    clearMethodSignRequest: [["personalSign", "Personal Sign"], ["typedData", "Typed Data (Seaport)"], ["permit", "Typed Data (Permit)"]],
    signPermitAndSeaport: [["permit", "Permit (EIP-712)"], ["seaport", "Seaport order (EIP-712)"]],
    signLongMessageAndTypedData: [["personalSign", "Long Message (personal_sign)"], ["typedData", "Typed Data (eth_signTypedData_v4)"]],
};

// The extension's legacy handler returns formatted text, WC returns an object.
// Adapt only the visible summary; raw wallet_output remains byte-for-byte intact.
export function signingRequestRows(action, result) {
    const legs = SIGNING_LEGS[action];
    if (!legs || !result) return null;
    return legs.map(([key, label]) => {
        let value = typeof result === "object" ? result[key] : null;
        if (typeof result === "string") {
            const block = result.split("\n\n").find((part) => part.startsWith(`❌ ${label}: `) || part.startsWith(`✅ ${label}: `));
            if (block?.startsWith("❌")) value = { error: block.slice(`❌ ${label}: `.length) };
            else if (block?.startsWith("✅")) value = block.split("Signature: ")[1]?.trim();
        }
        const error = value?.error;
        const signature = typeof value === "string" ? value : value?.result ?? value?.signature;
        return {
            label,
            title: error ? requestCancelled({ message: String(error) }) ? "Cancelled by tester" : "Request returned an error"
                : signature ? "Signature returned" : "No result recorded",
            ...(error ? { detail: String(error) } : signature ? { detail: signature } : {}),
        };
    });
}

export function authRequestTitle(row) {
    if (row.outcome === 'cancelled_by_tester') return 'Cancelled by tester';
    if (row.outcome === 'request_expired') return 'Request expired';
    if (row.network_precondition || row.transport_reason === 'polygon_required') return 'Request not sent — return to Polygon first';
    if (row.outcome === "method_not_approved") return "Method not available in this session — not sent";
    if (row.outcome === "method_not_requested") return "Method not requested at connection — reconnect first";
    if (row.request_submitted === false && row.transport_reason) return "Session unavailable for this request — not sent";
    if ([4200, -32601].includes(row.code)) return "Method not supported by the responder";
    // Do not infer a human refusal from a vendor code or a timing threshold.
    // Auto-rejection and unsupported methods remain separate observations.
    const message = row.outcome?.replace(/^error(?:\s*\([^)]*\))?:\s*/, "");
    if (row.code !== -32603 && (row.outcome === "rejected" || row.outcome?.startsWith("error")) && requestCancelled({ message, code: row.code })) return "Cancelled by tester";
    const names = { resolved: "Data returned", empty: "Empty response", declined: "Request declined", rejected: "Request rejected", no_response: "No response within timeout", stopped_waiting: "Tester stopped waiting — wallet request not cancelled", skipped_by_tester: "Skipped by tester — not sent", not_attempted: "Not sent — run stopped", session_dropped: "Session lost", unstable: "Unstable response" };
    return names[row.outcome] ?? (row.outcome?.startsWith("error") ? "Request returned an error" : row.outcome);
}

const AUTH_FAILURE_REASONS = {
    method_not_requested: "The dApp did not request this method when this session was created. Reconnect to request all test methods. Wallet support was not tested.",
    method_not_approved: "The method is not included in the approved WalletConnect session. The request was not sent.",
    chain_not_approved: "The network is not approved in this WalletConnect session. The request was not sent.",
    account_not_approved: "The account is not approved in this WalletConnect session. The request was not sent.",
    session_changed: "The WalletConnect session changed before dispatch. The request was not sent.",
    session_unavailable: "No active WalletConnect session was available. The request was not sent.",
    polygon_required: "The Polygon network precondition was not met. The request was not sent.",
    network_required: "The Polygon network precondition was not met. The request was not sent.",
    session_dropped: "The connection was lost or unavailable. This does not establish a wallet rejection.",
    request_expired: "The request expired without a wallet response.",
    no_response: "No response arrived before the wait timed out. This does not establish a wallet rejection.",
    unstable: "Account readings did not stabilize during the probe.",
    rejected: "The request was rejected without a recorded reason.",
};

export function authRequestFailure(row) {
    if (authRequestTitle(row) === "Cancelled by tester") return null;
    const reason = row.outcome === "method_not_approved" && row.runtime?.session_permissions?.requested_methods?.includes(row.method)
        ? "The dApp requested this method, but the wallet did not include it in the approved session. No reason was provided by the session approval. The request was not sent; wallet support was not tested."
        : AUTH_FAILURE_REASONS[row.transport_reason] ?? AUTH_FAILURE_REASONS[row.outcome];
    const errorOutcome = row.outcome?.startsWith("error");
    const late = row.late_settlement;
    if (late?.response_outcome) {
        const failure = authRequestFailure({ ...late, outcome: late.response_outcome, late_settlement: undefined });
        return failure ? { ...failure, late: true } : null;
    }
    if (!reason && !errorOutcome) return null;
    return {
        message: row.rpc_error?.message || (errorOutcome ? row.outcome.replace(/^error(?:\s*\([^)]*\))?:\s*/, "") : null)
            || reason || "No additional error message was recorded.",
        code: row.rpc_error?.code ?? row.code ?? null,
    };
}

export function authResultSummary(rows) {
    const pending = rows.filter((row) => row.request_submitted !== false && ["no_response", "stopped_waiting", "request_expired"].includes(row.outcome)).length;
    const unsent = rows.filter((row) => row.request_submitted === false).length;
    const answered = rows.length - pending - unsent;
    return [`${answered} ${answered === 1 ? 'response' : 'responses'} recorded`, pending ? `${pending} without a response` : null, unsent ? `${unsent} not sent` : null].filter(Boolean).join(" · ");
}
