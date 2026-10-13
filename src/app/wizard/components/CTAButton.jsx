import React from "react";

const CTAButton = ({ onClick, disabled, children, className = "" }) => {
    return (
        <button
            type="button"
            className={`inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium md:h-10 md:min-h-0 md:w-auto md:px-5 md:py-0
                       border border-blue-500/70 bg-transparent text-blue-600 hover:bg-blue-500/10 hover:text-blue-700
                       dark:border-blue-400/50 dark:text-blue-400 dark:hover:bg-blue-400/10 dark:hover:text-blue-300
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors ${className}`}
            onClick={onClick}
            disabled={disabled}>
            {children}
        </button>
    );
};

export default CTAButton;
