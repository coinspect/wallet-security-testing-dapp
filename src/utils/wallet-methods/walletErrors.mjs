export function isUserRejection(error) {
    return error?.code === 4001
        || /user (denied|rejected|disapproved)/i.test(error?.message || "");
}

// Some wallets use vendor codes (e.g. Trust's -32000) for an explicit cancel.
// Match the message narrowly; a timeout, transport abort or internal error is
// not a tester decision, even when its text mentions a rejection.
export function isUserCancellation(error) {
    if ([-32603, -32601, 4200].includes(Number(error?.code))) return false;
    const message = error?.message?.split?.('\n')[0]?.trim() ?? '';
    return isUserRejection(error)
        || /^(?:returned error:\s*)?(?:cancelled|canceled|user cancelled|user canceled|cancelled by user|canceled by user)[.!]?$/i.test(message);
}

export function isRequestExpired(error) {
    return /^Request expired\.?(?: Please try again\.?)?$/i.test(error?.message?.trim() ?? '');
}

export function isDeadWalletConnectSession(error) {
    const message = error?.message || "";
    return /no matching key.*(?:session|topic)|(?:session|pairing)(?: topic)?.*(?:expired|disconnected|not found|does not exist)|not connected.*(?:session|walletconnect)/i.test(message);
}

export function skippedRequestsAfterTimeout(methods, completedIndex) {
    return methods.slice(completedIndex + 1).map((method) => ({
        method,
        outcome: "not_attempted_after_timeout",
        data_returned: null,
        elapsed_ms: 0,
    }));
}
