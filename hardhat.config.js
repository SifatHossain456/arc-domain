/**
 * ArcName — Hardhat configuration.
 *
 * Arc testnet facts (verified against https://docs.arc.network):
 *   • chainId 5042002 (0x4CEF52), RPC https://rpc.testnet.arc.network
 *   • native gas token is USDC — eth_getBalance / msg.value use 18 decimals
 *   • EIP-1559 rule: maxFeePerGas must be >= 20 gwei, priority tip 0–1 gwei
 *     (a legacy tx must use gasPrice >= 20 gwei instead)
 *   • instant finality; native value transfers to 0x0 / blocklisted accounts revert
 *
 * `npx hardhat test` runs against the in-process hardhat network. To deploy on
 * Arc testnet, create a .env from .env.example and run:
 *   npx hardhat run scripts/deploy.js --network arcTestnet
 */
require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

const ARC_RPC = process.env.ARC_RPC || 'https://rpc.testnet.arc.network';
const PRIVATE_KEY = (process.env.PRIVATE_KEY || '').trim();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      // Local in-process test network — Arc's gas rules do not apply here.
      chainId: 31337
    },
    arcTestnet: {
      url: ARC_RPC,
      chainId: 5042002,
      // Private key for the deployment wallet (pays gas in native USDC).
      // Loaded from .env via dotenv; omitted when not configured so that
      // `npx hardhat test` / `compile` never require it.
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {})
      // EIP-1559 / 20 gwei floor note: Hardhat v2 exposes no per-network fee
      // fields, so scripts/deploy.js sends a type-2 transaction with explicit
      // maxFeePerGas / maxPriorityFeePerGas derived from ARC_FEE_CAP_GWEI and
      // ARC_TIP_GWEI, always honouring Arc's 20 gwei maxFeePerGas floor.
    }
  }
};
