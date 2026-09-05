<div align="center">

# ⌁ ArcName

**Domain name registration & management dApp on the Arc Network testnet — ENS-style names, live RPC telemetry, USDC-native.**

</div>

ArcName is an identity layer for the [Arc Network](https://arc.io): it turns a 42-character wallet
address into a short, human-readable name (`alice.arc`) that you can **register, own, and transfer**
on Arc testnet. It is a fully static, zero-build web app with a tiny Solidity registry — designed to be
honest by default: **every number on screen streams live from the Arc RPC, and nothing is ever simulated.**

---

## Why ArcName?

- **One identity across every Arc app.** A single human handle that people, dApps and AI agents on Arc
  can resolve — pay you, find you and verify you without copy-paste.
- **A portfolio of names you own.** Personal handles, brands, studios — each name is an onchain record
  (name → owner) registered on the Arc ledger, collectible and transferable like the asset it is.
- **No renewals, no middleman.** v1 registration writes an immutable record and hands ownership to your
  wallet. Names stay yours until you transfer them.
- **Live, not fake.** Block height, chain ID, gas price and balances are fetched from the real Arc
  testnet RPC every 10 s, with explicit loading / error / offline states. When no registry is deployed,
  the app says so instead of pretending.

## Features

| Feature | Status |
| --- | --- |
| Live telemetry (block / chain / gas) auto-refresh ~10 s, honest offline state | ✅ built-in |
| Wallet connect via injected EIP-1193 + `wallet_addEthereumChain` (Arc testnet, 5042002) | ✅ built-in |
| Native USDC balance (`eth_getBalance`, 18-dec native — see note below) | ✅ built-in |
| Name search + availability + register flow | ✅ built-in, **activates after you deploy the registry** |
| ENS-style registry (`contracts/ArcNameRegistry.sol`) | ✅ included, deploy via Remix |
| Deploy-to-activate gate (no fake registrations) | ✅ built-in |
| Vercel-ready static deploy | ✅ `vercel.json` |

> **USDC decimals note.** Arc runs USDC as its **native** token. Per the official Arc docs
> ([EVM differences](https://docs.arc.io/arc/references/evm-differences)), the native interface —
> which is what `eth_getBalance` returns — uses **18 decimals**, while the separate ERC-20 interface
> at `0x3600…0000` uses 6. ArcName therefore formats native balances with 18 decimals. (Never divide
> an `eth_getBalance` result by 1e6 on Arc.)

## Arc Testnet chain parameters

| Parameter | Value |
| --- | --- |
| Network name | Arc Testnet |
| Chain ID | `5042002` (`0x4CEF52`) |
| RPC (primary) | `https://rpc.testnet.arc.network` |
| RPC (fallback) | `https://rpc.testnet.arc.io` |
| Native / gas token | USDC (native decimals **18**; ERC-20 interface 6) |
| Block explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |
| Docs | https://docs.arc.network |
| Finality | sub-second, deterministic |

The RPC endpoints are configured in [`js/config.js`](js/config.js); the app tries them in order and
reports which one answered.

## Project layout

```
arc-domain/
├── index.html                 # single-page app shell (SEO meta, OG, JSON-LD)
├── css/styles.css             # dark glassmorphism design system
├── js/
│   ├── config.js              # ⚙️ chain params + REGISTRY_ADDRESS (edit after deploy)
│   ├── core.js                # pure logic: validation, units, RPC transport, ABI encode/decode
│   └── app.js                 # UI glue: telemetry, wallet, registry console
├── contracts/
│   └── ArcNameRegistry.sol    # minimal ENS-style registry (Solidity 0.8.20+)
├── DEPLOY.md                  # deploy the registry to Arc testnet (Remix walkthrough)
├── vercel.json                # static hosting config
└── README.md
```

## Run locally

ArcName is plain HTML/CSS/JS — no build step, no package manager required.

```bash
# simplest: open index.html directly in a browser
# better (proper origin for wallet + fetch): serve the folder
npx serve .
```

Then open the printed URL (default http://localhost:3000). To test registration end-to-end you also need
a browser wallet with Arc testnet added (the app does it for you on connect) and a deployed registry —
see [DEPLOY.md](DEPLOY.md).

## Deploy to Vercel

Zero config (the project is static), but `vercel.json` is included for safe headers.

```bash
npm i -g vercel
vercel            # or: vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard — framework preset **Other**, build command empty,
output directory `.`. That’s it.

## Activating registration (one-time)

1. Deploy `contracts/ArcNameRegistry.sol` to Arc testnet — follow [DEPLOY.md](DEPLOY.md) (Remix steps,
   constructor fee in 18-dec native USDC, e.g. `0` = free).
2. Put the deployed address in `js/config.js` → `REGISTRY_ADDRESS`.
3. Refresh. The console goes live: availability checks, fee, name count and registration transactions
   all talk to your contract onchain. Until then the app shows the deploy gate — nothing is faked.

## How the contract works

`ArcNameRegistry` is a minimal ENS-style registry:

- `register(string name)` — payable; validates `a-z0-9`, 3–32 chars; fee = `price` (native USDC);
  stores `name → msg.sender` and emits `NameRegistered`.
- `ownerOf(name)` / `isAvailable(name)` / `totalNames()` / `getAllNames()` — onchain reads.
- `transfer(name, to)` — owner-only; `setMetadataURI(name, uri)` — owner-only.
- `setPrice`, `setAdmin`, `withdraw` — admin controls.

Gas is paid in USDC automatically; native value follows Arc’s rules (no transfers to `0x0`, no burns).

## Verifying the live data

No hardcoded numbers: on load the app calls `eth_blockNumber`, `eth_chainId` and `eth_gasPrice` against
the Arc testnet RPC and re-polls every 10 seconds (values pause with an **offline** banner if the RPC is
unreachable). You can confirm the same numbers yourself with any RPC tool, e.g.:

```bash
curl -s https://rpc.testnet.arc.network -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## Disclaimer

Independent experiment on the **Arc testnet**. Test USDC has no value; the registry is unaudited and
intended for experimentation, not mainnet use. Not affiliated with ENS or Circle.
