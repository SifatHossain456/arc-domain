# ArcName roadmap

Where ArcName goes next. Status legend: ✅ done · ⬜ planned.

## P1 — Testnet foundation ✅ (current state of `main`)

- ✅ **Hardhat project** — `contracts/ArcNameRegistry.sol` compiles on Solidity 0.8.20+,
  35-test suite (`npx hardhat test`), one-command Arc testnet deploy
  (`npx hardhat run scripts/deploy.js --network arcTestnet`, EIP-1559 type-2 with the
  20 gwei `maxFeePerGas` floor).
- ✅ **Fee-aware transactions** — register txs quote `eth_feeHistory` / `eth_gasPrice`,
  send with `maxFeePerGas = max(20 gwei, baseFee·2 + 1 gwei tip)` and show the estimated
  USDC gas fee before the wallet prompt.
- ✅ **Live Network panel** — gas slow/avg/fast (gwei + $ per 21,000-gas transfer),
  transactions today, total addresses/transactions, utilization % and avg block time from
  the free Blockscout stats API, refreshed ~15 s, with an honest offline state.
- ✅ **SEO / PWA shell** — `site.webmanifest`, SVG favicon, `theme-color`, canonical,
  complete OG/Twitter tags, JSON-LD (WebSite + SoftwareApplication), `robots.txt`,
  `sitemap.xml`.

## P2 — Resolver UX · My Names · profile pages ⬜

- Owned-names dashboard (“My Names”) for the connected wallet: list, transfer and
  metadata controls without touching the contract directly.
- Human-readable profile pages (`{name}.arc`) rendering owner + metadata URI, and an
  offchain resolver layer so external dApps/agents can resolve names.

## P3 — Activity feed from Blockscout logs ⬜

- Pull `NameRegistered` / `NameTransferred` / `MetadataUpdated` events from the
  Blockscout logs API into a live activity feed on the landing page (registry, recent
  names, transfers).

## P4 — Accessibility / Lighthouse ⬜

- Target ≥ 95 across all Lighthouse categories: keyboard flows, focus management,
  ARIA on the console/panels, contrast, semantic landmarks, reduced-motion review,
  meta/social polish.

## P5 — JS SDK snippet + Multicall3 batch reads ⬜

- A tiny dependency-free `@arcname/sdk` snippet (register / resolve / transfer) and
  README embeddable in any app.
- Batch availability & owner reads through a Multicall3 contract instead of
  N serial RPC calls.

---

## Not adding

- **No token launch / governance token.** ArcName is an identity layer, not a token
  project; no emissions, no staking, no airdrop farming mechanics.
- **No NFT collection / marketplace.** Names are plain onchain records; we won't wrap
  them into an NFT standard or run a secondary-market UI.
- **No swaps / DeFi.** Out of scope — the app stays a registry + resolver frontend.
