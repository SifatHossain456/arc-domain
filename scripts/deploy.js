/**
 * Deploy ArcNameRegistry to Arc testnet.
 *
 * Usage (3 commands):
 *   1) Grab test USDC for your wallet at https://faucet.circle.com
 *   2) `cp .env.example .env` and fill in PRIVATE_KEY (optionally ARC_INITIAL_PRICE)
 *   3) `npx hardhat run scripts/deploy.js --network arcTestnet`
 *
 * Prints the deployed address plus the exact line to paste into js/config.js.
 *
 * Gas: sends an EIP-1559 type-2 transaction honouring Arc's rules —
 * maxFeePerGas >= 20 gwei (hard floor), priority tip 0–1 gwei. The fee cap is
 * only a ceiling: Arc charges base fee + tip, so a 20 gwei cap does not mean
 * you pay 20 gwei.
 */
const { ethers } = require('hardhat');

const ARC_FEE_FLOOR_WEI = 20_000_000_000n; // 20 gwei — Arc's maxFeePerGas floor

async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    console.error('No signer available. On arcTestnet this means PRIVATE_KEY is missing from .env — see .env.example.');
    process.exitCode = 1;
    return;
  }
  const deployer = signers[0];
  console.log('Deployer:', deployer.address);

  // Registration price in native USDC (18 decimals): "0" = free, "1" = 1 USDC.
  const rawPrice = process.env.ARC_INITIAL_PRICE || '0';
  const initialPrice = ethers.parseEther(rawPrice);

  let maxFeePerGas = ethers.parseUnits(String(process.env.ARC_FEE_CAP_GWEI || 20), 'gwei');
  if (maxFeePerGas < ARC_FEE_FLOOR_WEI) {
    console.log(`Note: configured fee cap is below Arc's 20 gwei floor — using 20 gwei.`);
    maxFeePerGas = ARC_FEE_FLOOR_WEI;
  }
  const maxPriorityFeePerGas = ethers.parseUnits(String(process.env.ARC_TIP_GWEI || 1), 'gwei');

  console.log('Gas (EIP-1559): maxFeePerGas =', maxFeePerGas.toString(), 'wei · maxPriorityFeePerGas =', maxPriorityFeePerGas.toString(), 'wei');

  const factory = await ethers.getContractFactory('ArcNameRegistry');
  const registry = await factory.deploy(initialPrice, {
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit: 1_500_000
  });
  await registry.waitForDeployment();

  const addr = await registry.getAddress();
  console.log('\nArcNameRegistry deployed to:', addr);
  console.log('Registration price:', initialPrice.toString(), `(native USDC, 18 dec — i.e. ${rawPrice} USDC)`);
  console.log('ArcScan:', `https://testnet.arcscan.app/address/${addr}`);
  console.log('\nPaste this exact line into js/config.js:\n');
  console.log(`var REGISTRY_ADDRESS = '${addr}'; // Arc testnet ArcNameRegistry\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
