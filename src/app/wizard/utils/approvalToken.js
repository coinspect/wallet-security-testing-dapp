import { TEST_ERC20_ADDRESS, USDC_E } from "@/utils/constants";

// Presentation-only identity from the check configuration, not wallet metadata.
// Keep the same selection precedence as approveTestErc20 and its two transports.
export function approvalTokenForStep(step) {
    if (step?.ui?.content?.button?.action !== "approveTestErc20") return null;
    const params = step.data?.params ?? {};
    const address = (params.useTestToken ? TEST_ERC20_ADDRESS : params.tokenAddress) || USDC_E;
    if (typeof address !== "string") return null;
    const name = address.toLowerCase() === USDC_E.toLowerCase() ? "USDC.e"
        : address.toLowerCase() === TEST_ERC20_ADDRESS.toLowerCase() ? "WSR Test Token (WSRT)"
        : "Custom token";
    return { name, address };
}
