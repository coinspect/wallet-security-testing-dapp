# Approval comparison token

`WSRDuplicateToken.sol` is a test duplicate for `WSR-VERI-005.v1`, not USDC or a stablecoin. Its constructor copies `name()`, `symbol()` and `decimals()` from Polygon USDC.e at `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`. These values remain fixed after deployment.

The contract has zero supply, no mint function and no administrator. ERC-20 approval does not require a token balance. The comparison covers approval dialogs, not transfers or balance-dependent warnings.

## Deployment

Compiler: Solidity 0.8.25, optimizer enabled with 200 runs, EVM target `paris`. No constructor arguments. Deployment is restricted to Polygon (chain ID 137).

## Comparison

Order: USDC.e, test duplicate, WSRT. The DApp labels the duplicate `USDC.e metadata duplicate (test)` and includes its full contract address in the captured result. All three cases use the same `APPROVE_SPENDER` and unlimited direct approval. Capture and cancel each wallet prompt; do not approve.

Deployed on Polygon at `0xF22b74Fd841FB9124730e7777ed785A162283297`. Metadata and zero supply were checked at block `97266068`. Executable bytecode matches the local build, excluding compiler metadata.
