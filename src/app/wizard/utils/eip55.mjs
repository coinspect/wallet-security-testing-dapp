import { ethers } from 'ethers';

/** True only for a valid, mixed-case EIP-55 address. */
export const hasValidEip55Checksum = (value) => {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
    const body = value.slice(2);
    if (body === body.toLowerCase() || body === body.toUpperCase()) return false;
    try {
        return ethers.utils.getAddress(value) === value;
    } catch {
        return false;
    }
};
