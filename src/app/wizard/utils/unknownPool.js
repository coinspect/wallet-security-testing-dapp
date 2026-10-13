import { testParams } from "@/utils/constants";

// THRE-005's unknown-address pool, DERIVED from the registry (single source),
// in registry order — candidate 1 is the frozen v0.1.0/v0.2.0 target.
const POOL_KEY = /^unknown_address_target(_\d+)?$/;

export const UNKNOWN_POOL = testParams
    .filter((p) => p.group === "Recipient addresses" && POOL_KEY.test(p.key))
    .map((p, i) => ({ key: p.key, address: p.value, index: i + 1 }));

export const DEFAULT_UNKNOWN_CANDIDATE = UNKNOWN_POOL[0]?.key;

export const findCandidate = (key) =>
    UNKNOWN_POOL.find((c) => c.key === key) ?? UNKNOWN_POOL[0];

// Only THRE-005 (the unknown-address check) offers the pool.
export const hasUnknownPool = (action) => action === "sendUnknownTransaction";

export const polygonscanAddress = (addr) => `https://polygonscan.com/address/${addr}`;
