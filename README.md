<a href="https://www.coinspect.com/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/coinspect-logo-dark.svg">
    <img src="public/coinspect-logo.svg" alt="Coinspect" width="240">
  </picture>
</a>

# Wallet Security Testing dApp

**WE TEST, YOU DECIDE**

Built by Coinspect for the Wallet Security Ranking. Guides testers through
security checks for browser extension and mobile wallets, and records responses
for review. Wallet screenshots are captured separately; results require human review.

[Open wizard](https://wsf.tools) ·
[Wallet Security Ranking](https://www.coinspect.com/wallets/) ·
[Checks and data](https://github.com/coinspect/wallet-security-ranking)

## Safety

Use a dedicated test wallet. Some checks send real transactions or approvals.
Follow each check's instructions and cancel when asked. Never enter a seed phrase
or private key. Review evidence before sharing it: it may contain addresses and signatures.

## Run locally

Requires Node.js 22.13.0 or newer.

```sh
npm ci
npm run dev
```

Open [the wizard](http://localhost:3000/wizard/) or
[test parameters](http://localhost:3000/params/). Stop the server when finished.

## Development

Built with React, React Router and Vite. Wallet requests run in the browser.
Preserve test inputs when changing the UI; unusual values may be intentional.
Use mocked wallets for automated tests, not real accounts.

Before submitting changes:

```sh
npm run check:secrets
npm test
npm run verify:token
npm run lint
npm run build
```

Publish `dist/`. Netlify settings, redirects and security headers are included.
Use `npm run preview` to inspect the build locally. Automated tests do not replace
testing the wallet's prompts.

## License

[CC BY 4.0](LICENSE), except where a file states otherwise.
Copyright (c) 2026 Coinspect Security LLC.

The bundled checks come from [Wallet Security Ranking](https://github.com/coinspect/wallet-security-ranking),
Copyright (c) 2024–2026 Coinspect Security LLC, also under CC BY 4.0.
The test token contract retains its MIT license. Third-party materials retain their licenses.
