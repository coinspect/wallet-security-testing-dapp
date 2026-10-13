// Shared normaliser for a step's how-to-test `action`, which may be a STRING
// (today's inline prose) or an ARRAY of short clauses (rendered as bullets by
// StepRenderer). Every site that needs the action AS A SINGLE STRING — surface
// derivation, button-label matching, /params display — routes through this one
// function, so an array can never silently change behaviour by, say, flipping a
// wizard step to wallet.
//
// Clauses are joined with a single space: a button label sits within ONE clause,
// so `.includes(label)` still finds it, and BROWSER_ACTION keywords (browser /
// tabs / URLs / domains) are still matched anywhere in the joined text. A plain
// string is returned unchanged, so every existing string action behaves exactly
// as before; a non-string / nullish value normalises to "".
export const actionToString = (action) =>
    Array.isArray(action)
        ? action.filter((c) => typeof c === "string").join(" ")
        : typeof action === "string"
            ? action
            : "";
