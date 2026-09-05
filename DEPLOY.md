# Deploying the ArcName registry

ArcName registers names through a single contract: [`contracts/ArcNameRegistry.sol`](contracts/ArcNameRegistry.sol).
Until a registry is deployed **and** its address is set in [`js/config.js`](js/config.js), the app shows an
honest “deploy to activate” panel and never simulates availability or registrations.

This guide walks you through deploying it to **Arc Testnet** with Remix — no local toolchain required.

---

## 0 · Chain facts you need

| Thing | Value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` (`0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.network` (fallback `https://rpc.testnet.arc.io`) |
| Native / gas token | **USDC** — native balance & `msg.value` use **18 decimals**; the ERC-20 interface at `0x3600…0000` uses 6 (never mix them) |
| Explorer | https://testnet.arcscan.app |
| Faucet (test USDC) | https://faucet.circle.com |
| Docs | https://docs.arc.network |

## 1 · Open the contract in Remix

1. Go to https://remix.ethereum.org.
2. Create a new file `ArcNameRegistry.sol` under `contracts/` and paste the contents of
   [`contracts/ArcNameRegistry.sol`](contracts/ArcNameRegistry.sol)
   (or upload the repo folder / use the GitHub import of this repo).
3. In the **Solidity compiler** tab, pick compiler `0.8.20+` (Arc targets the Osaka EVM baseline;
   `0.8.20+commit…` works) and click **Compile ArcNameRegistry.sol**. It should compile with zero warnings.

## 2 · Point Remix at Arc Testnet

In the **Deploy & run transactions** tab:

1. Environment → **Injected Provider – MetaMask** (or your browser wallet).
2. MetaMask will ask to connect — accept, then **switch the network to Arc Testnet**.
   - If Arc Testnet is not in your wallet yet, add it manually with the params from the table above
     (Chain ID `5042002`, symbol `USDC`, explorer `https://testnet.arcscan.app`), or connect once
     through the ArcName app’s wallet panel which adds it via `wallet_addEthereumChain`.
3. Verify the connected account shows **Arc Testnet · 5042002**. The account needs a little test USDC
   for gas — grab some at https://faucet.circle.com if it is empty.

## 3 · Deploy

1. In the **Deploy** section of the Remix tab, find the constructor argument **`uint256 initialPrice`**.
   This is the registration fee in **native USDC (18 decimals)** charged to every registrant
   (`msg.value`) and collected in the contract (admin can `withdraw()` it):
   - `0` → **free registration** (registrants pay only Arc gas) — recommended for testing.
   - `1000000000000000000` (1e18) → **1 USDC per name**.
   - `5000000000000000` (5e15) → 0.005 USDC per name.
2. Click the orange **Deploy** and confirm the transaction in your wallet (gas is paid in USDC).
3. Arc finality is sub-second — within a moment the deployed instance appears under **Deployed Contracts**.

> Tip: you can change the fee later by calling `setPrice` as the admin, and send collected fees to
> yourself with `withdraw()`.

## 4 · Configure the app

1. Copy the deployed contract address (`0x…`) from Remix.
2. Open [`js/config.js`](js/config.js) and paste it into the `REGISTRY_ADDRESS` constant:
   ```js
   var REGISTRY_ADDRESS = '0xYourDeployedAddressHere';
   ```
   Keep the quotes and the leading `0x` — the app validates the format (`0x` + 40 hex chars).
3. Save and refresh the site. The registry console should switch from the amber “not deployed” panel to
   a green **“Registry live”** bar showing the address, name count and fee.

## 5 · Smoke-test the integration

1. In the site’s registry console, search a name like `alice`.
2. Expect: green **Available**, with the fee read live from the contract.
3. Connect your wallet, click **Register**, confirm in MetaMask.
4. The console streams the transaction: broadcast → receipt polling → confirmed, and the name appears
   under **This session · real transactions** with a link to ArcScan.
5. Search the same name again → it now shows **Taken** with your address as owner (read straight from
   the contract via `ownerOf`).

## Contract reference (ABI)

Solidity gives you the ABI automatically; here are the selectors the front-end uses (helpful if you
call the contract yourself):

| Function | Selector |
| --- | --- |
| `register(string)` | `0xf2c298be` |
| `isAvailable(string)` | `0x965306aa` |
| `ownerOf(string)` | `0x920ffa26` |
| `totalNames()` | `0xa38cb6c1` |
| `price()` | `0xa035b1fe` |
| `transfer(string,address)` | `0xfbf58b3e` |
| `setMetadataURI(string,string)` | `0x1a157e0a` |
| `getAllNames()` | `0xfb825e5f` |
| `withdraw()` | `0x3ccfd60b` |

Name rules enforced onchain: **3–32 chars, `a-z` and `0-9` only** (lowercase). IDs are
`keccak256(name)`; names are unique, ownership is transferable only by the owner, and v1 has no renewals.

## Security notes (read before mainnet)

- This is a **testnet experiment**. The contract is intentionally minimal and has not been audited.
- On Arc, native-value transfers to `address(0)` and burns revert; `withdraw()` sends to `admin` — never
  set `admin` to `0x0`.
- Fees sit in the contract until withdrawn; keep the admin key safe.
- If you deploy a second registry (e.g. with a different price), point the app at the new address —
  names are **not** shared between instances.
