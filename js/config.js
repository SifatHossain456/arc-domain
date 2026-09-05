/**
 * ArcName — app configuration.
 * Loaded before app.js. Edit REGISTRY_ADDRESS after deploying the contract
 * (see DEPLOY.md). Nothing here is faked: if a value is empty, the UI shows
 * an honest "not configured" state instead of pretending.
 */
(function (root) {
  'use strict';

  // Arc testnet chain parameters — verified against the official Arc docs
  // (https://docs.arc.io, /arc/references/connect-to-arc and /evm-differences).
  var CHAIN = {
    chainId: 5042002,
    chainIdHex: '0x4CEF52', // 5042002 in hex
    name: 'Arc Testnet',
    // IMPORTANT — Arc runs USDC as its NATIVE token. The native interface
    // exposes 18 decimals (the docs' own warning: "USDC uses 18 decimals
    // natively (not 6)"). eth_getBalance therefore returns 18-decimal native
    // USDC. A separate ERC-20 interface exists with 6 decimals, but that is
    // NOT what eth_getBalance returns — dividing by 1e6 would show a balance
    // that is 10^12x too large. Source:
    // https://docs.arc.io/arc/references/evm-differences
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    // RPC endpoints, tried in order until one answers.
    rpcUrls: [
      'https://rpc.testnet.arc.network',
      'https://rpc.testnet.arc.io'
    ],
    blockExplorerUrl: 'https://testnet.arcscan.app',
    faucetUrl: 'https://faucet.circle.com',
    docsUrl: 'https://docs.arc.network'
  };

  // Blockscout REST API (free) — powers the live Network stats panel.
  // GET https://testnet.arcscan.app/api/v2/stats → gas_prices {slow,average,fast}
  // in gwei, transactions_today, total_transactions, total_addresses,
  // network_utilization_percentage, average_block_time (ms).
  var STATS = {
    url: 'https://testnet.arcscan.app/api/v2/stats',
    refreshMs: 15000,          // panel refresh cadence
    simpleTransferGas: 21000,  // plain USDC transfer gas — used for the "$ per transfer" column
    gasTrackerUrl: 'https://testnet.arcscan.app/gas-tracker',
    statusUrl: 'https://status.arc.io'
  };

  // Arc gas rules (verified): EIP-1559 type-2 transactions only, with
  // maxFeePerGas >= 20 gwei (hard floor) and a priority tip of 0–1 gwei.
  var TX_FEES = {
    maxFeeFloorGwei: 20, // Arc's minimum maxFeePerGas
    tipGwei: 1           // maxPriorityFeePerGas we send
  };

  // Deployment address of contracts/ArcNameRegistry.sol on Arc testnet.
  // Until this is set, the app honestly disables availability checks and
  // registration and shows the "deploy to activate" panel instead.
  var REGISTRY_ADDRESS = ''; // e.g. '0xAbC123...'

  var CONFIG = {
    productName: 'ArcName',
    displaySuffix: '.arc',       // purely a presentational namespace
    chain: CHAIN,
    registryAddress: REGISTRY_ADDRESS,
    telemetryMs: 10000,          // live RPC telemetry refresh interval
    balanceMs: 10000,            // wallet balance refresh interval
    minNameLength: 3,
    maxNameLength: 32,
    receiptPollMs: 1500,         // tx receipt polling interval
    receiptTimeoutMs: 90000,     // give up polling after this long
    stats: STATS,
    txFees: TX_FEES
  };

  root.ARC_CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
