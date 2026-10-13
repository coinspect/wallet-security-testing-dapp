import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Shared Tailwind class combiner for the wizard and navigation.
 *
 * @param  {...any} inputs
 * @returns {string}
 */
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
