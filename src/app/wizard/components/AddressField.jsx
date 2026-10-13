"use client";

import React from "react";
import { ethers } from "ethers";

// Well-formed address (checksum-agnostic). The ONLY text input in the wizard.
export const isValidAddress = (v) => {
    try {
        return typeof v === "string" && ethers.utils.isAddress(v.trim());
    } catch {
        return false;
    }
};

/**
 * PERM-008 (disconnected) can't read eth_accounts, and the canonical instruction
 * says the tester supplies the address. A single validated input — a SELECTION
 * of one value, prefilled with the last address seen while connected. The run
 * button stays disabled until the value is a well-formed address.
 */
const AddressField = ({ value, onChange }) => {
    const showError = value.trim().length > 0 && !isValidAddress(value);
    return (
        <div className="rounded-lg border border-gray-200 bg-surface-light p-4 dark:border-gray-700 dark:bg-dark-surface">
            <label
                htmlFor="auth-bypass-address"
                className="text-[0.8125rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
                Your wallet address
            </label>
            <p className="mt-1 text-[0.8125rem] leading-[1.1rem] text-gray-500 dark:text-gray-400">
                Running disconnected, so the dApp can’t read it — paste the address to test access
                against. Prefilled with the last address seen while connected.
            </p>
            <input
                id="auth-bypass-address"
                type="text"
                spellCheck={false}
                autoComplete="off"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="0x…"
                className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-[0.8125rem] text-gray-800 outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
            {showError && (
                <p className="mt-1 text-[0.8125rem] text-[var(--wsr-note-fg)]">
                    Enter a valid 0x wallet address.
                </p>
            )}
        </div>
    );
};

export default AddressField;
