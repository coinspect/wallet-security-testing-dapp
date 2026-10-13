# Wallet Security Testing dApp

What happens when a dApp asks a wallet to sign a misleading message, approve an
unknown token, or send a transaction to an address with an invalid checksum?
Testing these scenarios requires more than checking whether a request succeeds.
We also need to see what the wallet tells the user before they make a decision.

We built this dApp to make those checks repeatable. It is the guided testing
interface used in Coinspect's
[Wallet Security Ranking](https://www.coinspect.com/wallets/), with separate
flows for browser extensions and mobile wallets.

Use the live wizard at [wsf.tools](https://wsf.tools). The canonical checks and
ranking data are maintained in
[coinspect/wallet-security-ranking](https://github.com/coinspect/wallet-security-ranking).

## From a request to an observation

The wizard walks testers through wallet permissions, transaction and signature
previews, threat detection, and protection against physical access. Some checks
send requests from the dApp. Others guide the tester through actions inside the
wallet itself.

Each check explains what to do, what to look for, and which screenshots to keep.
The parameter view exposes the inputs used by the checks, so testers can inspect
the contract address, message, network, or RPC method behind a request.

The dApp records responses and execution context as evidence that can be copied
as JSON or a result image. Wallet screenshots are captured separately by the
tester. A returned signature or transaction hash does not establish what the
wallet displayed, and a cancelled request does not mean a check failed. The
wizard does not assign automatic pass or fail results.

JSON evidence also identifies the build that produced it: a build ID, the Git
commit when available, and fingerprints of the source and checks snapshot.
This keeps observations from different releases distinguishable without changing
the test inputs. Local development is labelled separately because hot reload
can change the code after startup; immutable-build fingerprints are only recorded
for production builds. Previously recorded evidence keeps its original identity.

Our [methodology update](https://www.coinspect.com/blog/wallet-security-ranking-fourth-edition/)
explains how the wizard fits into the wider review process.

## Test with a dedicated wallet

These checks deliberately exercise potentially unsafe requests, including real
mainnet transactions and approvals. Use a dedicated test wallet, not a wallet
holding personal or production assets. Follow each check's instructions: when a
check asks you to capture a prompt and cancel, do not sign or approve it.

Never enter a seed phrase or private key into the dApp. Review evidence before
sharing it; requests and responses can contain account addresses and signatures.

## Run it locally

Use Node.js 22.13.0 or newer and install the locked dependencies:

```sh
npm ci
npm run dev
```

Open [the wizard](http://localhost:3000/wizard/) and select Extension or Mobile.
The [parameter registry](http://localhost:3000/params/) exposes the check inputs
and their snapshot provenance. Extension flows use the selected injected
provider; mobile flows can connect through WalletConnect.

## A static site, with wallet interactions in the browser

React handles the interface, React Router handles navigation, and Vite builds the static site.
There is no application backend or database. Wallet interactions run in the
browser and depend on the selected provider, WalletConnect, and RPC services;
this is not an offline test environment.

To produce the deployable site:

```sh
npm run build
```

Publish **`dist/`**. No application server is required. Use `npm run preview` to inspect
the production build locally and stop it when finished.
The repository includes Netlify-compatible redirects and security headers in
`public/_redirects` and `public/_headers`. The SPA fallback serves deep links,
including `/wizard/mobile/WSR-PERM-001/` and `/params/`, on refresh.
`netlify.toml` sets the build command and publish directory.

## Keep the test inputs intact

An unusual address or message may be the condition a check is testing. UI cleanup
must not normalize those inputs or change request methods, values, or ordering.
Changes to check payloads or WalletConnect metadata need a separate methodology
review and targeted wallet testing.

Before submitting changes, run:

```sh
npm run check:secrets
npm test
npm run verify:token
npm run lint
npm run build
```

Token verification checks the committed artifact against its Solidity source and
pinned compiler. Automated validation must use mocks for wallet interactions: it
must not connect a real wallet, request signatures, add or switch networks,
approve assets, or broadcast transactions. Passing these checks does not replace
manual testing of the wallet's prompts and responses.

## License

Except where a file carries an explicit license notice, this project is licensed
under [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE).
Copyright (c) 2026 Coinspect Security LLC.

The bundled checks snapshot comes from
[Wallet Security Ranking](https://github.com/coinspect/wallet-security-ranking),
Copyright (c) 2024–2026 Coinspect Security LLC, also licensed under
[CC BY 4.0](https://github.com/coinspect/wallet-security-ranking/blob/main/LICENSE).
Its source revision and retrieval metadata are recorded in the snapshot.

The test token contract retains its explicit MIT license notice. Dependencies
and third-party materials retain their respective licenses.
